import AVFoundation
import Foundation

/// One live conversation with the OpenAI Realtime API, phone ↔ OpenAI directly.
///
/// The phone opens its own WebSocket with a short-lived client secret from `/api/realtime/session`;
/// no audio passes through our server. Turns are automatic: the API's voice activity detection
/// (configured server-side with a long silence allowance, since older speakers pause mid-sentence)
/// decides when the wearer has finished, the model answers in its own voice, and the phone plays the
/// 24 kHz PCM over the glasses. Half-duplex unless `bargeIn`: the mic is closed while the glasses
/// speak, so the open-ear speakers next to the temple mics cannot echo into a new turn.
///
/// Each finished turn (what was heard, what was said) is handed to `onTurn` for the memory log.
/// All state lives on the main actor.
@MainActor
final class RealtimeChat {
  struct Config {
    let url: URL
    let clientSecret: String
    let model: String
    let sessionId: String
    let bargeIn: Bool
    /// Spoken by the model as soon as the session opens, so the wearer knows to talk. "" for none.
    let greeting: String
    /// Spoken when the conversation ends for idleness. "" for none.
    let farewell: String
    /// End after this long with nobody speaking.
    let idleSeconds: TimeInterval
  }

  enum State: String { case connecting, listening, hearing, thinking, speaking, ended }

  private struct Turn {
    var userItemId: String?
    var question: String?
    var answer: String?
    var frame = false
  }

  let config: Config
  private(set) var state: State = .connecting
  private(set) var turnsLogged = 0

  var onState: ((State, String?) -> Void)?             // (state, reason)
  var onTranscript: ((String, String, Bool) -> Void)?  // (role "user" | "assistant", text so far, final)
  var onTurn: ((String, String, Bool) -> Void)?        // (question, answer, frame was shown)
  var onError: ((String) -> Void)?
  /// JPEG of what the glasses see right now, or nil. Asked once per wearer turn, as they start talking.
  var frameProvider: (() -> Data?)?
  /// Set before `start()` when "Hey Remi" opened this conversation: the last ~3 s of mic audio
  /// (24 kHz PCM16), so the question said in the same breath as the phrase is heard. The greeting
  /// is skipped (the wearer already spoke), the mic opens at once, and audio arriving before the
  /// session is ready is held rather than dropped.
  var preroll: Data?
  private var held = Data()
  private static let heldMaxBytes = 24000 * 2 * 15

  private var task: URLSessionWebSocketTask?
  private let urlSession: URLSession = {
    let cfg = URLSessionConfiguration.default
    cfg.waitsForConnectivity = false
    cfg.timeoutIntervalForRequest = 15
    return URLSession(configuration: cfg)
  }()
  private let audioOut = RealtimeAudioOut()

  private var ended = false
  private var sessionReady = false
  private var micOpen = false
  private var micBuffer = Data()
  /// ~100 ms of 24 kHz PCM16 per append, so the socket is not flooded with tiny frames.
  private static let micChunkBytes = 24000 * 2 / 10

  private var turn = Turn()
  private var turnGrace: Task<Void, Never>?
  private var userPartial = ""
  private var assistantText = ""
  private var currentResponseId: String?
  private var currentItemId: String?
  /// Set right before a scripted `response.create` (greeting/farewell); claimed by the next `response.created`.
  private var pendingScript = false
  private var scriptedResponses = Set<String>()
  private var farewellResponseId: String?
  private var idleTimer: Task<Void, Never>?
  private var micReopen: Task<Void, Never>?

  init(config: Config) {
    self.config = config
  }

  // MARK: Lifecycle

  func start() throws {
    audioOut.onError = { [weak self] msg in Task { @MainActor in self?.onError?(msg) } }
    audioOut.onDrained = { [weak self] in Task { @MainActor in self?.playbackDrained() } }
    try audioOut.start()

    var req = URLRequest(url: config.url)
    req.setValue("Bearer \(config.clientSecret)", forHTTPHeaderField: "Authorization")
    let t = urlSession.webSocketTask(with: req)
    task = t
    t.resume()
    receiveLoop()
    setState(.connecting)
    NSLog("[Chat] connecting to \(config.url.host ?? "") model \(config.model) session \(config.sessionId) barge-in \(config.bargeIn)")
  }

  /// Ends the conversation now (user tapped End, stream torn down, app going away).
  func stop(reason: String = "stopped") {
    end(reason: reason, error: nil)
  }

  private func end(reason: String, error: String?) {
    guard !ended else { return }
    ended = true
    micOpen = false
    idleTimer?.cancel()
    micReopen?.cancel()
    turnGrace?.cancel()
    flushTurn(force: true)
    audioOut.stopEngine()
    task?.cancel(with: .normalClosure, reason: nil)
    task = nil
    if let error { onError?(error) }
    NSLog("[Chat] ended (\(reason)); \(turnsLogged) turn(s)")
    setState(.ended, reason: reason)
  }

  private func fail(_ message: String) {
    guard !ended else { return }
    NSLog("[Chat] failed: \(message)")
    end(reason: "error", error: message)
  }

  private func setState(_ s: State, reason: String? = nil) {
    if s == state && reason == nil { return }
    state = s
    onState?(s, reason)
  }

  // MARK: Microphone

  /// 24 kHz mono PCM16 from AudioCapture. Dropped while the glasses are speaking (half-duplex) and
  /// before the session is ready.
  func feed(pcm24k: Data) {
    guard !ended else { return }
    if preroll != nil, !sessionReady {
      // Woken by voice: the wearer is mid-question while the socket opens. Keep it.
      if held.count < Self.heldMaxBytes { held.append(pcm24k) }
      return
    }
    guard micOpen, sessionReady else { return }
    micBuffer.append(pcm24k)
    guard micBuffer.count >= Self.micChunkBytes else { return }
    let chunk = micBuffer
    micBuffer.removeAll(keepingCapacity: true)
    send(["type": "input_audio_buffer.append", "audio": chunk.base64EncodedString()])
  }

  private func openMic() {
    guard !ended, sessionReady else { return }
    micBuffer.removeAll(keepingCapacity: true)
    micOpen = true
    setState(.listening)
    restartIdleTimer()
  }

  private func closeMic() {
    micOpen = false
    micBuffer.removeAll(keepingCapacity: true)
    micReopen?.cancel()
  }

  // MARK: Idle

  private func restartIdleTimer() {
    idleTimer?.cancel()
    let seconds = config.idleSeconds
    guard seconds > 0 else { return }
    idleTimer = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      guard let self, !Task.isCancelled, !self.ended else { return }
      self.sayFarewellAndEnd()
    }
  }

  private func sayFarewellAndEnd() {
    guard farewellResponseId == nil, state == .listening else { return }
    closeMic()
    guard !config.farewell.isEmpty else { return end(reason: "idle", error: nil) }
    NSLog("[Chat] idle for \(Int(config.idleSeconds)) s; saying goodbye")
    farewellResponseId = "pending"
    sayScripted(config.farewell)
  }

  /// A line the model speaks word for word, outside the conversation history.
  private func sayScripted(_ text: String) {
    pendingScript = true
    send([
      "type": "response.create",
      "response": [
        "conversation": "none",
        "output_modalities": ["audio"],
        "instructions": "Say exactly this, warmly, and nothing else: \"\(text)\"",
      ],
    ])
  }

  // MARK: Socket

  private func send(_ obj: [String: Any]) {
    guard let t = task, let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    t.send(.string(String(decoding: data, as: UTF8.self))) { [weak self] err in
      guard let err else { return }
      Task { @MainActor in self?.fail("Connection to the assistant was lost: \(err.localizedDescription)") }
    }
  }

  private func receiveLoop() {
    task?.receive { [weak self] result in
      Task { @MainActor in
        guard let self, !self.ended else { return }
        switch result {
        case .failure(let e):
          self.fail("Connection to the assistant was lost: \(e.localizedDescription)")
        case .success(let msg):
          switch msg {
          case .string(let s): self.handle(s)
          case .data(let d): self.handle(String(decoding: d, as: UTF8.self))
          @unknown default: break
          }
          self.receiveLoop()
        }
      }
    }
  }

  // MARK: Events

  private func handle(_ raw: String) {
    guard let data = raw.data(using: .utf8),
          let ev = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let type = ev["type"] as? String else { return }

    switch type {
    case "session.created":
      sessionReady = true
      NSLog("[Chat] session open")
      if let pre = preroll {
        // "Hey Remi, who is this?": send what was said before and during connecting, then go live.
        // Server VAD finds the speech in it and ends the turn as usual; no commit needed.
        preroll = nil
        openMic()
        // Fresh Data so indices start at 0: `pre` comes from a ring buffer trimmed with removeFirst,
        // which leaves a non-zero startIndex, and Data slicing by absolute index traps on that.
        var backlog = Data(capacity: pre.count + held.count)
        backlog.append(pre)
        backlog.append(held)
        held.removeAll()
        NSLog("[Chat] wake pre-roll \(pre.count / 48) ms + \(backlog.count / 48 - pre.count / 48) ms held")
        var i = backlog.startIndex
        while i < backlog.endIndex {
          let end = min(i + 48000, backlog.endIndex) // 1 s per append
          send(["type": "input_audio_buffer.append", "audio": backlog.subdata(in: i..<end).base64EncodedString()])
          i = end
        }
      } else if config.greeting.isEmpty { openMic() } else { sayScripted(config.greeting) }
      // Safety net: if the greeting never plays (rejected, no audio), the wearer must still be heard.
      Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: 8_000_000_000)
        guard let self, !self.ended, !self.micOpen, self.audioOut.isIdle, self.farewellResponseId == nil else { return }
        NSLog("[Chat] greeting did not finish in 8 s; opening the mic anyway")
        self.openMic()
      }

    case "input_audio_buffer.speech_started":
      idleTimer?.cancel()
      beginUserTurn()

    case "input_audio_buffer.speech_stopped":
      setState(.thinking)

    case "input_audio_buffer.committed":
      turn.userItemId = ev["item_id"] as? String

    case "conversation.item.input_audio_transcription.delta":
      if let d = ev["delta"] as? String {
        userPartial += d
        onTranscript?("user", userPartial, false)
      }

    case "conversation.item.input_audio_transcription.completed":
      let text = (ev["transcript"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let itemId = ev["item_id"] as? String
      if turn.userItemId == nil || turn.userItemId == itemId {
        turn.question = text
        userPartial = ""
        onTranscript?("user", text, true)
        NSLog("[Chat] heard: \(text)")
        flushTurn(force: false)
      } else {
        NSLog("[Chat] late transcript for \(itemId ?? "?"): \(text)")
      }

    case "conversation.item.input_audio_transcription.failed":
      turn.question = ""
      flushTurn(force: false)

    case "response.created":
      let id = (ev["response"] as? [String: Any])?["id"] as? String
      currentResponseId = id
      currentItemId = nil
      assistantText = ""
      audioOut.beginResponse()
      if pendingScript, let id {
        pendingScript = false
        scriptedResponses.insert(id)
        if farewellResponseId == "pending" { farewellResponseId = id }
      }
      if !config.bargeIn { closeMic() }
      setState(.thinking)

    case "response.output_item.added":
      if let item = ev["item"] as? [String: Any], let id = item["id"] as? String { currentItemId = id }

    case "response.output_audio.delta":
      if let b64 = ev["delta"] as? String, let pcm = Data(base64Encoded: b64) {
        audioOut.enqueue(pcm)
        if state != .speaking { setState(.speaking) }
      }

    case "response.output_audio_transcript.delta":
      if let d = ev["delta"] as? String {
        assistantText += d
        onTranscript?("assistant", assistantText, false)
      }

    case "response.output_audio_transcript.done":
      if let t = ev["transcript"] as? String, !t.isEmpty { assistantText = t }
      onTranscript?("assistant", assistantText, true)

    case "response.done":
      responseDone(ev["response"] as? [String: Any])

    case "error":
      let err = ev["error"] as? [String: Any]
      let msg = err?["message"] as? String ?? "unknown error"
      let code = err?["code"] as? String ?? ""
      NSLog("[Chat] API error \(code): \(msg)")
      if code.contains("auth") || msg.localizedCaseInsensitiveContains("api key") || msg.localizedCaseInsensitiveContains("expired") {
        fail("The assistant refused the connection: \(msg)")
      } else {
        onError?(msg)
        if pendingScript {
          // The greeting/farewell request itself was rejected: do not leave the wearer unheard.
          pendingScript = false
          if farewellResponseId == "pending" { end(reason: "idle", error: nil) } else if !micOpen { openMic() }
        }
      }

    default:
      break
    }
  }

  /// The wearer started talking: a new turn. A previous answer still waiting for its transcript is
  /// logged as is, and the glasses stop talking if barge-in is allowed.
  private func beginUserTurn() {
    flushTurn(force: true)
    turn = Turn()
    userPartial = ""
    if config.bargeIn, state == .speaking || state == .thinking, let item = currentItemId {
      let ms = audioOut.playedMs
      audioOut.interrupt()
      // The server cancelled the response (interrupt_response); tell it how much the wearer heard.
      send(["type": "conversation.item.truncate", "item_id": item, "content_index": 0, "audio_end_ms": ms])
    }
    setState(.hearing)
    // What they are looking at as they ask. One per turn, discarded by OpenAI with the session.
    if let jpeg = frameProvider?() {
      turn.frame = true
      send([
        "type": "conversation.item.create",
        "item": [
          "type": "message",
          "role": "user",
          "content": [
            ["type": "input_text", "text": "What I see right now through my glasses:"],
            ["type": "input_image", "image_url": "data:image/jpeg;base64,\(jpeg.base64EncodedString())"],
          ],
        ],
      ])
    }
  }

  private func responseDone(_ r: [String: Any]?) {
    let id = r?["id"] as? String
    let status = r?["status"] as? String ?? "completed"
    if status != "completed" && status != "cancelled" {
      let details = r?["status_details"] as? [String: Any]
      let why = (details?["error"] as? [String: Any])?["message"] as? String ?? details?["reason"] as? String ?? status
      NSLog("[Chat] response \(status): \(why)")
      onError?("The assistant could not answer: \(why)")
    }
    if assistantText.isEmpty, let output = r?["output"] as? [[String: Any]] {
      // No transcript deltas (text-only response): read the text out of the output items.
      assistantText = output
        .flatMap { ($0["content"] as? [[String: Any]]) ?? [] }
        .compactMap { ($0["transcript"] as? String) ?? ($0["text"] as? String) }
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let scripted = id.map { scriptedResponses.contains($0) } ?? false
    if !scripted, status != "cancelled", !assistantText.isEmpty {
      turn.answer = assistantText
      NSLog("[Chat] said: \(assistantText)")
      flushTurn(force: false)
      // The wearer's transcript usually lands first; if not, give it a moment and log without it.
      turnGrace?.cancel()
      turnGrace = Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        guard let self, !Task.isCancelled else { return }
        self.flushTurn(force: true)
      }
    }
    // Audio may still be playing: the mic reopens when the last buffer has played.
    audioOut.endOfResponse()
  }

  private func playbackDrained() {
    guard !ended else { return }
    if let fid = farewellResponseId, fid == currentResponseId {
      end(reason: "idle", error: nil)
      return
    }
    if micOpen {
      // Barge-in mode: the mic never closed. Back to listening unless the wearer is already talking.
      if state == .speaking || state == .thinking {
        setState(.listening)
        restartIdleTimer()
      }
      return
    }
    // A short tail so the speakers' last syllable is not heard as the start of a new turn.
    micReopen?.cancel()
    micReopen = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 300_000_000)
      guard let self, !Task.isCancelled else { return }
      self.openMic()
    }
  }

  /// Hands a finished turn to the log once both halves are in (or when forced, with whatever is there).
  private func flushTurn(force: Bool) {
    guard let answer = turn.answer else { return }
    if turn.question == nil && !force { return }
    turnGrace?.cancel()
    let question = turn.question ?? ""
    let frame = turn.frame
    turn.answer = nil
    turn.question = nil
    turnsLogged += 1
    onTurn?(question, answer, frame)
  }
}

/// Plays streamed 24 kHz mono PCM16 through an AVAudioEngine player node on the current route
/// (Bluetooth A2DP on the glasses). Reports when everything scheduled has actually played, so the
/// conversation can reopen the mic, and how many milliseconds played, for truncation on barge-in.
final class RealtimeAudioOut {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
  private var running = false
  private var pending = 0
  private var awaitingEnd = false
  private var generation = 0
  private var playedFrames = 0
  /// Jitter buffer. Network deltas arrive in bursts; scheduling each one as it lands means every
  /// late packet is an audible gap. Audio is staged here and scheduled in 200 ms pieces, after a
  /// 400 ms head start at the beginning of each response (and again after an underrun).
  private var staging = Data()
  private var primed = false
  private var underruns = 0
  private static let preRollBytes = 24000 * 2 * 400 / 1000
  private static let pieceBytes = 24000 * 2 * 200 / 1000

  var onDrained: (() -> Void)?
  var onError: ((String) -> Void)?

  init() {
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    NotificationCenter.default.addObserver(self, selector: #selector(configurationChanged), name: .AVAudioEngineConfigurationChange, object: engine)
  }

  var playedMs: Int { playedFrames * 1000 / 24000 }
  /// Nothing scheduled and nothing playing.
  var isIdle: Bool { pending == 0 }

  func start() throws {
    guard !running else { return }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      throw GlassesError("Could not start audio output for the conversation: \(error.localizedDescription)")
    }
    player.play()
    running = true
  }

  func stopEngine() {
    guard running else { return }
    generation += 1
    player.stop()
    engine.stop()
    running = false
    pending = 0
    awaitingEnd = false
    staging.removeAll()
    primed = false
  }

  /// A new response is about to stream: drop anything left over and reset the play clock.
  func beginResponse() {
    interrupt()
    playedFrames = 0
    underruns = 0
  }

  /// Stops playback now and forgets the scheduled buffers (barge-in).
  func interrupt() {
    generation += 1
    pending = 0
    awaitingEnd = false
    staging.removeAll(keepingCapacity: true)
    primed = false
    guard running else { return }
    player.stop()
    player.play()
  }

  /// Stages a network delta; playback starts once enough is buffered to ride out jitter.
  func enqueue(_ pcm16: Data) {
    guard running else { return }
    staging.append(pcm16)
    drainStaging(final: false)
  }

  private func drainStaging(final: Bool) {
    let threshold = primed ? Self.pieceBytes : Self.preRollBytes
    guard !staging.isEmpty, final || staging.count >= threshold else { return }
    // Whole pieces only while streaming, so each scheduled buffer is a steady 200 ms.
    let take = final ? staging.count : staging.count - (staging.count % Self.pieceBytes)
    guard take > 0 else { return }
    schedule(staging.prefix(take))
    staging.removeFirst(take)
    primed = true
  }

  private func schedule(_ pcm16: Data) {
    let n = pcm16.count / 2
    guard n > 0, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n)) else { return }
    buf.frameLength = AVAudioFrameCount(n)
    var samples = [Int16](repeating: 0, count: n)
    _ = samples.withUnsafeMutableBytes { pcm16.copyBytes(to: $0) }
    let out = buf.floatChannelData![0]
    for i in 0..<n { out[i] = Float(Int16(littleEndian: samples[i])) / 32768 }
    pending += 1
    let gen = generation
    player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async { self?.played(frames: n, generation: gen) }
    }
    if !player.isPlaying { player.play() }
  }

  /// The response has no more audio coming; `onDrained` fires when the last scheduled buffer has played.
  func endOfResponse() {
    drainStaging(final: true)
    if underruns > 0 { NSLog("[Chat] audio: \(underruns) underrun(s) this response") }
    if pending == 0 { onDrained?() } else { awaitingEnd = true }
  }

  private func played(frames: Int, generation gen: Int) {
    guard gen == generation else { return }  // a buffer from before an interrupt
    playedFrames += frames
    pending = max(0, pending - 1)
    if pending == 0, !awaitingEnd, primed {
      // Ran dry mid-response: the network fell behind. Build up a head start again before resuming.
      underruns += 1
      primed = false
    }
    if pending == 0, awaitingEnd {
      awaitingEnd = false
      onDrained?()
    }
  }

  /// The route changed (glasses connected or dropped): the engine stops itself and must be restarted.
  @objc private func configurationChanged(_ note: Notification) {
    DispatchQueue.main.async {
      guard self.running else { return }
      do {
        try self.engine.start()
        self.player.play()
      } catch {
        self.onError?("Audio output stopped after a route change: \(error.localizedDescription)")
      }
    }
  }
}
