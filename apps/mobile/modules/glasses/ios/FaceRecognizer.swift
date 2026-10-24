import Accelerate
import CoreGraphics
import CoreML
import Foundation
import ImageIO
import UIKit
import Vision

/// On-device face detection + embedding. Apple Vision finds faces and landmarks; the five ArcFace
/// points (eye centres, nose tip, mouth corners) are warped onto the 112x112 template with a
/// least-squares similarity transform and fed to the Core ML MobileFaceNet (buffalo_sc) in
/// Models/FaceEmbedder.mlmodelc. Embeddings are L2-normalized, so cosine similarity is a dot product.
///
/// Nothing here touches the network or disk: the frame is matched in memory and dropped.
final class FaceRecognizer {
  static let shared = FaceRecognizer()

  struct Detection {
    /// Face box in pixels of the input image, top-left origin: [x, y, w, h].
    let box: [Int]
    let embedding: [Float]
  }

  /// ArcFace 112x112 reference points (insightface `arcface_dst`): left eye, right eye, nose, left mouth, right mouth.
  private static let template: [CGPoint] = [
    CGPoint(x: 38.2946, y: 51.6963), CGPoint(x: 73.5318, y: 51.5014), CGPoint(x: 56.0252, y: 71.7366),
    CGPoint(x: 41.5493, y: 92.3655), CGPoint(x: 70.7299, y: 92.2041),
  ]
  static let inputSize = 112
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
    cfg.computeUnits = .all
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
    for b in candidates where b.url(forResource: "GlassesModels", withExtension: "bundle") != nil {
      if let rb = Bundle(url: b.url(forResource: "GlassesModels", withExtension: "bundle")!) { candidates.insert(rb, at: 0) }
    }
    for b in candidates {
      if let u = b.url(forResource: name, withExtension: ext) { return u }
    }
    return nil
  }

  // MARK: Detection + embedding

  /// Detects faces (largest first) and embeds each. `orientation` describes how the pixel data is stored.
  func detectAndEmbed(_ image: CGImage, orientation: CGImagePropertyOrientation = .up, maxFaces: Int = 4) throws -> [Detection] {
    try load()
    let request = VNDetectFaceLandmarksRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    try handler.perform([request])
    let W = CGFloat(image.width), H = CGFloat(image.height)
    var out: [(area: CGFloat, det: Detection)] = []
    for obs in request.results ?? [] {
      guard let pts = Self.fivePoints(obs, width: W, height: H) else { continue }
      let bb = obs.boundingBox  // normalized, origin bottom-left
      let box = CGRect(x: bb.minX * W, y: (1 - bb.maxY) * H, width: bb.width * W, height: bb.height * H)
      if min(box.width, box.height) < minFaceSide { continue }
      guard let aligned = Self.align(image, from: pts) else { continue }
      let emb = try embedAligned(aligned)
      out.append((box.width * box.height, Detection(box: [Int(box.minX.rounded()), Int(box.minY.rounded()), Int(box.width.rounded()), Int(box.height.rounded())], embedding: emb)))
    }
    out.sort { $0.area > $1.area }
    return out.prefix(maxFaces).map { $0.det }
  }

  /// Convenience for UIImage. Rotated images are redrawn upright first so boxes, landmarks and
  /// pixels share one coordinate system (glasses frames and server photos are already `.up`).
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

  /// Runs the Core ML model on an already aligned 112x112 crop. Returns the L2-normalized 512-d embedding.
  func embedAligned(_ crop: CGImage) throws -> [Float] {
    try load()
    guard let model, let constraint = imageConstraint else { throw GlassesError("Face model not loaded") }
    let fv = try MLFeatureValue(cgImage: crop, constraint: constraint, options: nil)
    let input = try MLDictionaryFeatureProvider(dictionary: ["face": fv])
    let result = try model.prediction(from: input)
    guard let arr = result.featureValue(for: "embedding")?.multiArrayValue else { throw GlassesError("Face model returned no embedding") }
    var v = MLShapedArray<Float>(arr).scalars
    var norm: Float = 0
    vDSP_svesq(v, 1, &norm, vDSP_Length(v.count))
    norm = sqrt(norm)
    if norm > 0 { var inv = 1 / norm; vDSP_vsmul(v, 1, &inv, &v, 1, vDSP_Length(v.count)) }
    return v
  }

  // MARK: Alignment

  /// Eye centres, nose tip and mouth corners in image pixels (top-left origin), ordered like insightface kps.
  private static func fivePoints(_ obs: VNFaceObservation, width W: CGFloat, height H: CGFloat) -> [CGPoint]? {
    guard let lm = obs.landmarks, let leftEye = lm.leftEye, let rightEye = lm.rightEye, let lips = lm.outerLips else { return nil }
    let size = CGSize(width: W, height: H)
    func flip(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x, y: H - p.y) }  // Vision is bottom-left
    func centre(_ r: VNFaceLandmarkRegion2D) -> CGPoint {
      let pts = r.pointsInImage(imageSize: size)
      let n = CGFloat(max(1, pts.count))
      return flip(CGPoint(x: pts.reduce(0) { $0 + $1.x } / n, y: pts.reduce(0) { $0 + $1.y } / n))
    }
    var eyeA = centre(leftEye), eyeB = centre(rightEye)
    if eyeA.x > eyeB.x { swap(&eyeA, &eyeB) }  // image-left eye first, whatever Vision calls it
    let nose: CGPoint
    if let crest = lm.noseCrest, let tip = crest.pointsInImage(imageSize: size).last {
      nose = flip(tip)  // crest runs from the brow down to the tip
    } else if let n = lm.nose {
      nose = centre(n)
    } else { return nil }
    let lipPts = lips.pointsInImage(imageSize: size).map(flip)
    guard let mouthL = lipPts.min(by: { $0.x < $1.x }), let mouthR = lipPts.max(by: { $0.x < $1.x }) else { return nil }
    return [eyeA, eyeB, nose, mouthL, mouthR]
  }

  /// Least-squares similarity (scale+rotation+translation, no reflection) mapping `src` onto `dst`:
  /// x' = a x - b y + tx, y' = b x + a y + ty.
  static func similarity(from src: [CGPoint], to dst: [CGPoint]) -> CGAffineTransform? {
    guard src.count == dst.count, src.count >= 2 else { return nil }
    // Normal equations for the 4 unknowns [a, b, tx, ty].
    var ata = [Double](repeating: 0, count: 16), atb = [Double](repeating: 0, count: 4)
    for (s, d) in zip(src, dst) {
      let rows: [([Double], Double)] = [([s.x, -s.y, 1, 0], d.x), ([s.y, s.x, 0, 1], d.y)]
      for (r, y) in rows {
        for i in 0..<4 {
          atb[i] += r[i] * y
          for j in 0..<4 { ata[i * 4 + j] += r[i] * r[j] }
        }
      }
    }
    guard let x = solve4(ata, atb) else { return nil }
    return CGAffineTransform(a: x[0], b: x[1], c: -x[1], d: x[0], tx: x[2], ty: x[3])
  }

  /// Gaussian elimination with partial pivoting for a 4x4 system.
  private static func solve4(_ A: [Double], _ b: [Double]) -> [Double]? {
    var m = (0..<4).map { i in Array(A[i * 4..<(i * 4 + 4)]) + [b[i]] }
    for c in 0..<4 {
      let p = (c..<4).max { abs(m[$0][c]) < abs(m[$1][c]) }!
      if abs(m[p][c]) < 1e-12 { return nil }
      m.swapAt(c, p)
      for r in 0..<4 where r != c {
        let f = m[r][c] / m[c][c]
        if f != 0 { for k in c..<5 { m[r][k] -= f * m[c][k] } }
      }
    }
    return (0..<4).map { m[$0][4] / m[$0][$0] }
  }

  /// Warps the source so `points` land on the ArcFace template, producing a 112x112 RGB crop.
  static func align(_ image: CGImage, from points: [CGPoint]) -> CGImage? {
    guard let T = similarity(from: points, to: template) else { return nil }
    let n = inputSize
    let W = CGFloat(image.width), H = CGFloat(image.height)
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
    // CoreGraphics draws with a bottom-left origin; the transform is in top-left pixel space.
    let flipSrc = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: H)
    let flipDst = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: CGFloat(n))
    ctx.concatenate(flipSrc.concatenating(T).concatenating(flipDst))
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
    return ctx.makeImage()
  }
}

extension CGImagePropertyOrientation {
  init(_ o: UIImage.Orientation) {
    switch o {
    case .up: self = .up
    case .down: self = .down
    case .left: self = .left
    case .right: self = .right
    case .upMirrored: self = .upMirrored
    case .downMirrored: self = .downMirrored
    case .leftMirrored: self = .leftMirrored
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
