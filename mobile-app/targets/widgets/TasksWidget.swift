import AppIntents
import SwiftUI
import UserNotifications
import WidgetKit

/// A tap on a task's circle in the مهامي widget. The tick is kept for the app, which applies it the
/// next time it opens (src/components/WidgetSync.tsx); a finished task's reminder is cancelled now,
/// unless it repeats (its daily or weekly reminder stays; the app reschedules it when it opens).
struct ToggleTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Tick a task"
  /// Only for the widget's buttons: kept out of Shortcuts and Spotlight.
  static var isDiscoverable: Bool { false }

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
    // Looked up before the tick is queued (Store.load lays queued ticks over the snapshot).
    let task = Store.load()?.tasks?.first(where: { $0.id == taskId })
    if done {
      // Reminders are scheduled by expo-notifications as "task-<id>" (lib/reminders.ts).
      var ids = ["task-\(taskId)-snooze"]
      let repeats = task.map { $0.repeats && $0.date != nil } ?? false
      if !repeats { ids.append("task-\(taskId)") }
      UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }
    Store.addPending(id: taskId, done: done, date: date.isEmpty ? nil : date)
    return .result()
  }
}

/// مهامي: every open task (overdue, today, no date, then the nearest dates), ticked off from the
/// widget. Small and medium: one list; large and the iPad: titled groups.
struct TasksWidget: Widget {
  let kind = "QUTasks"

  var body: some WidgetConfiguration {
    let x = Txt(ar: Store.ar)
    return StaticConfiguration(kind: kind, provider: QProvider(perMinute: false)) { entry in
      TasksView(entry: entry)
    }
    .configurationDisplayName(x.myTasks)
    .description(x.ar ? "كل مهامك، المتأخرة ومهام اليوم أولًا. اضغط الدائرة لإنجاز المهمة." : "All your tasks, overdue and today's first. Tap a circle to tick one off.")
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
    let list = entry.snap?.taskList(entry.date) ?? TaskList(sections: [])
    content(c, list)
      .qDirection(ar)
      .containerBackground(for: .widget) { c.p.background }
      .widgetURL(appURL("tasks"))
  }

  @ViewBuilder
  func content(_ c: Ctx, _ list: TaskList) -> some View {
    let all = list.all
    switch family {
    case .accessoryInline:
      Label(all.isEmpty ? c.x.noTasks : c.x.remainingTasks(all.count), systemImage: "checkmark.circle")
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Image(systemName: "checkmark.circle").font(.system(size: qs(12)))
          Text("\(all.count)").font(.system(size: qs(20), weight: .bold))
        }
      }
    case .accessoryRectangular:
      TasksRect(c: c, all: all)
    case .systemSmall:
      VStack(alignment: .leading, spacing: 6) {
        TasksHeader(c: c, wide: false, link: false)
        if all.isEmpty {
          TasksEmpty(c: c, big: false)
        } else {
          // Three rows where they fit at the widget text size, else two.
          ViewThatFits(in: .vertical) {
            VStack(alignment: .leading, spacing: 4) { ForEach(all.prefix(3), id: \.id) { t in TaskRow(c: c, t: t, small: true) } }
            VStack(alignment: .leading, spacing: 4) { ForEach(all.prefix(2), id: \.id) { t in TaskRow(c: c, t: t, small: true) } }
          }
        }
      }
      .frame(maxHeight: .infinity, alignment: .top)
    case .systemMedium:
      VStack(alignment: .leading, spacing: 10) {
        TasksHeader(c: c, wide: true, link: true)
        if all.isEmpty {
          TasksEmpty(c: c, big: false)
        } else {
          let shown = Array(all.prefix(4))
          HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) { ForEach(shown.prefix(2), id: \.id) { t in TaskRow(c: c, t: t, small: false) } }
              .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 10) { ForEach(shown.dropFirst(2), id: \.id) { t in TaskRow(c: c, t: t, small: false) } }
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          Spacer(minLength: 0)
        }
      }
    case .systemExtraLarge:
      VStack(alignment: .leading, spacing: 12) {
        TasksHeader(c: c, wide: true, link: true)
        if all.isEmpty {
          TasksEmpty(c: c, big: true)
        } else {
          // iPad: the groups flow into a second column when the first is full.
          GeometryReader { g in
            let first = fitGroups(list.sections, space: g.size.height, keepMore: false)
            let second = fitGroups(first.rest, space: g.size.height, keepMore: true)
            HStack(alignment: .top, spacing: 18) {
              TaskGroupsView(c: c, sections: first.sections, hidden: 0)
              Rectangle().fill(c.p.divider).frame(width: 1)
              TaskGroupsView(c: c, sections: second.sections, hidden: all.count - first.shown - second.shown)
            }
          }
        }
      }
    default:
      VStack(alignment: .leading, spacing: 10) {
        TasksHeader(c: c, wide: true, link: true)
        if all.isEmpty {
          TasksEmpty(c: c, big: true)
        } else {
          GeometryReader { g in
            let fit = fitGroups(list.sections, space: g.size.height, keepMore: true)
            TaskGroupsView(c: c, sections: fit.sections, hidden: all.count - fit.shown)
          }
        }
      }
    }
  }
}

/// Heights (points) used to fit the titled groups into the space the widget has (text scaled).
private let rowH: CGFloat = 31 * textScale
private let rowGap: CGFloat = 9
private let titleH: CGFloat = 20 * textScale
private let groupGap: CGFloat = 12
private let moreH: CGFloat = 18 * textScale

struct FittedGroups {
  let sections: [TaskSection]
  /// What did not fit, to continue in another column.
  let rest: [TaskSection]
  let shown: Int
}

/// As many groups and tasks as fit in `space`, in order; a group cut short continues in `rest`.
func fitGroups(_ sections: [TaskSection], space: CGFloat, keepMore: Bool) -> FittedGroups {
  let room = space - (keepMore ? moreH : 0)
  var used: CGFloat = 0
  var fitted: [TaskSection] = []
  var rest: [TaskSection] = []
  var shown = 0
  for sec in sections {
    if !rest.isEmpty {
      rest.append(sec)
      continue
    }
    let head = (fitted.isEmpty ? 0 : groupGap) + titleH
    if used + head + rowH > room {
      rest.append(sec)
      continue
    }
    used += head
    var rows: [STask] = []
    for t in sec.tasks {
      let add = (rows.isEmpty ? 0 : rowGap) + rowH
      if used + add > room { break }
      rows.append(t)
      used += add
    }
    fitted.append(TaskSection(group: sec.group, tasks: rows))
    shown += rows.count
    if rows.count < sec.tasks.count {
      rest.append(TaskSection(group: sec.group, tasks: Array(sec.tasks.dropFirst(rows.count))))
    }
  }
  return FittedGroups(sections: fitted, rest: rest, shown: shown)
}

/// Each group under its title (متأخرة · اليوم · بدون تاريخ · القادمة), then "+N أخرى".
struct TaskGroupsView: View {
  let c: Ctx
  let sections: [TaskSection]
  let hidden: Int
  var body: some View {
    VStack(alignment: .leading, spacing: groupGap) {
      ForEach(sections) { sec in
        VStack(alignment: .leading, spacing: 6) {
          Text(c.x.group(sec.group))
            .font(.system(size: qs(11), weight: .bold))
            .foregroundStyle(sec.group == .overdue ? c.p.now : c.p.accent)
            .widgetAccentable()
          VStack(alignment: .leading, spacing: rowGap) {
            // Under the متأخرة title a row shows when it was due, not "متأخرة" again.
            ForEach(sec.tasks, id: \.id) { t in TaskRow(c: c, t: t, small: false, labelOverdue: sec.group != .overdue) }
          }
        }
      }
      if hidden > 0 {
        Text(c.x.more(hidden)).font(.system(size: qs(11), weight: .medium)).foregroundStyle(c.p.faint)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct TasksHeader: View {
  let c: Ctx
  let wide: Bool
  /// Small widgets open the app with one tap anywhere, so the + is only a picture there.
  let link: Bool
  var body: some View {
    HStack(spacing: 6) {
      Text(c.x.myTasks).font(.system(size: qs(wide ? 14 : 13), weight: .bold)).foregroundStyle(wide ? c.p.text : c.p.accent).widgetAccentable()
      Spacer(minLength: 4)
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
    Circle().fill(p.accentFill).frame(width: 24, height: 24).widgetAccentable()
      .overlay(Image(systemName: "plus").font(.system(size: qs(13), weight: .bold)).foregroundStyle(p.onAccentFill))
  }
}

struct CheckCircle: View {
  let done: Bool
  let p: Pal
  var body: some View {
    ZStack {
      if done {
        Circle().fill(p.accentFill).widgetAccentable()
        Image(systemName: "checkmark").font(.system(size: qs(10), weight: .heavy)).foregroundStyle(p.onAccentFill)
      } else {
        Circle().strokeBorder(p.faint, lineWidth: 1.6).widgetAccentable()
      }
    }
    .frame(width: 18, height: 18)
  }
}

struct TaskRow: View {
  let c: Ctx
  let t: STask
  let small: Bool
  var labelOverdue = true
  var body: some View {
    let when = c.x.taskWhen(t, c.now, labelOverdue: labelOverdue)
    HStack(spacing: 8) {
      Button(intent: ToggleTaskIntent(taskId: t.id, done: !t.done, date: t.date ?? "")) {
        CheckCircle(done: t.done, p: c.p)
      }
      .buttonStyle(.plain)
      VStack(alignment: .leading, spacing: 1) {
        Text(t.title)
          .font(.system(size: qs(small ? 12 : 13), weight: .medium))
          .foregroundStyle(t.done ? c.p.faint : c.p.text)
          .strikethrough(t.done)
          .lineLimit(1)
        if t.code != nil || !when.isEmpty {
          HStack(spacing: 4) {
            if let code = t.code {
              Circle().fill(c.p.bar(t.bar)).frame(width: 6, height: 6)
              Text(code).font(.system(size: qs(10), weight: .semibold)).foregroundStyle(c.p.muted)
            }
            if t.code != nil && !when.isEmpty { Text("·").font(.system(size: qs(10))).foregroundStyle(c.p.faint) }
            if !when.isEmpty {
              Text(when).font(.system(size: qs(10))).foregroundStyle(t.isOverdue(c.now) ? c.p.now : c.p.faint)
            }
          }
          .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct TasksEmpty: View {
  let c: Ctx
  let big: Bool
  var body: some View {
    MessageView(icon: "checkmark.circle", title: c.x.noTasks, sub: nil, big: big, p: c.p)
  }
}

struct TasksRect: View {
  let c: Ctx
  let all: [STask]
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Label(all.isEmpty ? c.x.myTasks : c.x.myTasks + " · " + c.x.remainingTasks(all.count), systemImage: "checkmark.circle")
        .font(.system(size: qs(11), weight: .semibold)).opacity(0.8).lineLimit(1)
      if all.isEmpty {
        Text(c.x.noTasks).font(.system(size: qs(13), weight: .semibold)).lineLimit(2)
      }
      ForEach(all.prefix(3), id: \.id) { t in
        HStack(spacing: 6) {
          Circle().strokeBorder(lineWidth: 1.3).frame(width: 10, height: 10)
          Text(t.title).font(.system(size: qs(12), weight: .medium)).lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
