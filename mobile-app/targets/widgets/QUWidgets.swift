import SwiftUI
import WidgetKit

@main
struct QUWidgets: WidgetBundle {
  var body: some Widget {
    TimetableWidget()
    TasksWidget()
    CountdownWidget()
  }
}
