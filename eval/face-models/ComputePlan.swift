import CoreML
import CoreGraphics
import Foundation

// Usage: swift computeplan.swift <path/to/Model.mlmodelc|.mlpackage> [inputName] [side]
// Prints per-op compute device placement (MLComputePlan) and times prediction under each compute-unit setting.

func deviceName(_ d: MLComputeDevice) -> String {
  switch d {
  case .cpu: return "CPU"
  case .gpu: return "GPU"
  case .neuralEngine: return "ANE"
  @unknown default: return "?"
  }
}

func compiledURL(_ path: String) throws -> URL {
  let url = URL(fileURLWithPath: path)
  if url.pathExtension == "mlmodelc" { return url }
  return try MLModel.compileModel(at: url)
}

func runPlan(_ url: URL) async throws {
  let cfg = MLModelConfiguration()
  cfg.computeUnits = .all
  let plan = try await MLComputePlan.load(contentsOf: url, configuration: cfg)
  guard case let .program(program) = plan.modelStructure else { print("not an ML program"); return }
  var hist: [String: Int] = [:]
  var total = 0
  var aneSupported = 0
  var notANE: [String] = []
  for (_, fn) in program.functions {
    for op in fn.block.operations {
      total += 1
      guard let usage = plan.deviceUsage(for: op) else { continue }
      let pref = deviceName(usage.preferred)
      hist[pref, default: 0] += 1
      let sup = usage.supported.map(deviceName)
      if sup.contains("ANE") { aneSupported += 1 } else { notANE.append("\(op.operatorName) -> supported \(sup)") }
    }
  }
  print("ops: \(total)  preferred device histogram: \(hist)  ANE-capable ops: \(aneSupported)/\(total)")
  if notANE.isEmpty { print("every op can run on the Neural Engine") } else { print("ops without ANE support:"); notANE.forEach { print("  \($0)") } }
}

func makePixelBuffer(_ side: Int) -> CVPixelBuffer {
  var pb: CVPixelBuffer?
  CVPixelBufferCreate(nil, side, side, kCVPixelFormatType_32BGRA, nil, &pb)
  CVPixelBufferLockBaseAddress(pb!, [])
  let base = CVPixelBufferGetBaseAddress(pb!)!.assumingMemoryBound(to: UInt8.self)
  let bpr = CVPixelBufferGetBytesPerRow(pb!)
  for y in 0..<side { for x in 0..<side { for c in 0..<4 { base[y * bpr + x * 4 + c] = UInt8((x * 7 + y * 13 + c * 29) & 255) } } }
  CVPixelBufferUnlockBaseAddress(pb!, [])
  return pb!
}

func bench(_ url: URL, input: String, side: Int) throws {
  let pb = makePixelBuffer(side)
  for (label, units) in [("all", MLComputeUnits.all), ("cpuAndNeuralEngine", .cpuAndNeuralEngine), ("cpuAndGPU", .cpuAndGPU), ("cpuOnly", .cpuOnly)] {
    let cfg = MLModelConfiguration()
    cfg.computeUnits = units
    let t0 = CFAbsoluteTimeGetCurrent()
    let model = try MLModel(contentsOf: url, configuration: cfg)
    let loadMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
    let fv = MLFeatureValue(pixelBuffer: pb)
    let inp = try MLDictionaryFeatureProvider(dictionary: [input: fv])
    for _ in 0..<5 { _ = try model.prediction(from: inp) }  // warm up
    var times: [Double] = []
    for _ in 0..<50 {
      let t = CFAbsoluteTimeGetCurrent()
      _ = try model.prediction(from: inp)
      times.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
    }
    times.sort()
    print(String(format: "%-20@ load %6.0f ms   predict median %6.2f ms  p90 %6.2f ms", label as NSString, loadMs, times[times.count / 2], times[Int(Double(times.count) * 0.9)]))
  }
}

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: swift computeplan.swift <model> [inputName] [side]"); exit(1) }
let input = args.count >= 3 ? args[2] : "face"
let side = args.count >= 4 ? Int(args[3])! : 112
let sem = DispatchSemaphore(value: 0)
Task {
  do {
    let url = try compiledURL(args[1])
    print("model: \(url.lastPathComponent)")
    try await runPlan(url)
    try bench(url, input: input, side: side)
  } catch { print("error: \(error)") }
  sem.signal()
}
sem.wait()
