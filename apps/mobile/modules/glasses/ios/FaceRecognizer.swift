import Accelerate
import CoreGraphics
import CoreML
import Foundation
import ImageIO
import UIKit
import Vision

/// On-device face detection + embedding. Apple Vision finds face rectangles; a square crop around
/// each box (scaled 1.3x, shifted up a fifth of the box so the forehead/chin framing matches the
/// ArcFace template) is resized to 112x112 and fed to the Core ML MobileFaceNet (buffalo_sc) in
/// Models/FaceEmbedder.mlmodelc. Embeddings are L2-normalized, so cosine similarity is a dot product.
///
/// Why no landmark alignment: Vision's landmark request is unreliable on the simulator and the
/// box-only crop already agrees with InsightFace's landmark-aligned embeddings at cosine 0.8-0.9
/// (see scripts/README.md). Both enrollment photos and glasses frames go through this same crop,
/// so scores stay consistent either way.
///
/// Nothing here touches the network or disk: the frame is matched in memory and dropped.
final class FaceRecognizer {
  static let shared = FaceRecognizer()

  struct Detection {
    /// Face box in pixels of the input image, top-left origin: [x, y, w, h].
    let box: [Int]
    let embedding: [Float]
  }

  static let inputSize = 112
  /// Crop geometry relative to Vision's face rectangle (tuned against InsightFace in FaceSelfTest).
  static let cropScale: CGFloat = 1.3
  static let cropShiftY: CGFloat = -0.2
  /// Faces narrower than this (in source pixels) are too small to embed reliably and are skipped.
  var minFaceSide: CGFloat = 36

  private let lock = NSLock()
  private var model: MLModel?
  private var imageConstraint: MLImageConstraint?
  private(set) var loadError: String?

  private init() {}

  // MARK: Model

  /// Loads the compiled model from the Glasses resource bundle (or the app bundle). Idempotent.
  func load() throws {
    lock.lock(); defer { lock.unlock() }
    if model != nil { return }
    guard let url = Self.modelURL() else {
      loadError = "FaceEmbedder.mlmodelc not found in app bundle"
      throw GlassesError(loadError!)
    }
    let cfg = MLModelConfiguration()
    #if targetEnvironment(simulator)
    cfg.computeUnits = .cpuOnly  // no Neural Engine / GPU in the simulator
    #else
    cfg.computeUnits = .all
    #endif
    do {
      let t0 = CFAbsoluteTimeGetCurrent()
      let m = try MLModel(contentsOf: url, configuration: cfg)
      guard let constraint = m.modelDescription.inputDescriptionsByName["face"]?.imageConstraint else {
        throw GlassesError("FaceEmbedder model has no image input named 'face'")
      }
      model = m
      imageConstraint = constraint
      loadError = nil
      NSLog("[Glasses] face model loaded in %.0f ms from %@", (CFAbsoluteTimeGetCurrent() - t0) * 1000, url.lastPathComponent)
    } catch {
      loadError = "Face model failed to load: \(error.localizedDescription)"
      throw GlassesError(loadError!)
    }
  }

  var isLoaded: Bool { lock.lock(); defer { lock.unlock() }; return model != nil }

  private static func modelURL() -> URL? {
    let name = "FaceEmbedder", ext = "mlmodelc"
    var candidates: [Bundle] = [Bundle.main, Bundle(for: FaceRecognizer.self)]
    for b in candidates {
      if let u = b.url(forResource: "GlassesModels", withExtension: "bundle"), let rb = Bundle(url: u) { candidates.insert(rb, at: 0) }
    }
    for b in candidates {
      if let u = b.url(forResource: name, withExtension: ext) { return u }
    }
    return nil
  }

  // MARK: Detection + embedding

  /// Vision face rectangles (pixels, top-left origin), largest first.
  static func detectFaces(_ image: CGImage, orientation: CGImagePropertyOrientation = .up) throws -> [CGRect] {
    let request = VNDetectFaceRectanglesRequest()
    #if targetEnvironment(simulator)
    // The simulator's Vision backend fails with "Could not create inference context" (code 9)
    // unless the request is pinned to the CPU.
    if let devices = try? request.supportedComputeStageDevices {
      for (stage, list) in devices {
        if let cpu = list.first(where: { if case .cpu = $0 { return true } else { return false } }) {
          request.setComputeDevice(cpu, for: stage)
        }
      }
    }
    #endif
    try VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:]).perform([request])
    let W = CGFloat(image.width), H = CGFloat(image.height)
    return (request.results ?? [])
      .map { obs -> CGRect in
        let bb = obs.boundingBox  // normalized, origin bottom-left
        return CGRect(x: bb.minX * W, y: (1 - bb.maxY) * H, width: bb.width * W, height: bb.height * H)
      }
      .sorted { $0.width * $0.height > $1.width * $1.height }
  }

  /// Detects faces (largest first) and embeds each. `orientation` describes how the pixel data is stored.
  func detectAndEmbed(_ image: CGImage, orientation: CGImagePropertyOrientation = .up, maxFaces: Int = 4) throws -> [Detection] {
    try load()
    var out: [Detection] = []
    for box in try Self.detectFaces(image, orientation: orientation).prefix(maxFaces) {
      if min(box.width, box.height) < minFaceSide { continue }
      guard let crop = Self.boxCrop(image, box: box, scale: Self.cropScale, dy: Self.cropShiftY) else { continue }
      let emb = try embedAligned(crop)
      out.append(Detection(box: [Int(box.minX.rounded()), Int(box.minY.rounded()), Int(box.width.rounded()), Int(box.height.rounded())], embedding: emb))
    }
    return out
  }

  /// Convenience for UIImage. Rotated images are redrawn upright first so boxes and pixels share
  /// one coordinate system (glasses frames and server photos are already `.up`).
  func detectAndEmbed(_ image: UIImage, maxFaces: Int = 4) throws -> [Detection] {
    var img = image
    if img.imageOrientation != .up {
      let fmt = UIGraphicsImageRendererFormat.default()
      fmt.scale = 1
      let size = CGSize(width: img.size.width, height: img.size.height)
      img = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }
    guard let cg = img.cgImage else { throw GlassesError("Image has no bitmap") }
    return try detectAndEmbed(cg, orientation: .up, maxFaces: maxFaces)
  }

  /// Runs the Core ML model on a 112x112 crop. Returns the L2-normalized 512-d embedding.
  func embedAligned(_ crop: CGImage) throws -> [Float] {
    try load()
    guard let model, let constraint = imageConstraint else { throw GlassesError("Face model not loaded") }
    let fv = try MLFeatureValue(cgImage: crop, constraint: constraint, options: nil)
    let input = try MLDictionaryFeatureProvider(dictionary: ["face": fv])
    let result = try model.prediction(from: input)
    guard let arr = result.featureValue(for: "embedding")?.multiArrayValue else { throw GlassesError("Face model returned no embedding") }
    // fp16 models return Float16 arrays; MLShapedArray<Float>(arr) traps on a type mismatch.
    var v: [Float]
    switch arr.dataType {
    case .float32: v = MLShapedArray<Float>(arr).scalars
    case .float16: v = MLShapedArray<Float16>(arr).scalars.map { Float($0) }
    case .double: v = MLShapedArray<Double>(arr).scalars.map { Float($0) }
    default: v = (0..<arr.count).map { arr[$0].floatValue }
    }
    var norm: Float = 0
    vDSP_svesq(v, 1, &norm, vDSP_Length(v.count))
    norm = sqrt(norm)
    if norm > 0 { var inv = 1 / norm; vDSP_vsmul(v, 1, &inv, &v, 1, vDSP_Length(v.count)) }
    return v
  }

  // MARK: Crop

  /// Square of side `scale * max(w, h)` centred on the box (shifted by `dy` box-heights, negative is
  /// up), resized to 112x112 RGB. Areas outside the image are black.
  static func boxCrop(_ image: CGImage, box: CGRect, scale: CGFloat, dy: CGFloat) -> CGImage? {
    let n = inputSize
    let side = max(box.width, box.height) * scale
    let cx = box.midX, cy = box.midY + dy * box.height
    let src = CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)  // top-left space
    let s = CGFloat(n) / side
    let T = CGAffineTransform(translationX: -src.minX, y: -src.minY).concatenating(CGAffineTransform(scaleX: s, y: s))
    let W = CGFloat(image.width), H = CGFloat(image.height)
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
    // CoreGraphics draws with a bottom-left origin; T is in top-left pixel space, hence the two flips.
    let flipSrc = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: H)
    let flipDst = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: CGFloat(n))
    ctx.concatenate(flipSrc.concatenating(T).concatenating(flipDst))
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
    return ctx.makeImage()
  }
}
