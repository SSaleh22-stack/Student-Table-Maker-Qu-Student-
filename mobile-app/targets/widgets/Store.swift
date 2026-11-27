import Foundation

/// The snapshot written by the app (src/lib/widgets.ts, modules/qu-widgets) and the rules that turn
/// it into what a widget shows at a given moment. Same rules as the Android widgets
/// (modules/qu-widgets/android/.../WidgetData.kt) and the app (lib/tasks.ts, calendar/classDays.ts).

let appGroup = "group.net.qustudent.app"
private let snapshotKey = "snapshot"
private let pendingKey = "pendingToggles"

struct SLecture: Codable {
  var code: String
  var name: String
  var section: String?
  var kind: String?
  var room: String?
  var instructor: String?
  var day: String
  var start: String
  var end: String
  var bg: String?
  var text: String?
  var bar: String?

  var startMin: Int { minutesOf(start) }
  var endMin: Int { minutesOf(end) }
  var roomText: String { room ?? "" }
}

struct STask: Codable {
  var id: String
  var title: String
  var date: String?
  var time: String?
  var code: String?
  var bar: String?
  var done: Bool
  var completedAt: String?
  var repeatRule: String?
  /// No longer set (a repeating task ticked on the widget moves to its next date); still decoded.
  var movedOn: Bool?

  enum CodingKeys: String, CodingKey {
    case id, title, date, time, code, bar, done, completedAt, movedOn
    case repeatRule = "repeat"
  }

  var repeats: Bool { (repeatRule ?? "none") != "none" }
  var isMovedOn: Bool { movedOn ?? false }
}

struct SNoClass: Codable {
  var from: String
  var to: String?
}

struct Snapshot: Codable {
  var v: Int?
  var lang: String?
  var hasTimetable: Bool?
  var lectures: [SLecture]?
  var noClass: [SNoClass]?
  var tasks: [STask]?

  var ar: Bool { lang != "en" }
}

struct PendingToggle: Codable {
  var id: String
  var done: Bool
  var date: String?
  var at: String?
}

func minutesOf(_ hhmm: String) -> Int {
  let p = hhmm.split(separator: ":")
  let h = p.count > 0 ? Int(p[0]) ?? 0 : 0
  let m = p.count > 1 ? Int(p[1]) ?? 0 : 0
  return h * 60 + m
}

let gregorian: Calendar = {
  var c = Calendar(identifier: .gregorian)
  c.timeZone = TimeZone.current
  return c
}()

/// "2026-11-22" for a local date.
func dateKey(_ d: Date) -> String {
  let c = gregorian.dateComponents([.year, .month, .day], from: d)
  return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

func dayKey(_ d: Date) -> String {
  switch gregorian.component(.weekday, from: d) {
  case 1: return "Sun"
  case 2: return "Mon"
  case 3: return "Tue"
  case 4: return "Wed"
  case 5: return "Thu"
  case 6: return "Fri"
  default: return "Sat"
  }
}

func minuteOfDay(_ d: Date) -> Int {
  let c = gregorian.dateComponents([.hour, .minute], from: d)
  return (c.hour ?? 0) * 60 + (c.minute ?? 0)
}

func startOfDay(_ d: Date) -> Date { gregorian.startOfDay(for: d) }

func addDays(_ d: Date, _ n: Int) -> Date { gregorian.date(byAdding: .day, value: n, to: d) ?? d }

/// The moment `minute` (after midnight) on the day of `d`.
func at(_ d: Date, minute: Int) -> Date { startOfDay(d).addingTimeInterval(TimeInterval(minute * 60)) }

/// Whole minutes from `now` until `minute` today, rounded up (9:41:20 → 10:00 is 19).
func minutesUntil(_ now: Date, _ minute: Int) -> Int {
  let secs = at(now, minute: minute).timeIntervalSince(now)
  return max(0, Int((secs + 59) / 60))
}

private let isoFull: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f
}()

private let isoPlain = ISO8601DateFormatter()

func parseISO(_ s: String?) -> Date? {
  guard let s = s else { return nil }
  return isoFull.date(from: s) ?? isoPlain.date(from: s)
}

func nowISO() -> String { isoFull.string(from: Date()) }

enum Store {
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static func pending() -> [PendingToggle] {
    guard let json = defaults?.string(forKey: pendingKey), let data = json.data(using: .utf8) else { return [] }
    return (try? JSONDecoder().decode([PendingToggle].self, from: data)) ?? []
  }

  static func addPending(id: String, done: Bool, date: String?) {
    var list = pending()
    list.append(PendingToggle(id: id, done: done, date: date, at: nowISO()))
    if let data = try? JSONEncoder().encode(list), let json = String(data: data, encoding: .utf8) {
      defaults?.set(json, forKey: pendingKey)
    }
  }

  /// The app's snapshot with the widget ticks the app has not picked up yet laid over it, in the
  /// order they were made. A ticked repeating task moves to its next date and stays open, like in
  /// the app (lib/tasks.ts nextOccurrence, at the time of the tick).
  static func load() -> Snapshot? {
    guard let json = defaults?.string(forKey: snapshotKey), let data = json.data(using: .utf8),
          var snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return nil }
    let ticks = pending()
    if ticks.isEmpty { return snap }
    var tasks = snap.tasks ?? []
    for t in ticks {
      // A second tap before the widget redrew carries the old state: skip it, as the app does.
      guard let i = tasks.firstIndex(where: { $0.id == t.id }), tasks[i].done != t.done, tasks[i].date == t.date else { continue }
      if t.done, let next = tasks[i].nextDate(tickedAt: parseISO(t.at) ?? Date()) {
        tasks[i].date = next
        tasks[i].completedAt = t.at
      } else if t.done {
        tasks[i].done = true
        tasks[i].completedAt = t.at
      } else {
        tasks[i].done = false
        tasks[i].completedAt = nil
      }
    }
    snap.tasks = tasks
    return snap
  }

  /// The language for the widget gallery names (before any snapshot: Arabic, the app's default).
  static var ar: Bool { load()?.ar ?? true }
}

// MARK: - Lectures

enum LState { case done, now, next, later }

struct DayLecture: Identifiable {
  let lecture: SLecture
  let state: LState
  var id: String { "\(lecture.code)-\(lecture.start)-\(lecture.day)" }
}

extension Snapshot {
  func isNoClassDay(_ d: Date) -> Bool {
    let k = dateKey(d)
    return (noClass ?? []).contains { k >= $0.from && ($0.to == nil || k <= $0.to!) }
  }

  func lecturesOn(_ d: Date) -> [SLecture] {
    if isNoClassDay(d) { return [] }
    let key = dayKey(d)
    return (lectures ?? []).filter { $0.day == key }.sorted { $0.startMin < $1.startMin }
  }

  func today(_ now: Date) -> [DayLecture] {
    let m = minuteOfDay(now)
    var nextGiven = false
    return lecturesOn(now).map { l in
      let state: LState
      if l.endMin <= m { state = .done }
      else if l.startMin <= m { state = .now }
      else if !nextGiven { nextGiven = true; state = .next }
      else { state = .later }
      return DayLecture(lecture: l, state: state)
    }
  }

  /// The next day (within two weeks) that has lectures, with its first lecture.
  func nextStudyDay(_ now: Date) -> (Date, SLecture)? {
    var d = addDays(startOfDay(now), 1)
    for _ in 0..<14 {
      if let first = lecturesOn(d).first { return (d, first) }
      d = addDays(d, 1)
    }
    return nil
  }
}

/// What the countdown shows: the lecture, whether it is on now, the minutes left and the progress.
struct Focus {
  let lecture: SLecture
  let isNow: Bool
  let minutes: Int
  let progress: Double
  let after: SLecture?
}

extension Snapshot {
  func focus(_ now: Date) -> Focus? {
    let day = today(now)
    let m = minuteOfDay(now)
    let next = day.first { $0.state == .next }?.lecture
    if let cur = day.first(where: { $0.state == .now })?.lecture {
      let len = max(1, cur.endMin - cur.startMin)
      return Focus(lecture: cur, isNow: true, minutes: minutesUntil(now, cur.endMin),
                   progress: Double(m - cur.startMin) / Double(len), after: next)
    }
    guard let n = next else { return nil }
    let mins = minutesUntil(now, n.startMin)
    let after = day.first { $0.state == .later }?.lecture
    // The bar fills over the last hour before the lecture.
    return Focus(lecture: n, isNow: false, minutes: mins, progress: 1 - Double(min(60, mins)) / 60, after: after)
  }
}

// MARK: - Tasks

/// The groups of the مهامي widget, in the order it lists them.
enum TaskGroup: Hashable { case overdue, today, noDate, upcoming }

struct TaskSection: Identifiable {
  let group: TaskGroup
  let tasks: [STask]
  var id: TaskGroup { group }
}

/// Every open task: overdue first, then today's, then those without a date, then the nearest dates.
struct TaskList {
  let sections: [TaskSection]
  var all: [STask] { sections.flatMap { $0.tasks } }
}

extension STask {
  /// The start (local midnight) of the task's day.
  var dayStart: Date? {
    guard let date = date else { return nil }
    let p = date.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3 else { return nil }
    return gregorian.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
  }

  var dueAt: Date? {
    guard let day = dayStart else { return nil }
    if let t = time { return day.addingTimeInterval(TimeInterval(minutesOf(t) * 60)) }
    return addDays(day, 1)
  }

  /// Late from its due moment on, so the timeline entry at that moment (Ui.swift; midnight for a
  /// task without a time) already shows it late.
  func isOverdue(_ now: Date) -> Bool {
    guard !done, !isMovedOn, let due = dueAt else { return false }
    return due <= now
  }

  /// The date a repeating task moves on to when ticked off at `tickedAt` (lib/tasks.ts
  /// nextOccurrence): a day or a week on, past the day of the tick. Nil if it does not repeat.
  func nextDate(tickedAt: Date) -> String? {
    guard repeats, let day = dayStart else { return nil }
    let step = repeatRule == "daily" ? 1 : 7
    let tickDay = dateKey(tickedAt)
    var next = addDays(day, step)
    // Keys compare correctly as strings ('YYYY-MM-DD').
    while dateKey(next) <= tickDay { next = addDays(next, step) }
    return dateKey(next)
  }
}

private func soonest(_ a: STask, _ b: STask) -> Bool {
  let ka = "\(a.date ?? "9999-99-99") \(a.time ?? "99:99")"
  let kb = "\(b.date ?? "9999-99-99") \(b.time ?? "99:99")"
  return ka < kb
}

extension Snapshot {
  /// Ticked tasks leave the list at once (a repeating one moves to its next date, see Store.load).
  func taskList(_ now: Date) -> TaskList {
    let today = dateKey(now)
    let open = (tasks ?? []).filter { !$0.done && !$0.isMovedOn }
    let overdue = open.filter { $0.isOverdue(now) }.sorted(by: soonest)
    let onTime = open.filter { !$0.isOverdue(now) }
    let dueToday = onTime.filter { $0.date == today }.sorted(by: soonest)
    let noDate = onTime.filter { $0.date == nil }
    let upcoming = onTime.filter { ($0.date ?? "") > today }.sorted(by: soonest)
    return TaskList(sections: [
      TaskSection(group: .overdue, tasks: overdue),
      TaskSection(group: .today, tasks: dueToday),
      TaskSection(group: .noDate, tasks: noDate),
      TaskSection(group: .upcoming, tasks: upcoming),
    ].filter { !$0.tasks.isEmpty })
  }
}
