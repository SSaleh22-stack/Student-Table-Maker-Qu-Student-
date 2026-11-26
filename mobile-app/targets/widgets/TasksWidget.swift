import AppIntents
import SwiftUI
import UserNotifications
import WidgetKit

/// A tap on a task's circle in the مهامي widget. The tick is kept for the app, which applies it the
/// next time it opens (src/components/WidgetSync.tsx); a finished task's reminder is cancelled now.
struct ToggleTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Tick a task"

  @Parameter(title: "Task") var taskId: String
  @Parameter(title: "Done") var done: Bool
  @Parameter(title: "Date") var date: String

  init() {}

  init(taskId: String, done: Bool, date: String) {
    self.taskId = taskId
    self.done = done
    self.date = date
  }

  func perform() async throws -> some IntentResult {
    Store.addPending(id: taskId, done: done, date: date.isEmpty ? nil : date)
    if done {
      // Reminders are scheduled by expo-notifications as "task-<id>" (lib/reminders.ts).
      UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["task-\(taskId)", "task-\(taskId)-snooze"])
    }
    return .result()
  }
}

/// مهامي: today's tasks, ticked off from the widget.
struct TasksWidget: Widget {
  let kind = "QUTasks"

  var body: some WidgetConfiguration {
    let x = Txt(ar: Store.ar)
    return StaticConfiguration(kind: kind, provider: QProvider(perMinute: false)) { entry in
      TasksView(entry: entry)
    }
    .configurationDisplayName(x.myTasks)
    .description(x.ar ? "مهام اليوم. اضغط الدائرة لإنجاز المهمة." : "Today's tasks. Tap a circle to tick one off.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
  }
}

struct TasksView: View {
  let entry: QEntry
  @Environment(\.widgetFamily) var family
  @Environment(\.colorScheme) var scheme
  @Environment(\.widgetRenderingMode) var mode

  var body: some View {
    let ar = entry.snap?.ar ?? true
    let c = Ctx(snap: entry.snap, now: entry.date, x: Txt(ar: ar), p: Pal(scheme, mode))
    let day = entry.snap?.taskDay(entry.date) ?? TaskDay(today: [], upcoming: [], doneCount: 0, total: 0)
    content(c, day)
      .qDirection(ar)
      .containerBackground(for: .widget) { c.p.background }
      .widgetURL(appURL("tasks"))
  }

  @ViewBuilder
  func content(_ c: Ctx, _ day: TaskDay) -> some View {
    switch family {
    case .accessoryInline:
      Label(day.open.isEmpty ? c.x.allDone : c.x.remainingTasks(day.open.count), systemImage: "checkmark.circle")
    case .accessoryCircular:
      Gauge(value: Double(day.doneCount), in: 0...Double(max(1, day.total))) {
        Image(systemName: "checkmark")
      } currentValueLabel: {
        Text("\(day.open.count)")
      }
      .gaugeStyle(.accessoryCircular)
    case .accessoryRectangular:
      TasksRect(c: c, day: day)
    case .systemSmall:
      VStack(alignment: .leading, spacing: 8) {
        TasksHeader(c: c, day: day, wide: false, link: false)
        if day.open.isEmpty {
          TasksEmpty(c: c, day: day, big: false)
        } else {
          ForEach(day.open.prefix(3), id: \.id) { t in TaskRow(c: c, t: t, small: true) }
          Spacer(minLength: 0)
        }
      }
    case .systemMedium:
      VStack(alignment: .leading, spacing: 10) {
        TasksHeader(c: c, day: day, wide: true, link: true)
        ProgressBar(value: day.total == 0 ? 0 : Double(day.doneCount) / Double(day.total), p: c.p)
        if day.open.isEmpty {
          TasksEmpty(c: c, day: day, big: false)
        } else {
          let list = Array(day.today.prefix(4))
          HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) { ForEach(list.prefix(2), id: \.id) { t in TaskRow(c: c, t: t, small: false) } }
              .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 10) { ForEach(list.dropFirst(2), id: \.id) { t in TaskRow(c: c, t: t, small: false) } }
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          Spacer(minLength: 0)
        }
      }
    case .systemExtraLarge:
      VStack(alignment: .leading, spacing: 12) {
        TasksHeader(c: c, day: day, wide: true, link: true)
        ProgressBar(value: day.total == 0 ? 0 : Double(day.doneCount) / Double(day.total), p: c.p)
        HStack(alignment: .top, spacing: 18) {
          TaskSection(c: c, title: c.x.today, list: Array(day.today.prefix(5)), empty: day.open.isEmpty ? (day.doneCount > 0 ? c.x.allDone : c.x.nothingToday) : nil)
          Rectangle().fill(c.p.divider).frame(width: 1)
          TaskSection(c: c, title: c.x.upcoming, list: Array(day.upcoming.prefix(5)), empty: nil)
        }
        Spacer(minLength: 0)
      }
    default:
      VStack(alignment: .leading, spacing: 8) {
        TasksHeader(c: c, day: day, wide: true, link: true)
        ProgressBar(value: day.total == 0 ? 0 : Double(day.doneCount) / Double(day.total), p: c.p)
        if day.open.isEmpty {
          TasksEmpty(c: c, day: day, big: true)
        } else {
          TaskSection(c: c, title: c.x.today, list: Array(day.today.prefix(4)), empty: nil)
        }
        if !day.upcoming.isEmpty {
          Rectangle().fill(c.p.divider).frame(height: 1)
          TaskSection(c: c, title: c.x.upcoming, list: Array(day.upcoming.prefix(2)), empty: nil)
          if day.upcoming.count > 2 {
            Text(c.x.more(day.upcoming.count - 2)).font(.system(size: 11, weight: .medium)).foregroundStyle(c.p.faint)
          }
        }
        Spacer(minLength: 0)
      }
    }
  }
}

struct TasksHeader: View {
  let c: Ctx
  let day: TaskDay
  let wide: Bool
  /// Small widgets open the app with one tap anywhere, so the + is only a picture there.
  let link: Bool
  var body: some View {
    HStack(spacing: 6) {
      Text(c.x.myTasks).font(.system(size: wide ? 14 : 13, weight: .bold)).foregroundStyle(wide ? c.p.text : c.p.accent).widgetAccentable()
      if wide { Text(c.x.today).font(.system(size: 12)).foregroundStyle(c.p.muted) }
      Spacer(minLength: 4)
      if wide && day.total > 0 {
        Text(c.x.doneOf(day.doneCount, day.total)).font(.system(size: 11)).foregroundStyle(c.p.faint).lineLimit(1)
      }
      if link {
        Link(destination: appURL("task")) { AddButton(p: c.p) }
      } else {
        AddButton(p: c.p)
      }
    }
  }
}

struct AddButton: View {
  let p: Pal
  var body: some View {
    Circle().fill(p.accent).frame(width: 24, height: 24)
      .overlay(Image(systemName: "plus").font(.system(size: 13, weight: .bold)).foregroundStyle(p.onAccent))
      .widgetAccentable()
  }
}

struct CheckCircle: View {
  let done: Bool
  let p: Pal
  var body: some View {
    ZStack {
      if done {
        Circle().fill(p.accent)
        Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(p.onAccent)
      } else {
        Circle().strokeBorder(p.faint, lineWidth: 1.6)
      }
    }
    .frame(width: 18, height: 18)
    .widgetAccentable()
  }
}

struct TaskRow: View {
  let c: Ctx
  let t: STask
  let small: Bool
  var body: some View {
    let when = c.x.taskWhen(t, c.now)
    HStack(spacing: 8) {
      Button(intent: ToggleTaskIntent(taskId: t.id, done: !t.done, date: t.date ?? "")) {
        CheckCircle(done: t.done, p: c.p)
      }
      .buttonStyle(.plain)
      VStack(alignment: .leading, spacing: 1) {
        Text(t.title)
          .font(.system(size: small ? 12 : 13, weight: .medium))
          .foregroundStyle(t.done ? c.p.faint : c.p.text)
          .strikethrough(t.done)
          .lineLimit(1)
        if t.code != nil || !when.isEmpty {
          HStack(spacing: 4) {
            if let code = t.code {
              Circle().fill(c.p.bar(t.bar)).frame(width: 6, height: 6)
              Text(code).font(.system(size: 10, weight: .semibold)).foregroundStyle(c.p.muted)
            }
            if t.code != nil && !when.isEmpty { Text("·").font(.system(size: 10)).foregroundStyle(c.p.faint) }
            if !when.isEmpty {
              Text(when).font(.system(size: 10)).foregroundStyle(t.isOverdue(c.now) ? c.p.now : c.p.faint)
            }
          }
          .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct TaskSection: View {
  let c: Ctx
  let title: String
  let list: [STask]
  let empty: String?
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.system(size: 11, weight: .bold)).foregroundStyle(c.p.accent).widgetAccentable()
      if let e = empty {
        Text(e).font(.system(size: 13, weight: .semibold)).foregroundStyle(c.p.muted)
      }
      ForEach(list, id: \.id) { t in TaskRow(c: c, t: t, small: false) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct TasksEmpty: View {
  let c: Ctx
  let day: TaskDay
  let big: Bool
  var body: some View {
    MessageView(
      icon: "checkmark.circle",
      title: day.doneCount > 0 ? c.x.allDone : c.x.nothingToday,
      sub: day.upcoming.isEmpty ? nil : c.x.upcomingCount(day.upcoming.count),
      big: big,
      p: c.p
    )
  }
}

struct TasksRect: View {
  let c: Ctx
  let day: TaskDay
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Label(c.x.myTasks + " · " + c.x.remainingTasks(day.open.count), systemImage: "checkmark.circle")
        .font(.system(size: 11, weight: .semibold)).opacity(0.8).lineLimit(1)
      if day.open.isEmpty {
        Text(day.doneCount > 0 ? c.x.allDone : c.x.nothingToday).font(.system(size: 13, weight: .semibold)).lineLimit(2)
      }
      ForEach(day.open.prefix(3), id: \.id) { t in
        HStack(spacing: 6) {
          Circle().strokeBorder(lineWidth: 1.3).frame(width: 10, height: 10)
          Text(t.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
