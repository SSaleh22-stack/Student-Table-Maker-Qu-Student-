package net.qustudent.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import java.time.LocalDateTime

/** مهامي: today's tasks, ticked off from the widget. 2×2, 4×2 (two columns), 4×4 (today + upcoming). */
class TasksWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(SIZES)

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snap = WidgetStore.load(context)
    val now = LocalDateTime.now()
    provideContent { TasksContent(snap, now) }
  }
}

class TasksWidgetReceiver : TickingReceiver() {
  override val glanceAppWidget = TasksWidget()
}

private val KeyId = ActionParameters.Key<String>("id")
private val KeyDone = ActionParameters.Key<Boolean>("done")
private val KeyDate = ActionParameters.Key<String>("date")

/**
 * A tap on a task's circle: kept for the app (which applies it the next time it opens), the
 * reminder of a finished task is cancelled right away, and the widgets are redrawn.
 */
class ToggleTaskAction : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val id = parameters[KeyId] ?: return
    val done = parameters[KeyDone] ?: return
    val date = parameters[KeyDate]?.ifEmpty { null }
    WidgetStore.addPending(context, id, done, date)
    if (done) cancelReminders(context, id)
    TasksWidget().updateAll(context)
  }
}

/** Cancels the task's reminders, scheduled by expo-notifications as "task-<id>" (lib/reminders.ts). */
private fun cancelReminders(context: Context, taskId: String) {
  try {
    val cls = Class.forName("expo.modules.notifications.service.NotificationsService")
    val companion = cls.getField("Companion").get(null) ?: return
    val method = companion.javaClass.getMethod(
      "removeScheduledNotifications",
      Context::class.java,
      Collection::class.java,
      android.os.ResultReceiver::class.java,
    )
    method.invoke(companion, context, listOf("task-$taskId", "task-$taskId-snooze"), null)
  } catch (_: Throwable) {
    // The app resyncs every reminder the next time it opens.
  }
}

@Composable
private fun TasksContent(s: Snapshot?, now: LocalDateTime) {
  val context = LocalContext.current
  val size = LocalSize.current
  val x = Txt(s?.ar ?: true)
  val d = Dir(s?.ar ?: true, context)
  val day = s?.taskDay(now) ?: TaskDay(emptyList(), emptyList(), 0, 0)
  val wide = size.width >= 250.dp
  val tall = size.height >= 250.dp
  val open = day.today.filter { !it.done }
  Card(openApp(context, "tasks")) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Header(day, x, d, wide)
      if (wide) {
        Gap(8.dp)
        Progress(if (day.total == 0) 0f else day.doneCount.toFloat() / day.total)
      }
      Gap(8.dp)
      when {
        open.isEmpty() && !tall -> Box(GlanceModifier.fillMaxWidth().defaultWeight()) {
          Message(d, R.drawable.qw_check_circle, if (day.doneCount > 0) x.allDone else x.nothingToday,
            if (wide && day.upcoming.isNotEmpty()) x.upcomingCount(day.upcoming.size) else null, big = false)
        }
        open.isEmpty() -> {
          Box(GlanceModifier.fillMaxWidth().defaultWeight()) {
            Message(d, R.drawable.qw_check_circle, if (day.doneCount > 0) x.allDone else x.nothingToday,
              if (day.upcoming.isNotEmpty()) x.upcomingCount(day.upcoming.size) else null, big = true)
          }
          if (day.upcoming.isNotEmpty()) Upcoming(day, now, x, d, 2)
        }
        !wide -> Column(GlanceModifier.fillMaxWidth()) {
          open.take(if (size.height >= 170.dp) 3 else 2).forEachIndexed { i, t ->
            if (i > 0) Gap(8.dp)
            TaskRow(t, now, x, d, small = true)
          }
        }
        !tall -> {
          val list = day.today.take(4)
          DRow(d, GlanceModifier.fillMaxWidth(), vertical = Alignment.Top, items = listOf(
            { TaskColumn(list.take(2), now, x, d, GlanceModifier.defaultWeight()) },
            { HGap(12.dp) },
            { TaskColumn(list.drop(2), now, x, d, GlanceModifier.defaultWeight()) },
          ))
        }
        else -> {
          Column(modifier = GlanceModifier.fillMaxWidth()) {
            T(x.today, d, size = 11.sp, color = Pal.accent, bold = true, modifier = GlanceModifier.fillMaxWidth())
            Gap(4.dp)
            TaskColumn(day.today.take(4), now, x, d, GlanceModifier.fillMaxWidth())
          }
          if (day.upcoming.isNotEmpty()) {
            Gap(8.dp)
            Upcoming(day, now, x, d, 2)
          }
        }
      }
    }
  }
}

@Composable
private fun Header(day: TaskDay, x: Txt, d: Dir, wide: Boolean) {
  val context = LocalContext.current
  DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
    { AppMark() },
    { HGap(6.dp) },
    { T(x.myTasks, d, size = 14.sp, color = if (wide) Pal.text else Pal.accent, bold = true) },
    { if (wide) { HGap(4.dp); T(x.today, d, size = 12.sp, color = Pal.muted) } },
    { Box(GlanceModifier.defaultWeight()) {} },
    { if (wide && day.total > 0) { T(x.doneOf(day.doneCount, day.total), d, size = 11.sp, color = Pal.faint); HGap(8.dp) } },
    {
      Box(
        modifier = GlanceModifier.size(26.dp).cornerRadius(13.dp).background(Pal.accent).clickable(openApp(context, "task")),
        contentAlignment = Alignment.Center,
      ) { Icon(R.drawable.qw_plus, 16.dp, Pal.onAccent) }
    },
  ))
}

@Composable
private fun Upcoming(day: TaskDay, now: LocalDateTime, x: Txt, d: Dir, max: Int) {
  Column(modifier = GlanceModifier.fillMaxWidth()) {
    HDivider()
    Gap(6.dp)
    T(x.upcoming, d, size = 11.sp, color = Pal.accent, bold = true, modifier = GlanceModifier.fillMaxWidth())
    Gap(4.dp)
    TaskColumn(day.upcoming.take(max), now, x, d, GlanceModifier.fillMaxWidth())
    if (day.upcoming.size > max) T(x.more(day.upcoming.size - max), d, size = 11.sp, color = Pal.faint, modifier = GlanceModifier.fillMaxWidth())
  }
}

@Composable
private fun TaskColumn(list: List<WTask>, now: LocalDateTime, x: Txt, d: Dir, modifier: GlanceModifier) {
  Column(modifier = modifier) {
    list.forEachIndexed { i, t ->
      if (i > 0) Gap(8.dp)
      TaskRow(t, now, x, d, small = false)
    }
  }
}

@Composable
private fun Checkbox(t: WTask) {
  val toggle = actionRunCallback<ToggleTaskAction>(
    actionParametersOf(KeyId to t.id, KeyDone to !t.done, KeyDate to (t.date ?: "")),
  )
  if (t.done) {
    Box(
      modifier = GlanceModifier.size(20.dp).cornerRadius(10.dp).background(Pal.accent).clickable(toggle),
      contentAlignment = Alignment.Center,
    ) { Icon(R.drawable.qw_check, 13.dp, Pal.onAccent) }
  } else {
    Box(
      modifier = GlanceModifier.size(20.dp).cornerRadius(10.dp).background(Pal.faint).padding(2.dp).clickable(toggle),
      contentAlignment = Alignment.Center,
    ) { Box(GlanceModifier.fillMaxSize().cornerRadius(8.dp).background(Pal.bg)) {} }
  }
}

@Composable
private fun TaskRow(t: WTask, now: LocalDateTime, x: Txt, d: Dir, small: Boolean) {
  val whenText = x.taskWhen(t, now)
  DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
    { Checkbox(t) },
    { HGap(8.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
        T(t.title, d, size = if (small) 12.sp else 13.sp, color = if (t.done) Pal.faint else Pal.text, medium = true, strike = t.done, modifier = GlanceModifier.fillMaxWidth())
        if (t.code != null || whenText.isNotEmpty()) {
          DRow(d, items = listOf(
            { if (t.code != null) { Dot(Pal.bar(t.bar ?: 0xFF64748B)); HGap(4.dp); T(t.code, d, size = 10.sp, color = Pal.muted, bold = true) } },
            { if (t.code != null && whenText.isNotEmpty()) T(" · ", d, size = 10.sp, color = Pal.faint) },
            { if (whenText.isNotEmpty()) T(whenText, d, size = 10.sp, color = if (t.isOverdue(now)) Pal.now else Pal.faint) },
          ))
        }
      }
    },
  ))
}
