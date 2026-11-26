import ExpoModulesCore
import WidgetKit

/// Writes the widget snapshot into the App Group the widget extension reads (targets/widgets),
/// and hands back the tasks ticked on a widget. Keys must match targets/widgets/Store.swift.
private let appGroup = "group.net.qustudent.app"
private let snapshotKey = "snapshot"
private let pendingKey = "pendingToggles"

public class QuWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QuWidgets")

    Function("setSnapshot") { (json: String) in
      guard let defaults = UserDefaults(suiteName: appGroup) else { return }
      defaults.set(json, forKey: snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("takePendingToggles") { () -> String in
      guard let defaults = UserDefaults(suiteName: appGroup) else { return "[]" }
      let json = defaults.string(forKey: pendingKey) ?? "[]"
      defaults.removeObject(forKey: pendingKey)
      return json
    }
  }
}
