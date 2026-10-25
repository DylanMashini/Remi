import AVFoundation
import Foundation

/// Collects 16 kHz mono PCM16 audio for tap-to-ask and ambient transcription.
/// Primary source: in-band audio frames from the DAT camera stream (glasses mic).
/// Fallback: AVAudioEngine on the phone's input (built-in mic) when no in-band audio arrives.
final class AudioCapture {
  static let sampleRate: Double = 16000
  private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  /// The Realtime API takes PCM16 at 24 kHz only; the live conversation gets its own stream at that rate.
  private let chatFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!

  private let lock = NSLock()
  private var askBuffer = Data()
  private var ambientBuffer = Data()
  private var askActive = false
  private var chatActive = false
  private var ambientEnabled = false
  /// "Hey Remi" listening: every 16 kHz buffer also goes to `onWakeAudio`, and the last few seconds
  /// are kept at 24 kHz so the question said right after the phrase reaches the conversation.
  private var wakeEnabled = false
  private var preroll = Data()
  private let prerollBytes = 24000 * 2 * 3 // 3 s
  private var lastInbandAt: Date?
  private var converters: [String: AVAudioConverter] = [:]

  private let engine = AVAudioEngine()
  private var engineRunning = false
  private var engineForAmbient = false

  /// Called with a ~10 s WAV chunk for /api/utterances.
  var onAmbientChunk: ((Data) -> Void)?
  /// Called with 24 kHz mono PCM16 (no header) for every input buffer while a live conversation runs.
  var onChatAudio: ((Data) -> Void)?
  /// Called with 16 kHz mono PCM16 for every input buffer while wake listening is on and nothing
  /// else (conversation, ask) owns the mic. Audio-thread callback; the detector hops off it.
  var onWakeAudio: ((Data) -> Void)?
  /// Toggles play-and-record on the shared audio session.
  var setRecording: ((Bool) -> Void)?
  var log: ((String) -> Void)?

  private let ambientChunkBytes = Int(16000 * 2 * 10) // 10 s

  var hasRecentInband: Bool {
    lock.lock(); defer { lock.unlock() }
    guard let t = lastInbandAt else { return false }
    return Date().timeIntervalSince(t) < 2
  }

  var source: String { engineRunning ? "phone-mic" : (hasRecentInband ? "glasses-inband" : "none") }

  // MARK: Ambient

  func setAmbient(_ on: Bool) {
    lock.lock(); ambientEnabled = on; if !on { ambientBuffer.removeAll() }; lock.unlock()
    if !on && engineForAmbient && !isAsking { stopEngine() }
  }

  /// Called a few seconds after the stream starts: if the glasses deliver no audio, use the phone mic.
  func ensureAmbientSource() {
    guard !hasRecentInband, !engineRunning else { return }
    log?("No in-band glasses audio; falling back to phone mic (AVAudioEngine) for ambient + ask")
    engineForAmbient = true
    startEngine()
  }

  /// Hands back the ambient audio accumulated since the last 10 s boundary as a WAV, and clears it,
  /// so the words said right before a conversation starts reach the memory log before the
  /// conversation's context is built. Returns nil when under `minSeconds` or silent.
  func flushAmbient(minSeconds: Double = 2) -> Data? {
    lock.lock()
    guard ambientEnabled, ambientBuffer.count >= Int(AudioCapture.sampleRate * 2 * minSeconds) else { lock.unlock(); return nil }
    let chunk = ambientBuffer
    ambientBuffer.removeAll(keepingCapacity: true)
    lock.unlock()
    if AudioCapture.rms(chunk) < 60 { return nil }
    return AudioCapture.wav(pcm16: chunk, sampleRate: Int(AudioCapture.sampleRate))
  }

  var isAsking: Bool { lock.lock(); defer { lock.unlock() }; return askActive }
  var isChatting: Bool { lock.lock(); defer { lock.unlock() }; return chatActive }

  // MARK: Wake word

  /// Audio only flows while a stream runs (in-band, or the ambient phone-mic fallback), so wake
  /// listening is effectively stream-scoped.
  func setWake(_ on: Bool) {
    lock.lock(); wakeEnabled = on; if !on { preroll.removeAll() }; lock.unlock()
  }

  // MARK: Live conversation

  /// Starts feeding `onChatAudio`. Uses the glasses' in-band audio when it is flowing, else the phone mic.
  /// Returns the pre-roll (last ~3 s at 24 kHz, empty unless wake listening was on): taken under the
  /// same lock that flips the chat on, so no buffer is lost or duplicated between the two.
  @discardableResult
  func startChat() throws -> Data {
    lock.lock()
    chatActive = true
    let pre = Data(preroll) // copy: rebases indices to 0 after the ring's removeFirst trims
    preroll.removeAll()
    lock.unlock()
    if !hasRecentInband && !engineRunning {
      log?("Chat: using phone mic (no in-band glasses audio)")
      startEngine()
      if !engineRunning {
        lock.lock(); chatActive = false; lock.unlock()
        throw GlassesError("Could not start microphone capture")
      }
    }
    return pre
  }

  func stopChat() {
    lock.lock(); chatActive = false; lock.unlock()
    if engineRunning && !engineForAmbient && !isAsking { stopEngine() }
  }

  // MARK: Ask

  func startAsk() throws {
    lock.lock(); askBuffer.removeAll(); askActive = true; lock.unlock()
    if !hasRecentInband && !engineRunning {
      log?("Ask: using phone mic (no in-band glasses audio)")
      startEngine()
      if !engineRunning {
        lock.lock(); askActive = false; lock.unlock()
        throw GlassesError("Could not start microphone capture")
      }
    }
  }

  /// Ends capture and returns WAV bytes (16 kHz mono PCM16).
  func stopAsk() -> Data {
    lock.lock()
    askActive = false
    let pcm = askBuffer
    askBuffer.removeAll()
    lock.unlock()
    if engineRunning && !engineForAmbient { stopEngine() }
    return AudioCapture.wav(pcm16: pcm, sampleRate: Int(AudioCapture.sampleRate))
  }

  // MARK: Input

  /// In-band glasses audio from the DAT stream's audioFramePublisher.
  func appendInband(_ buffer: AVAudioPCMBuffer) {
    lock.lock(); lastInbandAt = Date(); lock.unlock()
    if engineRunning && engineForAmbient && !isAsking && !isChatting {
      // Glasses audio showed up after we fell back; prefer it.
      log?("In-band glasses audio arrived; stopping phone mic fallback")
      engineForAmbient = false
      stopEngine()
    }
    append(buffer)
  }

  private func append(_ buffer: AVAudioPCMBuffer) {
    lock.lock()
    let chatting = chatActive
    let wake = wakeEnabled && !chatActive && !askActive
    lock.unlock()
    if chatting || wake {
      if let pcm24 = convert(buffer, to: chatFormat), !pcm24.isEmpty {
        if chatting {
          // The conversation hears everything; ambient transcription pauses so the exchange is not logged twice.
          onChatAudio?(pcm24)
        } else {
          lock.lock()
          preroll.append(pcm24)
          if preroll.count > prerollBytes { preroll.removeFirst(preroll.count - prerollBytes) }
          lock.unlock()
        }
      }
      if chatting && !isAsking { return }
    }
    guard let data = convert(buffer, to: targetFormat), !data.isEmpty else { return }
    if wake { onWakeAudio?(data) }
    var chunk: Data?
    lock.lock()
    if askActive { askBuffer.append(data) }
    else if ambientEnabled {
      ambientBuffer.append(data)
      if ambientBuffer.count >= ambientChunkBytes {
        chunk = ambientBuffer
        ambientBuffer.removeAll(keepingCapacity: true)
      }
    }
    lock.unlock()
    if let chunk {
      if AudioCapture.rms(chunk) < 60 { return } // silence; skip the API call
      onAmbientChunk?(AudioCapture.wav(pcm16: chunk, sampleRate: Int(AudioCapture.sampleRate)))
    }
  }

  private func convert(_ buffer: AVAudioPCMBuffer, to targetFormat: AVAudioFormat) -> Data? {
    let fmt = buffer.format
    if fmt.commonFormat == .pcmFormatInt16 && fmt.sampleRate == targetFormat.sampleRate && fmt.channelCount == 1, let ch = buffer.int16ChannelData {
      return Data(bytes: ch[0], count: Int(buffer.frameLength) * 2)
    }
    let key = "\(fmt.commonFormat.rawValue)-\(fmt.sampleRate)-\(fmt.channelCount)-\(fmt.isInterleaved)->\(targetFormat.sampleRate)"
    lock.lock()
    var conv = converters[key]
    if conv == nil { conv = AVAudioConverter(from: fmt, to: targetFormat); converters[key] = conv }
    lock.unlock()
    guard let converter = conv else { return nil }
    let ratio = targetFormat.sampleRate / fmt.sampleRate
    let cap = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 64)
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: cap) else { return nil }
    var fed = false
    var err: NSError?
    let status = converter.convert(to: out, error: &err) { _, inputStatus in
      if fed { inputStatus.pointee = .noDataNow; return nil }
      fed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, let ch = out.int16ChannelData else {
      log?("Audio convert failed: \(err?.localizedDescription ?? "unknown")")
      return nil
    }
    return Data(bytes: ch[0], count: Int(out.frameLength) * 2)
  }

  // MARK: Phone-mic engine

  private func startEngine() {
    guard !engineRunning else { return }
    setRecording?(true)
    let input = engine.inputNode
    let fmt = input.outputFormat(forBus: 0)
    guard fmt.sampleRate > 0 else {
      log?("Microphone unavailable (input format has 0 Hz). Is mic permission granted?")
      setRecording?(false)
      return
    }
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buf, _ in
      self?.append(buf)
    }
    do {
      engine.prepare()
      try engine.start()
      engineRunning = true
      log?("Phone mic capture started (\(Int(fmt.sampleRate)) Hz)")
    } catch {
      input.removeTap(onBus: 0)
      log?("AVAudioEngine start failed: \(error.localizedDescription)")
      setRecording?(false)
    }
  }

  private func stopEngine() {
    guard engineRunning else { return }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    engineRunning = false
    engineForAmbient = false
    setRecording?(false)
  }

  /// Stream teardown. A live conversation survives it: in-band audio is gone, so it moves to the phone mic.
  func stopAll() {
    setAmbient(false)
    let chatting = isChatting
    lock.lock(); askActive = false; askBuffer.removeAll(); lastInbandAt = nil; lock.unlock()
    stopEngine()
    if chatting {
      log?("Stream stopped mid-conversation; continuing on the phone mic")
      startEngine()
    }
  }

  // MARK: Helpers

  static func rms(_ pcm: Data) -> Double {
    let n = pcm.count / 2
    guard n > 0 else { return 0 }
    var sum: Double = 0
    pcm.withUnsafeBytes { raw in
      let s = raw.bindMemory(to: Int16.self)
      var i = 0
      while i < n { let v = Double(s[i]); sum += v * v; i += 4 }
    }
    return (sum / Double(max(1, n / 4))).squareRoot()
  }

  static func wav(pcm16: Data, sampleRate: Int) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
    func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
    d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + pcm16.count))
    d.append("WAVE".data(using: .ascii)!)
    d.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1)
    u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2)); u16(2); u16(16)
    d.append("data".data(using: .ascii)!); u32(UInt32(pcm16.count))
    d.append(pcm16)
    return d
  }
}
