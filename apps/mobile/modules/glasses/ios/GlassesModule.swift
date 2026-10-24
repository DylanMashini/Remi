import ExpoModulesCore
import UIKit

struct ConfigureOptions: Record {
  @Field var backendUrl: String = ""
  @Field var token: String = ""
}

struct StartStreamOptions: Record {
  @Field var mock: Bool = false
}

struct EnrollOptions: Record {
  @Field var name: String = ""
  @Field var relationship: String?
  @Field var notes: String?
  @Field var photoUris: [String] = []
}

public final class GlassesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Glasses")

    Events("onStatus", "onFrameResult", "onAudioRoute", "onSpoken", "onError")

    OnCreate {
      let module = self
      Task { @MainActor in
        GlassesController.shared.module = module
        GlassesController.shared.setup()
      }
    }

    AsyncFunction("configure") { (opts: ConfigureOptions) in
      guard !opts.backendUrl.isEmpty, !opts.token.isEmpty else {
        throw GlassesError("configure requires backendUrl and token")
      }
      BackendClient.shared.configure(backendUrl: opts.backendUrl, token: opts.token)
    }

    AsyncFunction("register") { () async throws in
      try await GlassesController.shared.register()
    }

    AsyncFunction("startStream") { (opts: StartStreamOptions?) async throws in
      try await GlassesController.shared.startStream(mock: opts?.mock ?? false)
    }

    AsyncFunction("stopStream") { () async in
      await GlassesController.shared.stopStream()
    }

    AsyncFunction("getStatus") { () async -> [String: Any] in
      await GlassesController.shared.status()
    }

    AsyncFunction("enrollPerson") { (p: EnrollOptions) async throws -> [String: Any] in
      try await Enroll.run(p)
    }

    AsyncFunction("captureGlassesPhoto") { () async throws -> String in
      try await GlassesController.shared.captureGlassesPhoto()
    }

    AsyncFunction("startAsk") { () async throws in
      try await GlassesController.shared.startAsk()
    }

    AsyncFunction("stopAsk") { () async throws -> [String: Any] in
      try await GlassesController.shared.stopAsk()
    }

    AsyncFunction("speak") { (speechId: String, text: String) async throws in
      await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
        Task { @MainActor in
          GlassesController.shared.speaker.enqueue(speechId: speechId.isEmpty ? nil : speechId, text: text) { _ in cont.resume() }
        }
      }
    }

    View(GlassesPreviewView.self) {}
  }
}

enum Enroll {
  static func run(_ p: EnrollOptions) async throws -> [String: Any] {
    let name = p.name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw GlassesError("Name is required") }
    guard (1...3).contains(p.photoUris.count) else { throw GlassesError("Provide 1 to 3 photos") }

    var form = Multipart()
    form.addField("name", name)
    if let r = p.relationship, !r.isEmpty { form.addField("relationship", r) }
    if let n = p.notes, !n.isEmpty { form.addField("notes", n) }
    for (i, uri) in p.photoUris.enumerated() {
      let jpeg = try loadJPEG(uri)
      form.addFile("photos", filename: "photo\(i).jpg", mime: "image/jpeg", data: jpeg)
    }
    let body = form.finish()
    let req = try BackendClient.shared.request("/api/people", method: "POST", contentType: form.contentType, body: body, timeout: 60)
    let (data, status) = try await BackendClient.shared.send(req)
    let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    guard (200..<300).contains(status) else {
      var msg = obj["error"] as? String ?? "Enrollment failed (\(status))"
      if let idx = obj["index"] as? Int { msg += " (photo \(idx + 1))" }
      throw GlassesError(msg)
    }
    let person = obj["person"] as? [String: Any]
    let personId = person?["id"] as? String ?? ""
    let samples: Int
    if let n = obj["samples"] as? Int { samples = n } else if let arr = obj["samples"] as? [Any] { samples = arr.count } else { samples = 0 }
    return ["personId": personId, "samples": samples]
  }

  /// Reads a file:// URI (or bare path), downsizes to 1280px max and re-encodes as JPEG.
  static func loadJPEG(_ uri: String) throws -> Data {
    let url: URL
    if let u = URL(string: uri), u.scheme == "file" { url = u } else if uri.hasPrefix("/") { url = URL(fileURLWithPath: uri) } else {
      throw GlassesError("Unsupported photo URI (need file://): \(uri)")
    }
    let raw: Data
    do { raw = try Data(contentsOf: url) } catch { throw GlassesError("Could not read photo \(url.lastPathComponent): \(error.localizedDescription)") }
    guard let img = UIImage(data: raw) else { throw GlassesError("Not an image: \(url.lastPathComponent)") }
    let maxSide: CGFloat = 1280
    let w = img.size.width, h = img.size.height
    let scale = min(1, maxSide / max(w, h))
    let target = CGSize(width: floor(w * scale), height: floor(h * scale))
    let fmt = UIGraphicsImageRendererFormat.default()
    fmt.scale = 1
    let resized = UIGraphicsImageRenderer(size: target, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: target)) }
    guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { throw GlassesError("JPEG encode failed") }
    return jpeg
  }
}
