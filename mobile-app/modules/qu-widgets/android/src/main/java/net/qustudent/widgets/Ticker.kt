package net.qustudent.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Keeps the widgets current without the app: an alarm redraws them every minute while a lecture
 * is on or starts within the hour (the countdown), otherwise when the next lecture starts or ends,
 * and at midnight. The alarm is not a wake-up alarm, so a sleeping phone is not woken for it; the
 * widgets catch up when the screen comes on. Widget hosts also ask for an update every 30 minutes.
 */
object Ticker {
  private const val ACTION = "net.qustudent.widgets.TICK"
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  private fun pending(c: Context): PendingIntent =
    PendingIntent.getBroadcast(
      c, 4711,
      Intent(c, TickReceiver::class.java).setAction(ACTION),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  fun hasWidgets(c: Context): Boolean {
    val m = AppWidgetManager.getInstance(c) ?: return false
    return listOf(TimetableWidgetReceiver::class.java, TasksWidgetReceiver::class.java, CountdownWidgetReceiver::class.java)
      .any { m.getAppWidgetIds(ComponentName(c, it)).isNotEmpty() }
  }

  fun schedule(c: Context) {
    val am = c.getSystemService(AlarmManager::class.java) ?: return
    val pi = pending(c)
    if (!hasWidgets(c)) {
      am.cancel(pi)
      return
    }
    val next = nextRefresh(WidgetStore.load(c), LocalDateTime.now())
    val at = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
    am.set(AlarmManager.RTC, maxOf(at, System.currentTimeMillis() + 15_000), pi)
  }

  suspend fun redrawAll(c: Context) {
    TimetableWidget().updateAll(c)
    TasksWidget().updateAll(c)
    CountdownWidget().updateAll(c)
  }

  /** Redraws every widget and schedules the next redraw (from the app or a broadcast). */
  fun refresh(c: Context, done: (() -> Unit)? = null) {
    val app = c.applicationContext
    scope.launch {
      try {
        redrawAll(app)
        schedule(app)
      } catch (_: Throwable) {
        // A widget failing to redraw must never crash the app.
      } finally {
        done?.invoke()
      }
    }
  }
}

class TickReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val result = goAsync()
    Ticker.refresh(context) { result.finish() }
  }
}

/** A widget receiver that also keeps the redraw alarm going while any widget is on screen. */
abstract class TickingReceiver : GlanceAppWidgetReceiver() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    super.onUpdate(context, appWidgetManager, appWidgetIds)
    Ticker.schedule(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    Ticker.schedule(context)
  }
}
