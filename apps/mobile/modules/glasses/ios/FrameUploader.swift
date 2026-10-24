import Foundation
import UIKit

/// Encodes glasses frames to JPEG and POSTs them to /api/frames.
/// At most 2 fps and at most one request in flight; extra frames are dropped.
final class FrameUploader {
  private let queue = DispatchQueue(label: "recall.frames.encode", qos: .userInitiated)
  private let lock = NSLock()
  private var inFlight = false
  private var lastSentAt = Date.distantPast
  private let minInterval: TimeInterval = 0.5
  var enabled = false

  /// (resultBody, frameWidth, frameHeight)
  var onResult: (([String: Any], Int, Int) -> Void)?
  var onError: ((String) -> Void)?
  private var lastErrorAt = Date.distantPast

  /// Returns true if this frame was accepted for upload.
  @discardableResult
  func offer(_ image: UIImage) -> Bool {
    lock.lock()
    let now = Date()
    guard enabled, !inFlight, now.timeIntervalSince(lastSentAt) >= minInterval else { lock.unlock(); return false }
    inFlight = true
    lastSentAt = now
    lock.unlock()

    queue.async {
      guard let jpeg = image.jpegData(compressionQuality: 0.6) else { self.done(); return }
      let w = Int(image.size.width * image.scale), h = Int(image.size.height * image.scale)
      Task {
        defer { self.done() }
        do {
          let req = try BackendClient.shared.request("/api/frames", method: "POST", contentType: "image/jpeg", body: jpeg, timeout: 10)
          let obj = try await BackendClient.shared.sendJSON(req)
          self.onResult?(obj, w, h)
        } catch {
          // Throttle error spam to one every 5 s.
          if Date().timeIntervalSince(self.lastErrorAt) > 5 {
            self.lastErrorAt = Date()
            self.onError?("Frame upload failed: \(error.localizedDescription)")
          }
        }
      }
    }
    return true
  }

  private func done() {
    lock.lock(); inFlight = false; lock.unlock()
  }
}
