import ExpoModulesCore
import MWDATCore
import UIKit

enum GlassesSDK {
  private static let lock = NSLock()
  private static var configured = false
  private(set) static var configureError: String?

  /// Wearables.configure() must run exactly once, as early as possible.
  static func configureOnce() {
    lock.lock(); defer { lock.unlock() }
    guard !configured else { return }
    configured = true
    do {
      try Wearables.configure()
      NSLog("[Glasses] Wearables SDK configured")
    } catch {
      configureError = "Wearables.configure failed: \(error)"
      NSLog("[Glasses] \(configureError!)")
    }
  }
}

/// Configures the DAT SDK at launch and forwards the Meta AI registration callback
/// (memoryaid://...?metaWearablesAction=...) to Wearables.shared.handleUrl.
/// ExpoAppSceneDelegate re-feeds scene openURLContexts to app delegate subscribers.
public class GlassesAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    GlassesSDK.configureOnce()
    return true
  }

  public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    guard
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.queryItems?.contains(where: { $0.name == "metaWearablesAction" }) == true
    else {
      return false
    }
    GlassesSDK.configureOnce()
    NSLog("[Glasses] Meta AI callback: \(url.absoluteString)")
    Task {
      do {
        _ = try await Wearables.shared.handleUrl(url)
      } catch {
        NSLog("[Glasses] handleUrl failed: \(error)")
        GlassesController.shared.emitError("Meta AI callback failed: \(error)")
      }
    }
    return true
  }
}
