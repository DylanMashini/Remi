import AVFoundation
import Foundation

/// Plays spoken lines one at a time over the current audio route (Bluetooth A2DP on the glasses).
/// ElevenLabs audio comes from /api/speech/<id> and is cached on disk; roster lines are prefetched
/// when the roster syncs, so a recognition normally plays from the cache with no network round trip.
/// Falls back to AVSpeechSynthesizer with the text if the audio cannot be fetched or decoded.
/// All queue state lives on the main queue.
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

  // MARK: Audio cache (Library/Caches/speech/<speechId>.mp3)

  // These run from background tasks too, so they stay off the main actor.
  nonisolated private static let cacheDir: URL = {
    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
    let dir = base.appendingPathComponent("speech", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()

  nonisolated private static func cacheURL(_ speechId: String) -> URL {
    cacheDir.appendingPathComponent("\(speechId).mp3")
  }

  nonisolated private static func cached(_ speechId: String) -> Data? {
    let data = try? Data(contentsOf: cacheURL(speechId))
    return (data?.isEmpty == false) ? data : nil
  }

  nonisolated private static func store(_ data: Data, for speechId: String) {
    let url = cacheURL(speechId)
    let tmp = url.appendingPathExtension("tmp")
    do {
      try data.write(to: tmp, options: .atomic)
      _ = try? FileManager.default.removeItem(at: url)
      try FileManager.default.moveItem(at: tmp, to: url)
    } catch {
      NSLog("[Glasses] speech cache write failed for \(speechId): \(error.localizedDescription)")
    }
  }

  /// Downloads /api/speech/<id> (the server generates and caches it once) and stores it locally.
  nonisolated private static func fetch(_ speechId: String, timeout: TimeInterval) async throws -> Data {
    let req = try BackendClient.shared.request("/api/speech/\(speechId)", timeout: timeout)
    let (data, status) = try await BackendClient.shared.send(req)
    guard status == 200, !data.isEmpty else { throw GlassesError("speech \(speechId) HTTP \(status)") }
    store(data, for: speechId)
    return data
  }

  /// Ids with a download in flight (main actor, like the rest of the queue state).
  private var prefetching = Set<String>()

  /// Warms the on-device cache for the given speech ids (roster lines). Safe to call often; ids
  /// already cached or in flight are skipped. Runs a few downloads at a time in the background.
  func prefetch(_ speechIds: [String]) {
    var wanted: [String] = []
    for id in Set(speechIds) where !id.isEmpty && !prefetching.contains(id) && Self.cached(id) == nil {
      prefetching.insert(id)
      wanted.append(id)
    }
    guard !wanted.isEmpty else { return }
    Task.detached(priority: .utility) { [weak self] in
      let t0 = CFAbsoluteTimeGetCurrent()
      var ok = 0
      // Three downloads at a time: on a cache miss each one is the server waiting on ElevenLabs.
      for start in stride(from: 0, to: wanted.count, by: 3) {
        let chunk = Array(wanted[start..<min(start + 3, wanted.count)])
        ok += await withTaskGroup(of: Bool.self, returning: Int.self) { group in
          for id in chunk {
            group.addTask {
              do {
                _ = try await Self.fetch(id, timeout: 20)
                return true
              } catch {
                NSLog("[Glasses] speech prefetch \(id) failed: \(error.localizedDescription)")
                return false
              }
            }
          }
          var n = 0
          for await done in group where done { n += 1 }
          return n
        }
      }
      let ms = Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)
      NSLog("[Glasses] speech prefetch: \(ok)/\(wanted.count) lines cached in \(ms) ms")
      guard let self else { return }
      await MainActor.run { self.prefetching.subtract(wanted) }
    }
  }

  /// Forget cached audio (sign-out).
  func clearCache() {
    try? FileManager.default.removeItem(at: Self.cacheDir)
    try? FileManager.default.createDirectory(at: Self.cacheDir, withIntermediateDirectories: true)
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
      NSLog("[Glasses] no speechId, using Apple speech")
      speakWithSynth(line.text)
      return
    }
    if let data = Self.cached(speechId) {
      NSLog("[Glasses] speech \(speechId) from cache")
      playAudio(data, fallbackText: line.text)
      return
    }
    downloadTask = Task {
      let t0 = CFAbsoluteTimeGetCurrent()
      do {
        let data = try await Self.fetch(speechId, timeout: 8)
        NSLog("[Glasses] speech \(speechId) downloaded in \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)) ms")
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
      if let id = line.speechId { try? FileManager.default.removeItem(at: Self.cacheURL(id)) }
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
