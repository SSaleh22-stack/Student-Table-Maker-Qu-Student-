import ExpoModulesCore
import UIKit

/**
 Apple Pencil double tap (Apple Pencil 2, Pencil Pro) and squeeze (Pencil Pro, iOS 17.5+) for the
 notebook (PRD NB-52). One UIPencilInteraction sits on the key window while JavaScript has it
 enabled; what a tap or squeeze does is decided in JavaScript from the notebook settings
 (pencilDoubleTap / pencilSqueeze), so the events only report what happened plus the system
 preference from Settings, for reference.

 Threading: UIKit and the controller are used only on the main thread. Functions hop there with
 DispatchQueue.main.async (closures on the main queue are main-actor isolated for Swift).
 */
public final class PencilInteractionModule: Module {
  /// Main thread only.
  private var controller: PencilController?

  public func definition() -> ModuleDefinition {
    Name("PencilInteraction")

    Events("tap", "squeeze")

    AsyncFunction("enable") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(self.attach())
      }
    }

    AsyncFunction("disable") { (promise: Promise) in
      DispatchQueue.main.async {
        self.detach()
        promise.resolve()
      }
    }

    AsyncFunction("isEnabled") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(self.controller?.isAttached ?? false)
      }
    }

    AsyncFunction("prefersPencilOnlyDrawing") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(UIPencilInteraction.prefersPencilOnlyDrawing)
      }
    }

    AsyncFunction("preferredActions") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(PencilController.preferredActions())
      }
    }

    OnDestroy {
      // Capture the controller, not the module, which is going away.
      let controller = self.controller
      DispatchQueue.main.async {
        controller?.detach()
      }
    }
  }

  @MainActor
  private func attach() -> Bool {
    let current = controller ?? PencilController { [weak self] name, body in
      self?.sendEvent(name, body)
    }
    controller = current
    return current.attach()
  }

  @MainActor
  private func detach() {
    controller?.detach()
  }
}

/// Owns the UIPencilInteraction and is its delegate. Main actor (UIKit) only.
@MainActor
final class PencilController: NSObject, UIPencilInteractionDelegate {
  private let emit: (String, [String: Any?]) -> Void
  private var interaction: UIPencilInteraction?
  /// Uptime of the last tap sent, to drop a second callback for the same double tap.
  private var lastTapAt: TimeInterval = 0

  init(emit: @escaping (String, [String: Any?]) -> Void) {
    self.emit = emit
    super.init()
  }

  var isAttached: Bool {
    return interaction?.view != nil
  }

  /**
   Attaches one interaction to the key window. Calling it again is a no-op while the same window is
   key (the double-attach guard); when the key window changed it moves there. Interactions left on
   the window by an earlier instance (a JavaScript reload) are removed first, so there is never more
   than one. Returns false when there is no window yet.
   */
  func attach() -> Bool {
    guard let window = SceneGeometry.keyWindow() else {
      return false
    }
    if let interaction, interaction.view === window {
      interaction.isEnabled = true
      return true
    }
    detach()
    for case let stale as UIPencilInteraction in window.interactions
    where stale.delegate == nil || stale.delegate is PencilController {
      window.removeInteraction(stale)
    }
    // init(delegate:) is iOS 17.5+; the plain initializer plus `delegate` works from iOS 12.1.
    let created = UIPencilInteraction()
    created.delegate = self
    window.addInteraction(created)
    interaction = created
    return true
  }

  func detach() {
    if let interaction {
      interaction.view?.removeInteraction(interaction)
    }
    interaction = nil
  }

  // MARK: - UIPencilInteractionDelegate

  /// iOS 17.5+: double tap, with the hover pose when the tip is near the screen.
  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
    sendTap(timestamp: tap.timestamp, hoverPose: Self.hoverDictionary(tap.hoverPose))
  }

  /// Before iOS 17.5. Also implemented on later versions in case UIKit calls it there; sendTap drops
  /// the duplicate.
  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    sendTap(timestamp: ProcessInfo.processInfo.systemUptime, hoverPose: nil)
  }

  /// iOS 17.5+, Apple Pencil Pro: every phase is sent; JavaScript acts on "ended".
  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
    var body: [String: Any?] = [
      "kind": "squeeze",
      "phase": Self.phaseName(squeeze.phase),
      "preferredAction": Self.actionName(UIPencilInteraction.preferredSqueezeAction),
      "timestamp": squeeze.timestamp,
    ]
    if let hover = Self.hoverDictionary(squeeze.hoverPose) {
      body["hoverPose"] = hover
    }
    emit("squeeze", body)
  }

  private func sendTap(timestamp: TimeInterval, hoverPose: [String: Any]?) {
    let now = ProcessInfo.processInfo.systemUptime
    // Two double taps cannot come 0.2 s apart; two callbacks for one double tap can.
    if now - lastTapAt < 0.2 {
      return
    }
    lastTapAt = now
    var body: [String: Any?] = [
      "kind": "tap",
      "preferredAction": Self.actionName(UIPencilInteraction.preferredTapAction),
      "timestamp": timestamp,
    ]
    if let hoverPose {
      body["hoverPose"] = hoverPose
    }
    emit("tap", body)
  }

  // MARK: - Helpers

  static func preferredActions() -> [String: Any] {
    var squeeze = "ignore"
    if #available(iOS 17.5, *) {
      squeeze = actionName(UIPencilInteraction.preferredSqueezeAction)
    }
    return [
      "tap": actionName(UIPencilInteraction.preferredTapAction),
      "squeeze": squeeze,
    ]
  }

  static func actionName(_ action: UIPencilPreferredAction) -> String {
    switch action {
    case .ignore:
      return "ignore"
    case .switchEraser:
      return "switchEraser"
    case .switchPrevious:
      return "switchPrevious"
    case .showColorPalette:
      return "showColorPalette"
    case .showInkAttributes:
      return "showInkAttributes"
    default:
      break
    }
    if #available(iOS 17.5, *) {
      if action == .showContextualPalette {
        return "showContextualPalette"
      }
      if action == .runSystemShortcut {
        return "runSystemShortcut"
      }
    }
    return "unknown"
  }

  @available(iOS 17.5, *)
  static func phaseName(_ phase: UIPencilInteraction.Phase) -> String {
    switch phase {
    case .began:
      return "began"
    case .changed:
      return "changed"
    case .ended:
      return "ended"
    case .cancelled:
      return "cancelled"
    @unknown default:
      return "unknown"
    }
  }

  /// Location is in window points (the interaction's view is the key window).
  @available(iOS 17.5, *)
  static func hoverDictionary(_ pose: UIPencilHoverPose?) -> [String: Any]? {
    guard let pose else {
      return nil
    }
    return [
      "x": Double(pose.location.x),
      "y": Double(pose.location.y),
      "zOffset": Double(pose.zOffset),
      "altitudeAngle": Double(pose.altitudeAngle),
      "azimuthAngle": Double(pose.azimuthAngle),
      "rollAngle": Double(pose.rollAngle),
    ]
  }
}
