import ExpoModulesCore
import UIKit

/**
 Shows the system share sheet for a piece of text, or for several files at once.

 React Native's `Share.share` only anchors the sheet on an iPad. iPhone Duo's inner display is a
 regular-width iPhone, where UIKit presents the sheet as a popover and needs an anchor, so this
 module anchors it on every regular-width display, the same way expo-sharing does.

 `shareFilesAsync` takes file URLs ("file:///…", percent-encoded as expo-file-system writes them)
 or plain paths, and shares them together in one sheet (expo-sharing shares one file at a time).
 */
public final class TextShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TextShare")

    AsyncFunction("shareAsync") { (message: String, promise: Promise) in
      guard let viewController = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_TEXT_SHARE_NO_VIEW", "There is no screen to show the share sheet on")
        return
      }

      let activityController = UIActivityViewController(activityItems: [message], applicationActivities: nil)
      // Called once when the sheet closes, whether something was shared or not.
      activityController.completionWithItemsHandler = { _, completed, _, _ in
        promise.resolve(completed)
      }

      // Anchor whatever the size class (compact ignores it): a sheet opened folded, or in half of a
      // split, turns into a popover if the window becomes regular width while it is still open
      // (unfolding, widening the split), and a popover without an anchor crashes. No rect: the
      // bottom middle of the view's bounds.
      SceneGeometry.anchorPopover(of: activityController, to: viewController.view)
      if viewController.traitCollection.horizontalSizeClass == .regular {
        activityController.modalPresentationStyle = .pageSheet
      }

      viewController.present(activityController, animated: true)
    }
    .runOnQueue(.main)

    AsyncFunction("shareFilesAsync") { (paths: [String], promise: Promise) in
      guard let viewController = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_TEXT_SHARE_NO_VIEW", "There is no screen to show the share sheet on")
        return
      }
      let urls: [URL] = paths.compactMap { path in
        if path.hasPrefix("file://") {
          if let url = URL(string: path), url.isFileURL {
            return url
          }
          return URL(fileURLWithPath: String(path.dropFirst("file://".count)))
        }
        return URL(fileURLWithPath: path)
      }
      guard !urls.isEmpty, urls.allSatisfy({ FileManager.default.fileExists(atPath: $0.path) }) else {
        promise.reject("ERR_TEXT_SHARE_NO_FILE", "A file to share does not exist")
        return
      }

      let activityController = UIActivityViewController(activityItems: urls, applicationActivities: nil)
      activityController.completionWithItemsHandler = { _, completed, _, _ in
        promise.resolve(completed)
      }
      SceneGeometry.anchorPopover(of: activityController, to: viewController.view)
      if viewController.traitCollection.horizontalSizeClass == .regular {
        activityController.modalPresentationStyle = .pageSheet
      }
      viewController.present(activityController, animated: true)
    }
    .runOnQueue(.main)
  }
}
