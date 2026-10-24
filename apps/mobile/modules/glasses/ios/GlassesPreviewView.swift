import ExpoModulesCore
import UIKit

/// Holds the latest glasses frame and pushes it to every mounted GlassesPreview (main thread only).
final class FrameHub {
  static let shared = FrameHub()
  private let views = NSHashTable<GlassesPreviewView>.weakObjects()
  private(set) var latest: UIImage?

  func register(_ v: GlassesPreviewView) {
    views.add(v)
    v.show(latest)
  }

  func publish(_ image: UIImage?) {
    DispatchQueue.main.async {
      self.latest = image
      for v in self.views.allObjects { v.show(image) }
    }
  }
}

/// <GlassesPreview />: renders the latest glasses frame, aspect fit.
final class GlassesPreviewView: ExpoView {
  private let imageView = UIImageView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    imageView.contentMode = .scaleAspectFit
    imageView.frame = bounds
    imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(imageView)
    FrameHub.shared.register(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    imageView.frame = bounds
  }

  func show(_ image: UIImage?) {
    imageView.image = image
  }
}
