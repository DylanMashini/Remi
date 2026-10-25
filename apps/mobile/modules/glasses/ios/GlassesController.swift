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
    didSet {
      if streaming != oldValue {
        PhotoIndex.shared.setStreaming(streaming)
        updateWakeActive()
        // Raw DAT frames only arrive while foregrounded; auto-lock would silently end recognition
        // while the status still said "streaming". Keep the screen awake for the life of a stream.
        setKeepAwake(streaming)
      }
    }
  }

  /// `isIdleTimerDisabled` must be touched on the main thread; this class is @MainActor.
  private func setKeepAwake(_ on: Bool) {
    if UIApplication.shared.isIdleTimerDisabled != on {
      UIApplication.shared.isIdleTimerDisabled = on
      NSLog("[Glasses] keep awake: \(on)")
    }
  }
  private(set) var mock = false
  private var audioRoute = "other"

  private var mockGlasses: (any MockGlasses)?
  private var session: DeviceSession?
  private var camera: Camera?
  /// The camera `stopStream` just stopped. `Camera.stop()` is async (.stopping -> .stopped) and the
  /// SDK has no removeCamera, so `addCamera` on the same session throws capabilityAlreadyActive until
  /// it has reached .stopped; `startStream` waits for it first.
  private var stoppingCamera: Camera?
  /// The start sequence in flight, shared by concurrent callers (Live screen + captureGlassesPhoto).
  private var startTask: Task<Void, Error>?
  private var startSeq = 0
  private var audioEnabledInStream = false
  private var registrationToken: (any AnyListenerToken)?
  /// Bluetooth link of the glasses as Meta AI reports it, independent of any DAT session. A session
  /// only exists while a stream runs, so without this the screen says "not connected" whenever the
  /// glasses are paired and idle.
  private var linkState: LinkState = .disconnected
  private var devicesToken: (any AnyListenerToken)?
  private var linkTokens: [any AnyListenerToken] = []
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
    watchDevices(Wearables.shared.devices)
    devicesToken = Wearables.shared.addDevicesListener { [weak self] devices in
      Task { @MainActor in self?.watchDevices(devices) }
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
    speaker.onSpoken = { [weak self] text, route, pan in
      Task { @MainActor in self?.emit("onSpoken", ["text": text, "route": route, "pan": pan]) }
    }
    speaker.onError = { [weak self] msg in
      Task { @MainActor in self?.emitError(msg) }
    }
    speaker.onSpeakingChanged = { [weak self] on in
      Task { @MainActor in
        guard let self else { return }
        self.speakerSpeaking = on
        self.wake?.setMuted(on)
        // A live conversation must not hear Remi's own line (recognition, reminder, answer) as the
        // wearer's turn: hold the chat mic while Speaker talks, release it when the queue is idle.
        if on { self.chat?.holdMic() } else { self.chat?.releaseMic() }
      }
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
    local.onSpeak = { [weak self] speechId, text, pan in
      Task { @MainActor in
        NSLog("[Glasses] speak (\(Speaker.panLabel(pan))): \(text)")
        self?.speaker.enqueue(speechId: speechId, text: text, pan: pan)
      }
    }
    local.onError = { [weak self] msg in
      Task { @MainActor in self?.emitError(msg) }
    }
    local.onRosterSpeech = { [weak self] speechIds in
      Task { @MainActor in self?.speaker.prefetch(speechIds) }
    }
  }

  // MARK: Devices

  /// Re-subscribes to the link state of every paired device (real or mock). The best link across
  /// devices is what `status()` reports when there is no session.
  private func watchDevices(_ ids: [DeviceIdentifier]) {
    let old = linkTokens
    linkTokens = []
    Task { for t in old { await t.cancel() } }
    var devices: [Device] = []
    for id in ids {
      guard let d = Wearables.shared.deviceForIdentifier(id) else { continue }
      devices.append(d)
      linkTokens.append(d.addLinkStateListener { [weak self] _ in
        Task { @MainActor in self?.refreshLinkState() }
      })
    }
    NSLog("[Glasses] devices: \(devices.map { "\($0.nameOrId()) \($0.linkState)" })")
    refreshLinkState()
  }

  private func refreshLinkState() {
    var best: LinkState = .disconnected
    for id in Wearables.shared.devices {
      guard let d = Wearables.shared.deviceForIdentifier(id) else { continue }
      switch d.linkState {
      case .connected: best = .connected
      case .connecting: if best != .connected { best = .connecting }
      case .disconnected: break
      }
    }
    guard best != linkState else { return }
    NSLog("[Glasses] link: \(linkState) -> \(best)")
    linkState = best
    emitStatus()
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
    // A session exists only while streaming; between streams the Bluetooth link is the truth.
    let conn: String
    switch sessionState {
    case .started?, .paused?: conn = "connected"
    case .starting?: conn = "connecting"
    default:
      if connecting { conn = "connecting" } else {
        switch linkState {
        case .connected: conn = "connected"
        case .connecting: conn = "connecting"
        case .disconnected: conn = "disconnected"
        }
      }
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
      "wakeWord": wakeEnabled,
    ]
  }

  func emitStatus() {
    emit("onStatus", status())
  }

  /// Glasses paired before launch never post a route-change notification, so without this the
  /// status says "other" (shown as phone speaker) until the first spoken line. Speaker.checkRoute()
  /// also fires onRoute (-> onAudioRoute) via a main-actor Task; the route is assigned here
  /// synchronously so the emitStatus that follows in the caller already carries it.
  private func refreshAudioRoute() {
    audioRoute = speaker.checkRoute()
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
    // Two callers at once (the Live screen and captureGlassesPhoto) share one start sequence
    // instead of both calling addCamera on the same session.
    if let inFlight = startTask {
      try await inFlight.value
      if streaming && wantMock == mock { return }
    }
    if streaming && wantMock == mock { return }
    startSeq += 1
    let seq = startSeq
    let task = Task { @MainActor [self] in try await self.runStartStream(mock: wantMock) }
    startTask = task
    defer { if startSeq == seq { startTask = nil } }
    try await task.value
  }

  private func runStartStream(mock wantMock: Bool) async throws {
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

    // Stop -> Start on the same session: the previous camera must finish stopping first.
    await waitForCameraStopped()
    var session = try await ensureSession()
    let camera: Camera
    do {
      camera = try addCamera(to: session, mic: &mic)
    } catch {
      // Still capabilityAlreadyActive (or anything else): a fresh session always accepts a camera.
      NSLog("[Glasses] \(error.localizedDescription); recreating the session and retrying once")
      await tearDownSession()
      stoppingCamera = nil
      session = try await ensureSession()
      camera = try addCamera(to: session, mic: &mic)
    }
    attachInputs(to: session)
    self.camera = camera
    audioEnabledInStream = mic
    attachStreamListeners(camera.stream, audio: mic)
    refreshAudioRoute()

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
    // The stream is up: read the route again so the deferred emitStatus reports where Remi will speak.
    refreshAudioRoute()

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
    if let c = camera {
      c.stop()
      stoppingCamera = c
    }
    camera = nil
    if streaming { streaming = false }
    setKeepAwake(false)
    failPhoto(GlassesError("Stream stopped"))
    FrameHub.shared.publish(nil)
    emitStatus()
  }

  /// Adds the camera to `session`, dropping in-band audio (video only) if that is what fails.
  /// `mic` is cleared when the fallback was used. Throws when the session refuses a camera.
  private func addCamera(to session: DeviceSession, mic: inout Bool) throws -> Camera {
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
      // A previous camera the SDK is still tearing down is not fixed by dropping audio.
      if mic, error != .capabilityAlreadyActive {
        NSLog("[Glasses] addCamera with audio failed (\(error)); retrying video only")
        mic = false
        config = StreamConfiguration(videoCodec: .raw, resolution: .medium, frameRate: 7)
        do {
          cameraCap = try session.addCamera(config: config)
        } catch {
          throw GlassesError("addCamera failed: \(error.description)")
        }
      } else {
        throw GlassesError("addCamera failed: \(error.description)")
      }
    }
    guard let camera = cameraCap else { throw GlassesError("addCamera returned nil (session not started)") }
    return camera
  }

  /// Waits (at most 5 s) for the camera `stopStream` stopped to reach .stopped. The SDK keeps the
  /// capability active until then and a second addCamera throws capabilityAlreadyActive.
  private func waitForCameraStopped() async {
    guard let old = stoppingCamera else { return }
    if old.state != .stopped {
      NSLog("[Glasses] waiting for the previous camera to stop (\(old.state))")
      do {
        try await waitUntil(timeout: 5, "previous camera to stop") { old.state == .stopped }
      } catch {
        NSLog("[Glasses] previous camera still \(old.state) after 5 s; adding a new one anyway")
      }
    }
    if stoppingCamera === old { stoppingCamera = nil }
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
    // A fresh session accepts a camera regardless of the old one; do not wait on an orphaned camera.
    stoppingCamera = nil
  }

  private func sessionStateChanged(_ state: DeviceSessionState) {
    NSLog("[Glasses] session: \(state.description)")
    sessionState = state
    if state == .stopped {
      // Hinges closed / BT dropped: the session is terminal. Next startStream creates a new one.
      camera = nil
      stoppingCamera = nil
      streaming = false
      setKeepAwake(false)
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
      body["speak"] = ["speechId": speak["speechId"] as? String ?? "", "text": text, "pan": speak["pan"] as? Float ?? 0]
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

  /// The frame on screen when the wearer tapped Ask: what they were looking at as the question
  /// started. Replaced by a newer frame at stopAsk when one exists.
  private var askFrame: UIImage?
  /// A frame older than this is not sent (the stream may have stopped since).
  private static let askFrameMaxAge: TimeInterval = 5
  /// Long edge of the JPEG sent with a question. 768 px is plenty for the model to read a scene.
  private static let askFrameMaxSide: CGFloat = 768

  func startAsk() throws {
    setup()
    try audio.startAsk()
    askFrame = FrameHub.shared.fresh(maxAge: Self.askFrameMaxAge)
    NSLog("[Glasses] ask: recording via \(audio.source); frame at start: \(askFrame != nil)")
  }

  /// Uploads the question audio plus the latest glasses frame (if one is fresh) as multipart to
  /// /api/ask. The frame is used for this one answer and discarded by the server; it is never stored.
  func stopAsk() async throws -> [String: Any] {
    let wav = audio.stopAsk()
    let frame = FrameHub.shared.fresh(maxAge: Self.askFrameMaxAge) ?? askFrame
    askFrame = nil
    guard wav.count > 44 + 16000 / 2 else { throw GlassesError("No audio captured") } // < ~0.25 s
    var form = Multipart()
    form.addFile("audio", filename: "ask.wav", mime: "audio/wav", data: wav)
    let jpeg = frame.flatMap { Self.askJpeg($0) }
    if let jpeg { form.addFile("frame", filename: "frame.jpg", mime: "image/jpeg", data: jpeg) }
    let body = form.finish()
    NSLog("[Glasses] ask: uploading \(wav.count) B audio, frame \(jpeg?.count ?? 0) B")
    let req = try BackendClient.shared.request("/api/ask", method: "POST", contentType: form.contentType, body: body, timeout: 45)
    let obj = try await BackendClient.shared.sendJSON(req)
    let question = obj["question"] as? String ?? ""
    let answer = obj["answer"] as? String ?? ""
    let speechId = obj["speechId"] as? String
    if !answer.isEmpty {
      NSLog("[Glasses] ask Q: \(question) A: \(answer)")
      speaker.enqueue(speechId: speechId, text: answer)
    }
    return ["question": question, "answer": answer, "sawFrame": jpeg != nil]
  }

  /// Downscales a frame to `askFrameMaxSide` on its long edge and encodes a JPEG.
  private static func askJpeg(_ image: UIImage) -> Data? {
    let w = image.size.width, h = image.size.height
    guard w > 0, h > 0 else { return nil }
    let scale = min(1, askFrameMaxSide / max(w, h))
    guard scale < 1 else { return image.jpegData(compressionQuality: 0.75) }
    let size = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    return small.jpegData(compressionQuality: 0.75)
  }

  // MARK: Live conversation

  /// The running conversation, if any. One at a time.
  private var chat: RealtimeChat?
  /// Mirrors Speaker.onSpeakingChanged, so a chat started mid-line begins with its mic held.
  private var speakerSpeaking = false
  /// End a conversation after this long with nobody speaking.
  private static let chatIdleSeconds: TimeInterval = 90

  var chatActive: Bool { chat != nil }

  /// Starts a live conversation: asks the server for a client secret, opens the WebSocket to OpenAI
  /// from the phone, and streams the mic (glasses in-band audio, or the phone's) until `stopChat`,
  /// a long silence, or a connection failure. Returns the session details for the screen.
  /// `trigger` is "phone" (the Ask Remi button) or "wake" ("Hey Remi" heard: the pre-roll audio is
  /// handed to the conversation and the greeting is skipped).
  func startChat(trigger: String = "phone") async throws -> [String: Any] {
    setup()
    if let old = chat {
      old.stop(reason: "restarted")
      chatEnded(old)
    }
    guard !audio.isAsking else { throw GlassesError("A question is being recorded; finish it first") }

    // Ambient audio uploads in 10 s chunks, so the last few seconds of the conversation the wearer
    // is about to ask about would otherwise sit untranscribed until after the chat. Send the partial
    // chunk now and wait (briefly) for the server to log it before the chat's context is built.
    if let tail = audio.flushAmbient() {
      let started = Date()
      do {
        let req = try BackendClient.shared.request("/api/utterances", method: "POST", contentType: "audio/wav", body: tail, timeout: 4)
        let obj = try await BackendClient.shared.sendJSON(req)
        let text = obj["text"] as? String ?? ""
        NSLog("[Glasses] chat: flushed \(tail.count / 32000) s of ambient audio in \(Int(Date().timeIntervalSince(started) * 1000)) ms: \(text)")
      } catch {
        NSLog("[Glasses] chat: ambient flush failed, starting anyway: \(error.localizedDescription)")
      }
    }

    let obj = try await chatSession()
    guard let urlStr = obj["url"] as? String, let url = URL(string: urlStr),
          let secret = obj["clientSecret"] as? String, !secret.isEmpty else {
      throw GlassesError("The conversation token was incomplete")
    }
    let sessionId = obj["sessionId"] as? String ?? UUID().uuidString
    let model = obj["model"] as? String ?? ""
    let cfg = RealtimeChat.Config(
      url: url,
      clientSecret: secret,
      model: model,
      sessionId: sessionId,
      bargeIn: obj["bargeIn"] as? Bool ?? false,
      greeting: obj["greeting"] as? String ?? "",
      farewell: obj["farewell"] as? String ?? "",
      idleSeconds: Self.chatIdleSeconds
    )
    let c = RealtimeChat(config: cfg)
    c.frameProvider = { [weak self] in
      guard let self, self.streaming, let frame = FrameHub.shared.fresh(maxAge: Self.askFrameMaxAge) else { return nil }
      return Self.askJpeg(frame)
    }
    c.onState = { [weak self, weak c] state, reason in
      guard let self else { return }
      self.emit("onChat", ["kind": "state", "state": state.rawValue, "reason": reason, "sessionId": sessionId])
      if state == .ended, let c { self.chatEnded(c) }
    }
    c.onTranscript = { [weak self] role, text, final in
      self?.emit("onChat", ["kind": "transcript", "role": role, "text": text, "final": final, "sessionId": sessionId])
    }
    c.onTurn = { [weak self] question, answer, frame in
      guard let self else { return }
      let route = self.speaker.checkRoute()
      self.emit("onChat", ["kind": "turn", "question": question, "answer": answer, "frame": frame, "route": route, "sessionId": sessionId])
      Self.logChatTurn(sessionId: sessionId, model: model, question: question, answer: answer, frame: frame)
    }
    c.onError = { [weak self] msg in self?.emitError(msg) }

    // Output goes wherever the speaker's session points (A2DP on the glasses); input is the same
    // path tap-to-ask uses, converted to 24 kHz for the API.
    speaker.configureSession()
    audio.onChatAudio = { [weak c] pcm in
      Task { @MainActor in c?.feed(pcm24k: pcm) }
    }
    let preroll = try audio.startChat()
    if trigger == "wake" { c.preroll = preroll }
    chat = c
    if speakerSpeaking { c.holdMic() }
    updateWakeActive()
    do {
      try c.start()
    } catch {
      chatEnded(c)
      throw error
    }
    NSLog("[Glasses] chat \(sessionId) (\(trigger)): mic via \(audio.source), route \(speaker.route)")
    var td: [String: Any] = [:]
    if let t = obj["turnDetection"] as? [String: Any] { td = t }
    let result: [String: Any] = [
      "sessionId": sessionId,
      "model": model,
      "voice": obj["voice"] as? String ?? "",
      "bargeIn": cfg.bargeIn,
      "turnDetection": td["type"] as? String ?? "",
      "silenceMs": td["silence_duration_ms"] as? Int ?? 0,
      "micSource": audio.source,
      "trigger": trigger,
    ]
    // JS did not call startChat, so it learns about this session from an event.
    if trigger != "phone" { emit("onChat", result.merging(["kind": "started"]) { _, new in new }) }
    return result
  }

  // MARK: Chat session (client secret)

  /// The secret lives 10 min; a prefetched one older than this is thrown away.
  private static let chatSecretFresh: TimeInterval = 8 * 60
  private var prefetchedChat: (obj: [String: Any], at: Date)?
  private var prefetchTask: Task<Void, Never>?

  private func chatSession() async throws -> [String: Any] {
    if let p = prefetchedChat {
      prefetchedChat = nil
      if Date().timeIntervalSince(p.at) < Self.chatSecretFresh { return p.obj }
      NSLog("[Glasses] prefetched chat secret stale; fetching a fresh one")
    }
    return try await Self.fetchChatSession()
  }

  private nonisolated static func fetchChatSession() async throws -> [String: Any] {
    let req = try BackendClient.shared.request("/api/realtime/session", method: "POST", contentType: "application/json", body: Data("{}".utf8), timeout: 20)
    return try await BackendClient.shared.sendJSON(req)
  }

  /// With "Hey Remi" on, keep a client secret ready so the conversation opens as soon as the phrase
  /// is heard (the fetch is ~0.5 to 1 s). Renewed before it goes stale and after each use.
  private func prefetchChatSession() {
    guard wakeEnabled, prefetchedChat == nil, chat == nil, prefetchTask == nil else { return }
    prefetchTask = Task { @MainActor [weak self] in
      defer { self?.prefetchTask = nil }
      do {
        let obj = try await Self.fetchChatSession()
        guard let self, self.wakeEnabled else { return }
        self.prefetchedChat = (obj, Date())
        // Renew just before the secret expires.
        Task { @MainActor [weak self] in
          try? await Task.sleep(nanoseconds: UInt64(Self.chatSecretFresh * 1_000_000_000))
          guard let self, let p = self.prefetchedChat, Date().timeIntervalSince(p.at) >= Self.chatSecretFresh else { return }
          self.prefetchedChat = nil
          self.prefetchChatSession()
        }
      } catch {
        NSLog("[Glasses] chat secret prefetch failed: \(error.localizedDescription)")
      }
    }
  }

  // MARK: Wake word ("Hey Remi")

  private var wake: WakeWord?
  private(set) var wakeEnabled = false
  private var wakeStarting = false
  private var lastChatEndedAt: Date?
  /// After a conversation ends, ignore the phrase for this long: Remi's farewell is still in the air.
  private static let wakeCooldown: TimeInterval = 5

  /// Turns "Hey Remi" on or off. Off by default; the Ask Remi button and the glasses button stay the
  /// primary way to ask. Loading the model (~5 MB int8) happens once, off the main thread.
  func setWakeWord(_ on: Bool) async throws -> [String: Any] {
    setup()
    if on {
      if wake == nil {
        let w = try await Task.detached { try WakeWord() }.value
        w.log = { msg in NSLog("[Glasses] \(msg)") }
        w.onDetected = { [weak self] keyword in
          Task { @MainActor in self?.wakeHeard(keyword) }
        }
        wake = w
      }
      guard let w = wake else { throw GlassesError("Wake word unavailable") }
      wakeEnabled = true
      audio.onWakeAudio = { [weak w] pcm in w?.feed(pcm16: pcm) }
      audio.setWake(true)
      updateWakeActive()
      prefetchChatSession()
      NSLog("[Glasses] wake word on (threshold \(WakeWord.threshold)); listening while streaming")
    } else {
      wakeEnabled = false
      audio.setWake(false)
      audio.onWakeAudio = nil
      wake?.setActive(false)
      prefetchedChat = nil
      NSLog("[Glasses] wake word off")
    }
    emitStatus()
    return ["enabled": wakeEnabled, "phrase": "Hey Remi"]
  }

  /// The detector only scores audio while a stream runs and nothing else owns the mic.
  private func updateWakeActive() {
    wake?.setActive(wakeEnabled && streaming && chat == nil)
  }

  private func wakeHeard(_ keyword: String) {
    guard wakeEnabled, streaming, chat == nil, !wakeStarting, !audio.isAsking else { return }
    if let t = lastChatEndedAt, Date().timeIntervalSince(t) < Self.wakeCooldown {
      NSLog("[Glasses] wake word ignored (cooldown after the last conversation)")
      return
    }
    wakeStarting = true
    NSLog("[Glasses] Hey Remi heard via \(audio.source); starting a conversation")
    emit("onWake", ["keyword": keyword, "source": audio.source])
    Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.wakeStarting = false }
      do {
        _ = try await self.startChat(trigger: "wake")
      } catch {
        self.emitError("Heard \"Hey Remi\", but the conversation could not start: \(error.localizedDescription)")
      }
    }
  }

  /// Ends the conversation (user tapped End). Safe when none is running.
  func stopChat() -> [String: Any] {
    guard let c = chat else { return ["ended": true, "turns": 0] }
    let turns = c.turnsLogged
    c.stop(reason: "stopped")   // onState(.ended) → chatEnded
    chatEnded(c)
    return ["ended": true, "turns": turns]
  }

  private func chatEnded(_ c: RealtimeChat) {
    guard chat === c else { return }
    chat = nil
    audio.onChatAudio = nil
    audio.stopChat()
    lastChatEndedAt = Date()
    updateWakeActive()
    prefetchChatSession()
  }

  /// Posts one finished turn to the memory log (QUESTION / ANSWER / SPOKEN). Fire and forget.
  private nonisolated static func logChatTurn(sessionId: String, model: String, question: String, answer: String, frame: Bool) {
    Task.detached {
      do {
        let body = try JSONSerialization.data(withJSONObject: [
          "sessionId": sessionId, "model": model, "question": question, "answer": answer, "frame": frame,
        ] as [String: Any])
        let req = try BackendClient.shared.request("/api/realtime/turns", method: "POST", contentType: "application/json", body: body, timeout: 20)
        let obj = try await BackendClient.shared.sendJSON(req)
        if obj["repeat"] as? Bool == true { NSLog("[Glasses] chat turn was a repeat question") }
      } catch {
        NSLog("[Glasses] chat turn log failed: \(error.localizedDescription)")
      }
    }
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
