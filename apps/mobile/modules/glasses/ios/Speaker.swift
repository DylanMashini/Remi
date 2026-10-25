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
    /// Stereo position, -1 (left) to 1 (right). Where the recognized face was in the frame, so
    /// over A2DP the name comes from the side the person is standing on. 0 for answers/reminders.
    let pan: Float
    let completion: ((String) -> Void)?
  }

  var onRoute: ((String, String) -> Void)?   // (route, portName)
  var onSpoken: ((String, String, Float) -> Void)?  // (text, route, pan)
  var onError: ((String) -> Void)?
  /// Fires when a line starts playing and when the queue goes idle. The wake word listener mutes
  /// itself while Remi talks so Remi's own voice ("Hey Remi" is never in a line, but why risk it) is not heard.
  var onSpeakingChanged: ((Bool) -> Void)?

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
  /// Incremented every time `current` changes. A download or watchdog started for one line checks
  /// it before acting, so a late result never plays over (or finishes) a later line.
  private var lineSeq = 0
  private var watchdog: DispatchWorkItem?
  /// The utterance speaking the current line. stopSpeaking (watchdog, interruption) delivers didCancel
  /// after finishCurrent has already moved on to the next line; without this check that stale
  /// callback would finish the next line before it is spoken.
  private var currentUtterance: AVSpeechUtterance?

  override init() {
    super.init()
    synth.delegate = self
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
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
        // No .allowBluetoothA2DP here: it is only valid with .playAndRecord (playback always routes to
        // A2DP). With it, iOS rejected the whole call with -50 on every line and setActive never ran.
        try s.setCategory(.playback, mode: .spokenAudio, options: [])
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

  /// When the Bluetooth route disappears mid-line (glasses folded, powered off, out of range) iOS
  /// pauses the AVAudioPlayer and never calls audioPlayerDidFinishPlaying, so without this `current`
  /// stays set and every later line queues silently for the rest of the session (same failure class
  /// as the Spotify interruption below). A paused player on a route change means the line is lost;
  /// drop it and move on. A player that is still playing after the change is left alone.
  @objc private func routeChanged(_ note: Notification) {
    let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
    let reason = raw.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
    DispatchQueue.main.async {
      _ = self.checkRoute()
      guard let line = self.current, let p = self.player else { return }
      if p.isPlaying || self.synth.isSpeaking { return }
      let why = reason == .oldDeviceUnavailable ? "output device went away" : "route changed (reason \(raw ?? 0))"
      NSLog("[Glasses] \(why) while a line was paused; dropping line: \(line.text)")
      p.stop()
      self.finishCurrent()
    }
  }

  // MARK: Watchdog

  /// Guarantees the queue never wedges on a line whose finish callback never arrives (route lost,
  /// download hung, synth stalled). Re-armed whenever a line starts downloading or playing; cancelled
  /// when `current` changes. Fires only if the same line is still current.
  private func armWatchdog(seconds: TimeInterval) {
    watchdog?.cancel()
    let seq = lineSeq
    let item = DispatchWorkItem { [weak self] in
      guard let self, self.lineSeq == seq, let line = self.current else { return }
      NSLog("[Glasses] speech watchdog: line still current after \(Int(seconds)) s, dropping: \(line.text)")
      self.player?.stop()
      if self.synth.isSpeaking { self.synth.stopSpeaking(at: .immediate) }
      self.finishCurrent()
    }
    watchdog = item
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
  }

  /// Another app (music, a call, Siri) took the audio session. An interrupted AVAudioPlayer never
  /// reports finishing, so without this the current line stays "playing" and every later line waits
  /// behind it forever. The interruption may never end (the other app keeps playing), so the line is
  /// dropped at .began and the queue moves on; .ended just reactivates the session.
  @objc private func interrupted(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    DispatchQueue.main.async {
      switch type {
      case .began:
        guard let line = self.current else { return }
        NSLog("[Glasses] audio interrupted by another app; dropping line: \(line.text)")
        self.player?.stop()
        if self.synth.isSpeaking { self.synth.stopSpeaking(at: .immediate) }  // its didCancel is a no-op once current is nil
        self.finishCurrent()
      case .ended:
        NSLog("[Glasses] audio interruption ended")
        self.configureSession()
        self.playNextIfIdle()
      @unknown default:
        break
      }
    }
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

  /// `pan` is -1 (left) to 1 (right); values outside are clamped.
  func enqueue(speechId: String?, text: String, pan: Float = 0, completion: ((String) -> Void)? = nil) {
    let clamped = max(-1, min(1, pan.isFinite ? pan : 0))
    DispatchQueue.main.async {
      self.queue.append(Line(speechId: speechId, text: text, pan: clamped, completion: completion))
      self.playNextIfIdle()
    }
  }

  private func playNextIfIdle() {
    guard current == nil, !queue.isEmpty else { return }
    let line = queue.removeFirst()
    current = line
    lineSeq &+= 1
    let seq = lineSeq
    onSpeakingChanged?(true)
    configureSession()
    let route = checkRoute()
    if route != "a2dp" { NSLog("[Glasses] WARNING speaking over \(route), not glasses A2DP") }
    if line.pan != 0 { NSLog("[Glasses] pan \(String(format: "%.2f", line.pan)) (\(Self.panLabel(line.pan)))") }

    guard let speechId = line.speechId, !speechId.isEmpty else {
      NSLog("[Glasses] no speechId, using Apple speech")
      speakWithSynth(line.text)
      return
    }
    if let data = Self.cached(speechId) {
      NSLog("[Glasses] speech \(speechId) from cache")
      playAudio(data, pan: line.pan, fallbackText: line.text)
      return
    }
    // Download hung or callback lost: the fetch has an 8 s timeout, so 30 s is comfortably past it.
    armWatchdog(seconds: 30)
    downloadTask = Task {
      let t0 = CFAbsoluteTimeGetCurrent()
      do {
        let data = try await Self.fetch(speechId, timeout: 8)
        NSLog("[Glasses] speech \(speechId) downloaded in \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)) ms")
        await MainActor.run {
          // The line this download was started for is no longer current (dropped by an interruption,
          // a route loss or the watchdog): the data is cached for next time, do not play it now.
          guard self.lineSeq == seq, self.current != nil, !Task.isCancelled else {
            NSLog("[Glasses] speech \(speechId) landed after its line was dropped; ignoring")
            return
          }
          self.playAudio(data, pan: line.pan, fallbackText: line.text)
        }
      } catch {
        await MainActor.run {
          guard self.lineSeq == seq, self.current != nil, !Task.isCancelled else { return }
          NSLog("[Glasses] TTS download failed, using Apple speech: \(error.localizedDescription)")
          self.speakWithSynth(line.text)
        }
      }
    }
  }

  static func panLabel(_ pan: Float) -> String {
    if pan <= -0.2 { return "left" }
    if pan >= 0.2 { return "right" }
    return "centre"
  }

  private func playAudio(_ data: Data, pan: Float, fallbackText: String) {
    do {
      let p = try AVAudioPlayer(data: data)
      p.delegate = self
      // Stereo position of the whisper (A2DP is stereo; HFP/mono routes just ignore it).
      p.pan = pan
      player = p
      if !p.play() { throw GlassesError("AVAudioPlayer.play returned false") }
      // Duration is known here: give the line twice that (at least 10 s) before declaring it stuck.
      let dur = p.duration
      armWatchdog(seconds: dur.isFinite && dur > 0 ? max(10, 2 * dur) : 30)
    } catch {
      NSLog("[Glasses] audio playback failed, using Apple speech: \(error.localizedDescription)")
      player = nil
      speakWithSynth(fallbackText)
    }
  }

  /// Fallback voice. AVSpeechSynthesizer has no pan, so this plays centred.
  private func speakWithSynth(_ text: String) {
    let u = AVSpeechUtterance(string: text)
    u.voice = AVSpeechSynthesisVoice(language: "en-US")
    u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
    // Synth duration is unknown; a Remi line is a sentence or three, 30 s is far past any of them.
    armWatchdog(seconds: 30)
    currentUtterance = u
    synth.speak(u)
  }

  private func finishCurrent() {
    guard let line = current else { return }
    current = nil
    lineSeq &+= 1
    watchdog?.cancel()
    watchdog = nil
    downloadTask?.cancel()
    downloadTask = nil
    player = nil
    currentUtterance = nil
    let route = currentRoute
    NSLog("[Glasses] spoke over \(route) (\(Self.panLabel(line.pan))): \(line.text)")
    onSpoken?(line.text, route, line.pan)
    line.completion?(route)
    if queue.isEmpty { onSpeakingChanged?(false) }
    playNextIfIdle()
  }

  // MARK: Delegates

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    DispatchQueue.main.async {
      // A player dropped by a route loss or the watchdog must not finish the line that replaced it.
      guard player === self.player else { return }
      self.finishCurrent()
    }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    DispatchQueue.main.async {
      guard player === self.player, let line = self.current else { return }
      self.player = nil
      if let id = line.speechId { try? FileManager.default.removeItem(at: Self.cacheURL(id)) }
      self.speakWithSynth(line.text)
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    DispatchQueue.main.async {
      guard utterance === self.currentUtterance else { return }
      self.finishCurrent()
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    DispatchQueue.main.async {
      guard utterance === self.currentUtterance else { return }
      self.finishCurrent()
    }
  }
}
