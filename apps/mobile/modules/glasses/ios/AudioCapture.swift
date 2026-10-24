import AVFoundation
import Foundation

/// Collects 16 kHz mono PCM16 audio for tap-to-ask and ambient transcription.
/// Primary source: in-band audio frames from the DAT camera stream (glasses mic).
/// Fallback: AVAudioEngine on the phone's input (built-in mic) when no in-band audio arrives.
final class AudioCapture {
  static let sampleRate: Double = 16000
  private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

  private let lock = NSLock()
  private var askBuffer = Data()
  private var ambientBuffer = Data()
  private var askActive = false
  private var ambientEnabled = false
  private var lastInbandAt: Date?
  private var converters: [String: AVAudioConverter] = [:]

  private let engine = AVAudioEngine()
  private var engineRunning = false
  private var engineForAmbient = false

  /// Called with a ~10 s WAV chunk for /api/utterances.
  var onAmbientChunk: ((Data) -> Void)?
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

  private var isAsking: Bool { lock.lock(); defer { lock.unlock() }; return askActive }

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
    if engineRunning && engineForAmbient && !isAsking {
      // Glasses audio showed up after we fell back; prefer it.
      log?("In-band glasses audio arrived; stopping phone mic fallback")
      engineForAmbient = false
      stopEngine()
    }
    append(buffer)
  }

  private func append(_ buffer: AVAudioPCMBuffer) {
    guard let data = convert(buffer), !data.isEmpty else { return }
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

  private func convert(_ buffer: AVAudioPCMBuffer) -> Data? {
    let fmt = buffer.format
    if fmt.commonFormat == .pcmFormatInt16 && fmt.sampleRate == 16000 && fmt.channelCount == 1, let ch = buffer.int16ChannelData {
      return Data(bytes: ch[0], count: Int(buffer.frameLength) * 2)
    }
    let key = "\(fmt.commonFormat.rawValue)-\(fmt.sampleRate)-\(fmt.channelCount)-\(fmt.isInterleaved)"
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

  func stopAll() {
    setAmbient(false)
    lock.lock(); askActive = false; askBuffer.removeAll(); lastInbandAt = nil; lock.unlock()
    stopEngine()
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
