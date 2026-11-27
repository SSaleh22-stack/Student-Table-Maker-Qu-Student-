import Foundation

/// The example the widget gallery shows (and the placeholder while a widget loads): a made-up day
/// at 9:35 with three lectures and a few tasks, in the app's language. Never the student's own data.
/// The same example as the Android previews (modules/qu-widgets/android/src/main/res/layout/qw_preview_*.xml).
enum Sample {
  static func entry() -> QEntry {
    // A class day: on Friday and Saturday the example is the coming Sunday.
    let today = startOfDay(Date())
    let weekday = gregorian.component(.weekday, from: today)
    let day = weekday >= 6 ? addDays(today, 8 - weekday) : today
    let now = at(day, minute: 9 * 60 + 35)
    return QEntry(date: now, snap: snapshot(now, ar: Store.ar))
  }

  static func snapshot(_ now: Date, ar: Bool) -> Snapshot {
    let day = dayKey(now)
    let t = { (a: String, e: String) in ar ? a : e }
    func lecture(_ code: String, _ name: String, _ room: String, _ start: String, _ end: String, _ bg: String, _ text: String, _ bar: String) -> SLecture {
      SLecture(code: code, name: name, section: "1271", kind: t("نظري", "Lecture"), room: room, instructor: nil,
               day: day, start: start, end: end, bg: bg, text: text, bar: bar)
    }
    func task(_ id: String, _ title: String, _ date: Date?, _ time: String?, _ code: String?, _ bar: String?) -> STask {
      STask(id: id, title: title, date: date.map(dateKey), time: time, code: code, bar: bar,
            done: false, completedAt: nil, repeatRule: "none", movedOn: nil)
    }
    let blue = ("#DCEBFF", "#1E3A8A", "#3B82F6")
    let green = ("#D8F3E8", "#065F46", "#10B981")
    let orange = ("#FFE7CC", "#9A3412", "#F59E0B")
    return Snapshot(
      v: 1,
      lang: ar ? "ar" : "en",
      hasTimetable: true,
      lectures: [
        lecture("CS 214", t("هياكل البيانات", "Data Structures"), t("مبنى 21 · 104", "Bldg 21 · 104"), "08:00", "09:15", blue.0, blue.1, blue.2),
        lecture("MATH 106", t("تفاضل وتكامل 2", "Calculus 2"), t("مبنى 9 · 210", "Bldg 9 · 210"), "10:00", "11:15", green.0, green.1, green.2),
        lecture("PHYS 101", t("فيزياء عامة", "General Physics"), t("مبنى 5 · 012", "Bldg 5 · 012"), "12:30", "13:45", orange.0, orange.1, orange.2),
      ],
      noClass: [],
      tasks: [
        task("s1", t("تقرير المختبر", "Lab report"), addDays(now, -1), nil, "CS 214", blue.2),
        task("s2", t("حل الواجب الثالث", "Homework 3"), now, "14:00", "MATH 106", green.2),
        task("s3", t("مراجعة الفصل الرابع", "Review chapter 4"), now, nil, nil, nil),
        task("s4", t("شراء دفتر جديد", "Buy a notebook"), nil, nil, nil, nil),
        task("s5", t("اختبار قصير", "Quiz"), addDays(now, 1), "10:00", "PHYS 101", orange.2),
        task("s6", t("تسليم المشروع", "Project due"), addDays(now, 3), nil, "CS 214", blue.2),
      ]
    )
  }
}
