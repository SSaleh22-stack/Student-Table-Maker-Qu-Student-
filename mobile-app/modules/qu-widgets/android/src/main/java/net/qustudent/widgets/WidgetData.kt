package net.qustudent.widgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * The snapshot written by the app (src/lib/widgets.ts) and the rules that turn it into what a
 * widget shows at a given moment: today's lectures and which one is next, and today's tasks.
 * Same rules as the app (lib/tasks.ts groupTasks 'today', calendar/classDays.ts).
 */

data class Lecture(
  val code: String,
  val name: String,
  val section: String,
  val kind: String,
  val room: String,
  val instructor: String,
  val day: String,
  /** Minutes after midnight */
  val start: Int,
  val end: Int,
  val bg: Long,
  val text: Long,
  val bar: Long,
)

data class WTask(
  val id: String,
  val title: String,
  val date: String?,
  val time: String?,
  val code: String?,
  val bar: Long?,
  val done: Boolean,
  val completedAt: String?,
  val repeat: String,
  /** A repeating task ticked on the widget: the app will move it to its next date. */
  val movedOn: Boolean = false,
)

data class NoClass(val from: String, val to: String?)

data class Snapshot(
  val ar: Boolean,
  val hasTimetable: Boolean,
  val lectures: List<Lecture>,
  val noClass: List<NoClass>,
  val tasks: List<WTask>,
)

private fun colorOf(hex: String?, fallback: Long): Long {
  if (hex == null || !hex.startsWith("#") || hex.length != 7) return fallback
  return hex.substring(1).toLongOrNull(16)?.let { 0xFF000000L or it } ?: fallback
}

private fun minutesOf(hhmm: String): Int {
  val p = hhmm.split(":")
  return (p.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0)
}

private fun JSONObject.str(key: String): String? = if (has(key) && !isNull(key)) optString(key).ifEmpty { null } else null

object WidgetStore {
  private const val PREFS = "qu_widgets"
  private const val SNAPSHOT = "snapshot"
  private const val PENDING = "pendingToggles"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun saveSnapshot(c: Context, json: String) {
    prefs(c).edit().putString(SNAPSHOT, json).apply()
  }

  @Synchronized
  fun takePending(c: Context): String {
    val json = prefs(c).getString(PENDING, null) ?: "[]"
    prefs(c).edit().remove(PENDING).commit()
    return json
  }

  @Synchronized
  fun addPending(c: Context, id: String, done: Boolean, date: String?) {
    val list = try {
      JSONArray(prefs(c).getString(PENDING, null) ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }
    list.put(
      JSONObject()
        .put("id", id)
        .put("done", done)
        .put("date", date ?: JSONObject.NULL)
        .put("at", Instant.now().toString()),
    )
    prefs(c).edit().putString(PENDING, list.toString()).commit()
  }

  /** The app's snapshot with the widget ticks the app has not picked up yet laid over it. */
  fun load(c: Context): Snapshot? {
    val raw = prefs(c).getString(SNAPSHOT, null) ?: return null
    val snap = try {
      parse(JSONObject(raw))
    } catch (_: Exception) {
      return null
    }
    val pending = try {
      JSONArray(prefs(c).getString(PENDING, null) ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }
    if (pending.length() == 0) return snap
    val tasks = snap.tasks.toMutableList()
    for (i in 0 until pending.length()) {
      val p = pending.optJSONObject(i) ?: continue
      val id = p.optString("id")
      val done = p.optBoolean("done")
      val at = p.optString("at").ifEmpty { Instant.now().toString() }
      val idx = tasks.indexOfFirst { it.id == id }
      if (idx < 0) continue
      val t = tasks[idx]
      tasks[idx] = when {
        done && t.repeat != "none" && t.date != null -> t.copy(movedOn = true, completedAt = at)
        done -> t.copy(done = true, completedAt = at)
        else -> t.copy(done = false, completedAt = null, movedOn = false)
      }
    }
    return snap.copy(tasks = tasks)
  }

  private fun parse(o: JSONObject): Snapshot {
    val lectures = mutableListOf<Lecture>()
    o.optJSONArray("lectures")?.let { a ->
      for (i in 0 until a.length()) {
        val l = a.optJSONObject(i) ?: continue
        lectures += Lecture(
          code = l.optString("code"),
          name = l.optString("name"),
          section = l.optString("section"),
          kind = l.optString("kind"),
          room = l.optString("room"),
          instructor = l.optString("instructor"),
          day = l.optString("day"),
          start = minutesOf(l.optString("start")),
          end = minutesOf(l.optString("end")),
          bg = colorOf(l.str("bg"), 0xFFE5E9F2),
          text = colorOf(l.str("text"), 0xFF334155),
          bar = colorOf(l.str("bar"), 0xFF64748B),
        )
      }
    }
    val noClass = mutableListOf<NoClass>()
    o.optJSONArray("noClass")?.let { a ->
      for (i in 0 until a.length()) {
        val r = a.optJSONObject(i) ?: continue
        val from = r.str("from") ?: continue
        noClass += NoClass(from, r.str("to"))
      }
    }
    val tasks = mutableListOf<WTask>()
    o.optJSONArray("tasks")?.let { a ->
      for (i in 0 until a.length()) {
        val t = a.optJSONObject(i) ?: continue
        tasks += WTask(
          id = t.optString("id"),
          title = t.optString("title"),
          date = t.str("date"),
          time = t.str("time"),
          code = t.str("code"),
          bar = t.str("bar")?.let { colorOf(it, 0xFF64748B) },
          done = t.optBoolean("done"),
          completedAt = t.str("completedAt"),
          repeat = t.str("repeat") ?: "none",
        )
      }
    }
    return Snapshot(
      ar = o.optString("lang", "ar") != "en",
      hasTimetable = o.optBoolean("hasTimetable"),
      lectures = lectures.sortedBy { it.start },
      noClass = noClass,
      tasks = tasks,
    )
  }
}

// ---------- lectures ----------

enum class LState { DONE, NOW, NEXT, LATER }

data class DayLecture(val lecture: Lecture, val state: LState)

fun dayKey(d: LocalDate): String = when (d.dayOfWeek) {
  DayOfWeek.SUNDAY -> "Sun"
  DayOfWeek.MONDAY -> "Mon"
  DayOfWeek.TUESDAY -> "Tue"
  DayOfWeek.WEDNESDAY -> "Wed"
  DayOfWeek.THURSDAY -> "Thu"
  DayOfWeek.FRIDAY -> "Fri"
  else -> "Sat"
}

fun Snapshot.isNoClassDay(d: LocalDate): Boolean {
  val k = d.toString()
  return noClass.any { k >= it.from && (it.to == null || k <= it.to) }
}

fun Snapshot.lecturesOn(d: LocalDate): List<Lecture> =
  if (isNoClassDay(d)) emptyList() else lectures.filter { it.day == dayKey(d) }.sortedBy { it.start }

/** Today's lectures with their state at `now`. */
fun Snapshot.today(now: LocalDateTime): List<DayLecture> {
  val m = now.hour * 60 + now.minute
  var nextGiven = false
  return lecturesOn(now.toLocalDate()).map { l ->
    val state = when {
      l.end <= m -> LState.DONE
      l.start <= m -> LState.NOW
      !nextGiven -> { nextGiven = true; LState.NEXT }
      else -> LState.LATER
    }
    DayLecture(l, state)
  }
}

/** The next day (after today, within two weeks) that has lectures, with its first lecture. */
fun Snapshot.nextStudyDay(now: LocalDateTime): Pair<LocalDate, Lecture>? {
  var d = now.toLocalDate().plusDays(1)
  repeat(14) {
    lecturesOn(d).firstOrNull()?.let { return d to it }
    d = d.plusDays(1)
  }
  return null
}

/** Whole minutes from `now` until `minuteOfDay` today (rounded up, so 9:41:20 → 10:00 is 19). */
fun minutesUntil(now: LocalDateTime, minuteOfDay: Int): Int {
  val secs = minuteOfDay * 60 - (now.hour * 3600 + now.minute * 60 + now.second)
  return maxOf(0, (secs + 59) / 60)
}

/** When the widgets should be drawn again: every minute near a lecture, else at the next change. */
fun nextRefresh(s: Snapshot?, now: LocalDateTime): LocalDateTime {
  val midnight = now.toLocalDate().plusDays(1).atStartOfDay()
  if (s == null) return midnight
  val m = now.hour * 60 + now.minute
  val today = s.lecturesOn(now.toLocalDate())
  val minuteTicks = today.any { (it.start <= m && m < it.end) || (it.start > m && it.start - m <= 60) }
  if (minuteTicks) return now.withSecond(0).withNano(0).plusMinutes(1)
  val marks = today.flatMap { listOf(it.start - 60, it.start, it.end) }.filter { it > m }
  val next = marks.minOrNull() ?: return midnight
  return now.toLocalDate().atStartOfDay().plusMinutes(next.toLong())
}

// ---------- tasks ----------

data class TaskDay(
  /** Overdue, then today's, then the ones without a date, then those finished today (struck through). */
  val today: List<WTask>,
  val upcoming: List<WTask>,
  val doneCount: Int,
  val total: Int,
)

private fun localDayOf(iso: String?): String? = try {
  if (iso == null) null else Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate().toString()
} catch (_: Exception) {
  null
}

private fun WTask.dueAt(): LocalDateTime? {
  val d = try {
    LocalDate.parse(date ?: return null)
  } catch (_: Exception) {
    return null
  }
  val t = time
  return if (t != null) d.atStartOfDay().plusMinutes(minutesOf(t).toLong()) else d.plusDays(1).atStartOfDay()
}

fun WTask.isOverdue(now: LocalDateTime): Boolean = !done && !movedOn && (dueAt()?.isBefore(now) ?: false)

private val bySoonest = compareBy<WTask>({ it.date ?: "9999-99-99" }, { it.time ?: "99:99" })

fun Snapshot.taskDay(now: LocalDateTime): TaskDay {
  val today = now.toLocalDate().toString()
  val open = tasks.filter { !it.done && !it.movedOn }
  val overdue = open.filter { it.isOverdue(now) }.sortedWith(bySoonest)
  val onTime = open.filter { !it.isOverdue(now) }
  val dueToday = onTime.filter { it.date == today }.sortedWith(bySoonest)
  val noDate = onTime.filter { it.date == null }
  val doneToday = tasks.filter { t ->
    t.done && (t.date == today || (localDayOf(t.completedAt) == today && (t.date == null || t.date < today)))
  }
  // Repeating tasks finished today moved on to a later date: only completedAt tells.
  val repeatDone = tasks.count { t ->
    !t.done && t.repeat != "none" && (t.movedOn || localDayOf(t.completedAt) == today)
  }
  val upcoming = onTime.filter { it.date != null && it.date > today && !it.movedOn }.sortedWith(bySoonest)
  val list = overdue + dueToday + noDate + doneToday
  val doneCount = doneToday.size + repeatDone
  return TaskDay(list, upcoming, doneCount, overdue.size + dueToday.size + noDate.size + doneCount)
}
