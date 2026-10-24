import Foundation
import UIKit

/// DEBUG-only check of the on-device recognizer against InsightFace numbers produced by
/// scripts/reference_embeddings.py. Runs at launch when RECALL_FACE_SELFTEST=<dir> is in the
/// environment (simulator: SIMCTL_CHILD_RECALL_FACE_SELFTEST). Reads <dir>/reference.json and
/// <dir>/<name>.aligned.png, logs results and writes <dir>/selftest-result.json.
enum FaceSelfTest {
  static func runIfRequested() {
    #if DEBUG
    guard let dir = ProcessInfo.processInfo.environment["RECALL_FACE_SELFTEST"], !dir.isEmpty else { return }
    DispatchQueue.global(qos: .userInitiated).async { run(dir: URL(fileURLWithPath: dir)) }
    #endif
  }

  private static func cosine(_ a: [Float], _ b: [Float]) -> Float {
    var s: Float = 0, na: Float = 0, nb: Float = 0
    for i in 0..<min(a.count, b.count) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    return na > 0 && nb > 0 ? s / (na.squareRoot() * nb.squareRoot()) : 0
  }

  private static func run(dir: URL) {
    var report: [String: Any] = [:]
    func log(_ s: String) { NSLog("[FaceSelfTest] %@", s) }
    do {
      let data = try Data(contentsOf: dir.appendingPathComponent("reference.json"))
      guard let ref = try JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { throw GlassesError("bad reference.json") }
      let t0 = CFAbsoluteTimeGetCurrent()
      try FaceRecognizer.shared.load()
      report["modelLoadMs"] = (CFAbsoluteTimeGetCurrent() - t0) * 1000

      var visionEmb: [String: [Float]] = [:]
      var perImage: [String: Any] = [:]
      for (name, entry) in ref.sorted(by: { $0.key < $1.key }) {
        var row: [String: Any] = [:]
        let mbf = (entry["mbf"] as? [NSNumber])?.map { $0.floatValue } ?? []

        // 1. Model equivalence: InsightFace's aligned crop through Core ML vs onnxruntime.
        if let crop = UIImage(contentsOfFile: dir.appendingPathComponent("\(name).aligned.png").path)?.cgImage {
          var times: [Double] = []
          var emb: [Float] = []
          for _ in 0..<5 {
            let t = CFAbsoluteTimeGetCurrent()
            emb = try FaceRecognizer.shared.embedAligned(crop)
            times.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
          }
          row["alignedCosineVsOnnx"] = cosine(emb, mbf)
          row["embedMsMedian"] = times.sorted()[times.count / 2]
        }

        // 2. Full pipeline: Vision detection + our alignment on the original photo.
        if let path = entry["image"] as? String, let img = UIImage(contentsOfFile: path) {
          let t = CFAbsoluteTimeGetCurrent()
          let dets = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 1)
          row["pipelineMs"] = (CFAbsoluteTimeGetCurrent() - t) * 1000
          if let d = dets.first {
            visionEmb[name] = d.embedding
            row["box"] = d.box
            row["refBox"] = entry["box"]
            row["pipelineCosineVsInsightFace"] = cosine(d.embedding, mbf)
          } else {
            row["pipelineCosineVsInsightFace"] = "no face"
          }
        }
        perImage[name] = row
        log("\(name): \(row)")
      }
      report["images"] = perImage

      // 3. Decisions: cosine matrix of the Vision-pipeline embeddings vs the reference matrix.
      var matrix: [String: Any] = [:]
      var refMatrix: [String: Any] = [:]
      let names = visionEmb.keys.sorted()
      var agree = 0, total = 0
      for a in names {
        var rowV: [String: Float] = [:], rowR: [String: Float] = [:]
        for b in names where a < b {
          let v = cosine(visionEmb[a]!, visionEmb[b]!)
          let refA = (ref[a]?["mbf"] as? [NSNumber])?.map { $0.floatValue } ?? []
          let refB = (ref[b]?["mbf"] as? [NSNumber])?.map { $0.floatValue } ?? []
          let r = cosine(refA, refB)
          rowV[b] = v; rowR[b] = r
          total += 1
          if (v >= LocalRecognition.matchThreshold) == (r >= LocalRecognition.matchThreshold) { agree += 1 }
        }
        matrix[a] = rowV; refMatrix[a] = rowR
      }
      report["pairCosineVision"] = matrix
      report["pairCosineInsightFace"] = refMatrix
      report["decisionAgreement"] = "\(agree)/\(total)"
      log("pair cosines (Vision pipeline): \(matrix)")
      log("pair cosines (InsightFace mbf): \(refMatrix)")
      log("match decisions agree at \(LocalRecognition.matchThreshold): \(agree)/\(total)")
      report["ok"] = true
    } catch {
      report["ok"] = false
      report["error"] = error.localizedDescription
      log("FAILED: \(error.localizedDescription)")
    }
    if let out = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
      try? out.write(to: dir.appendingPathComponent("selftest-result.json"))
    }
    log("done")
  }
}
