import AVFoundation
import Foundation
import MWDATCamera
import MWDATCore
import MWDATInputs
import MWDATMockDevice
import UIKit

/// Owns everything DAT: registration, device session, camera stream, in-band audio, photo capture.
/// State lives on the main actor; SDK listener callbacks hop here.
@MainActor
final class GlassesController {
  static let shared = GlassesController()

  /// Set by GlassesModule; used to emit JS events.
  weak var module: GlassesModule?

  let speaker = Speaker()
  let audio = AudioCapture()

  private(set) var registration: RegistrationState = .unavailable
  private var sessionState: DeviceSessionState?
  private var connecting = false
  /// Every path that changes this (stopStream, stream state, session .stopped on disconnect) keeps
  /// the library indexer in sync: it yields the CPU to recognition while a stream runs.
  private(set) var streaming = false {
    didSet { if streaming != oldValue { PhotoIndex.shared.setStreaming(streaming) } }
  }
  private(set) var mock = false
  private var audioRoute = "other"

  private var mockGlasses: (any MockGlasses)?
  private var session: DeviceSession?
  private var camera: Camera?
  private var audioEnabledInStream = false
  private var registrationToken: (any AnyListenerToken)?
  private let sessionTokens = ListenerTokenBag()
  private let streamTokens = ListenerTokenBag()
  /// Inputs capability (beta): the glasses' capture button answers "who is here?" on demand.
  private var inputs: Inputs?
  private let inputTokens = ListenerTokenBag()
  private var inputEventsTask: Task<Void, Never>?

  private let frameQueue = DispatchQueue(label: "recall.frames.decode", qos: .userInitiated)
  private let frameLock = NSLock()
  private nonisolated(unsafe) var decoding = false

  private var photoContinuation: CheckedContinuation<Data, Error>?
  private var photoSeq = 0
  private var didSetup = false

  private init() {}

  // MARK: Setup

  func setup() {
    guard !didSetup else { return }
    didSetup = true
    GlassesSDK.configureOnce()
    if let err = GlassesSDK.configureError { emitError(err) }

    registration = Wearables.shared.registrationState
    registrationToken = Wearables.shared.addRegistrationStateListener { [weak self] state in
      Task { @MainActor in
        guard let self else { return }
        self.registration = state
        NSLog("[Glasses] registration: \(state.description)")
        self.emitStatus()
      }
    }

    speaker.onRoute = { [weak self] route, port in
      Task { @MainActor in
        guard let self else { return }
        let changed = self.audioRoute != route
        self.audioRoute = route
        self.emit("onAudioRoute", ["route": route, "portName": port])
        if changed { self.emitStatus() }
      }
    }
    speaker.onSpoken = { [weak self] text, route in
      Task { @MainActor in self?.emit("onSpoken", ["text": text, "route": route]) }
    }
    speaker.onError = { [weak self] msg in
      Task { @MainActor in self?.emitError(msg) }
    }
    speaker.configureSession()

    audio.setRecording = { [weak self] on in
      // Must be synchronous: the engine reads the input format right after this.
      guard let self else { return }
      if Thread.isMainThread {
        MainActor.assumeIsolated { self.speaker.recordingActive = on }
      } else {
        DispatchQueue.main.sync { MainActor.assumeIsolated { self.speaker.recordingActive = on } }
      }
    }
    audio.log = { msg in NSLog("[Glasses] \(msg)") }
    audio.onAmbientChunk = { wav in
      Task.detached {
        do {
          let req = try BackendClient.shared.request("/api/utterances", method: "POST", contentType: "audio/wav", body: wav, timeout: 30)
          let obj = try await BackendClient.shared.sendJSON(req)
          if let text = obj["text"] as? String, !text.isEmpty { NSLog("[Glasses] utterance: \(text)") }
        } catch {
          NSLog("[Glasses] ambient upload failed: \(error.localizedDescription)")
        }
      }
    }

    // Faces are recognized on the phone (Core ML); the frame never leaves the device.
    // The first load on a device compiles the 83 MB model for the Neural Engine (seconds), so it runs
    // off the main thread; startStream awaits it before frames flow.
    Task { [weak self] in
      do { try await FaceRecognizer.shared.loadAsync() } catch { self?.emitError(error.localizedDescription) }
    }
    let local = LocalRecognition.shared
    local.onResult = { [weak self] obj, w, h in
      Task { @MainActor in self?.handleFrameResult(obj, width: w, height: h) }
    }
    local.onSpeak = { [weak self] speechId, text in
      Task { @MainActor in
        NSLog("[Glasses] speak: \(text)")
        self?.speaker.enqueue(speechId: speechId, text: text)
      }
    }
    local.onError = { [weak self] msg in
      Task { @MainActor in self?.emitError(msg) }
    }
    local.onRosterSpeech = { [weak self] speechIds in
      Task { @MainActor in self?.speaker.prefetch(speechIds) }
    }
  }

  // MARK: Roster

  /// Re-embeds the roster from the server's enrollment photos. Call after enrolling or editing people.
  func syncRoster() async throws -> [String: Any] {
    let r = try await LocalRecognition.shared.syncRoster()
    emitStatus()
    return ["people": r.people, "samples": r.samples]
  }

  private func syncRosterInBackground() {
    Task { @MainActor [weak self] in
      do { _ = try await self?.syncRoster() } catch { self?.emitError("Roster sync failed: \(error.localizedDescription)") }
    }
  }

  // MARK: Events

  func emit(_ name: String, _ body: [String: Any?]) {
    module?.sendEvent(name, body)
  }

  func emitError(_ message: String) {
    NSLog("[Glasses] error: \(message)")
    emit("onError", ["message": message])
  }

  func status() -> [String: Any] {
    let reg: String
    switch registration {
    case .registered: reg = "registered"
    case .registering: reg = "registering"
    default: reg = "unregistered"
    }
    let conn: String
    switch sessionState {
    case .started?, .paused?: conn = "connected"
    case .starting?: conn = "connecting"
    default: conn = connecting ? "connecting" : "disconnected"
    }
    let roster = LocalRecognition.shared.rosterCounts
    return [
      "registration": reg,
      "connection": conn,
      "streaming": streaming,
      "audioRoute": audioRoute,
      "mock": mock,
      "rosterPeople": roster.people,
      "rosterSamples": roster.samples,
    ]
  }

  func emitStatus() {
    emit("onStatus", status())
  }

  // MARK: Registration

  func register() async throws {
    setup()
    // Registering means real glasses: leave MockDeviceKit first, or its fake "registered"
    // state makes this return without ever opening Meta AI.
    if mock {
      await stopStream()
      await tearDownSession()
      try setMock(false)
    }
    NSLog("[Glasses] register: state=\(registration)")
    if registration == .registered { return }
    do {
      try await Wearables.shared.startRegistration()
    } catch {
      if case .alreadyRegistered = error { return }
      throw GlassesError("Registration failed: \(error.description)")
    }
  }

  // MARK: Stream

  func startStream(mock wantMock: Bool) async throws {
    setup()
    if streaming && wantMock == mock { return }
    if wantMock != mock || streaming {
      await stopStream()
      await tearDownSession()
    }
    if !BackendClient.shared.isConfigured {
      emitError("Backend not configured; preview only (call configure first)")
    }

    connecting = true
    emitStatus()
    defer { connecting = false; emitStatus() }

    try setMock(wantMock)

    if !wantMock && registration != .registered {
      throw GlassesError("Glasses app not registered with Meta AI. Call register() first.")
    }

    // Camera permission (opens Meta AI if needed).
    let cam = try await ensurePermission(.camera)
    guard cam else { throw GlassesError("Camera permission denied in Meta AI app") }
    // Microphone permission for in-band audio is optional; fall back to the phone mic.
    var mic = false
    do { mic = try await ensurePermission(.microphone) } catch {
      NSLog("[Glasses] microphone permission unavailable: \(error); using phone mic fallback")
    }

    let session = try await ensureSession()
    attachInputs(to: session)

    var config = StreamConfiguration(
      videoCodec: .raw,
      audioCodec: mic ? .pcm(sampleRate: .rate16000, numberOfChannels: 1) : nil,
      resolution: .medium,
      frameRate: 7
    )
    var cameraCap: Camera?
    do {
      cameraCap = try session.addCamera(config: config)
    } catch {
      if mic {
        NSLog("[Glasses] addCamera with audio failed (\(error)); retrying video only")
        mic = false
        config = StreamConfiguration(videoCodec: .raw, resolution: .medium, frameRate: 7)
        cameraCap = try session.addCamera(config: config)
      } else {
        throw GlassesError("addCamera failed: \(error.description)")
      }
    }
    guard let camera = cameraCap else { throw GlassesError("addCamera returned nil (session not started)") }
    self.camera = camera
    audioEnabledInStream = mic
    attachStreamListeners(camera.stream, audio: mic)

    // Frames are only matched once the model is in memory (no "model not loaded" drops on first launch).
    try await FaceRecognizer.shared.loadAsync()
    // The first sync of a launch re-embeds every roster photo; finish it before frames flow so an
    // enrolled face is never matched against an empty roster ("someone new is here"). Later syncs
    // reuse the per-file cache and stay in the background. A failed sync does not block the stream.
    if LocalRecognition.shared.lastSyncAt == nil {
      do { _ = try await syncRoster() } catch { emitError("Roster sync failed: \(error.localizedDescription)") }
    } else {
      syncRosterInBackground()
    }
    LocalRecognition.shared.setActive(true)
    audio.setAmbient(true)
    camera.stream.start()

    // `streaming` flipping true also pauses the library indexer (see its didSet).
    try await waitUntil(timeout: 20, "camera stream to start") { [weak self] in self?.streaming == true }

    // If the glasses don't deliver audio within a few seconds, use the phone mic for ambient.
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 4_000_000_000)
      guard let self, self.streaming else { return }
      self.audio.ensureAmbientSource()
    }
  }

  func stopStream() async {
    LocalRecognition.shared.setActive(false)
    audio.stopAll()
    await streamTokens.cancelAll()
    camera?.stop()
    camera = nil
    if streaming { streaming = false }
    failPhoto(GlassesError("Stream stopped"))
    FrameHub.shared.publish(nil)
    emitStatus()
  }

  private func setMock(_ on: Bool) throws {
    if on {
      if !MockDeviceKit.shared.isEnabled { MockDeviceKit.shared.enable() }
      if mockGlasses == nil {
        do {
          let g = try MockDeviceKit.shared.pairGlasses(model: .rayBanMeta)
          g.powerOn()
          g.unfold()
          g.don()
          g.services.camera.setCameraFeed(cameraFacing: .back)
          mockGlasses = g
        } catch {
          throw GlassesError("MockDeviceKit pairGlasses failed: \(error.description)")
        }
      }
      mock = true
      registration = Wearables.shared.registrationState
    } else {
      if MockDeviceKit.shared.isEnabled {
        if let g = mockGlasses { MockDeviceKit.shared.unpairDevice(g) }
        MockDeviceKit.shared.disable()
      }
      mockGlasses = nil
      mock = false
      registration = Wearables.shared.registrationState
    }
    emitStatus()
  }

  private func ensurePermission(_ p: Permission) async throws -> Bool {
    let status = try await Wearables.shared.checkPermissionStatus(p)
    if status == .granted { return true }
    return try await Wearables.shared.requestPermission(p) == .granted
  }

  private func ensureSession() async throws -> DeviceSession {
    if let s = session, s.state == .started { return s }
    if let s = session, s.state == .starting || s.state == .paused {
      try await waitUntil(timeout: 20, "glasses session to start") { s.state == .started }
      return s
    }
    await tearDownSession()

    let selector = AutoDeviceSelector(wearables: Wearables.shared)
    if selector.activeDevice == nil {
      try await waitUntil(timeout: 15, "glasses to be available (powered on, unfolded, connected in Meta AI)") {
        selector.activeDevice != nil
      }
    }
    let s: DeviceSession
    do {
      s = try Wearables.shared.createSession(deviceSelector: selector)
    } catch {
      throw GlassesError("createSession failed: \(error.description)")
    }
    s.statePublisher.listen { [weak self] state in
      Task { @MainActor in self?.sessionStateChanged(state) }
    }.store(in: sessionTokens)
    s.errorPublisher.listen { [weak self] error in
      Task { @MainActor in
        guard let self else { return }
        if case .datAppOnTheGlassesUpdateRequired = error {
          self.emitError("Glasses app update required; opening Meta AI")
          try? await Wearables.shared.openDATGlassesAppUpdate()
        } else {
          self.emitError("Glasses session error: \(error.description)")
        }
      }
    }.store(in: sessionTokens)
    session = s
    do {
      try s.start()
    } catch {
      session = nil
      throw GlassesError("Session start failed: \(error.description)")
    }
    try await waitUntil(timeout: 20, "glasses session to start") { s.state == .started }
    sessionState = .started
    return s
  }

  private func tearDownSession() async {
    await detachInputs(remove: true)
    await sessionTokens.cancelAll()
    session?.stop()
    session = nil
    sessionState = nil
  }

  private func sessionStateChanged(_ state: DeviceSessionState) {
    NSLog("[Glasses] session: \(state.description)")
    sessionState = state
    if state == .stopped {
      // Hinges closed / BT dropped: the session is terminal. Next startStream creates a new one.
      camera = nil
      streaming = false
      LocalRecognition.shared.setActive(false)
      audio.stopAll()
      streamTokens.clear()
      sessionTokens.clear()
      inputTokens.clear()
      inputEventsTask?.cancel()
      inputEventsTask = nil
      inputs = nil
      session = nil
      failPhoto(GlassesError("Glasses disconnected"))
    }
    emitStatus()
  }

  // MARK: Inputs (glasses button)

  /// Subscribes to the capture button (top right of the right temple) and the action button. A
  /// press asks "who is here?" and the glasses answer at once, debounce or not. Inputs is a beta
  /// capability (dev/beta release channels) and MockDeviceKit may not offer it, so a failure here is
  /// logged and the stream carries on without the button.
  private func attachInputs(to session: DeviceSession) {
    guard inputs == nil else { return }
    let cap: Inputs?
    do {
      cap = try session.addInputs(configuration: InputsConfiguration(sources: [.captureButton, .actionButton], consumeBack: false))
    } catch {
      NSLog("[Glasses] inputs unavailable (button disabled): \(error.description)")
      return
    }
    guard let cap else {
      NSLog("[Glasses] inputs: session not started yet; button disabled")
      return
    }
    inputs = cap
    cap.statePublisher.listen { state in
      NSLog("[Glasses] inputs: \(state.description)")
    }.store(in: inputTokens)
    cap.errorPublisher.listen { [weak self] error in
      Task { @MainActor in
        guard let self else { return }
        NSLog("[Glasses] inputs error: \(error.description)")
        // Every error ends delivery and leaves the capability attached; drop it so a later stream re-adds it.
        await self.detachInputs(remove: true)
      }
    }.store(in: inputTokens)
    let events = cap.events
    inputEventsTask = Task { [weak self] in
      for await event in events {
        guard let self else { return }
        await self.handleInput(event)
      }
    }
  }

  private func detachInputs(remove: Bool) async {
    inputEventsTask?.cancel()
    inputEventsTask = nil
    await inputTokens.cancelAll()
    if inputs != nil, remove, let s = session, s.state == .started {
      do { try s.removeInputs() } catch { NSLog("[Glasses] removeInputs failed: \(error.description)") }
    }
    inputs = nil
  }

  private func handleInput(_ event: InputEvent) {
    switch event {
    case let .capture(press, _, _):
      NSLog("[Glasses] capture button: \(press)")
      // One event per press, fired on release. A hold or double press is the system's video gesture.
      guard press == .shortPress else { return }
      emit("onButton", ["button": "capture"])
      Task { _ = await whoIsHere(trigger: "glasses") }
    case .button:
      NSLog("[Glasses] action button")
      emit("onButton", ["button": "action"])
      Task { _ = await whoIsHere(trigger: "glasses") }
    case .nav, .select, .back, .drag:
      break
    @unknown default:
      break
    }
  }

  /// Names everyone in view right now (ignoring the per-person cooldown) or says nobody is there.
  /// `trigger` is "glasses" for a button press or "phone" for the on-screen control; it is logged.
  /// Returns the words spoken, or nil when a request was already in flight or nothing is streaming.
  func whoIsHere(trigger: String) async -> String? {
    guard streaming else {
      NSLog("[Glasses] who is here (\(trigger)): no stream")
      speaker.enqueue(speechId: nil, text: LocalRecognition.nobodyLine)
      return LocalRecognition.nobodyLine
    }
    return await LocalRecognition.shared.whoIsHere(trigger: trigger)
  }

  private func attachStreamListeners(_ stream: MWDATCamera.Stream, audio withAudio: Bool) {
    stream.statePublisher.listen { [weak self] state in
      Task { @MainActor in
        guard let self else { return }
        NSLog("[Glasses] stream: \(state)")
        let now = (state == .streaming)
        if now != self.streaming {
          self.streaming = now
          self.emitStatus()
        }
        if state == .stopped { LocalRecognition.shared.setActive(false) } else if now { LocalRecognition.shared.setActive(true) }
      }
    }.store(in: streamTokens)

    stream.errorPublisher.listen { [weak self] error in
      Task { @MainActor in
        guard let self else { return }
        self.emitError("Stream error: \(error.description)")
        if case .photoCaptureFailed = error { self.failPhoto(GlassesError("Photo capture failed")) }
      }
    }.store(in: streamTokens)

    stream.videoFramePublisher.listen { [weak self] frame in
      self?.handleVideoFrame(frame)
    }.store(in: streamTokens)

    stream.photoDataPublisher.listen { [weak self] photo in
      Task { @MainActor in self?.deliverPhoto(photo.data) }
    }.store(in: streamTokens)

    if withAudio {
      let audio = self.audio
      stream.audioFramePublisher.listen { frame in
        audio.appendInband(frame.pcmBuffer)
      }.store(in: streamTokens)
    }
  }

  /// Called on the SDK's thread. Decodes off-main, dropping frames while a decode is running.
  private nonisolated func handleVideoFrame(_ frame: VideoFrame) {
    frameLock.lock()
    if decoding { frameLock.unlock(); return }
    decoding = true
    frameLock.unlock()
    frameQueue.async { [weak self] in
      guard let self else { return }
      defer { self.frameLock.lock(); self.decoding = false; self.frameLock.unlock() }
      guard let image = frame.makeUIImage() else { return }
      FrameHub.shared.publish(image)
      // Matched on the phone; the frame never leaves the device.
      LocalRecognition.shared.offer(image)
    }
  }

  /// Boxes and the line for the UI. The line itself is spoken once /api/recognitions returns the
  /// canonical text (or the local fallback), via LocalRecognition.onSpeak.
  private func handleFrameResult(_ obj: [String: Any], width: Int, height: Int) {
    var body: [String: Any?] = [
      "faces": obj["faces"] as? [[String: Any]] ?? [],
      "frameWidth": width,
      "frameHeight": height,
    ]
    if let speak = obj["speak"] as? [String: Any], let text = speak["text"] as? String, !text.isEmpty {
      body["speak"] = ["speechId": speak["speechId"] as? String ?? "", "text": text]
    }
    emit("onFrameResult", body)
  }

  // MARK: Photo

  func captureGlassesPhoto() async throws -> String {
    if !streaming {
      try await startStream(mock: mock)
    }
    guard let stream = camera?.stream else { throw GlassesError("Camera not available") }
    failPhoto(GlassesError("Superseded by a new capture"))
    photoSeq += 1
    let seq = photoSeq
    let data: Data = try await withCheckedThrowingContinuation { cont in
      self.photoContinuation = cont
      if !stream.capturePhoto(format: .jpeg) {
        self.failPhoto(GlassesError("Capture not started (another capture in flight?)"))
        return
      }
      Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: 15_000_000_000)
        guard let self, self.photoSeq == seq else { return }
        self.failPhoto(GlassesError("Photo capture timed out"))
      }
    }
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let url = dir.appendingPathComponent("glasses-\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
    var jpeg = data
    if let img = UIImage(data: data), let j = img.jpegData(compressionQuality: 0.9) { jpeg = j } // normalizes HEIC
    try jpeg.write(to: url)
    return url.absoluteString
  }

  private func deliverPhoto(_ data: Data) {
    guard let c = photoContinuation else { return }
    photoContinuation = nil
    c.resume(returning: data)
  }

  private func failPhoto(_ error: Error) {
    guard let c = photoContinuation else { return }
    photoContinuation = nil
    c.resume(throwing: error)
  }

  // MARK: Ask

  func startAsk() throws {
    setup()
    try audio.startAsk()
    NSLog("[Glasses] ask: recording via \(audio.source)")
  }

  func stopAsk() async throws -> [String: Any] {
    let wav = audio.stopAsk()
    guard wav.count > 44 + 16000 / 2 else { throw GlassesError("No audio captured") } // < ~0.25 s
    let req = try BackendClient.shared.request("/api/ask", method: "POST", contentType: "audio/wav", body: wav, timeout: 45)
    let obj = try await BackendClient.shared.sendJSON(req)
    let question = obj["question"] as? String ?? ""
    let answer = obj["answer"] as? String ?? ""
    let speechId = obj["speechId"] as? String
    if !answer.isEmpty {
      NSLog("[Glasses] ask Q: \(question) A: \(answer)")
      speaker.enqueue(speechId: speechId, text: answer)
    }
    return ["question": question, "answer": answer]
  }

  // MARK: Listen (Remember visits)

  /// Starts mic capture for a memory the wearer is about to share. Same capture path as ask.
  func startListening() throws {
    setup()
    try audio.startAsk()
    NSLog("[Glasses] listen: recording via \(audio.source)")
  }

  /// Stops capture and returns the transcript from /api/transcribe. Nothing is logged server-side
  /// until the wearer chooses to keep the memory.
  func stopListening() async throws -> [String: Any] {
    let wav = audio.stopAsk()
    guard wav.count > 44 + 16000 / 2 else { throw GlassesError("No audio captured") } // < ~0.25 s
    let req = try BackendClient.shared.request("/api/transcribe", method: "POST", contentType: "audio/wav", body: wav, timeout: 45)
    let obj = try await BackendClient.shared.sendJSON(req)
    let text = obj["text"] as? String ?? ""
    NSLog("[Glasses] listen heard: \(text)")
    return ["text": text]
  }

  // MARK: Utilities

  private func waitUntil(timeout: TimeInterval, _ what: String, _ cond: @escaping () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !cond() {
      if Date() > deadline { throw GlassesError("Timed out waiting for \(what)") }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
  }
}

extension MainActor {
  /// Runs `body` on the main actor: inline when already on main, otherwise async.
  static func assumeIsolatedOrHop(_ body: @escaping @MainActor () -> Void) {
    if Thread.isMainThread {
      MainActor.assumeIsolated { body() }
    } else {
      DispatchQueue.main.async { MainActor.assumeIsolated { body() } }
    }
  }
}
