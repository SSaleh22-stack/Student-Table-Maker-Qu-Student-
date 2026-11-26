import Foundation

/// Widget text in the app's language (Arabic or English), with Western digits like the app.
struct Txt {
  let ar: Bool
  private func t(_ a: String, _ e: String) -> String { ar ? a : e }

  /// Keeps times and ranges left-to-right inside Arabic text (like lib/rtl.ts ltr()).
  static func ltr(_ s: String) -> String { "\u{2066}\(s)\u{2069}" }

  var nextLecture: String { t("المحاضرة القادمة", "Next lecture") }
  var now: String { t("الآن", "Now") }
  var endsIn: String { t("تنتهي بعد", "Ends in") }
  var then: String { t("بعدها", "Then") }
  var noLectures: String { t("لا محاضرات متبقية اليوم", "No more lectures today") }
  var addTimetable: String { t("أضف جدولك من التطبيق", "Add your timetable in the app") }
  var tomorrow: String { t("غدًا", "Tomorrow") }
  var myTasks: String { t("مهامي", "My tasks") }
  var today: String { t("اليوم", "Today") }
  var upcoming: String { t("القادمة", "Upcoming") }
  var allDone: String { t("أنجزت كل مهام اليوم", "All done for today") }
  var nothingToday: String { t("لا مهام لليوم", "Nothing due today") }
  var newTask: String { t("مهمة جديدة", "New task") }
  var overdue: String { t("متأخرة", "Overdue") }
  var section: String { t("شعبة", "Section") }
  var timetable: String { t("الجدول", "Timetable") }

  func starts(_ time: String) -> String { t("تبدأ ", "Starts ") + Txt.ltr(time) }
  func until(_ time: String) -> String { t("حتى ", "Until ") + Txt.ltr(time) }

  func dayName(_ key: String) -> String {
    switch key {
    case "Sun": return t("الأحد", "Sunday")
    case "Mon": return t("الاثنين", "Monday")
    case "Tue": return t("الثلاثاء", "Tuesday")
    case "Wed": return t("الأربعاء", "Wednesday")
    case "Thu": return t("الخميس", "Thursday")
    case "Fri": return t("الجمعة", "Friday")
    default: return t("السبت", "Saturday")
    }
  }

  private static let monthsAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
  private static let monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  /// "22 نوفمبر" / "Nov 22"
  func date(_ d: Date) -> String {
    let c = gregorian.dateComponents([.month, .day], from: d)
    let m = max(1, min(12, c.month ?? 1)) - 1
    let day = c.day ?? 1
    return ar ? "\(day) \(Txt.monthsAr[m])" : "\(Txt.monthsEn[m]) \(day)"
  }

  func lectures(_ n: Int) -> String {
    if !ar { return n == 1 ? "1 lecture" : "\(n) lectures" }
    if n == 1 { return "محاضرة واحدة" }
    if n == 2 { return "محاضرتان" }
    if (3...10).contains(n) { return "\(n) محاضرات" }
    return "\(n) محاضرة"
  }

  func left(_ n: Int, _ total: Int) -> String { t("\(n) من \(total) متبقية", "\(n) of \(total) left") }
  func doneOf(_ done: Int, _ total: Int) -> String { t("\(done) من \(total) منجزة", "\(done) of \(total) done") }
  func more(_ n: Int) -> String { t("+\(n) أخرى", "+\(n) more") }
  func remainingTasks(_ n: Int) -> String {
    if !ar { return "\(n) left" }
    if n == 1 { return "مهمة متبقية" }
    if n == 2 { return "مهمتان متبقيتان" }
    if (3...10).contains(n) { return "\(n) مهام متبقية" }
    return "\(n) مهمة متبقية"
  }

  func upcomingCount(_ n: Int) -> String {
    if !ar { return "\(n) upcoming" }
    if n == 1 { return "مهمة قادمة" }
    if n == 2 { return "مهمتان قادمتان" }
    if (3...10).contains(n) { return "\(n) مهام قادمة" }
    return "\(n) مهمة قادمة"
  }

  /// "19 د", "1 س 20 د" / "19 min", "1 h 20 min"
  func duration(_ mins: Int) -> String {
    if mins < 60 { return t("\(mins) د", "\(mins) min") }
    let h = mins / 60, m = mins % 60
    if m == 0 { return t("\(h) س", "\(h) h") }
    return t("\(h) س \(m) د", "\(h) h \(m) min")
  }

  func inDuration(_ mins: Int) -> String { t("بعد ", "in ") + duration(mins) }

  /// The big countdown: the number and its unit ("19" + "دقيقة", "1:20" + "ساعة").
  func bigCountdown(_ mins: Int) -> (String, String) {
    if mins < 60 {
      let unit = !ar ? "min" : ((3...10).contains(mins) ? "دقائق" : "دقيقة")
      return ("\(mins)", unit)
    }
    return ("\(mins / 60):" + String(format: "%02d", mins % 60), t("ساعة", "hr"))
  }

  /// "10:00" (12-hour clock, no AM/PM: how students read class times)
  func clock(_ minute: Int) -> String {
    let h = (minute / 60) % 24
    let h12 = h % 12 == 0 ? 12 : h % 12
    return "\(h12):" + String(format: "%02d", minute % 60)
  }

  func range(_ start: Int, _ end: Int) -> String { Txt.ltr("\(clock(start))–\(clock(end))") }

  /// A task's time with ص/م (AM/PM)
  func taskTime(_ hhmm: String) -> String {
    let m = minutesOf(hhmm)
    let base = clock(m)
    return m < 12 * 60 ? t("\(base) ص", "\(base) AM") : t("\(base) م", "\(base) PM")
  }

  /// The short "when" under a task: overdue, its time today, or its day.
  func taskWhen(_ task: STask, _ now: Date) -> String {
    guard let date = task.date else { return "" }
    if task.isOverdue(now) { return overdue }
    let todayKey = dateKey(now)
    var day = ""
    if date == todayKey {
      day = task.time == nil ? today : ""
    } else if date == dateKey(addDays(now, 1)) {
      day = tomorrow
    } else if let due = task.dueAt, due < addDays(startOfDay(now), 8) {
      day = dayName(dayKey(due.addingTimeInterval(-1)))
    } else if let due = task.dueAt {
      day = self.date(due.addingTimeInterval(-1))
    }
    let time = task.time.map { taskTime($0) } ?? ""
    return [day, time].filter { !$0.isEmpty }.joined(separator: " ")
  }
}
