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
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import java.time.LocalDateTime

/**
 * مهامي: every open task (overdue, today, no date, then the nearest dates) in a list that scrolls,
 * ticked off from the widget. The big widget (4×4 and up) shows the groups under their titles.
 */
class TasksWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(TASK_SIZES)

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      // A running session is not started again by update(): the version (Ticker.redraw) is what
      // makes it read the snapshot and the time again.
      val version = currentState(DataVersion) ?: 0L
      val snap = remember(version) { WidgetStore.load(context) }
      val now = remember(version) { LocalDateTime.now() }
      TasksContent(snap, now)
    }
  }
}

class TasksWidgetReceiver : TickingReceiver() {
  override val glanceAppWidget = TasksWidget()
}

/**
 * The list scrolls, so the size only picks the look: narrow, wide, or big with group titles. Each
 * size is drawn in full (every row), so there are as few as that needs.
 */
private val TASK_SIZES = setOf(DpSize(150.dp, 80.dp), DpSize(250.dp, 80.dp), DpSize(250.dp, 250.dp))

/**
 * Rows in the list. The whole list goes to the home screen in one go, which has a size limit, so a
 * very long one ends with "+N أخرى" (opens the app).
 */
private const val MAX_ROWS = 40

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
    val task = WidgetStore.load(context)?.tasks?.firstOrNull { it.id == id }
    // A tap on a row the widget has not redrawn yet (the tick is already in): nothing to do.
    if (task != null && (task.done == done || task.date != date)) {
      Ticker.redraw(context, TasksWidget())
      return
    }
    WidgetStore.addPending(context, id, done, date)
    if (done) {
      // A repeating task keeps its daily or weekly reminder (the app moves it on when it opens).
      val repeats = task != null && task.repeat != "none" && task.date != null
      cancelReminders(context, if (repeats) listOf("task-$id-snooze") else listOf("task-$id", "task-$id-snooze"))
    }
    Ticker.redraw(context, TasksWidget())
  }
}

/** Cancels reminders scheduled by expo-notifications as "task-<id>" (lib/reminders.ts). */
private fun cancelReminders(context: Context, ids: List<String>) {
  try {
    val cls = Class.forName("expo.modules.notifications.service.NotificationsService")
    val companion = cls.getField("Companion").get(null) ?: return
    val method = companion.javaClass.getMethod(
      "removeScheduledNotifications",
      Context::class.java,
      Collection::class.java,
      android.os.ResultReceiver::class.java,
    )
    method.invoke(companion, context, ids, null)
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
  val list = s?.taskList(now) ?: TaskList(emptyList())
  val wide = size.width >= 250.dp
  val tall = size.height >= 250.dp
  Card(openApp(context, "tasks")) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Header(x, d, wide)
      Gap(if (tall) 10.dp else 8.dp)
      if (list.all.isEmpty()) {
        Box(GlanceModifier.fillMaxWidth().defaultWeight()) {
          Message(d, R.drawable.qw_check_circle, x.noTasks, null, big = tall)
        }
      } else {
        TaskScroll(list, grouped = wide && tall, small = !wide, now, x, d, GlanceModifier.fillMaxWidth().defaultWeight())
      }
    }
  }
}

/** Every task in a list that scrolls: under the group titles on the big widget, else one list. */
@Composable
private fun TaskScroll(list: TaskList, grouped: Boolean, small: Boolean, now: LocalDateTime, x: Txt, d: Dir, modifier: GlanceModifier) {
  // A tap on a row (not its circle) opens the app, like a tap anywhere else on the widget.
  val open = openApp(LocalContext.current, "tasks")
  val hidden = (list.all.size - MAX_ROWS).coerceAtLeast(0)
  LazyColumn(modifier = modifier) {
    if (grouped) {
      var room = MAX_ROWS
      list.sections.forEachIndexed { i, sec ->
        if (room <= 0) return@forEachIndexed
        val tasks = sec.tasks.take(room)
        room -= tasks.size
        item(itemId = -1L - sec.group.ordinal) {
          T(
            x.group(sec.group), d, size = 11.sp, color = if (sec.group == TaskGroup.OVERDUE) Pal.now else Pal.accent, bold = true,
            modifier = GlanceModifier.fillMaxWidth().padding(top = if (i == 0) 0.dp else 10.dp, bottom = 2.dp),
          )
        }
        // Under the متأخرة title a row shows when it was due, not "متأخرة" again.
        items(tasks, itemId = { rowId(it) }) { t -> TaskItem(t, now, x, d, small, open, labelOverdue = sec.group != TaskGroup.OVERDUE) }
      }
    } else {
      items(list.all.take(MAX_ROWS), itemId = { rowId(it) }) { t -> TaskItem(t, now, x, d, small, open) }
    }
    if (hidden > 0) {
      item(itemId = -10L) {
        T(x.more(hidden), d, size = 11.sp, color = Pal.faint, modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp).clickable(open))
      }
    }
  }
}

/** A stable, non-negative id per task (the titles and "+N" use negative ones). */
private fun rowId(t: WTask): Long = t.id.hashCode().toLong() and 0xFFFFFFFFL

@Composable
private fun TaskItem(t: WTask, now: LocalDateTime, x: Txt, d: Dir, small: Boolean, open: Action, labelOverdue: Boolean = true) {
  Box(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp).clickable(open)) {
    TaskRow(t, now, x, d, small = small, labelOverdue = labelOverdue)
  }
}

@Composable
private fun Header(x: Txt, d: Dir, wide: Boolean) {
  val context = LocalContext.current
  DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
    { AppMark() },
    { HGap(6.dp) },
    { T(x.myTasks, d, size = 14.sp, color = if (wide) Pal.text else Pal.accent, bold = true) },
    { Box(GlanceModifier.defaultWeight()) {} },
    {
      Box(
        modifier = GlanceModifier.size(26.dp).cornerRadius(13.dp).background(Pal.accent).clickable(openApp(context, "task")),
        contentAlignment = Alignment.Center,
      ) { Icon(R.drawable.qw_plus, 16.dp, Pal.onAccent) }
    },
  ))
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
private fun TaskRow(t: WTask, now: LocalDateTime, x: Txt, d: Dir, small: Boolean, labelOverdue: Boolean = true) {
  val whenText = x.taskWhen(t, now, labelOverdue)
  DRow(d, GlanceModifier.fillMaxWidth(), items = listOf(
    { Checkbox(t) },
    { HGap(8.dp) },
    {
      Column(modifier = GlanceModifier.defaultWeight(), horizontalAlignment = d.startH) {
        T(t.title, d, size = if (small) 12.sp else 13.sp, color = if (t.done) Pal.faint else Pal.text, medium = true, strike = t.done, modifier = GlanceModifier.fillMaxWidth())
        if (t.code != null || whenText.isNotEmpty()) {
          // The due time stays whole; when space runs out the course code is shortened (it is last
          // and takes what is left), and the colored dot still tells the course.
          // Full width only with a course code (it takes the rest); otherwise the line stays at the
          // start of the row, under the title.
          DRow(d, if (t.code != null) GlanceModifier.fillMaxWidth() else GlanceModifier, items = listOf(
            { if (t.code != null) Dot(Pal.bar(t.bar ?: 0xFF64748B)) },
            { if (t.code != null) HGap(4.dp) },
            { if (whenText.isNotEmpty()) T(whenText, d, size = 10.sp, color = if (t.isOverdue(now)) Pal.now else Pal.faint) },
            { if (t.code != null && whenText.isNotEmpty()) T(" · ", d, size = 10.sp, color = Pal.faint) },
            { if (t.code != null) T(t.code, d, size = 10.sp, color = Pal.muted, bold = true, modifier = GlanceModifier.defaultWeight()) },
          ))
        }
      }
    },
  ))
}
