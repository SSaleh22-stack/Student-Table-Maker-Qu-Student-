package net.qustudent.widgets

import java.time.LocalDate
import java.time.LocalDateTime

/** Widget text in the app's language (Arabic or English), with Western digits like the app. */
class Txt(val ar: Boolean) {
  private fun t(a: String, e: String) = if (ar) a else e

  val nextLecture get() = t("المحاضرة القادمة", "Next lecture")
  val now get() = t("الآن", "Now")
  val endsIn get() = t("تنتهي بعد", "Ends in")
  val then get() = t("بعدها", "Then")
  val noLectures get() = t("لا محاضرات متبقية اليوم", "No more lectures today")
  val addTimetable get() = t("أضف جدولك من التطبيق", "Add your timetable in the app")
  val tomorrow get() = t("غدًا", "Tomorrow")
  val yesterday get() = t("أمس", "Yesterday")
  val myTasks get() = t("مهامي", "My tasks")
  val today get() = t("اليوم", "Today")
  val upcoming get() = t("القادمة", "Upcoming")
  val noDate get() = t("بدون تاريخ", "No date")
  val noTasks get() = t("لا مهام متبقية", "No tasks left")
  val newTask get() = t("مهمة جديدة", "New task")
  val overdue get() = t("متأخرة", "Overdue")
  val section get() = t("شعبة", "Section")

  fun starts(time: String) = t("تبدأ ", "Starts ") + ltr(time)
  fun until(time: String) = t("حتى ", "Until ") + ltr(time)

  fun dayName(key: String): String = when (key) {
    "Sun" -> t("الأحد", "Sunday")
    "Mon" -> t("الاثنين", "Monday")
    "Tue" -> t("الثلاثاء", "Tuesday")
    "Wed" -> t("الأربعاء", "Wednesday")
    "Thu" -> t("الخميس", "Thursday")
    "Fri" -> t("الجمعة", "Friday")
    else -> t("السبت", "Saturday")
  }

  private val monthsAr = listOf("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر")
  private val monthsEn = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

  /** "22 نوفمبر" / "Nov 22" */
  fun date(d: LocalDate): String =
    if (ar) "${d.dayOfMonth} ${monthsAr[d.monthValue - 1]}" else "${monthsEn[d.monthValue - 1]} ${d.dayOfMonth}"

  fun lectures(n: Int): String = if (!ar) (if (n == 1) "1 lecture" else "$n lectures") else when {
    n == 1 -> "محاضرة واحدة"
    n == 2 -> "محاضرتان"
    n in 3..10 -> "$n محاضرات"
    else -> "$n محاضرة"
  }

  fun left(n: Int, total: Int) = t("$n من $total متبقية", "$n of $total left")
  fun more(n: Int) = t("+$n أخرى", "+$n more")

  fun group(g: TaskGroup) = when (g) {
    TaskGroup.OVERDUE -> overdue
    TaskGroup.TODAY -> today
    TaskGroup.NO_DATE -> noDate
    TaskGroup.UPCOMING -> upcoming
  }

  /** "19 د", "1 س 20 د" / "19 min", "1 h 20 min" */
  fun duration(mins: Int): String {
    if (mins < 60) return t("$mins د", "$mins min")
    val h = mins / 60
    val m = mins % 60
    return if (m == 0) t("$h س", "$h h") else t("$h س $m د", "$h h $m min")
  }

  fun inDuration(mins: Int) = t("بعد ", "in ") + duration(mins)

  /** The big countdown: the number and its unit ("19" + "دقيقة", "1:20" + "ساعة"). */
  fun bigCountdown(mins: Int): Pair<String, String> {
    if (mins < 60) return mins.toString() to (if (!ar) "min" else if (mins in 3..10) "دقائق" else "دقيقة")
    return "${mins / 60}:${(mins % 60).toString().padStart(2, '0')}" to t("ساعة", "hr")
  }

  /** "10:00" (12-hour clock, no AM/PM: how students read class times) */
  fun clock(minuteOfDay: Int): String {
    val h = (minuteOfDay / 60) % 24
    val h12 = if (h % 12 == 0) 12 else h % 12
    return "$h12:${(minuteOfDay % 60).toString().padStart(2, '0')}"
  }

  fun range(start: Int, end: Int) = ltr("${clock(start)}–${clock(end)}")

  /** A task's time with ص/م (AM/PM) */
  fun taskTime(hhmm: String): String {
    val p = hhmm.split(":")
    val h = p.getOrNull(0)?.toIntOrNull() ?: 0
    val m = p.getOrNull(1)?.toIntOrNull() ?: 0
    val base = clock(h * 60 + m)
    return if (h < 12) t("$base ص", "$base AM") else t("$base م", "$base PM")
  }

  /**
   * The short "when" under a task: overdue, its time today, or its day. Without `labelOverdue`
   * (rows under the متأخرة title) a late task shows when it was due instead.
   */
  fun taskWhen(task: WTask, now: LocalDateTime, labelOverdue: Boolean = true): String {
    val date = task.date ?: return ""
    if (labelOverdue && task.isOverdue(now)) return overdue
    val d = try {
      LocalDate.parse(date)
    } catch (_: Exception) {
      return ""
    }
    val today = now.toLocalDate()
    val day = when {
      d == today -> if (task.time != null) "" else this.today
      d == today.plusDays(1) -> tomorrow
      d == today.minusDays(1) -> yesterday
      d.isBefore(today.plusDays(7)) && d.isAfter(today.minusDays(7)) -> dayName(dayKey(d))
      else -> date(d)
    }
    val time = task.time?.let { taskTime(it) } ?: ""
    return listOf(day, time).filter { it.isNotEmpty() }.joinToString(" ")
  }

  companion object {
    /** Keeps times and ranges left-to-right inside Arabic text (like lib/rtl.ts ltr()). */
    fun ltr(s: String) = "⁦$s⁩"
  }
}

fun ltr(s: String) = Txt.ltr(s)
