import SwiftUI
import WidgetKit

/// الجدول: today's lectures (small, medium, large, iPad extra large and the lock screen).
struct TimetableWidget: Widget {
  let kind = "QUTimetable"

  var body: some WidgetConfiguration {
    let x = Txt(ar: Store.ar)
    return StaticConfiguration(kind: kind, provider: QProvider(perMinute: true)) { entry in
      TimetableView(entry: entry)
    }
    .configurationDisplayName(x.timetable)
    .description(x.ar ? "محاضرات اليوم، مع تمييز المحاضرة القادمة." : "Today's lectures, with the next one highlighted.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
  }
}

struct TimetableView: View {
  let entry: QEntry
  @Environment(\.widgetFamily) var family
  @Environment(\.colorScheme) var scheme
  @Environment(\.widgetRenderingMode) var mode

  var body: some View {
    let ar = entry.snap?.ar ?? true
    let c = Ctx(snap: entry.snap, now: entry.date, x: Txt(ar: ar), p: Pal(scheme, mode))
    content(c)
      .qDirection(ar)
      .containerBackground(for: .widget) { c.p.background }
      .widgetURL(appURL("timetable"))
  }

  @ViewBuilder
  func content(_ c: Ctx) -> some View {
    let day = c.snap?.today(c.now) ?? []
    let left = day.filter { $0.state != .done }
    switch family {
    case .accessoryInline: TimetableInline(c: c, left: left)
    case .accessoryCircular: TimetableCircular(c: c, left: left)
    case .accessoryRectangular: TimetableRect(c: c, left: left)
    default:
      if c.snap?.hasTimetable != true {
        MessageView(icon: "calendar", title: c.x.addTimetable, sub: nil, big: family != .systemSmall, p: c.p)
      } else if left.isEmpty {
        MessageView(icon: "calendar.badge.checkmark", title: c.x.noLectures, sub: todayLine(c), big: family != .systemSmall, p: c.p)
      } else {
        switch family {
        case .systemSmall: TimetableSmall(c: c, left: left)
        case .systemMedium: TimetableMedium(c: c, day: day, left: left)
        case .systemExtraLarge: TimetableXL(c: c, day: day)
        default: TimetableLarge(c: c, day: day)
        }
      }
    }
  }
}

func pill(_ dl: DayLecture, _ c: Ctx) -> String? {
  switch dl.state {
  case .now: return c.x.now
  case .next: return c.x.inDuration(minutesUntil(c.now, dl.lecture.startMin))
  default: return nil
  }
}

struct TimetableSmall: View {
  let c: Ctx
  let left: [DayLecture]
  var body: some View {
    let first = left[0]
    let l = first.lecture
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text(c.x.dayName(dayKey(c.now))).font(.system(size: 13, weight: .bold)).foregroundStyle(c.p.accent).widgetAccentable()
        Spacer(minLength: 4)
        if let t = pill(first, c) { PillView(text: t, p: c.p) }
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(l.name).font(.system(size: 14, weight: .bold)).lineLimit(2).minimumScaleFactor(0.85)
        Text(c.x.range(l.startMin, l.endMin)).font(.system(size: 11)).opacity(0.85)
        if !l.roomText.isEmpty { Text(l.roomText).font(.system(size: 11)).opacity(0.85).lineLimit(1) }
      }
      .foregroundStyle(c.p.courseText(l))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(10)
      .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(c.p.courseBg(l)))
      if left.count > 1 {
        let o = left[1].lecture
        HStack(spacing: 6) {
          Circle().fill(c.p.bar(o.bar)).frame(width: 6, height: 6)
          Text(o.name).font(.system(size: 11, weight: .medium)).foregroundStyle(c.p.text).lineLimit(1)
          Spacer(minLength: 4)
          Text(Txt.ltr(c.x.clock(o.startMin))).font(.system(size: 11, weight: .semibold)).foregroundStyle(c.p.muted)
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct LectureRow: View {
  let c: Ctx
  let dl: DayLecture
  let pillText: String?
  var body: some View {
    let l = dl.lecture
    let hl = pillText != nil
    HStack(spacing: 8) {
      RoundedRectangle(cornerRadius: 2).fill(c.p.bar(l.bar)).frame(width: 3).widgetAccentable()
      VStack(alignment: .leading, spacing: 1) {
        Text(l.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
        Text(c.x.range(l.startMin, l.endMin) + (l.roomText.isEmpty ? "" : " · " + l.roomText))
          .font(.system(size: 11)).opacity(hl ? 0.85 : 1).foregroundStyle(hl ? c.p.courseText(l) : c.p.muted).lineLimit(1)
      }
      .foregroundStyle(hl ? c.p.courseText(l) : c.p.text)
      Spacer(minLength: 4)
      if let t = pillText { PillView(text: t, p: c.p) }
    }
    .fixedSize(horizontal: false, vertical: true)
    .padding(.horizontal, hl ? 8 : 0)
    .padding(.vertical, hl ? 6 : 0)
    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hl ? c.p.courseBg(l) : Color.clear))
  }
}

struct DaySegments: View {
  let total: Int
  let done: Int
  let p: Pal
  var body: some View {
    HStack(spacing: 3) {
      ForEach(0..<min(total, 8), id: \.self) { i in
        Capsule().fill(i < done ? p.track : p.accent).frame(width: 12, height: 4)
      }
    }
    .widgetAccentable()
  }
}

struct TimetableMedium: View {
  let c: Ctx
  let day: [DayLecture]
  let left: [DayLecture]
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(c.x.dayName(dayKey(c.now))).font(.system(size: 22, weight: .bold)).foregroundStyle(c.p.text).minimumScaleFactor(0.7).lineLimit(1)
        Text(c.x.date(c.now)).font(.system(size: 12)).foregroundStyle(c.p.muted)
        Spacer(minLength: 0)
        DaySegments(total: day.count, done: day.count - left.count, p: c.p)
        Text(c.x.left(left.count, day.count)).font(.system(size: 10)).foregroundStyle(c.p.faint).lineLimit(2)
      }
      .frame(width: 84, alignment: .leading)
      Rectangle().fill(c.p.divider).frame(width: 1)
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(left.prefix(3).enumerated()), id: \.element.id) { i, dl in
          LectureRow(c: c, dl: dl, pillText: i == 0 ? pill(dl, c) : nil)
        }
        Spacer(minLength: 0)
      }
    }
  }
}

struct TimelineRow: View {
  let c: Ctx
  let dl: DayLecture
  var compact = false
  var body: some View {
    let l = dl.lecture
    let done = dl.state == .done
    let next = dl.state == .next || dl.state == .now
    HStack(alignment: .top, spacing: 10) {
      VStack(alignment: .leading, spacing: 0) {
        Text(Txt.ltr(c.x.clock(l.startMin))).font(.system(size: 12, weight: .semibold)).foregroundStyle(c.p.text)
        Text(Txt.ltr(c.x.clock(l.endMin))).font(.system(size: 10)).foregroundStyle(c.p.faint)
      }
      .frame(width: 40, alignment: .leading)
      HStack(spacing: 6) {
        VStack(alignment: .leading, spacing: 1) {
          Text(l.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
          Text([l.roomText, l.kind ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.system(size: 11)).opacity(0.8).lineLimit(1)
        }
        Spacer(minLength: 4)
        if let t = pill(dl, c), !compact { PillView(text: t, p: c.p) }
      }
      .foregroundStyle(c.p.courseText(l))
      .padding(.horizontal, 10)
      .padding(.vertical, compact ? 5 : 7)
      .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(c.p.courseBg(l)))
      .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(next ? c.p.accent : Color.clear, lineWidth: 1.5))
    }
    .opacity(done ? 0.45 : 1)
  }
}

struct NowLine: View {
  let c: Ctx
  var body: some View {
    HStack(spacing: 0) {
      Text(Txt.ltr(c.x.clock(minuteOfDay(c.now)))).font(.system(size: 10, weight: .bold)).foregroundStyle(c.p.now).frame(width: 40, alignment: .leading)
      Circle().fill(c.p.now).frame(width: 7, height: 7)
      Rectangle().fill(c.p.now).frame(height: 1.5)
    }
    .widgetAccentable()
  }
}

/// The day's lectures with the "now" line after the last finished one (at most `max` rows).
struct DayTimeline: View {
  let c: Ctx
  let day: [DayLecture]
  let max: Int
  var compact = false
  var body: some View {
    let done = day.filter { $0.state == .done }.count
    let startAt = Swift.max(0, Swift.min(done - 1, day.count - max))
    let shown = Array(day.dropFirst(startAt).prefix(max))
    VStack(alignment: .leading, spacing: compact ? 5 : 7) {
      ForEach(shown) { dl in
        TimelineRow(c: c, dl: dl, compact: compact)
        if dl.state == .done && dl.id == shown.last(where: { $0.state == .done })?.id && dl.id != day.last?.id {
          NowLine(c: c)
        }
      }
    }
  }
}

struct TimetableLarge: View {
  let c: Ctx
  let day: [DayLecture]
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        VStack(alignment: .leading, spacing: 0) {
          Text(c.x.dayName(dayKey(c.now))).font(.system(size: 20, weight: .bold)).foregroundStyle(c.p.text)
          Text(c.x.date(c.now) + " · " + c.x.lectures(day.count)).font(.system(size: 12)).foregroundStyle(c.p.muted)
        }
        Spacer()
        IconTile(system: "calendar", size: 32, p: c.p)
      }
      DayTimeline(c: c, day: day, max: 5)
      Spacer(minLength: 0)
      if let next = c.snap?.nextStudyDay(c.now) {
        let d = next.0
        let first = next.1
        Rectangle().fill(c.p.divider).frame(height: 1)
        HStack(spacing: 6) {
          Image(systemName: "calendar").font(.system(size: 11)).foregroundStyle(c.p.faint)
          let label = dateKey(d) == dateKey(addDays(c.now, 1)) ? c.x.tomorrow : c.x.dayName(dayKey(d))
          Text("\(label): \(first.name) · \(Txt.ltr(c.x.clock(first.startMin)))").font(.system(size: 11)).foregroundStyle(c.p.muted).lineLimit(1)
        }
      }
    }
  }
}

/// iPad: today's timeline beside the week (Sunday to Thursday).
struct TimetableXL: View {
  let c: Ctx
  let day: [DayLecture]
  var body: some View {
    let next = day.first { $0.state == .next || $0.state == .now }
    HStack(alignment: .top, spacing: 16) {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          VStack(alignment: .leading, spacing: 0) {
            Text(c.x.dayName(dayKey(c.now))).font(.system(size: 20, weight: .bold)).foregroundStyle(c.p.text)
            Text(c.x.date(c.now) + " · " + c.x.lectures(day.count)).font(.system(size: 12)).foregroundStyle(c.p.muted)
          }
          Spacer()
          if let n = next, let t = pill(n, c) { PillView(text: t, p: c.p) }
        }
        DayTimeline(c: c, day: day, max: 5, compact: true)
        Spacer(minLength: 0)
      }
      .frame(width: 320)
      Rectangle().fill(c.p.divider).frame(width: 1)
      WeekGrid(c: c)
    }
  }
}

struct WeekGrid: View {
  let c: Ctx
  private let days = ["Sun", "Mon", "Tue", "Wed", "Thu"]
  private let from = 8 * 60
  private let to = 16 * 60

  var body: some View {
    let s = c.snap
    let ar = c.x.ar
    let weekStart = addDays(startOfDay(c.now), -(gregorian.component(.weekday, from: c.now) - 1))
    GeometryReader { g in
      let labelW: CGFloat = 22
      let headH: CGFloat = 20
      let colW = (g.size.width - labelW) / CGFloat(days.count)
      let ph = (g.size.height - headH - 2) / CGFloat((to - from) / 60)
      let y = { (m: Int) -> CGFloat in headH + CGFloat(m - from) / 60 * ph }
      ZStack(alignment: .topLeading) {
        ForEach([8, 10, 12, 14, 16], id: \.self) { h in
          Rectangle().fill(c.p.divider).frame(width: g.size.width - labelW, height: 1)
            .offset(x: ar ? 0 : labelW, y: y(h * 60))
          Text("\(h % 12 == 0 ? 12 : h % 12)").font(.system(size: 9)).foregroundStyle(c.p.faint)
            .frame(width: labelW - 4, alignment: ar ? .trailing : .leading)
            .offset(x: ar ? g.size.width - labelW + 4 : 0, y: y(h * 60) - 6)
        }
        ForEach(Array(days.enumerated()), id: \.offset) { i, key in
          let date = addDays(weekStart, i)
          let isToday = dateKey(date) == dateKey(c.now)
          // Sunday sits next to the hour labels: on the right in Arabic.
          let colX = ar ? g.size.width - labelW - CGFloat(i + 1) * colW : labelW + CGFloat(i) * colW
          if isToday {
            RoundedRectangle(cornerRadius: 8).fill(c.p.soft).frame(width: colW, height: g.size.height - headH + 4).offset(x: colX, y: headH - 4)
          }
          Text(c.x.dayName(key)).font(.system(size: 10, weight: isToday ? .bold : .medium))
            .foregroundStyle(isToday ? c.p.accent : c.p.muted).lineLimit(1).minimumScaleFactor(0.7)
            .frame(width: colW).offset(x: colX, y: 0)
          ForEach(Array((s?.lecturesOn(date) ?? []).enumerated()), id: \.offset) { _, l in
            let top = y(max(from, l.startMin))
            let h = max(10, y(min(to, l.endMin)) - top - 2)
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(c.p.courseBg(l))
              .overlay(Text(l.code).font(.system(size: 9, weight: .semibold)).foregroundStyle(c.p.courseText(l)).lineLimit(1).padding(3), alignment: .topLeading)
              .frame(width: colW - 4, height: h)
              .offset(x: colX + 2, y: top + 1)
          }
          if isToday {
            let m = minuteOfDay(c.now)
            if m > from && m < to {
              Rectangle().fill(c.p.now).frame(width: colW, height: 1.5).offset(x: colX, y: y(m))
            }
          }
        }
      }
      // Positions above are absolute (x from the left edge), whatever the reading direction.
      .environment(\.layoutDirection, .leftToRight)
    }
  }
}

// MARK: - Lock screen

struct TimetableInline: View {
  let c: Ctx
  let left: [DayLecture]
  var body: some View {
    if let f = left.first {
      Label("\(f.lecture.name) · \(Txt.ltr(c.x.clock(f.lecture.startMin)))", systemImage: "calendar")
    } else {
      Label(c.x.noLectures, systemImage: "calendar")
    }
  }
}

struct TimetableCircular: View {
  let c: Ctx
  let left: [DayLecture]
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Image(systemName: "calendar").font(.system(size: 12))
        Text("\(left.count)").font(.system(size: 20, weight: .bold))
      }
    }
  }
}

struct TimetableRect: View {
  let c: Ctx
  let left: [DayLecture]
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Label(c.x.dayName(dayKey(c.now)) + " · " + c.x.left(left.count, c.snap?.today(c.now).count ?? 0), systemImage: "calendar")
        .font(.system(size: 11, weight: .semibold)).opacity(0.8).lineLimit(1)
      if left.isEmpty {
        Text(c.x.noLectures).font(.system(size: 13, weight: .semibold)).lineLimit(2)
      }
      ForEach(left.prefix(3)) { dl in
        HStack(spacing: 6) {
          Text(Txt.ltr(c.x.clock(dl.lecture.startMin))).font(.system(size: 12, weight: .bold))
          Text(dl.lecture.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
