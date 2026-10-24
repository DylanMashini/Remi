import AVFoundation
import Foundation

/// Plays spoken lines one at a time over the current audio route (Bluetooth A2DP on the glasses).
/// Downloads ElevenLabs audio from /api/speech/<id>; falls back to AVSpeechSynthesizer with the text.
/// All state lives on the main queue.
final class Speaker: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
  struct Line {
    let speechId: String?
    let text: String
    let completion: ((String) -> Void)?
  }

  var onRoute: ((String, String) -> Void)?   // (route, portName)
  var onSpoken: ((String, String) -> Void)?  // (text, route)
  var onError: ((String) -> Void)?

  /// Set by AudioCapture while it needs the mic (play-and-record); otherwise playback-only.
  var recordingActive = false {
    didSet { if oldValue != recordingActive { configureSession() } }
  }

  private var queue: [Line] = []
  private var current: Line?
  private var currentRoute = "other"
  private var player: AVAudioPlayer?
  private let synth = AVSpeechSynthesizer()
  private var downloadTask: Task<Void, Never>?

  override init() {
    super.init()
    synth.delegate = self
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
  }

  // MARK: Session + route

  private var configuredForRecording: Bool?

  func configureSession() {
    let s = AVAudioSession.sharedInstance()
    do {
      if configuredForRecording == recordingActive {
        // Category already right; re-setting it would interrupt a running AVAudioEngine.
      } else if recordingActive {
        // Built-in (or glasses-paired) mic in, A2DP out. No .allowBluetoothHFP so output stays hi-fi.
        try s.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP, .defaultToSpeaker])
      } else {
        try s.setCategory(.playback, mode: .spokenAudio, options: [.allowBluetoothA2DP])
      }
      configuredForRecording = recordingActive
      try s.setActive(true)
    } catch {
      onError?("Audio session setup failed: \(error.localizedDescription)")
    }
    _ = checkRoute()
  }

  /// Reads the current output port, logs it, emits onAudioRoute. Returns the route string.
  @discardableResult
  func checkRoute() -> String {
    let out = AVAudioSession.sharedInstance().currentRoute.outputs.first
    let route: String
    switch out?.portType {
    case .bluetoothA2DP?: route = "a2dp"
    case .bluetoothHFP?, .bluetoothLE?: route = "hfp"
    case .builtInSpeaker?, .builtInReceiver?: route = "speaker"
    default: route = "other"
    }
    let name = out?.portName ?? "none"
    currentRoute = route
    NSLog("[Glasses] audio route: \(route) (\(name))")
    onRoute?(route, name)
    return route
  }

  var route: String { currentRoute }

  @objc private func routeChanged(_ note: Notification) {
    DispatchQueue.main.async { _ = self.checkRoute() }
  }

  // MARK: Queue

  func enqueue(speechId: String?, text: String, completion: ((String) -> Void)? = nil) {
    DispatchQueue.main.async {
      self.queue.append(Line(speechId: speechId, text: text, completion: completion))
      self.playNextIfIdle()
    }
  }

  private func playNextIfIdle() {
    guard current == nil, !queue.isEmpty else { return }
    let line = queue.removeFirst()
    current = line
    configureSession()
    let route = checkRoute()
    if route != "a2dp" { NSLog("[Glasses] WARNING speaking over \(route), not glasses A2DP") }

    guard let speechId = line.speechId, !speechId.isEmpty else {
      speakWithSynth(line.text)
      return
    }
    downloadTask = Task {
      do {
        let req = try BackendClient.shared.request("/api/speech/\(speechId)", timeout: 8)
        let (data, status) = try await BackendClient.shared.send(req)
        guard status == 200, !data.isEmpty else { throw GlassesError("speech \(speechId) HTTP \(status)") }
        await MainActor.run { self.playAudio(data, fallbackText: line.text) }
      } catch {
        NSLog("[Glasses] TTS download failed, using Apple speech: \(error.localizedDescription)")
        await MainActor.run { self.speakWithSynth(line.text) }
      }
    }
  }

  private func playAudio(_ data: Data, fallbackText: String) {
    do {
      let p = try AVAudioPlayer(data: data)
      p.delegate = self
      player = p
      if !p.play() { throw GlassesError("AVAudioPlayer.play returned false") }
    } catch {
      NSLog("[Glasses] audio playback failed, using Apple speech: \(error.localizedDescription)")
      player = nil
      speakWithSynth(fallbackText)
    }
  }

  private func speakWithSynth(_ text: String) {
    let u = AVSpeechUtterance(string: text)
    u.voice = AVSpeechSynthesisVoice(language: "en-US")
    u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
    synth.speak(u)
  }

  private func finishCurrent() {
    guard let line = current else { return }
    current = nil
    player = nil
    let route = currentRoute
    NSLog("[Glasses] spoke over \(route): \(line.text)")
    onSpoken?(line.text, route)
    line.completion?(route)
    playNextIfIdle()
  }

  // MARK: Delegates

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    DispatchQueue.main.async { self.finishCurrent() }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    DispatchQueue.main.async {
      guard let line = self.current else { return }
      self.player = nil
      self.speakWithSynth(line.text)
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    DispatchQueue.main.async { self.finishCurrent() }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    DispatchQueue.main.async { self.finishCurrent() }
  }
}
