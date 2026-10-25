// Runs the phone's face pipeline (Apple Vision face rectangle -> 1.3x box crop shifted up 0.2 ->
// 112x112 -> Core ML embedder -> L2 norm) over every image in a manifest, for several embedder
// models at once, and writes embeddings plus timings. The geometry constants mirror
// apps/mobile/modules/glasses/ios/FaceRecognizer.swift; keep them in sync.
//
// Build:  swiftc -O -o FaceEval FaceEval.swift
// Run:    ./FaceEval --manifest <data>/manifest.json --out <outdir> --model mbf=<path>.mlmodelc --model r50=... [--limit N]
//
// Output: <outdir>/<model>.f32 (N x D float32, zeros when no face) and <outdir>/meta.json.

import CoreGraphics
import CoreML
import Foundation
import ImageIO
import Vision

let inputSize = 112
let cropScale: CGFloat = 1.3
let cropShiftY: CGFloat = -0.2
let minFaceSide: CGFloat = 36

struct Args {
  var manifest = ""
  var out = ""
  var models: [(String, String)] = []
  var limit = Int.max
}

func parseArgs() -> Args {
  var a = Args()
  var it = CommandLine.arguments.dropFirst().makeIterator()
  while let flag = it.next() {
    switch flag {
    case "--manifest": a.manifest = it.next() ?? ""
    case "--out": a.out = it.next() ?? ""
    case "--limit": a.limit = Int(it.next() ?? "") ?? Int.max
    case "--model":
      let spec = it.next() ?? ""
      guard let eq = spec.firstIndex(of: "=") else { fatalError("--model name=path") }
      a.models.append((String(spec[..<eq]), String(spec[spec.index(after: eq)...])))
    default: fatalError("unknown flag \(flag)")
    }
  }
  precondition(!a.manifest.isEmpty && !a.out.isEmpty && !a.models.isEmpty, "usage: --manifest m.json --out dir --model name=path ...")
  return a
}

func loadCGImage(_ path: String) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

/// Largest Vision face rectangle in top-left pixel coordinates, or nil.
func detectLargestFace(_ image: CGImage) throws -> CGRect? {
  let request = VNDetectFaceRectanglesRequest()
  try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
  let W = CGFloat(image.width), H = CGFloat(image.height)
  return (request.results ?? [])
    .map { obs -> CGRect in
      let bb = obs.boundingBox
      return CGRect(x: bb.minX * W, y: (1 - bb.maxY) * H, width: bb.width * W, height: bb.height * H)
    }
    .max { $0.width * $0.height < $1.width * $1.height }
}

/// Same crop as FaceRecognizer.boxCrop.
func boxCrop(_ image: CGImage, box: CGRect) -> CGImage? {
  let n = inputSize
  let side = max(box.width, box.height) * cropScale
  let cx = box.midX, cy = box.midY + cropShiftY * box.height
  let src = CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)
  let s = CGFloat(n) / side
  let T = CGAffineTransform(translationX: -src.minX, y: -src.minY).concatenating(CGAffineTransform(scaleX: s, y: s))
  let W = CGFloat(image.width), H = CGFloat(image.height)
  guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
  ctx.interpolationQuality = .high
  ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
  let flipSrc = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: H)
  let flipDst = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: CGFloat(n))
  ctx.concatenate(flipSrc.concatenating(T).concatenating(flipDst))
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
  return ctx.makeImage()
}

final class Embedder {
  let name: String
  let model: MLModel
  let constraint: MLImageConstraint
  let loadMs: Double
  var dim = 0
  var times: [Double] = []

  init(name: String, path: String) throws {
    self.name = name
    let cfg = MLModelConfiguration()
    cfg.computeUnits = .all
    let t0 = CFAbsoluteTimeGetCurrent()
    let url = URL(fileURLWithPath: path)
    let compiled = url.pathExtension == "mlmodelc" ? url : try MLModel.compileModel(at: url)
    model = try MLModel(contentsOf: compiled, configuration: cfg)
    loadMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
    guard let c = model.modelDescription.inputDescriptionsByName["face"]?.imageConstraint else {
      throw NSError(domain: "FaceEval", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(name): no image input named 'face'"])
    }
    constraint = c
  }

  func embed(_ crop: CGImage) throws -> [Float] {
    let fv = try MLFeatureValue(cgImage: crop, constraint: constraint, options: nil)
    let input = try MLDictionaryFeatureProvider(dictionary: ["face": fv])
    let t = CFAbsoluteTimeGetCurrent()
    let result = try model.prediction(from: input)
    times.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
    guard let arr = result.featureValue(for: "embedding")?.multiArrayValue else {
      throw NSError(domain: "FaceEval", code: 2, userInfo: [NSLocalizedDescriptionKey: "\(name): no 'embedding' output"])
    }
    var v: [Float]
    switch arr.dataType {
    case .float32: v = MLShapedArray<Float>(arr).scalars
    case .float16: v = MLShapedArray<Float16>(arr).scalars.map { Float($0) }
    case .double: v = MLShapedArray<Double>(arr).scalars.map { Float($0) }
    default: v = (0..<arr.count).map { arr[$0].floatValue }
    }
    dim = v.count
    var norm: Float = 0
    for x in v { norm += x * x }
    norm = norm.squareRoot()
    if norm > 0 { for i in v.indices { v[i] /= norm } }
    return v
  }
}

func median(_ xs: [Double]) -> Double { xs.isEmpty ? 0 : xs.sorted()[xs.count / 2] }
func p90(_ xs: [Double]) -> Double { xs.isEmpty ? 0 : xs.sorted()[Int(Double(xs.count) * 0.9)] }

let args = parseArgs()
let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args.manifest))) as! [String: Any]
let root = manifest["root"] as! String
let images = Array((manifest["images"] as! [[String: String]]).prefix(args.limit))
let embedders = try args.models.map { try Embedder(name: $0.0, path: $0.1) }
try FileManager.default.createDirectory(atPath: args.out, withIntermediateDirectories: true)

// Warm up (ANE compile and caches) on a mid-grey crop.
if let warm = CGContext(data: nil, width: inputSize, height: inputSize, bitsPerComponent: 8, bytesPerRow: inputSize * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)?.makeImage() {
  for e in embedders { for _ in 0..<5 { _ = try e.embed(warm) } }
  for e in embedders { e.times.removeAll() }
}

var buffers = [String: Data]()
var detectTimes: [Double] = []
var imageMeta: [[String: Any]] = []
var detected = 0
let t0 = CFAbsoluteTimeGetCurrent()
for (i, im) in images.enumerated() {
  let id = im["id"]!, path = root + "/" + im["path"]!
  var meta: [String: Any] = ["id": id, "detected": false]
  var crop: CGImage?
  if let cg = loadCGImage(path) {
    let t = CFAbsoluteTimeGetCurrent()
    let box = try detectLargestFace(cg)
    detectTimes.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
    if let box {
      meta["faceW"] = Int(box.width.rounded())
      meta["faceH"] = Int(box.height.rounded())
      meta["imageW"] = cg.width
      if min(box.width, box.height) >= minFaceSide { crop = boxCrop(cg, box: box) } else { meta["tooSmall"] = true }
    }
  } else {
    meta["loadError"] = true
  }
  for e in embedders {
    var v = [Float](repeating: 0, count: max(e.dim, 1))
    if let crop {
      v = try e.embed(crop)
      meta["detected"] = true
    }
    if e.dim > 0 && v.count != e.dim { v = [Float](repeating: 0, count: e.dim) }
    buffers[e.name, default: Data()].append(v.withUnsafeBufferPointer { Data(buffer: $0) })
  }
  if crop != nil { detected += 1 }
  imageMeta.append(meta)
  if (i + 1) % 1000 == 0 {
    let el = CFAbsoluteTimeGetCurrent() - t0
    FileHandle.standardError.write("\(i + 1)/\(images.count) images, \(String(format: "%.0f", el)) s elapsed, detect median \(String(format: "%.1f", median(detectTimes))) ms\n".data(using: .utf8)!)
  }
}

for e in embedders {
  // The warm-up above fixed e.dim before the loop, so every row is exactly dim floats.
  let data = buffers[e.name] ?? Data()
  precondition(data.count == images.count * e.dim * 4, "\(e.name): embedding buffer has the wrong size")
  try data.write(to: URL(fileURLWithPath: args.out).appendingPathComponent("\(e.name).f32"))
}

var modelMeta: [String: Any] = [:]
for e in embedders {
  modelMeta[e.name] = ["dim": e.dim, "loadMs": e.loadMs, "predictMsMedian": median(e.times), "predictMsP90": p90(e.times), "predictions": e.times.count]
}
let out: [String: Any] = [
  "images": imageMeta,
  "imageOrder": images.map { $0["id"]! },
  "detected": detected,
  "detectMsMedian": median(detectTimes),
  "detectMsP90": p90(detectTimes),
  "models": modelMeta,
  "host": ProcessInfo.processInfo.operatingSystemVersionString,
  "elapsedS": CFAbsoluteTimeGetCurrent() - t0,
]
try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted]).write(to: URL(fileURLWithPath: args.out).appendingPathComponent("meta.json"))
print("done: \(images.count) images, \(detected) with a usable face, \(String(format: "%.0f", CFAbsoluteTimeGetCurrent() - t0)) s")
for e in embedders { print("  \(e.name): dim \(e.dim), load \(String(format: "%.0f", e.loadMs)) ms, predict median \(String(format: "%.2f", median(e.times))) ms") }
