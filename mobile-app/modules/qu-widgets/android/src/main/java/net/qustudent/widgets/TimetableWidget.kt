package net.qustudent.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.currentState
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import java.time.LocalDateTime

/** الجدول: today's lectures. 2×2 (next lecture card), 4×2 (day + list), 4×4 (timeline). */
class TimetableWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(SIZES + DpSize(250.dp, 280.dp) + DpSize(250.dp, 300.dp))

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      // A running session is not started again by update(): the version (Ticker.redraw) is what
      // makes it read the snapshot and the time again.
      val version = currentState(DataVersion) ?: 0L
      val snap = remember(version) { WidgetStore.load(context) }
      val now = remember(version) { LocalDateTime.now() }
      TimetableContent(snap, now)
    }
  }
}

class TimetableWidgetReceiver : TickingReceiver() {
  override val glanceAppWidget = TimetableWidget()
}

@Composable
private fun TimetableContent(s: Snapshot?, now: LocalDateTime) {
  val context = LocalContext.current
  val size = LocalSize.current
  val x = Txt(s?.ar ?: true)
  val d = Dir(s?.ar ?: true, context)
  Card(openApp(context, "timetable")) {
    val day = s?.today(now).orEmpty()
    val left = day.filter { it.state != LState.DONE }
    when {
      s == null || !s.hasTimetable -> Message(d, R.drawable.qw_calendar, x.addTimetable, null, big = size.height >= 250.dp)
      left.isEmpty() -> Message(
        d, R.drawable.qw_calendar_check, x.noLectures,
        x.dayName(dayKey(now.toLocalDate())) + " " + x.date(now.toLocalDate()),
        big = size.width >= 250.dp && size.height >= 170.dp,
      )
      size.width < 250.dp -> Small(s, day, now, x, d)
      size.height < 250.dp -> Medium(day, now, x, d)
      else -> Large(s, day, now, x, d)
    }
  }
}

private fun pillFor(l: DayLecture, now: LocalDateTime, x: Txt): String? = when (l.state) {
  LState.NOW -> x.now
  LState.NEXT -> x.inDuration(minutesUntil(now, l.lecture.start))
  else -> null
}

@Composable
private fun Small(s: Snapshot, day: List<DayLecture>, now: LocalDateTime, x: Txt, d: Dir) {
  val left = day.filter { it.state != LState.DONE }
  val first = left.first()
  val l = first.lecture
  Column(modifier = GlanceModifier.fillMaxSize()) {
    // No app mark here: the day name needs the room beside the pill.
    DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
      { T(x.dayName(dayKey(now.toLocalDate())), d, size = 13.sp, color = Pal.accent, bold = true, modifier = GlanceModifier.defaultWeight()) },
      { pillFor(first, now, x)?.let { Pill(it, d) } },
    ))
    Gap(8.dp)
    Column(
      modifier = GlanceModifier.fillMaxWidth().cornerRadius(14.dp).background(Pal.courseBg(l)).padding(10.dp),
      horizontalAlignment = d.startH,
    ) {
      T(l.name, d, size = 14.sp, color = Pal.courseText(l), bold = true, lines = 2, modifier = GlanceModifier.fillMaxWidth())
      // Time and room on one line, so two more lectures still fit under a two-line name.
      T(x.range(l.start, l.end) + if (l.room.isNotEmpty()) " · " + l.room else "", d, size = 11.sp, color = Pal.courseText(l), modifier = GlanceModifier.fillMaxWidth())
    }
    // One more lecture under the card: two no longer fit a 2×2 at the widget text size.
    for (o in left.drop(1).take(1)) {
      Gap(6.dp)
      DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
        { Dot(Pal.bar(o.lecture.bar)) },
        { HGap(6.dp) },
        { T(o.lecture.name, d, size = 11.sp, medium = true, modifier = GlanceModifier.defaultWeight()) },
        { HGap(6.dp) },
        { T(ltr(x.clock(o.lecture.start)), d, size = 11.sp, color = Pal.muted, bold = true) },
      ))
    }
  }
}

@Composable
private fun LectureRow(dl: DayLecture, pill: String?, x: Txt, d: Dir) {
  val l = dl.lecture
  val hl = pill != null
  val mod = if (hl) {
    GlanceModifier.fillMaxWidth().cornerRadius(10.dp).background(Pal.courseBg(l)).padding(horizontal = 8.dp, vertical = 6.dp)
  } else GlanceModifier.fillMaxWidth()
  val meta = x.range(l.start, l.end) + if (l.room.isNotEmpty()) " · " + l.room else ""
  DRow(d, mod, items = listOf(
    { Box(GlanceModifier.width(3.dp).height(32.dp).cornerRadius(2.dp).background(Pal.bar(l.bar))) {} },
    { HGap(8.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
        T(l.name, d, size = 13.sp, color = if (hl) Pal.courseText(l) else Pal.text, bold = true, modifier = GlanceModifier.fillMaxWidth())
        T(meta, d, size = 11.sp, color = if (hl) Pal.courseText(l) else Pal.muted, modifier = GlanceModifier.fillMaxWidth())
      }
    },
    { if (pill != null) HGap(6.dp) },
    { if (pill != null) Pill(pill, d) },
  ))
}

@Composable
private fun Medium(day: List<DayLecture>, now: LocalDateTime, x: Txt, d: Dir) {
  val left = day.filter { it.state != LState.DONE }
  DRow(d, GlanceModifier.fillMaxSize(), vertical = Alignment.Top, items = listOf(
    {
      Column(modifier = GlanceModifier.width(78.dp).fillMaxHeight(), horizontalAlignment = d.startH) {
        AppMark()
        Gap(4.dp)
        T(x.dayName(dayKey(now.toLocalDate())), d, size = 16.sp, bold = true)
        T(x.date(now.toLocalDate()), d, size = 12.sp, color = Pal.muted)
        Box(GlanceModifier.defaultWeight()) {}
        T(x.left(left.size, day.size), d, size = 10.sp, color = Pal.faint, lines = 2)
      }
    },
    { HGap(10.dp) },
    { VDivider() },
    { HGap(10.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight()) {
        left.take(3).forEachIndexed { i, dl ->
          if (i > 0) Gap(6.dp)
          LectureRow(dl, if (i == 0) pillFor(dl, now, x) else null, x, d)
        }
      }
    },
  ))
}

@Composable
private fun TimelineRow(dl: DayLecture, now: LocalDateTime, x: Txt, d: Dir) {
  val l = dl.lecture
  val done = dl.state == LState.DONE
  val pill = pillFor(dl, now, x)
  DRow(d, GlanceModifier.fillMaxWidth(), vertical = Alignment.Top, items = listOf(
    {
      Column(modifier = GlanceModifier.width(40.dp), horizontalAlignment = d.startH) {
        T(ltr(x.clock(l.start)), d, size = 12.sp, color = if (done) Pal.faint else Pal.text, bold = true)
        T(ltr(x.clock(l.end)), d, size = 10.sp, color = Pal.faint)
      }
    },
    { HGap(8.dp) },
    {
      val bg = if (done) Pal.track else Pal.courseBg(l)
      val fg = if (done) Pal.faint else Pal.courseText(l)
      DRow(d, GlanceModifier.defaultWeight().cornerRadius(12.dp).background(bg).padding(horizontal = 10.dp, vertical = 6.dp), items = listOf(
        {
          Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
            T(l.name, d, size = 13.sp, color = fg, bold = true, modifier = GlanceModifier.fillMaxWidth())
            T(listOf(l.room, l.kind).filter { it.isNotEmpty() }.joinToString(" · "), d, size = 11.sp, color = fg, modifier = GlanceModifier.fillMaxWidth())
          }
        },
        { if (pill != null) HGap(6.dp) },
        { if (pill != null) Pill(pill, d) },
      ))
    },
  ))
}

@Composable
private fun Large(s: Snapshot, day: List<DayLecture>, now: LocalDateTime, x: Txt, d: Dir) {
  val today = now.toLocalDate()
  Column(modifier = GlanceModifier.fillMaxSize()) {
    DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
      { AppMark() },
      { HGap(8.dp) },
      {
        Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
          T(x.dayName(dayKey(today)), d, size = 20.sp, bold = true)
          T(x.date(today) + " · " + x.lectures(day.size), d, size = 12.sp, color = Pal.muted)
        }
      },
    ))
    Gap(8.dp)
    Column(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
      // As many lectures as the height holds at the widget text size (4 from 300dp, 3 from 280dp,
      // else 2; Glance allows 10 children per column): the first ones still to come, with the last
      // finished one above the "now" line.
      val h = LocalSize.current.height
      val rows = if (h >= 300.dp) 4 else if (h >= 280.dp) 3 else 2
      val doneCount = day.count { it.state == LState.DONE }
      val startAt = maxOf(0, minOf(doneCount - 1, day.size - rows))
      day.drop(startAt).take(rows).forEachIndexed { i, dl ->
        if (i > 0) Gap(6.dp)
        TimelineRow(dl, now, x, d)
        val nextIdx = startAt + i + 1
        if (dl.state == LState.DONE && (nextIdx >= day.size || day[nextIdx].state != LState.DONE)) {
          Gap(4.dp)
          Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(GlanceModifier.fillMaxWidth().height(2.dp).cornerRadius(1.dp).background(Pal.now)) {}
          }
        }
      }
    }
    s.nextStudyDay(now)?.let { (date, first) ->
      HDivider()
      Gap(6.dp)
      val label = if (date == today.plusDays(1)) x.tomorrow else x.dayName(dayKey(date))
      DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
        { Icon(R.drawable.qw_calendar, 13.dp, Pal.faint) },
        { HGap(6.dp) },
        { T("$label: ${first.name} · ${ltr(x.clock(first.start))}", d, size = 11.sp, color = Pal.muted, modifier = GlanceModifier.defaultWeight()) },
      ))
    }
  }
}

/** The layouts switch at 250dp wide and 250dp tall, so the sizes start there too. */
internal val SIZES = setOf(
  DpSize(150.dp, 80.dp),
  DpSize(150.dp, 170.dp),
  DpSize(250.dp, 80.dp),
  DpSize(250.dp, 170.dp),
  DpSize(250.dp, 250.dp),
)
