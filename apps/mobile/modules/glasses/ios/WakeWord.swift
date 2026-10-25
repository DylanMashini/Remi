import Foundation
import SherpaOnnxC

/// On-device "Hey Remi" detection with sherpa-onnx's open-vocabulary keyword spotter (Apache 2.0,
/// no key, no network). A streaming Zipformer transducer (3.3M params, int8, 5 MB) scores the
/// incoming 16 kHz audio against the BPE tokens of the phrase; nothing is trained, so the phrase can
/// change by editing `keywords`. Audio is fed from AudioCapture's existing stream (glasses in-band
/// or phone mic) on a serial queue; `onDetected` fires on that queue.
final class WakeWord: @unchecked Sendable {
  /// Keywords in sherpa's format: BPE pieces, then `@LABEL`. Pieces come from the model's
  /// bpe.model (`sentencepiece` encode of the upper-cased phrase). Both spellings judges use.
  static let keywords = """
  ▁HE Y ▁RE M I @HEY_REMI
  ▁HE Y ▁RE M Y @HEY_REMI
  """
  /// Larger = stricter. 0.25 caught 5/5 synthesized "Hey Remi" voices at -34 dB noise and fired on
  /// nothing else except "Hey Ramy", which sounds the same; 0.4 missed two voices.
  static let threshold: Float = 0.25
  static let keywordScore: Float = 1.5

  var onDetected: ((String) -> Void)?
  var log: ((String) -> Void)?

  private let queue = DispatchQueue(label: "recall.wake", qos: .userInitiated)
  private let spotter: OpaquePointer
  private var stream: OpaquePointer
  private var muted = false
  private var active = false

  /// Loads the model from the GlassesWake resource bundle (Models/wake, fetched by scripts/fetch-sherpa.sh).
  init() throws {
    let dir = try Self.modelDir()
    func path(_ name: String) -> String { dir.appendingPathComponent(name).path }
    let encoder = path("encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx")
    let decoder = path("decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx")
    let joiner = path("joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx")
    let tokens = path("tokens.txt")
    for f in [encoder, decoder, joiner, tokens] where !FileManager.default.fileExists(atPath: f) {
      throw GlassesError("Wake word model file missing: \(f.components(separatedBy: "/").last ?? f)")
    }

    // The C structs keep raw pointers; the strdup'd copies live as long as the spotter does.
    func cstr(_ s: String) -> UnsafePointer<CChar>? { UnsafePointer(strdup(s)) }
    var config = SherpaOnnxKeywordSpotterConfig()
    config.feat_config.sample_rate = 16000
    config.feat_config.feature_dim = 80
    config.model_config.transducer.encoder = cstr(encoder)
    config.model_config.transducer.decoder = cstr(decoder)
    config.model_config.transducer.joiner = cstr(joiner)
    config.model_config.tokens = cstr(tokens)
    config.model_config.num_threads = 1
    config.model_config.provider = cstr("cpu")
    config.model_config.debug = 0
    config.max_active_paths = 4
    config.num_trailing_blanks = 1
    config.keywords_score = Self.keywordScore
    config.keywords_threshold = Self.threshold
    config.keywords_buf = cstr(Self.keywords)
    config.keywords_buf_size = Int32(Self.keywords.utf8.count)
    cstrings = [config.model_config.transducer.encoder, config.model_config.transducer.decoder,
                config.model_config.transducer.joiner, config.model_config.tokens,
                config.model_config.provider, config.keywords_buf]

    guard let s = SherpaOnnxCreateKeywordSpotter(&config) else {
      throw GlassesError("Wake word model failed to load (sherpa-onnx returned null)")
    }
    spotter = s
    guard let st = SherpaOnnxCreateKeywordStream(s) else {
      SherpaOnnxDestroyKeywordSpotter(s)
      throw GlassesError("Wake word stream failed to open")
    }
    stream = st
  }

  private let cstrings: [UnsafePointer<CChar>?]

  deinit {
    SherpaOnnxDestroyOnlineStream(stream)
    SherpaOnnxDestroyKeywordSpotter(spotter)
    for p in cstrings { free(UnsafeMutablePointer(mutating: p)) }
  }

  // MARK: Control

  /// Start/stop scoring. Stopping also drops the partial hypothesis so a half-said phrase does not
  /// carry across a conversation.
  func setActive(_ on: Bool) {
    queue.async { [self] in
      if on == active { return }
      active = on
      if on { resetStream() }
    }
  }

  /// While Remi itself is talking (TTS line, conversation answer) its own voice must not wake it.
  func setMuted(_ on: Bool) {
    queue.async { [self] in
      if on == muted { return }
      muted = on
      if !on { resetStream() }
    }
  }

  // MARK: Audio

  /// 16 kHz mono PCM16, any length. Called from the audio thread; the work hops to `queue`.
  func feed(pcm16: Data) {
    queue.async { [self] in
      guard active, !muted else { return }
      let n = pcm16.count / 2
      guard n > 0 else { return }
      var samples = [Float](repeating: 0, count: n)
      pcm16.withUnsafeBytes { raw in
        let s = raw.bindMemory(to: Int16.self)
        for i in 0..<n { samples[i] = Float(s[i]) / 32768 }
      }
      SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, Int32(n))
      while SherpaOnnxIsKeywordStreamReady(spotter, stream) == 1 {
        SherpaOnnxDecodeKeywordStream(spotter, stream)
        guard let r = SherpaOnnxGetKeywordResult(spotter, stream) else { continue }
        let keyword = r.pointee.keyword.map { String(cString: $0) } ?? ""
        SherpaOnnxDestroyKeywordResult(r)
        if !keyword.isEmpty {
          SherpaOnnxResetKeywordStream(spotter, stream)
          log?("wake word heard: \(keyword)")
          onDetected?(keyword)
        }
      }
    }
  }

  private func resetStream() {
    SherpaOnnxDestroyOnlineStream(stream)
    if let st = SherpaOnnxCreateKeywordStream(spotter) {
      stream = st
    } else {
      log?("wake word stream failed to reopen; detection is off until the next toggle")
      active = false
    }
  }

  // MARK: Model location

  /// Models/wake ships as the GlassesWake resource bundle (see Glasses.podspec); same lookup as FaceEmbedder.
  private static func modelDir() throws -> URL {
    var candidates: [Bundle] = [Bundle.main, Bundle(for: WakeWord.self)]
    for b in candidates.reversed() {
      if let u = b.url(forResource: "GlassesWake", withExtension: "bundle"), let rb = Bundle(url: u) { candidates.insert(rb, at: 0) }
    }
    for b in candidates {
      if let u = b.url(forResource: "tokens", withExtension: "txt") { return u.deletingLastPathComponent() }
    }
    throw GlassesError("Wake word model (GlassesWake.bundle) not in the app; run pod install and rebuild")
  }
}
