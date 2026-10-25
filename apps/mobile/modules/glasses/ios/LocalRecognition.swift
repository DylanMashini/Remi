import Foundation
import UIKit

/// On-device face recognition. Glasses frames never leave the phone: faces are embedded by
/// `FaceRecognizer` (Core ML), matched against the family roster (embeddings computed on the
/// phone from the enrollment photos), debounced (5 min per person, 60 s for strangers), and only
/// the *decision* (`personId` or unknown, score, box) is posted to `POST /api/recognitions`,
/// which logs the moment and returns the sentence to speak.
final class LocalRecognition {
  static let shared = LocalRecognition()

  static let matchThreshold = FaceModel.matchThreshold
  static let knownDebounce: TimeInterval = 5 * 60
  static let unknownDebounce: TimeInterval = 60
  static let unknownLine = "Someone new is here."
  /// On-demand lines (glasses button). The server composes the same words; these are the offline copy.
  static let nobodyLine = "I don't see anyone right now."
  static let unknownAlsoLine = "Someone new is here too."
  /// A frame result older than this is stale for an on-demand answer; wait for the next one instead.
  static let freshResult: TimeInterval = 1.5
  static let onDemandWait: TimeInterval = 2.5

  /// `speechId` is the server's id for the ElevenLabs audio of `line` (nil for a roster copy that
  /// predates the field); the Speaker caches that audio on the phone during roster sync.
  struct Person { let id: String; let name: String; let relationship: String?; let line: String; let speechId: String? }
  private struct Sample { let personId: String; let embedding: [Float] }

  private let queue = DispatchQueue(label: "recall.frames.local", qos: .userInitiated)
  private let lock = NSLock()

  /// Frames are only processed while a stream is running (set by GlassesController).
  private var active = false

  // Roster (guarded by `lock`).
  private var people: [String: Person] = [:]
  private var samples: [Sample] = []
  private var embeddingByFile: [String: [Float]] = [:]  // fileId -> embedding, so re-syncs skip unchanged photos
  private var unknownSpeechId: String?  // server's speechId for `unknownLine`
  private var nobodySpeechId: String?  // server's speechId for `nobodyLine`
  private(set) var lastSyncAt: Date?
  private(set) var lastSyncError: String?

  // Debounce (guarded by `lock`).
  private var lastAnnounced: [String: Date] = [:]

  // Frame pipeline.
  private var busy = false
  private var lastFrameAt = Date.distantPast
  private let minInterval: TimeInterval = 0.25
  private var lastErrorAt = Date.distantPast
  /// The last processed frame's matches (guarded by `lock`), so a button press can answer from what
  /// the glasses saw a moment ago instead of waiting a full detection cycle.
  private var lastMatches: [Match] = []
  private var lastResultAt = Date.distantPast
  /// Width of the frame `lastMatches` came from (for the pan of an on-demand answer).
  private var lastFrameWidth = 0
  private var onDemandInFlight = false

  /// `{faces, speak?}` for the UI plus the frame size.
  var onResult: (([String: Any], Int, Int) -> Void)?
  var onError: ((String) -> Void)?
  /// Called with (speechId?, text, pan) when a line should be spoken. `pan` is -1 (left) to 1
  /// (right): where the announced face sits in the frame, so the whisper comes from that side.
  var onSpeak: ((String?, String, Float) -> Void)?
  /// Called after a roster sync with every speechId the glasses may need, so audio can be prefetched.
  var onRosterSpeech: (([String]) -> Void)?

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
    try await FaceRecognizer.shared.loadAsync()
    let t0 = CFAbsoluteTimeGetCurrent()
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
      let speechId = (p["speechId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      newPeople[id] = Person(id: id, name: name, relationship: p["relationship"] as? String, line: line, speechId: speechId)
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
    let unknownId = ((obj["unknown"] as? [String: Any])?["speechId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let nobodyId = ((obj["nobody"] as? [String: Any])?["speechId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    withLock {
      people = newPeople
      samples = newSamples
      embeddingByFile = cache
      unknownSpeechId = unknownId
      nobodySpeechId = nobodyId
      lastSyncAt = Date()
      lastSyncError = failures > 0 ? "\(failures) photo(s) could not be embedded" : nil
    }
    // Pull every line's ElevenLabs audio onto the phone now, so the first recognition plays instantly.
    let speechIds = newPeople.values.compactMap { $0.speechId } + [unknownId, nobodyId].compactMap { $0 }
    onRosterSpeech?(speechIds)
    NSLog("[Glasses] roster synced in \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)) ms: \(newPeople.count) people, \(newSamples.count) samples, \(newPeople.count - known.count) without a usable photo")
    return (newPeople.count, newSamples.count)
  }

  /// Forget everything (sign-out).
  func clear() {
    lock.lock(); defer { lock.unlock() }
    people = [:]; samples = []; embeddingByFile = [:]; lastAnnounced = [:]; lastSyncAt = nil
    lastMatches = []; lastResultAt = .distantPast
  }

  // MARK: Matching

  struct Match { let box: [Int]; let score: Float; let person: Person? }

  // MARK: Spatial pan

  /// Horizontal offset from frame centre is pushed by this much before clamping, so a face a third
  /// of the way across the frame already sounds fully to one side (the glasses camera is wide and
  /// faces rarely reach the edges).
  static let panGain: Float = 1.5

  /// Stereo pan, -1 (left) to 1 (right), for a face box `[x, y, w, h]` in a frame `width` px wide.
  /// The glasses camera looks out from the wearer's face and is not mirrored, so the left of the
  /// frame is the wearer's left.
  static func pan(for box: [Int], frameWidth: Int) -> Float {
    guard box.count >= 3, frameWidth > 0 else { return 0 }
    let centre = Float(box[0]) + Float(box[2]) / 2
    let offset = (centre / Float(frameWidth) - 0.5) * 2  // -1 .. 1
    return max(-1, min(1, offset * panGain))
  }

  /// One pan for a line that names several faces: the mean of their positions (two people either
  /// side of the wearer land in the centre).
  static func pan(for boxes: [[Int]], frameWidth: Int) -> Float {
    guard !boxes.isEmpty else { return 0 }
    let sum = boxes.reduce(Float(0)) { $0 + pan(for: $1, frameWidth: frameWidth) }
    return (sum / Float(boxes.count) * 100).rounded() / 100
  }

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
  /// Marks a key as just announced without checking (an on-demand answer restarts the passive cooldown,
  /// so the stream does not repeat the same name a second later).
  private func markAnnounced(_ key: String) {
    lock.lock(); lastAnnounced[key] = Date(); lock.unlock()
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
    withLock { lastMatches = matches; lastResultAt = Date(); lastFrameWidth = w }
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
    var lineIds: [String?] = []
    var spokenBoxes: [[Int]] = []  // faces the line is about, for the stereo pan
    var announced = Set<String>()
    for m in matches {
      guard let p = m.person, !announced.contains(p.id), shouldAnnouncePerson(p.id) else { continue }
      announced.insert(p.id)
      lines.append(p.line)
      lineIds.append(p.speechId)
      spokenBoxes.append(m.box)
      events.append(["personId": p.id, "score": m.score, "box": m.box])
    }
    let unknown = matches.filter { $0.person == nil }
    if lines.isEmpty, let first = unknown.first, matches.allSatisfy({ $0.person == nil }), shouldAnnounceUnknown() {
      lines.append(Self.unknownLine)
      lineIds.append(withLock { unknownSpeechId })
      spokenBoxes.append(first.box)
      events.append(["personId": NSNull(), "score": first.score, "box": first.box, "count": unknown.count])
    }

    var body: [String: Any] = ["faces": faces]
    let localText = lines.joined(separator: " ")
    // The roster's speechId is only valid for a single line (ids hash the exact text).
    let localSpeechId: String? = lines.count == 1 ? lineIds[0] : nil
    let pan = Self.pan(for: spokenBoxes, frameWidth: w)
    if !lines.isEmpty { body["speak"] = ["speechId": localSpeechId ?? "", "text": localText, "pan": pan] }
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
          onSpeak?(speak["speechId"] as? String, text, pan)
          return
        }
      } catch {
        report("Recognition log failed (spoke locally): \(error.localizedDescription)")
      }
      // Offline fallback: the roster's speechId is usually already cached on the phone, so this is
      // still the ElevenLabs voice; Apple speech only if the audio was never fetched.
      onSpeak?(localSpeechId, localText, pan)
    }
  }

  // MARK: On demand (glasses button)

  /// Answers "who is here?" right now, ignoring the debounce: names everyone known in the latest
  /// frame, "Someone new is here." for strangers, or "I don't see anyone right now." Uses the last
  /// result if it is fresh, otherwise waits for the next frame (up to `onDemandWait`). The decision
  /// is logged through `POST /api/recognitions` with `trigger` so the caregiver timeline shows the
  /// press; if the server is unreachable the local copy of the words is spoken. Returns the text.
  /// A second press while one is in flight is ignored (returns nil).
  func whoIsHere(trigger: String) async -> String? {
    let proceed: Bool = withLock {
      if onDemandInFlight { return false }
      onDemandInFlight = true
      return true
    }
    guard proceed else { return nil }
    defer { withLock { onDemandInFlight = false } }

    let matches = await latestMatches()
    let frameWidth = withLock { lastFrameWidth }
    var events: [[String: Any]] = []
    var lines: [String] = []
    var lineIds: [String?] = []
    var spokenBoxes: [[Int]] = []
    var named = Set<String>()
    for m in matches {
      guard let p = m.person, !named.contains(p.id) else { continue }
      named.insert(p.id)
      markAnnounced("p:\(p.id)")
      lines.append(p.line)
      lineIds.append(p.speechId)
      spokenBoxes.append(m.box)
      events.append(["personId": p.id, "score": m.score, "box": m.box])
    }
    let unknown = matches.filter { $0.person == nil }
    if let first = unknown.first {
      markAnnounced("unknown")
      lines.append(named.isEmpty ? Self.unknownLine : Self.unknownAlsoLine)
      lineIds.append(named.isEmpty ? withLock { unknownSpeechId } : nil)
      spokenBoxes.append(first.box)
      events.append(["personId": NSNull(), "score": first.score, "box": first.box, "count": unknown.count])
    }
    if lines.isEmpty {
      lines.append(Self.nobodyLine)
      lineIds.append(withLock { nobodySpeechId })
    }
    let localText = lines.joined(separator: " ")
    let localSpeechId: String? = lines.count == 1 ? lineIds[0] : nil
    let pan = Self.pan(for: spokenBoxes, frameWidth: frameWidth)
    NSLog("[Glasses] who is here (\(trigger)): \(matches.count) face(s), \(named.count) known -> \(localText)")

    do {
      let data = try JSONSerialization.data(withJSONObject: ["events": events, "trigger": trigger])
      let req = try BackendClient.shared.request("/api/recognitions", method: "POST", contentType: "application/json", body: data, timeout: 8)
      let obj = try await BackendClient.shared.sendJSON(req)
      if let speak = obj["speak"] as? [String: Any], let text = speak["text"] as? String, !text.isEmpty {
        onSpeak?(speak["speechId"] as? String, text, pan)
        return text
      }
    } catch {
      report("Recognition log failed (spoke locally): \(error.localizedDescription)")
    }
    onSpeak?(localSpeechId, localText, pan)
    return localText
  }

  /// The matches of a frame processed within `freshResult`, or the next frame's matches if one
  /// arrives within `onDemandWait`. Empty when no stream is running or no frame arrives in time.
  private func latestMatches() async -> [Match] {
    let (isActive, matches, at) = withLock { (active, lastMatches, lastResultAt) }
    guard isActive else { return [] }
    if Date().timeIntervalSince(at) <= Self.freshResult { return matches }
    let deadline = Date().addingTimeInterval(Self.onDemandWait)
    while Date() < deadline {
      try? await Task.sleep(nanoseconds: 50_000_000)
      let (m, t) = withLock { (lastMatches, lastResultAt) }
      if t > at { return m }
    }
    NSLog("[Glasses] who is here: no frame within \(Self.onDemandWait) s")
    return []
  }

  private func report(_ msg: String) {
    if Date().timeIntervalSince(lastErrorAt) > 5 {
      lastErrorAt = Date()
      onError?(msg)
    }
  }
}
