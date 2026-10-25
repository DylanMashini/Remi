import Accelerate
import CoreGraphics
import Foundation
import Photos
import UIKit

/// TWO SEPARATE STORES, NEVER CROSSED.
///
/// This file indexes faces in the phone's own photo library (newest 2,000 photos) with the same
/// on-device model as the glasses (`FaceRecognizer`). It exists for ONE purpose: when somebody is
/// already being enrolled from `add-person`, suggest other photos of that same person so the
/// remaining enrollment slots are real photos from different days instead of a camera burst.
///
/// - `LocalRecognition` (the roster matcher for glasses frames) must NEVER read this index.
///   A library face joins the roster only when the person enrolling taps it, it is exported to a
///   JPEG, and that JPEG goes through the normal `enrollPerson` upload like any other photo.
/// - Nothing here leaves the phone. Embeddings, metadata and thumbnails live in the app sandbox
///   (Application Support + tmp). The index never syncs between phones: a caregiver's phone indexes
///   the caregiver's photos, the wearer's phone indexes the wearer's photos.
/// - iCloud originals are never downloaded (`isNetworkAccessAllowed = false`); they count as skipped.
/// - Role-agnostic: there is no role check anywhere in this feature.
final class PhotoIndex {
  static let shared = PhotoIndex()

  // MARK: Tuning

  static let maxAssets = 2000
  /// First pass thumbnail. MobileFaceNet wants ~90 px faces; 512 would upscale most of them.
  static let primarySide: CGFloat = 1024
  /// Faces narrower than this in the 1024 px image get a second detection on a 2048 px thumbnail.
  static let upgradeBelowWidth: CGFloat = 120
  static let upgradeSide: CGFloat = 2048
  static let checkpointEvery = 50
  static let formatVersion = 2
  static let dim = 512
  static let matchThreshold: Float = 0.45
  static let diversityThreshold: Float = 0.92
  static let maxCandidates = 12
  static let exportSide: CGFloat = 1280
  static let thumbSide = 256

  // MARK: Types

  /// One stored face. `box` is in pixels of the `imageWidth` x `imageHeight` image (top-left
  /// origin) that PhotoKit returned for a `targetSize` of `imageSide` x `imageSide`.
  struct Entry: Codable {
    let assetId: String
    let box: [Int]
    let imageSide: Int
    let imageWidth: Int
    let imageHeight: Int
    let creationDate: Double?
  }

  struct Candidate {
    let id: String
    let assetId: String
    let score: Float
    let thumbUri: String
    let takenAt: String
  }

  enum State: String { case idle, indexing, paused, done }

  private struct Sidecar: Codable {
    var version: Int
    var entries: [Entry]
    var processed: [String]
    var skipped: Int
    var upgraded: Int
    var total: Int
    var finished: Bool
  }

  // MARK: State

  private let queue = DispatchQueue(label: "recall.photoindex", qos: .utility)
  private let ioQueue = DispatchQueue(label: "recall.photoindex.io", qos: .userInitiated)
  private let lock = NSLock()

  private var entries: [Entry] = []
  private var embeddings: [Float] = []  // entries.count * dim, row-major, each row L2-normalized
  private var processed: Set<String> = []
  private var state: State = .idle
  private var total = 0
  private var skipped = 0
  private var upgraded = 0
  private var finished = false
  private var loaded = false

  /// The enroller (or the app) wants the indexer running.
  private var shouldRun = false
  /// The worker loop is on `queue`.
  private var working = false
  /// Paused by the app resigning active (resumes on didBecomeActive) rather than by a person.
  private var autoPaused = false
  /// A glasses stream is running: keep the CPU for recognition.
  private var streaming = false
  private var lastEmit = Date.distantPast
  private var lastError: String?

  /// exported file path -> assetId, so a seed photo that itself came from the library is excluded.
  private var exportedAssets: [String: String] = [:]

  /// Status for JS (`onPhotoIndex`), set by GlassesModule.
  var onStatus: (([String: Any]) -> Void)?

  private var observers: [NSObjectProtocol] = []

  private init() {
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.appWillResignActive()
    })
    observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.appDidBecomeActive()
    })
  }

  // MARK: Files

  private static var directory: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("PhotoIndex", isDirectory: true)
  }
  private static var sidecarURL: URL { directory.appendingPathComponent("index.json") }
  private static var embeddingsURL: URL { directory.appendingPathComponent("embeddings.f32") }
  private static var tmpDirectory: URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("photoindex", isDirectory: true)
  }

  /// Loads the checkpoint from disk. Idempotent; called before anything else touches the store.
  func load() {
    lock.lock(); defer { lock.unlock() }
    if loaded { return }
    loaded = true
    let fm = FileManager.default
    guard fm.fileExists(atPath: Self.sidecarURL.path), fm.fileExists(atPath: Self.embeddingsURL.path) else { return }
    do {
      let side = try JSONDecoder().decode(Sidecar.self, from: Data(contentsOf: Self.sidecarURL))
      guard side.version == Self.formatVersion else {
        NSLog("[PhotoIndex] discarding index with format v\(side.version)")
        try? fm.removeItem(at: Self.sidecarURL)
        try? fm.removeItem(at: Self.embeddingsURL)
        return
      }
      let raw = try Data(contentsOf: Self.embeddingsURL)
      let count = raw.count / MemoryLayout<Float>.size
      guard count == side.entries.count * Self.dim else {
        NSLog("[PhotoIndex] embeddings/sidecar mismatch (\(count) floats for \(side.entries.count) entries); discarding")
        return
      }
      var floats = [Float](repeating: 0, count: count)
      _ = floats.withUnsafeMutableBytes { raw.copyBytes(to: $0) }
      entries = side.entries
      embeddings = floats
      processed = Set(side.processed)
      skipped = side.skipped
      upgraded = side.upgraded
      total = side.total
      finished = side.finished
      state = side.finished ? .done : (side.processed.isEmpty ? .idle : .paused)
      NSLog("[PhotoIndex] loaded \(entries.count) faces from \(processed.count) assets (finished: \(finished))")
    } catch {
      NSLog("[PhotoIndex] load failed: \(error.localizedDescription)")
    }
  }

  /// Writes the checkpoint. Call with the lock NOT held; takes a snapshot under the lock.
  private func save() {
    lock.lock()
    let side = Sidecar(version: Self.formatVersion, entries: entries, processed: Array(processed),
                       skipped: skipped, upgraded: upgraded, total: total, finished: finished)
    let floats = embeddings
    lock.unlock()
    do {
      let fm = FileManager.default
      try fm.createDirectory(at: Self.directory, withIntermediateDirectories: true)
      let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
      try data.write(to: Self.embeddingsURL, options: .atomic)
      try JSONEncoder().encode(side).write(to: Self.sidecarURL, options: .atomic)
      // Keep the index out of iCloud backups: it is derived data about other people's faces.
      var url = Self.directory
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? url.setResourceValues(values)
    } catch {
      NSLog("[PhotoIndex] save failed: \(error.localizedDescription)")
    }
  }

  /// Deletes the index files, thumbnails and in-memory state.
  func clear() {
    lock.lock()
    shouldRun = false
    entries = []; embeddings = []; processed = []
    total = 0; skipped = 0; upgraded = 0; finished = false
    state = .idle
    lastError = nil
    exportedAssets = [:]
    lock.unlock()
    let fm = FileManager.default
    try? fm.removeItem(at: Self.directory)
    try? fm.removeItem(at: Self.tmpDirectory)
    emitStatus(force: true)
  }

  // MARK: Permission

  static func permissionString(_ s: PHAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .notDetermined: return "notDetermined"
    default: return "denied"  // .denied, .restricted
    }
  }

  var permission: PHAuthorizationStatus { PHPhotoLibrary.authorizationStatus(for: .readWrite) }

  var hasAccess: Bool {
    let p = permission
    return p == .authorized || p == .limited
  }

  // MARK: Status

  func status() -> [String: Any] {
    load()
    lock.lock(); defer { lock.unlock() }
    return statusLocked()
  }

  private func statusLocked() -> [String: Any] {
    var s: [String: Any] = [
      "permission": Self.permissionString(permission),
      "state": state.rawValue,
      "indexed": total > 0 ? min(processed.count, total) : processed.count,
      "total": total,
      "faces": entries.count,
      "skipped": skipped,
      "upgraded": upgraded,
    ]
    if let lastError { s["error"] = lastError }
    return s
  }

  private func emitStatus(force: Bool) {
    lock.lock()
    let now = Date()
    if !force, now.timeIntervalSince(lastEmit) < 0.5 { lock.unlock(); return }
    lastEmit = now
    let body = statusLocked()
    lock.unlock()
    onStatus?(body)
  }

  private func setState(_ s: State) {
    lock.lock()
    let changed = state != s
    state = s
    lock.unlock()
    if changed { emitStatus(force: true) }
  }

  // MARK: Running

  /// Requests Photos permission if it has never been asked, then starts or resumes indexing.
  /// Returns the status afterwards. Never shows the prompt when permission was already decided.
  @discardableResult
  func start() async -> [String: Any] {
    load()
    var p = permission
    if p == .notDetermined {
      p = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }
    guard p == .authorized || p == .limited else {
      lock.lock(); lastError = nil; lock.unlock()
      emitStatus(force: true)
      return status()
    }
    resume(manual: true)
    return status()
  }

  /// Resumes if there is access and work left. `manual` clears an auto-pause.
  private func resume(manual: Bool) {
    guard hasAccess else { return }
    lock.lock()
    if manual { autoPaused = false }
    shouldRun = true
    lastError = nil
    let alreadyWorking = working
    let blocked = streaming
    if !alreadyWorking && !blocked { working = true }
    lock.unlock()
    if alreadyWorking || blocked { emitStatus(force: true); return }
    queue.async { [self] in runLoop() }
  }

  /// Stops after the current asset. The checkpoint is kept; `start()` resumes.
  @discardableResult
  func pause() -> [String: Any] {
    lock.lock()
    shouldRun = false
    autoPaused = false
    let wasWorking = working
    let hadStarted = !processed.isEmpty
    let isDone = finished
    lock.unlock()
    if !wasWorking, hadStarted, !isDone { setState(.paused) }
    return status()
  }

  /// Called by GlassesController: while a stream runs the indexer yields the CPU to recognition.
  func setStreaming(_ on: Bool) {
    lock.lock()
    streaming = on
    let wantsRun = shouldRun && !working
    lock.unlock()
    if !on, wantsRun { resume(manual: false) }
  }

  private func appWillResignActive() {
    lock.lock()
    let wasRunning = shouldRun
    if wasRunning { autoPaused = true }
    shouldRun = false
    lock.unlock()
  }

  private func appDidBecomeActive() {
    lock.lock()
    let shouldResume = autoPaused
    autoPaused = false
    lock.unlock()
    if shouldResume { resume(manual: false) }
  }

  private func runLoop() {
    defer {
      lock.lock(); working = false; lock.unlock()
    }
    do { try FaceRecognizer.shared.load() } catch {
      lock.lock(); lastError = error.localizedDescription; shouldRun = false; lock.unlock()
      setState(.idle)
      return
    }
    let opts = PHFetchOptions()
    opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    opts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    opts.fetchLimit = Self.maxAssets
    opts.includeHiddenAssets = false
    let assets = PHAsset.fetchAssets(with: opts)
    lock.lock()
    total = assets.count
    finished = false
    lock.unlock()
    setState(.indexing)
    NSLog("[PhotoIndex] indexing \(assets.count) assets (\(processed.count) already done)")

    let t0 = CFAbsoluteTimeGetCurrent()
    var sinceCheckpoint = 0
    var completed = true
    var touched = 0
    for i in 0..<assets.count {
      lock.lock(); let go = shouldRun && !streaming; lock.unlock()
      if !go { completed = false; break }
      let asset = assets.object(at: i)
      lock.lock(); let seen = processed.contains(asset.localIdentifier); lock.unlock()
      if seen { continue }
      autoreleasepool { process(asset) }
      touched += 1
      sinceCheckpoint += 1
      if sinceCheckpoint >= Self.checkpointEvery {
        save()
        sinceCheckpoint = 0
      }
      emitStatus(force: false)
    }
    lock.lock()
    finished = completed
    let counts = (processed.count, entries.count, skipped, upgraded)
    lock.unlock()
    save()
    let dt = CFAbsoluteTimeGetCurrent() - t0
    NSLog("[PhotoIndex] %@ after %d assets in %.1f s (%.0f ms/asset): %d processed, %d faces, %d skipped (not on device), %d upgraded to 2048",
          completed ? "finished" : "paused", touched, dt, touched > 0 ? dt * 1000 / Double(touched) : 0,
          counts.0, counts.1, counts.2, counts.3)
    setState(completed ? .done : .paused)
  }

  // MARK: Per-asset work

  private struct Fetched { let cg: CGImage; let side: Int }

  /// Synchronous PhotoKit request, device-only. nil when the original is only in iCloud.
  private func fetch(_ asset: PHAsset, side: CGFloat) -> Fetched? {
    let o = PHImageRequestOptions()
    o.deliveryMode = .highQualityFormat
    o.resizeMode = .exact
    o.isSynchronous = true
    o.isNetworkAccessAllowed = false
    o.version = .current
    var out: UIImage?
    var inCloud = false
    PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: side, height: side), contentMode: .aspectFit, options: o) { img, info in
      out = img
      if let c = info?[PHImageResultIsInCloudKey] as? Bool, c { inCloud = true }
    }
    guard let img = out, !inCloud, let cg = Self.upright(img) else { return nil }
    return Fetched(cg: cg, side: Int(side))
  }

  /// Redraws a rotated UIImage so pixels and Vision boxes share one top-left coordinate space.
  static func upright(_ img: UIImage) -> CGImage? {
    if img.imageOrientation == .up, let cg = img.cgImage { return cg }
    let fmt = UIGraphicsImageRendererFormat.default()
    fmt.scale = 1
    let size = CGSize(width: img.size.width, height: img.size.height)
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.cgImage
  }

  private func process(_ asset: PHAsset) {
    let id = asset.localIdentifier
    defer {
      lock.lock(); processed.insert(id); lock.unlock()
    }
    guard let small = fetch(asset, side: Self.primarySide) else {
      lock.lock(); skipped += 1; lock.unlock()
      return
    }
    let recognizer = FaceRecognizer.shared
    let boxes: [CGRect]
    do { boxes = try FaceRecognizer.detectFaces(small.cg) } catch {
      NSLog("[PhotoIndex] detect failed for \(id): \(error.localizedDescription)")
      return
    }
    if boxes.isEmpty { return }

    // Tier 2: small faces are re-detected on a 2048 px thumbnail so the 112 px crop is not an upscale.
    var big: Fetched?
    var bigBoxes: [CGRect] = []
    if boxes.contains(where: { $0.width < Self.upgradeBelowWidth }), let b = fetch(asset, side: Self.upgradeSide), b.cg.width > small.cg.width {
      big = b
      bigBoxes = (try? FaceRecognizer.detectFaces(b.cg)) ?? []
      lock.lock(); upgraded += 1; lock.unlock()
    }
    let scale = big.map { CGFloat($0.cg.width) / CGFloat(small.cg.width) } ?? 1

    var newEntries: [Entry] = []
    var newEmb: [Float] = []
    for box in boxes.prefix(8) {
      var src = small
      var useBox = box
      if box.width < Self.upgradeBelowWidth, let big {
        // Match by scaled centre distance (within half the scaled box width).
        let target = CGPoint(x: box.midX * scale, y: box.midY * scale)
        let tol = max(8, box.width * scale * 0.5)
        if let m = bigBoxes.min(by: { hypot($0.midX - target.x, $0.midY - target.y) < hypot($1.midX - target.x, $1.midY - target.y) }),
           hypot(m.midX - target.x, m.midY - target.y) <= tol {
          src = big
          useBox = m
        }
      }
      if min(useBox.width, useBox.height) < recognizer.minFaceSide { continue }
      guard let crop = FaceRecognizer.boxCrop(src.cg, box: useBox, scale: FaceRecognizer.cropScale, dy: FaceRecognizer.cropShiftY) else { continue }
      do {
        let emb = try recognizer.embedAligned(crop)
        guard emb.count == Self.dim else { continue }
        newEntries.append(Entry(assetId: id,
                                box: [Int(useBox.minX.rounded()), Int(useBox.minY.rounded()), Int(useBox.width.rounded()), Int(useBox.height.rounded())],
                                imageSide: src.side, imageWidth: src.cg.width, imageHeight: src.cg.height,
                                creationDate: asset.creationDate?.timeIntervalSince1970))
        newEmb.append(contentsOf: emb)
      } catch {
        NSLog("[PhotoIndex] embed failed for \(id): \(error.localizedDescription)")
      }
    }
    if newEntries.isEmpty { return }
    lock.lock()
    entries.append(contentsOf: newEntries)
    embeddings.append(contentsOf: newEmb)
    lock.unlock()
  }

  // MARK: Search

  /// Brute-force cosine search (one sgemv), threshold, then greedy diversity so a burst of
  /// near-identical shots does not fill the grid. One candidate per asset. Best first, max 12.
  func search(seed: [Float], excludingAsset: String?) -> [(index: Int, entry: Entry, score: Float)] {
    guard seed.count == Self.dim else { return [] }
    lock.lock()
    let n = entries.count
    guard n > 0 else { lock.unlock(); return [] }
    var scores = [Float](repeating: 0, count: n)
    embeddings.withUnsafeBufferPointer { a in
      seed.withUnsafeBufferPointer { x in
        cblas_sgemv(CblasRowMajor, CblasNoTrans, Int32(n), Int32(Self.dim), 1, a.baseAddress, Int32(Self.dim), x.baseAddress, 1, 0, &scores, 1)
      }
    }
    var hits: [(Int, Float)] = []
    for i in 0..<n where scores[i] >= Self.matchThreshold {
      if let ex = excludingAsset, entries[i].assetId == ex { continue }
      hits.append((i, scores[i]))
    }
    hits.sort { $0.1 > $1.1 }
    var kept: [(index: Int, entry: Entry, score: Float)] = []
    var keptAssets = Set<String>()
    for (i, s) in hits {
      if kept.count >= Self.maxCandidates { break }
      let e = entries[i]
      if keptAssets.contains(e.assetId) { continue }
      var diverse = true
      for k in kept {
        var d: Float = 0
        embeddings.withUnsafeBufferPointer { a in
          vDSP_dotpr(a.baseAddress! + i * Self.dim, 1, a.baseAddress! + k.index * Self.dim, 1, &d, vDSP_Length(Self.dim))
        }
        if d >= Self.diversityThreshold { diverse = false; break }
      }
      if !diverse { continue }
      kept.append((i, e, s))
      keptAssets.insert(e.assetId)
    }
    lock.unlock()
    return kept
  }

  /// Embeds the largest face in `seedPhotoUri` and returns candidates with 256 px face thumbnails.
  func searchSeedPhoto(_ seedPhotoUri: String) async throws -> [Candidate] {
    load()
    try FaceRecognizer.shared.load()
    let url = try Self.fileURL(seedPhotoUri)
    let data: Data
    do { data = try Data(contentsOf: url) } catch { throw GlassesError("Could not read the photo: \(error.localizedDescription)") }
    guard let img = UIImage(data: data) else { throw GlassesError("The photo is not an image") }
    guard let face = try FaceRecognizer.shared.detectAndEmbed(img, maxFaces: 1).first else {
      throw GlassesError("No face found in the photo")
    }
    lock.lock(); let exclude = exportedAssets[url.path]; lock.unlock()
    let hits = search(seed: face.embedding, excludingAsset: exclude)
    if hits.isEmpty { return [] }
    return try await onIO { [self] in
      var out: [Candidate] = []
      for h in hits {
        guard let thumb = try? thumbnail(for: h.entry, index: h.index) else { continue }
        out.append(Candidate(id: Self.candidateId(h.index, h.entry), assetId: h.entry.assetId, score: h.score, thumbUri: thumb,
                             takenAt: Self.iso(h.entry.creationDate)))
      }
      return out
    }
  }

  // MARK: Export

  private static func candidateId(_ index: Int, _ e: Entry) -> String { "\(index)|\(e.assetId)" }

  private func entry(for candidateId: String) throws -> (Int, Entry) {
    guard let sep = candidateId.firstIndex(of: "|"), let idx = Int(candidateId[..<sep]) else {
      throw GlassesError("Bad candidate id")
    }
    let assetId = String(candidateId[candidateId.index(after: sep)...])
    lock.lock(); defer { lock.unlock() }
    guard idx >= 0, idx < entries.count, entries[idx].assetId == assetId else {
      throw GlassesError("That photo is no longer in the index")
    }
    return (idx, entries[idx])
  }

  private func asset(_ id: String) throws -> PHAsset {
    guard let a = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
      throw GlassesError("That photo is no longer in your library")
    }
    return a
  }

  /// Writes a 1280 px JPEG of the candidate's asset into tmp; the returned file:// URI goes
  /// straight into `enrollPerson.photoUris`.
  func exportCandidate(_ candidateId: String) async throws -> String {
    load()
    let (_, e) = try entry(for: candidateId)
    return try await onIO { [self] in
      let dir = try Self.ensureTmp()
      let file = dir.appendingPathComponent("photo-\(Self.safeName(e.assetId)).jpg")
      if !FileManager.default.fileExists(atPath: file.path) {
        guard let f = fetch(try asset(e.assetId), side: Self.exportSide) else {
          throw GlassesError("That photo is only in iCloud. Open it in Photos first, then try again.")
        }
        guard let jpeg = UIImage(cgImage: f.cg).jpegData(compressionQuality: 0.85) else { throw GlassesError("JPEG encode failed") }
        try jpeg.write(to: file, options: .atomic)
      }
      lock.lock(); exportedAssets[file.path] = e.assetId; lock.unlock()
      return file.absoluteString
    }
  }

  /// 256 px square crop around the face (1.6x the box), cached in tmp per candidate.
  private func thumbnail(for e: Entry, index: Int) throws -> String {
    let dir = try Self.ensureTmp()
    let file = dir.appendingPathComponent("thumb-\(Self.safeName(e.assetId))-\(index).jpg")
    if FileManager.default.fileExists(atPath: file.path) { return file.absoluteString }
    // A 512 px request is enough for a 256 px thumbnail; rescale the stored box to it.
    guard let f = fetch(try asset(e.assetId), side: 512) else { throw GlassesError("thumbnail source unavailable") }
    let s = CGFloat(f.cg.width) / CGFloat(e.imageWidth)
    let box = CGRect(x: CGFloat(e.box[0]) * s, y: CGFloat(e.box[1]) * s, width: CGFloat(e.box[2]) * s, height: CGFloat(e.box[3]) * s)
    let side = max(box.width, box.height) * 1.6
    let src = CGRect(x: box.midX - side / 2, y: box.midY - side / 2, width: side, height: side)
    let n = Self.thumbSide
    let fmt = UIGraphicsImageRendererFormat.default()
    fmt.scale = 1
    let ui = UIImage(cgImage: f.cg)
    let out = UIGraphicsImageRenderer(size: CGSize(width: n, height: n), format: fmt).image { ctx in
      UIColor.black.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
      let k = CGFloat(n) / side
      ui.draw(in: CGRect(x: -src.minX * k, y: -src.minY * k, width: CGFloat(f.cg.width) * k, height: CGFloat(f.cg.height) * k))
    }
    guard let jpeg = out.jpegData(compressionQuality: 0.8) else { throw GlassesError("thumbnail encode failed") }
    try jpeg.write(to: file, options: .atomic)
    return file.absoluteString
  }

  // MARK: Helpers

  private func onIO<T>(_ body: @escaping () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { cont in
      ioQueue.async {
        do { cont.resume(returning: try body()) } catch { cont.resume(throwing: error) }
      }
    }
  }

  private static func ensureTmp() throws -> URL {
    try FileManager.default.createDirectory(at: tmpDirectory, withIntermediateDirectories: true)
    return tmpDirectory
  }

  private static func safeName(_ s: String) -> String {
    String(s.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : "_" }.prefix(48))
  }

  private static func fileURL(_ uri: String) throws -> URL {
    if let u = URL(string: uri), u.scheme == "file" { return u }
    if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
    throw GlassesError("Unsupported photo URI (need file://): \(uri)")
  }

  private static let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()

  private static func iso(_ t: Double?) -> String {
    guard let t else { return "" }
    return isoFormatter.string(from: Date(timeIntervalSince1970: t))
  }
}
