import SwiftUI
import WidgetKit

/// المحاضرة القادمة: minutes until the next lecture, or until the current one ends.
struct CountdownWidget: Widget {
  let kind = "QUCountdown"

  var body: some WidgetConfiguration {
    let x = Txt(ar: Store.ar)
    return StaticConfiguration(kind: kind, provider: QProvider(perMinute: true)) { entry in
      CountdownView(entry: entry)
    }
    .configurationDisplayName(x.nextLecture)
    .description(x.ar ? "الدقائق المتبقية على محاضرتك القادمة وقاعتها." : "Minutes until your next lecture, and its room.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
  }
}

struct CountdownView: View {
  let entry: QEntry
  @Environment(\.widgetFamily) var family
  @Environment(\.colorScheme) var scheme
  @Environment(\.widgetRenderingMode) var mode

  var body: some View {
    let ar = entry.snap?.ar ?? true
    let c = Ctx(snap: entry.snap, now: entry.date, x: Txt(ar: ar), p: Pal(scheme, mode))
    content(c, entry.snap?.focus(entry.date))
      .qDirection(ar)
      .containerBackground(for: .widget) { c.p.background }
      .widgetURL(appURL("timetable"))
  }

  @ViewBuilder
  func content(_ c: Ctx, _ f: Focus?) -> some View {
    switch family {
    case .accessoryInline:
      if let f = f {
        Label("\(f.lecture.name) · \(f.isNow ? c.x.endsIn + " " + c.x.duration(f.minutes) : c.x.inDuration(f.minutes))", systemImage: "clock")
      } else {
        Label(c.x.noLectures, systemImage: "clock")
      }
    case .accessoryCircular:
      if let f = f {
        let big = c.x.bigCountdown(f.minutes)
        Gauge(value: min(1, max(0, f.progress))) {
          Image(systemName: "clock")
        } currentValueLabel: {
          Text(big.0)
        }
        .gaugeStyle(.accessoryCircularCapacity)
      } else {
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: "calendar.badge.checkmark").font(.system(size: qs(20)))
        }
      }
    case .accessoryRectangular:
      if let f = f {
        VStack(alignment: .leading, spacing: 1) {
          Label(f.isNow ? c.x.endsIn + " " + c.x.duration(f.minutes) : c.x.inDuration(f.minutes), systemImage: "clock")
            .font(.system(size: qs(12), weight: .bold)).lineLimit(1)
          Text(f.lecture.name).font(.system(size: qs(15), weight: .bold)).lineLimit(1)
          Text(whereWhen(f, c)).font(.system(size: qs(12))).opacity(0.8).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        Text(c.x.noLectures).font(.system(size: qs(14), weight: .semibold)).lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    default:
      if c.snap?.hasTimetable != true {
        MessageView(icon: "calendar", title: c.x.addTimetable, sub: nil, big: false, p: c.p)
      } else if let f = f {
        if family == .systemMedium { CountdownMedium(c: c, f: f) } else { CountdownSmall(c: c, f: f) }
      } else {
        MessageView(icon: "calendar.badge.checkmark", title: c.x.noLectures, sub: todayLine(c), big: false, p: c.p)
      }
    }
  }
}

func whereWhen(_ f: Focus, _ c: Ctx) -> String {
  let time = f.isNow ? c.x.until(c.x.clock(f.lecture.endMin)) : Txt.ltr(c.x.clock(f.lecture.startMin))
  return f.lecture.roomText.isEmpty ? time : "\(time) · \(f.lecture.roomText)"
}

struct BigNumber: View {
  let c: Ctx
  let f: Focus
  let size: CGFloat
  var body: some View {
    let big = c.x.bigCountdown(f.minutes)
    HStack(alignment: .lastTextBaseline, spacing: 4) {
      // An hour count ("1:20") shrinks a little if it must; the unit never wraps.
      Text(Txt.ltr(big.0)).font(.system(size: qs(size), weight: .bold, design: .rounded)).foregroundStyle(c.p.accent).widgetAccentable()
        .lineLimit(1).minimumScaleFactor(0.8)
        .contentTransition(.numericText(countsDown: true))
      Text(big.1).font(.system(size: qs(size * 0.32), weight: .semibold)).foregroundStyle(c.p.muted).lineLimit(1).fixedSize()
    }
  }
}

struct CountdownSmall: View {
  let c: Ctx
  let f: Focus
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        if f.isNow { PillView(text: c.x.now, p: c.p) } else { Circle().fill(c.p.bar(f.lecture.bar)).frame(width: 8, height: 8) }
        Text(f.isNow ? c.x.endsIn : c.x.nextLecture).font(.system(size: qs(11), weight: .semibold)).foregroundStyle(c.p.muted).lineLimit(1)
      }
      Spacer(minLength: 0)
      BigNumber(c: c, f: f, size: 40)
      Text(f.lecture.name).font(.system(size: qs(14), weight: .bold)).foregroundStyle(c.p.text).lineLimit(1)
      Text(whereWhen(f, c)).font(.system(size: qs(11))).foregroundStyle(c.p.muted).lineLimit(1)
      ProgressBar(value: f.progress, p: c.p).padding(.top, 2)
    }
  }
}

struct CountdownMedium: View {
  let c: Ctx
  let f: Focus
  var body: some View {
    let l = f.lecture
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          if f.isNow { PillView(text: c.x.now, p: c.p) }
          Text(f.isNow ? c.x.endsIn : c.x.nextLecture).font(.system(size: qs(11), weight: .semibold)).foregroundStyle(c.p.muted).lineLimit(1)
        }
        Spacer(minLength: 0)
        BigNumber(c: c, f: f, size: 44)
        Text(f.isNow ? c.x.until(c.x.clock(l.endMin)) : c.x.starts(c.x.clock(l.startMin))).font(.system(size: qs(11))).foregroundStyle(c.p.muted)
        ProgressBar(value: f.progress, p: c.p)
      }
      .frame(width: 112, alignment: .leading)
      Rectangle().fill(c.p.divider).frame(width: 1)
      VStack(alignment: .leading, spacing: 4) {
        Text(l.name).font(.system(size: qs(17), weight: .bold)).foregroundStyle(c.p.text).lineLimit(2).minimumScaleFactor(0.85)
        Text([l.code, (l.section ?? "").isEmpty ? "" : "\(c.x.section) \(l.section ?? "")", l.kind ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
          .font(.system(size: qs(11))).foregroundStyle(c.p.faint).lineLimit(1)
        if !l.roomText.isEmpty {
          Label(l.roomText, systemImage: "mappin.and.ellipse").font(.system(size: qs(12))).foregroundStyle(c.p.muted).lineLimit(1)
        }
        if let who = l.instructor, !who.isEmpty {
          Label(who, systemImage: "person").font(.system(size: qs(12))).foregroundStyle(c.p.muted).lineLimit(1)
        }
        Spacer(minLength: 0)
        if let a = f.after {
          Rectangle().fill(c.p.divider).frame(height: 1)
          HStack(spacing: 6) {
            Text(c.x.then).font(.system(size: qs(11), weight: .bold)).foregroundStyle(c.p.accent).widgetAccentable()
            Circle().fill(c.p.bar(a.bar)).frame(width: 6, height: 6)
            Text("\(a.name) · \(Txt.ltr(c.x.clock(a.startMin)))").font(.system(size: qs(11))).foregroundStyle(c.p.muted).lineLimit(1)
          }
        }
      }
    }
  }
}
