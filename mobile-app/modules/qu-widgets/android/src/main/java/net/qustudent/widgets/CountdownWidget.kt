package net.qustudent.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.width
import java.time.LocalDateTime

/** المحاضرة القادمة: minutes until the next lecture (or until the current one ends). */
class CountdownWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(SIZES)

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snap = WidgetStore.load(context)
    val now = LocalDateTime.now()
    provideContent { CountdownContent(snap, now) }
  }
}

class CountdownWidgetReceiver : TickingReceiver() {
  override val glanceAppWidget = CountdownWidget()
}

/** What the countdown shows: the lecture, whether it is on now, the minutes left and the progress. */
private class Focus(val lecture: Lecture, val now: Boolean, val minutes: Int, val progress: Float, val after: Lecture?)

private fun focusOf(s: Snapshot, now: LocalDateTime): Focus? {
  val day = s.today(now)
  val m = now.hour * 60 + now.minute
  val current = day.firstOrNull { it.state == LState.NOW }?.lecture
  val next = day.firstOrNull { it.state == LState.NEXT }?.lecture
  if (current != null) {
    val len = maxOf(1, current.end - current.start)
    return Focus(current, true, minutesUntil(now, current.end), (m - current.start).toFloat() / len, next)
  }
  if (next == null) return null
  val mins = minutesUntil(now, next.start)
  // The bar fills over the last hour before the lecture.
  val after = day.firstOrNull { it.state == LState.LATER }?.lecture
  return Focus(next, false, mins, 1f - minOf(60, mins) / 60f, after)
}

@Composable
private fun CountdownContent(s: Snapshot?, now: LocalDateTime) {
  val context = LocalContext.current
  val size = LocalSize.current
  val x = Txt(s?.ar ?: true)
  val d = Dir(s?.ar ?: true, context)
  val focus = s?.let { focusOf(it, now) }
  val short = size.height < 130.dp
  Card(openApp(context, "timetable"), pad = if (short) 12.dp else 14.dp) {
    when {
      s == null || !s.hasTimetable -> OneLine(d) { T(x.addTimetable, d, size = 13.sp, bold = true, lines = 2) }
      focus == null && short -> OneLine(d) {
        Column(horizontalAlignment = d.startH) {
          T(x.noLectures, d, size = 13.sp, bold = true, lines = 2)
          T(x.date(now.toLocalDate()), d, size = 11.sp, color = Pal.muted)
        }
      }
      focus == null -> Message(
        d, R.drawable.qw_calendar_check, x.noLectures,
        x.dayName(dayKey(now.toLocalDate())) + " " + x.date(now.toLocalDate()), big = false,
      )
      short && size.width < 250.dp -> Tiny(focus, x, d)
      short -> Strip(focus, x, d)
      size.width < 250.dp -> Square(focus, x, d)
      else -> Wide(focus, x, d)
    }
  }
}

@Composable
private fun OneLine(d: Dir, content: @Composable () -> Unit) {
  Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) { content() }
}

@Composable
private fun Big(f: Focus, x: Txt, d: Dir, size: Int) {
  val (num, unit) = x.bigCountdown(f.minutes)
  DRow(d, vertical = Alignment.Bottom, items = listOf(
    { T(ltr(num), d, size = size.sp, color = Pal.accent, bold = true) },
    { HGap(4.dp) },
    { T(unit, d, size = (size * 0.32f).sp, color = Pal.muted, medium = true) },
  ))
}

private fun label(f: Focus, x: Txt) = if (f.now) x.endsIn else x.nextLecture

private fun whereWhen(f: Focus, x: Txt): String {
  val time = if (f.now) x.until(x.clock(f.lecture.end)) else ltr(x.clock(f.lecture.start))
  return if (f.lecture.room.isEmpty()) time else "$time · ${f.lecture.room}"
}

/** 2×1 */
@Composable
private fun Tiny(f: Focus, x: Txt, d: Dir) {
  val (num, unit) = x.bigCountdown(f.minutes)
  DRow(d, GlanceModifier.fillMaxSize(), items = listOf(
    {
      Column(modifier = GlanceModifier.width(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        T(ltr(num), d, size = 22.sp, color = Pal.accent, bold = true, center = true)
        T(unit, d, size = 10.sp, color = Pal.muted, center = true)
      }
    },
    { HGap(8.dp) },
    { VDivider() },
    { HGap(8.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
        if (f.now) Pill(x.now, d)
        T(f.lecture.name, d, size = 13.sp, bold = true, lines = 2, modifier = GlanceModifier.fillMaxWidth())
        T(whereWhen(f, x), d, size = 10.sp, color = Pal.muted, modifier = GlanceModifier.fillMaxWidth())
      }
    },
  ))
}

/** 4×1 */
@Composable
private fun Strip(f: Focus, x: Txt, d: Dir) {
  val head = if (f.now) "${x.now} · ${x.endsIn} ${x.duration(f.minutes)}" else "${x.nextLecture} · ${x.inDuration(f.minutes)}"
  DRow(d, GlanceModifier.fillMaxSize(), items = listOf(
    { AppMark() },
    { HGap(10.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
        T(head, d, size = 11.sp, color = Pal.accent, bold = true, modifier = GlanceModifier.fillMaxWidth())
        T(f.lecture.name, d, size = 15.sp, bold = true, modifier = GlanceModifier.fillMaxWidth())
        T(x.range(f.lecture.start, f.lecture.end) + if (f.lecture.room.isNotEmpty()) " · " + f.lecture.room else "", d, size = 11.sp, color = Pal.muted, modifier = GlanceModifier.fillMaxWidth())
      }
    },
    { HGap(10.dp) },
    { Big(f, x, d, 26) },
  ))
}

/** 2×2 */
@Composable
private fun Square(f: Focus, x: Txt, d: Dir) {
  Column(modifier = GlanceModifier.fillMaxSize(), horizontalAlignment = d.startH) {
    DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
      { AppMark() },
      { HGap(6.dp) },
      { if (f.now) { Pill(x.now, d); HGap(6.dp) } },
      { T(label(f, x), d, size = 11.sp, color = Pal.muted, medium = true, modifier = GlanceModifier.defaultWeight()) },
    ))
    Box(GlanceModifier.defaultWeight()) {}
    Big(f, x, d, 40)
    T(f.lecture.name, d, size = 14.sp, bold = true, modifier = GlanceModifier.fillMaxWidth())
    T(whereWhen(f, x), d, size = 11.sp, color = Pal.muted, modifier = GlanceModifier.fillMaxWidth())
    Gap(6.dp)
    Progress(f.progress)
  }
}

/** 4×2 */
@Composable
private fun Wide(f: Focus, x: Txt, d: Dir) {
  val l = f.lecture
  DRow(d, GlanceModifier.fillMaxSize(), vertical = Alignment.Top, items = listOf(
    {
      Column(modifier = GlanceModifier.width(112.dp).fillMaxHeight(), horizontalAlignment = d.startH) {
        DRow(d, items = listOf(
          { AppMark() },
          { HGap(6.dp) },
          { if (f.now) Pill(x.now, d) else T(x.nextLecture, d, size = 11.sp, color = Pal.muted, medium = true) },
        ))
        Box(GlanceModifier.defaultWeight()) {}
        if (f.now) T(x.endsIn, d, size = 11.sp, color = Pal.muted)
        Big(f, x, d, 40)
        T(if (f.now) x.until(x.clock(l.end)) else x.starts(x.clock(l.start)), d, size = 11.sp, color = Pal.muted)
        Gap(4.dp)
        Progress(f.progress)
      }
    },
    { HGap(12.dp) },
    { VDivider() },
    { HGap(12.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight(), horizontalAlignment = d.startH) {
        T(l.name, d, size = 16.sp, bold = true, lines = 2, modifier = GlanceModifier.fillMaxWidth())
        T(listOf(l.code, if (l.section.isNotEmpty()) "${x.section} ${l.section}" else "", l.kind).filter { it.isNotEmpty() }.joinToString(" · "), d, size = 11.sp, color = Pal.faint, modifier = GlanceModifier.fillMaxWidth())
        if (l.room.isNotEmpty()) MetaLine(R.drawable.qw_pin, l.room, d)
        if (l.instructor.isNotEmpty()) MetaLine(R.drawable.qw_user, l.instructor, d)
        Box(GlanceModifier.defaultWeight()) {}
        f.after?.let { a ->
          HDivider()
          Gap(4.dp)
          DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
            { T(x.then, d, size = 11.sp, color = Pal.accent, bold = true) },
            { HGap(6.dp) },
            { Dot(Pal.bar(a.bar)) },
            { HGap(6.dp) },
            { T("${a.name} · ${ltr(x.clock(a.start))}", d, size = 11.sp, color = Pal.muted, modifier = GlanceModifier.defaultWeight()) },
          ))
        }
      }
    },
  ))
}

@Composable
private fun MetaLine(icon: Int, text: String, d: Dir) {
  DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
    { Icon(icon, 13.dp, Pal.faint) },
    { HGap(6.dp) },
    { T(text, d, size = 12.sp, color = Pal.muted, modifier = GlanceModifier.defaultWeight()) },
  ))
}
