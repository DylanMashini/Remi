import Foundation
import UIKit

/// DEBUG-only check of the on-device recognizer against InsightFace numbers produced by
/// scripts/reference_embeddings.py (InsightFace buffalo_l, the same w600k_r50 that ships). Runs at launch when RECALL_FACE_SELFTEST=<dir> is in the
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

  private static func floats(_ v: Any?) -> [Float] { (v as? [NSNumber])?.map { $0.floatValue } ?? [] }

  private static func run(dir: URL) {
    var report: [String: Any] = [:]
    func log(_ s: String) { NSLog("[FaceSelfTest] %@", s) }
    do {
      let data = try Data(contentsOf: dir.appendingPathComponent("reference.json"))
      guard let ref = try JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { throw GlassesError("bad reference.json") }
      let t0 = CFAbsoluteTimeGetCurrent()
      try FaceRecognizer.shared.load()
      report["modelLoadMs"] = (CFAbsoluteTimeGetCurrent() - t0) * 1000

      if let wrong = ref.first(where: { ($0.value["model"] as? String) != FaceModel.name }) {
        throw GlassesError("reference.json entry \(wrong.key) is from model \(wrong.value["model"] as? String ?? "none"), app ships \(FaceModel.name); rerun reference_embeddings.py")
      }
      report["model"] = FaceModel.name
      let names = ref.keys.sorted()
      var pipelineEmb: [String: [Float]] = [:]
      var sweepEmb: [String: [Float]] = [:]  // "<image>|<variant>" -> embedding
      var perImage: [String: Any] = [:]
      for name in names {
        let entry = ref[name]!
        var row: [String: Any] = [:]
        let refEmb = floats(entry["embedding"])

        // 1. Model equivalence: InsightFace's aligned crop through Core ML vs onnxruntime.
        if let crop = UIImage(contentsOfFile: dir.appendingPathComponent("\(name).aligned.png").path)?.cgImage {
          do {
            var times: [Double] = []
            var emb: [Float] = []
            for _ in 0..<5 {
              let t = CFAbsoluteTimeGetCurrent()
              emb = try FaceRecognizer.shared.embedAligned(crop)
              times.append((CFAbsoluteTimeGetCurrent() - t) * 1000)
            }
            row["alignedCosineVsOnnx"] = cosine(emb, refEmb)
            row["embedMsMedian"] = times.sorted()[times.count / 2]
          } catch {
            row["alignedError"] = error.localizedDescription
          }
        }

        // 2. Full pipeline (Vision rectangle + box crop + Core ML) on the original photo.
        guard let path = entry["image"] as? String, let img = UIImage(contentsOfFile: path), let cg = img.cgImage else {
          perImage[name] = row; continue
        }
        do {
          let t = CFAbsoluteTimeGetCurrent()
          let dets = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 1)
          row["pipelineMs"] = (CFAbsoluteTimeGetCurrent() - t) * 1000
          if let d = dets.first {
            pipelineEmb[name] = d.embedding
            row["box"] = d.box
            row["refBox"] = entry["box"]
            row["pipelineCosineVsInsightFace"] = cosine(d.embedding, refEmb)
            if let crop = FaceRecognizer.boxCrop(cg, box: CGRect(x: d.box[0], y: d.box[1], width: d.box[2], height: d.box[3]),
                                                 scale: FaceRecognizer.cropScale, dy: FaceRecognizer.cropShiftY),
               let png = UIImage(cgImage: crop).pngData() {
              try? png.write(to: dir.appendingPathComponent("\(name).vision.png"))
            }
          } else {
            row["pipelineCosineVsInsightFace"] = "no face"
          }
        } catch {
          row["pipelineError"] = error.localizedDescription
        }

        // 3. Tuning sweep for the crop geometry: cosine vs InsightFace per (scale, dy).
        if let box = try? FaceRecognizer.detectFaces(cg).first {
          var sweep: [String: Any] = [:]
          for scale in [1.2, 1.3, 1.4] as [CGFloat] {
            for dy in [-0.2, -0.15, -0.1, -0.05] as [CGFloat] {
              let key = "s\(scale)_dy\(dy)"
              if let crop = FaceRecognizer.boxCrop(cg, box: box, scale: scale, dy: dy), let emb = try? FaceRecognizer.shared.embedAligned(crop) {
                sweep[key] = Double(cosine(emb, refEmb))
                sweepEmb["\(name)|\(key)"] = emb
              }
            }
          }
          row["cropSweepCosineVsInsightFace"] = sweep
        }
        perImage[name] = row
        log("\(name): \(row.filter { $0.key != "cropSweepCosineVsInsightFace" })")
      }
      report["images"] = perImage

      // 4. Decisions: pair cosines of pipeline embeddings vs InsightFace's, agreement at the threshold.
      var pairs: [String: Any] = [:], refPairs: [String: Any] = [:]
      var agree = 0, total = 0
      for a in names { for b in names where a < b {
        let r = cosine(floats(ref[a]?["embedding"]), floats(ref[b]?["embedding"]))
        refPairs["\(a)~\(b)"] = r
        if let ea = pipelineEmb[a], let eb = pipelineEmb[b] {
          let v = cosine(ea, eb)
          pairs["\(a)~\(b)"] = v
          total += 1
          if (v >= LocalRecognition.matchThreshold) == (r >= LocalRecognition.matchThreshold) { agree += 1 }
        }
      } }
      report["pairCosinePipeline"] = pairs
      report["pairCosineInsightFace"] = refPairs
      report["decisionAgreement"] = "\(agree)/\(total)"
      var sweepPairs: [String: Any] = [:]
      for v in Set(sweepEmb.keys.compactMap { $0.split(separator: "|").last.map(String.init) }).sorted() {
        var p: [String: Float] = [:]
        for a in names { for b in names where a < b {
          if let ea = sweepEmb["\(a)|\(v)"], let eb = sweepEmb["\(b)|\(v)"] { p["\(a)~\(b)"] = cosine(ea, eb) }
        } }
        sweepPairs[v] = p
      }
      report["cropSweepPairCosines"] = sweepPairs
      log("pair cosines (pipeline): \(pairs)")
      log("pair cosines (InsightFace \(FaceModel.name)): \(refPairs)")
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
