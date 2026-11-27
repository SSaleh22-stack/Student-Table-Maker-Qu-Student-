import SwiftUI
import WidgetKit

// MARK: - Timeline

struct QEntry: TimelineEntry {
  let date: Date
  let snap: Snapshot?
}

/// One timeline for every widget. Countdown widgets get an entry every minute for the next three
/// hours (entries cost nothing; only reloads are limited), the others one at each lecture start and
/// end and when each open task falls due. The app reloads every widget whenever its data changes.
struct QProvider: TimelineProvider {
  let perMinute: Bool

  /// Shown redacted while a widget loads: the example day (Sample.swift) gives it its shape.
  func placeholder(in context: Context) -> QEntry { Sample.entry() }

  /// The widget gallery shows the example day, so every widget looks the way it will with a
  /// timetable and tasks, whatever the student has added yet.
  func getSnapshot(in context: Context, completion: @escaping (QEntry) -> Void) {
    if context.isPreview {
      completion(Sample.entry())
    } else {
      completion(QEntry(date: Date(), snap: Store.load()))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QEntry>) -> Void) {
    let snap = Store.load()
    let now = Date()
    var dates: [Date] = [now]
    let midnight = addDays(startOfDay(now), 1)
    if let s = snap {
      for l in s.lecturesOn(now) {
        for m in [l.startMin - 60, l.startMin, l.endMin] where at(now, minute: m) > now {
          dates.append(at(now, minute: m))
        }
      }
      // A task turns late at its due time.
      for t in s.tasks ?? [] where !t.done {
        if let due = t.dueAt, due > now, due <= midnight { dates.append(due) }
      }
    }
    var until = midnight
    if perMinute {
      // The start of the next minute.
      let firstMinute = gregorian.dateInterval(of: .minute, for: now)?.end
        ?? Date(timeIntervalSince1970: (floor(now.timeIntervalSince1970 / 60) + 1) * 60)
      let end = now.addingTimeInterval(3 * 3600)
      var d = firstMinute
      while d < end {
        dates.append(d)
        d = d.addingTimeInterval(60)
      }
      until = min(midnight, end)
    }
    dates.append(midnight)
    let unique = Array(Set(dates.map { $0.timeIntervalSince1970.rounded() })).sorted().map { Date(timeIntervalSince1970: $0) }
    let entries = unique.filter { $0 <= midnight }.map { QEntry(date: $0, snap: snap) }
    completion(Timeline(entries: entries, policy: .after(until)))
  }
}

// MARK: - Text size

/// Every widget text is drawn this much bigger than the sizes written in the views.
let textScale: CGFloat = 1.2

/// A font size from the views, scaled by textScale (whole points).
func qs(_ size: CGFloat) -> CGFloat { (size * textScale).rounded() }

// MARK: - Colors

func hexColor(_ hex: String?, _ fallback: Color) -> Color {
  guard let hex = hex, hex.hasPrefix("#"), hex.count == 7, let v = Int(hex.dropFirst(), radix: 16) else { return fallback }
  return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
}

/// Colors from mobile-app/src/lib/theme.ts (light) and the dark designs. In the tinted and clear
/// home screens (iOS 18+) the system recolors everything; accent parts are marked widgetAccentable.
struct Pal {
  let dark: Bool
  let tinted: Bool

  init(_ scheme: ColorScheme, _ mode: WidgetRenderingMode) {
    dark = scheme == .dark
    tinted = mode != .fullColor
  }

  var text: Color { dark ? Color(red: 0.933, green: 0.953, blue: 0.973) : Color(red: 0.106, green: 0.145, blue: 0.2) }
  var muted: Color { dark ? Color(red: 0.667, green: 0.714, blue: 0.769) : Color(red: 0.29, green: 0.337, blue: 0.408) }
  var faint: Color { dark ? Color(red: 0.529, green: 0.58, blue: 0.639) : Color(red: 0.42, green: 0.463, blue: 0.525) }
  var accent: Color { dark ? Color(red: 0.498, green: 0.827, blue: 0.89) : Color(red: 0.055, green: 0.455, blue: 0.565) }
  var onAccent: Color { dark ? Color(red: 0.043, green: 0.102, blue: 0.133) : .white }
  var soft: Color { dark ? accent.opacity(0.16) : Color(red: 0.867, green: 0.941, blue: 0.957) }
  var divider: Color { dark ? Color(red: 0.165, green: 0.212, blue: 0.267) : Color(red: 0.89, green: 0.914, blue: 0.941) }
  var track: Color { dark ? Color(red: 0.173, green: 0.224, blue: 0.278) : Color(red: 0.89, green: 0.914, blue: 0.941) }
  var now: Color { dark ? Color(red: 1, green: 0.478, blue: 0.478) : Color(red: 0.898, green: 0.282, blue: 0.302) }
  var background: Color { dark ? Color(red: 0.094, green: 0.133, blue: 0.176) : .white }

  /// An accent shape with a glyph or text on it. Tinted, the shape (alone marked widgetAccentable)
  /// is see-through and the glyph full strength, or the system would draw one blank tinted shape.
  var accentFill: Color { tinted ? accent.opacity(0.35) : accent }
  var onAccentFill: Color { tinted ? Color.primary : onAccent }

  func bar(_ hex: String?) -> Color { hexColor(hex, Color.gray) }
  func courseBg(_ l: SLecture) -> Color {
    if tinted { return Color.primary.opacity(0.12) }
    return dark ? bar(l.bar).opacity(0.22) : hexColor(l.bg, soft)
  }
  func courseText(_ l: SLecture) -> Color {
    if tinted || dark { return text }
    return hexColor(l.text, text)
  }
}

// MARK: - Shared pieces

struct Ctx {
  let snap: Snapshot?
  let now: Date
  let x: Txt
  let p: Pal
}

extension View {
  /// Lays the widget out in the app's language (right-to-left in Arabic).
  func qDirection(_ ar: Bool) -> some View {
    environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
  }
}

struct PillView: View {
  let text: String
  let p: Pal
  var body: some View {
    Text(text)
      .font(.system(size: qs(10), weight: .bold))
      .foregroundStyle(p.onAccentFill)
      .lineLimit(1)
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .background(Capsule().fill(p.accentFill).widgetAccentable())
  }
}

/// Tinted, the icon takes the tint and the tile stays a faint shape behind it.
struct IconTile: View {
  let system: String
  let size: CGFloat
  let p: Pal
  var body: some View {
    RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
      .fill(p.tinted ? Color.primary.opacity(0.12) : p.soft)
      .frame(width: size, height: size)
      .overlay(Image(systemName: system).font(.system(size: qs(size * 0.45), weight: .semibold)).foregroundStyle(p.accent).widgetAccentable())
  }
}

struct ProgressBar: View {
  let value: Double
  let p: Pal
  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(p.track)
        Capsule().fill(p.accent).frame(width: max(4, g.size.width * min(1, max(0, value)))).widgetAccentable()
      }
    }
    .frame(height: 4)
  }
}

/// A centered icon with a line or two of text (empty states).
struct MessageView: View {
  let icon: String
  let title: String
  let sub: String?
  let big: Bool
  let p: Pal
  var body: some View {
    VStack(spacing: big ? 10 : 6) {
      IconTile(system: icon, size: big ? 64 : 42, p: p)
      Text(title)
        .font(.system(size: qs(big ? 18 : 14), weight: .bold))
        .foregroundStyle(p.text)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
      if let sub = sub {
        Text(sub).font(.system(size: qs(12))).foregroundStyle(p.muted).multilineTextAlignment(.center).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

func appURL(_ path: String) -> URL { URL(string: "qustudent:///\(path)")! }

func todayLine(_ c: Ctx) -> String { c.x.dayName(dayKey(c.now)) + " " + c.x.date(c.now) }
