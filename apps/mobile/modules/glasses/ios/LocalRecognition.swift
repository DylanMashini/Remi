import Foundation
import UIKit

/// On-device face recognition. Glasses frames never leave the phone: faces are embedded by
/// `FaceRecognizer` (Core ML), matched against the family roster (embeddings computed on the
/// phone from the enrollment photos), debounced (5 min per person, 60 s for strangers), and only
/// the *decision* (`personId` or unknown, score, box) is posted to `POST /api/recognitions`,
/// which logs the moment and returns the sentence to speak.
final class LocalRecognition {
  static let shared = LocalRecognition()

  static let matchThreshold: Float = 0.5
  static let knownDebounce: TimeInterval = 5 * 60
  static let unknownDebounce: TimeInterval = 60
  static let unknownLine = "Someone new is here."

  struct Person { let id: String; let name: String; let relationship: String?; let line: String }
  private struct Sample { let personId: String; let embedding: [Float] }

  private let queue = DispatchQueue(label: "recall.frames.local", qos: .userInitiated)
  private let lock = NSLock()

  /// Frames are only processed while a stream is running (set by GlassesController).
  private var active = false

  // Roster (guarded by `lock`).
  private var people: [String: Person] = [:]
  private var samples: [Sample] = []
  private var embeddingByFile: [String: [Float]] = [:]  // fileId -> embedding, so re-syncs skip unchanged photos
  private(set) var lastSyncAt: Date?
  private(set) var lastSyncError: String?

  // Debounce (guarded by `lock`).
  private var lastAnnounced: [String: Date] = [:]

  // Frame pipeline.
  private var busy = false
  private var lastFrameAt = Date.distantPast
  private let minInterval: TimeInterval = 0.25
  private var lastErrorAt = Date.distantPast

  /// `{faces, speak?}` for the UI plus the frame size.
  var onResult: (([String: Any], Int, Int) -> Void)?
  var onError: ((String) -> Void)?
  /// Called with (speechId?, text) when a line should be spoken.
  var onSpeak: ((String?, String) -> Void)?

  private init() {}

  /// Synchronous critical section (callable from async code without the Swift 6 lock warning).
  private func withLock<T>(_ body: () -> T) -> T {
    lock.lock(); defer { lock.unlock() }
    return body()
  }

  func setActive(_ on: Bool) {
    lock.lock(); active = on; lock.unlock()
  }

  var rosterCounts: (people: Int, samples: Int) {
    lock.lock(); defer { lock.unlock() }
    return (people.count, samples.count)
  }

  // MARK: Roster

  /// Fetches `GET /api/people` and embeds every enrollment photo on the phone. Returns (people, samples).
  @discardableResult
  func syncRoster() async throws -> (people: Int, samples: Int) {
    try FaceRecognizer.shared.load()
    let req = try BackendClient.shared.request("/api/people", timeout: 20)
    let obj = try await BackendClient.shared.sendJSON(req)
    let list = obj["people"] as? [[String: Any]] ?? []

    var newPeople: [String: Person] = [:]
    var newSamples: [Sample] = []
    var cache = withLock { embeddingByFile }
    var failures = 0
    for p in list {
      guard let id = p["id"] as? String, let name = p["name"] as? String else { continue }
      let line = (p["line"] as? String) ?? "This is \(name)."
      newPeople[id] = Person(id: id, name: name, relationship: p["relationship"] as? String, line: line)
      var urls = p["photoUrls"] as? [String] ?? []
      if urls.isEmpty, let one = p["photoUrl"] as? String { urls = [one] }
      for url in urls {
        let fileId = url.split(separator: "/").last.map(String.init) ?? url
        if let cached = cache[fileId] {
          newSamples.append(Sample(personId: id, embedding: cached))
          continue
        }
        do {
          let photoReq = try BackendClient.shared.request(url, timeout: 30)
          let (data, status) = try await BackendClient.shared.send(photoReq)
          guard (200..<300).contains(status), let img = UIImage(data: data) else {
            throw GlassesError("photo \(fileId) -> \(status)")
          }
          let faces = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 1)
          guard let face = faces.first else { NSLog("[Glasses] roster: no face in photo \(fileId) of \(name)"); continue }
          cache[fileId] = face.embedding
          newSamples.append(Sample(personId: id, embedding: face.embedding))
        } catch {
          failures += 1
          NSLog("[Glasses] roster: \(name) photo failed: \(error.localizedDescription)")
        }
      }
    }
    let known = Set(newSamples.map { $0.personId })
    withLock {
      people = newPeople
      samples = newSamples
      embeddingByFile = cache
      lastSyncAt = Date()
      lastSyncError = failures > 0 ? "\(failures) photo(s) could not be embedded" : nil
    }
    NSLog("[Glasses] roster synced: \(newPeople.count) people, \(newSamples.count) samples, \(newPeople.count - known.count) without a usable photo")
    return (newPeople.count, newSamples.count)
  }

  /// Forget everything (sign-out).
  func clear() {
    lock.lock(); defer { lock.unlock() }
    people = [:]; samples = []; embeddingByFile = [:]; lastAnnounced = [:]; lastSyncAt = nil
  }

  // MARK: Matching

  struct Match { let box: [Int]; let score: Float; let person: Person? }

  /// A person's score is their best sample; known if ≥ threshold.
  func match(_ detections: [FaceRecognizer.Detection]) -> [Match] {
    lock.lock(); let samples = self.samples, people = self.people; lock.unlock()
    return detections.map { det in
      var best: [String: Float] = [:]
      for s in samples {
        let score = dot(s.embedding, det.embedding)
        if score > (best[s.personId] ?? -2) { best[s.personId] = score }
      }
      guard let top = best.max(by: { $0.value < $1.value }) else { return Match(box: det.box, score: 0, person: nil) }
      let score = (top.value * 1000).rounded() / 1000
      return Match(box: det.box, score: score, person: top.value >= Self.matchThreshold ? people[top.key] : nil)
    }
  }

  private func dot(_ a: [Float], _ b: [Float]) -> Float {
    var s: Float = 0
    for i in 0..<min(a.count, b.count) { s += a[i] * b[i] }
    return s
  }

  // MARK: Debounce

  private func claim(_ key: String, window: TimeInterval) -> Bool {
    lock.lock(); defer { lock.unlock() }
    let now = Date()
    if let last = lastAnnounced[key], now.timeIntervalSince(last) < window { return false }
    lastAnnounced[key] = now
    return true
  }
  func shouldAnnouncePerson(_ id: String) -> Bool { claim("p:\(id)", window: Self.knownDebounce) }
  func shouldAnnounceUnknown() -> Bool { claim("unknown", window: Self.unknownDebounce) }
  func clearDebounce() { lock.lock(); lastAnnounced = [:]; lock.unlock() }

  // MARK: Frames

  /// Accepts a frame if a stream is active and the pipeline is idle (≤ 4 fps). Returns true when accepted.
  @discardableResult
  func offer(_ image: UIImage) -> Bool {
    lock.lock()
    let now = Date()
    guard active, !busy, now.timeIntervalSince(lastFrameAt) >= minInterval else { lock.unlock(); return false }
    busy = true
    lastFrameAt = now
    lock.unlock()
    queue.async { [self] in
      defer { lock.lock(); busy = false; lock.unlock() }
      process(image)
    }
    return true
  }

  private func process(_ image: UIImage) {
    let w = Int(image.size.width * image.scale), h = Int(image.size.height * image.scale)
    let detections: [FaceRecognizer.Detection]
    do {
      detections = try FaceRecognizer.shared.detectAndEmbed(image)
    } catch {
      report("Face recognition failed: \(error.localizedDescription)")
      return
    }
    let matches = match(detections)
    var faces: [[String: Any]] = []
    for m in matches {
      var f: [String: Any] = ["box": m.box, "score": m.score]
      if let p = m.person {
        f["personId"] = p.id
        f["name"] = p.name
        if let r = p.relationship { f["relationship"] = r }
      }
      faces.append(f)
    }

    // Decide what to say: known people first (5 min each), unknown only if nobody known is in frame.
    var events: [[String: Any]] = []
    var lines: [String] = []
    var announced = Set<String>()
    for m in matches {
      guard let p = m.person, !announced.contains(p.id), shouldAnnouncePerson(p.id) else { continue }
      announced.insert(p.id)
      lines.append(p.line)
      events.append(["personId": p.id, "score": m.score, "box": m.box])
    }
    let unknown = matches.filter { $0.person == nil }
    if lines.isEmpty, let first = unknown.first, matches.allSatisfy({ $0.person == nil }), shouldAnnounceUnknown() {
      lines.append(Self.unknownLine)
      events.append(["personId": NSNull(), "score": first.score, "box": first.box, "count": unknown.count])
    }

    var body: [String: Any] = ["faces": faces]
    let localText = lines.joined(separator: " ")
    if !lines.isEmpty { body["speak"] = ["speechId": "", "text": localText] }
    onResult?(body, w, h)
    // `image` goes out of scope here: the frame is discarded, never written anywhere.

    guard !events.isEmpty else { return }
    Task {
      // The server logs RECOGNITION/UNKNOWN + SPOKEN and returns the canonical sentence (it may
      // include a newer memory than the roster copy). If it is unreachable, speak the local line.
      do {
        let data = try JSONSerialization.data(withJSONObject: ["events": events])
        let req = try BackendClient.shared.request("/api/recognitions", method: "POST", contentType: "application/json", body: data, timeout: 8)
        let obj = try await BackendClient.shared.sendJSON(req)
        if let speak = obj["speak"] as? [String: Any], let text = speak["text"] as? String, !text.isEmpty {
          onSpeak?(speak["speechId"] as? String, text)
          return
        }
      } catch {
        report("Recognition log failed (spoke locally): \(error.localizedDescription)")
      }
      onSpeak?(nil, localText)
    }
  }

  private func report(_ msg: String) {
    if Date().timeIntervalSince(lastErrorAt) > 5 {
      lastErrorAt = Date()
      onError?(msg)
    }
  }
}
