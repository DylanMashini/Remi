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
  /// Optional: the first photo. Other photos pick the face closest to this one (group shots).
  @Field var seedPhotoUri: String?
}

public final class GlassesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Glasses")

    Events("onStatus", "onFrameResult", "onAudioRoute", "onSpoken", "onError", "onPhotoIndex", "onButton", "onChat")

    OnCreate {
      let module = self
      Task { @MainActor in
        GlassesController.shared.module = module
        GlassesController.shared.setup()
      }
      PhotoIndex.shared.onStatus = { body in
        Task { @MainActor in GlassesController.shared.emit("onPhotoIndex", body) }
      }
      PhotoIndex.shared.load()
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

    // Live conversation: turns are automatic (server VAD), audio phone ↔ OpenAI directly. See CONTRACT.md.
    AsyncFunction("startChat") { () async throws -> [String: Any] in
      try await GlassesController.shared.startChat()
    }

    AsyncFunction("stopChat") { () async -> [String: Any] in
      await GlassesController.shared.stopChat()
    }

    AsyncFunction("startListening") { () async throws in
      try await GlassesController.shared.startListening()
    }

    AsyncFunction("stopListening") { () async throws -> [String: Any] in
      try await GlassesController.shared.stopListening()
    }

    // Same as pressing the glasses' capture button: name everyone in view now, ignoring the cooldown.
    AsyncFunction("whoIsHere") { () async -> [String: Any?] in
      let text = await GlassesController.shared.whoIsHere(trigger: "phone")
      return ["text": text]
    }

    // Re-embed everyone's enrollment photos on the phone (after enrolling or editing people elsewhere).
    AsyncFunction("syncRoster") { () async throws -> [String: Any] in
      try await GlassesController.shared.syncRoster()
    }

    // Photo library index (PhotoIndex.swift): suggestions for enrollment only. Phone-local,
    // never synced, never read by the glasses recognition path.
    AsyncFunction("photoIndexStatus") { () -> [String: Any] in
      PhotoIndex.shared.status()
    }

    AsyncFunction("photoIndexStart") { () async -> [String: Any] in
      await PhotoIndex.shared.start()
    }

    AsyncFunction("photoIndexPause") { () -> [String: Any] in
      PhotoIndex.shared.pause()
    }

    AsyncFunction("photoIndexClear") { () in
      PhotoIndex.shared.clear()
    }

    AsyncFunction("photoIndexSearch") { (seedPhotoUri: String) async throws -> [[String: Any]] in
      try await PhotoIndex.shared.searchSeedPhoto(seedPhotoUri).map {
        ["id": $0.id, "score": $0.score, "thumbUri": $0.thumbUri, "takenAt": $0.takenAt]
      }
    }

    AsyncFunction("photoIndexExport") { (candidateId: String) async throws -> String in
      try await PhotoIndex.shared.exportCandidate(candidateId)
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
  /// Below this cosine to the seed face, a chosen photo is rejected as a different person.
  static let seedMatchThreshold = FaceModel.enrollSeedThreshold

  static func cosine(_ a: [Float], _ b: [Float]) -> Float {
    var s: Float = 0
    for i in 0..<min(a.count, b.count) { s += a[i] * b[i] }
    return s  // both are L2-normalized
  }

  static func run(_ p: EnrollOptions) async throws -> [String: Any] {
    let name = p.name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw GlassesError("Name is required") }
    guard (1...3).contains(p.photoUris.count) else { throw GlassesError("Provide 1 to 3 photos") }

    var form = Multipart()
    form.addField("name", name)
    if let r = p.relationship, !r.isEmpty { form.addField("relationship", r) }
    if let n = p.notes, !n.isEmpty { form.addField("notes", n) }
    // Every photo must contain a face the on-device model can embed; the boxes go up with the
    // photos so the server can crop the avatar around the face (it does no face detection itself).
    //
    // With a seed photo (the first one), each other photo contributes the face most similar to
    // the seed's largest face, so a group shot picked from the library enrolls the right person.
    // Without a seed (live capture), the largest face is used, as before.
    var seed: [Float]?
    let seedUri = p.seedPhotoUri?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !seedUri.isEmpty {
      let jpeg = try loadJPEG(seedUri)
      guard let img = UIImage(data: jpeg) else { throw GlassesError("The first photo is not an image") }
      guard let face = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 1).first else {
        throw GlassesError("No face found in the first photo")
      }
      seed = face.embedding
    }
    var boxes: [[Int]] = []
    for (i, uri) in p.photoUris.enumerated() {
      let jpeg = try loadJPEG(uri)
      guard let img = UIImage(data: jpeg) else { throw GlassesError("Photo \(i + 1) is not an image") }
      let face: FaceRecognizer.Detection
      if let seed, uri != seedUri {
        let faces = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 6)
        guard !faces.isEmpty else { throw GlassesError("No face found in photo \(i + 1)") }
        let scored = faces.map { ($0, cosine($0.embedding, seed)) }
        let best = scored.max { $0.1 < $1.1 }!
        NSLog("[Glasses] enroll photo %d: %d face(s), best cosine to seed %.2f", i + 1, faces.count, best.1)
        guard best.1 >= seedMatchThreshold else {
          throw GlassesError("That photo does not look like the same person (photo \(i + 1))")
        }
        face = best.0
      } else {
        guard let first = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 1).first else {
          throw GlassesError("No face found in photo \(i + 1)")
        }
        face = first
      }
      boxes.append(face.box)
      form.addFile("photos", filename: "photo\(i).jpg", mime: "image/jpeg", data: jpeg)
    }
    let json = try JSONSerialization.data(withJSONObject: boxes)
    form.addField("faces", String(decoding: json, as: UTF8.self))
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
    let photos = person?["photoCount"] as? Int ?? p.photoUris.count
    // The new face is matched on the phone: refresh the local roster right away.
    do { _ = try await GlassesController.shared.syncRoster() } catch { NSLog("[Glasses] roster sync after enroll failed: \(error)") }
    return ["personId": personId, "photos": photos]
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
