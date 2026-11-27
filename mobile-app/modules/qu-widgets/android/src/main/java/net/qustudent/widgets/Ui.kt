package net.qustudent.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.color.ColorProvider as DayNight

/** Every widget text is drawn this much bigger than the sizes written in the layouts. */
const val TEXT_SCALE = 1.2f

/** Colors from mobile-app/src/lib/theme.ts (light) and the dark designs in Figma. */
object Pal {
  val bg = DayNight(day = Color(0xFFFFFFFF), night = Color(0xFF18222D))
  val text = DayNight(day = Color(0xFF1B2533), night = Color(0xFFEEF3F8))
  val muted = DayNight(day = Color(0xFF4A5668), night = Color(0xFFAAB6C4))
  val faint = DayNight(day = Color(0xFF6B7686), night = Color(0xFF8794A3))
  val accent = DayNight(day = Color(0xFF0E7490), night = Color(0xFF7FD3E3))
  val onAccent = DayNight(day = Color(0xFFFFFFFF), night = Color(0xFF0B1A22))
  val soft = DayNight(day = Color(0xFFDDF0F4), night = Color(0x297FD3E3))
  val divider = DayNight(day = Color(0xFFE3E9F0), night = Color(0xFF2A3644))
  val track = DayNight(day = Color(0xFFE3E9F0), night = Color(0xFF2C3947))
  val now = DayNight(day = Color(0xFFE5484D), night = Color(0xFFFF7A7A))

  fun courseBg(l: Lecture) = DayNight(day = Color(l.bg), night = Color(l.bar).copy(alpha = 0.22f))
  fun courseText(l: Lecture) = DayNight(day = Color(l.text), night = Color(0xFFEEF3F8))
  fun bar(color: Long) = ColorProvider(Color(color))
}

/**
 * Reading direction. Widgets follow the app's language, but Android lays a widget out in the
 * phone's own direction, so rows are reversed and text aligned by hand when the two differ.
 */
class Dir(val rtl: Boolean, context: Context) {
  private val sysRtl = context.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
  val reverse = rtl != sysRtl
  val align: TextAlign = if (rtl) TextAlign.Right else TextAlign.Left
  /** The side reading starts from (right in Arabic). */
  val startH: Alignment.Horizontal = if (reverse) Alignment.End else Alignment.Start
}

/** A row whose items are given in reading order (first = right in Arabic). */
@Composable
fun DRow(
  d: Dir,
  modifier: GlanceModifier = GlanceModifier,
  vertical: Alignment.Vertical = Alignment.CenterVertically,
  items: List<@Composable RowScope.() -> Unit>,
) {
  Row(modifier = modifier, verticalAlignment = vertical) {
    (if (d.reverse) items.reversed() else items).forEach { it() }
  }
}

@Composable
fun T(
  text: String,
  d: Dir,
  size: TextUnit = 13.sp,
  color: ColorProvider = Pal.text,
  bold: Boolean = false,
  medium: Boolean = false,
  lines: Int = 1,
  strike: Boolean = false,
  center: Boolean = false,
  modifier: GlanceModifier = GlanceModifier,
) {
  Text(
    // Glance's text views take their direction from the phone's language: an isolate in the app's
    // direction keeps Arabic in the right order on an English phone (and the other way round).
    text = if (d.rtl) "\u2067$text\u2069" else "\u2066$text\u2069",
    modifier = modifier,
    maxLines = lines,
    style = TextStyle(
      color = color,
      fontSize = (size.value * TEXT_SCALE).sp,
      fontWeight = if (bold) FontWeight.Bold else if (medium) FontWeight.Medium else FontWeight.Normal,
      textAlign = if (center) TextAlign.Center else d.align,
      textDecoration = if (strike) TextDecoration.LineThrough else TextDecoration.None,
    ),
  )
}

@Composable
fun Icon(res: Int, size: Dp, color: ColorProvider) {
  Image(
    provider = ImageProvider(res),
    contentDescription = null,
    modifier = GlanceModifier.size(size),
    colorFilter = ColorFilter.tint(color),
  )
}

/** The small app mark in the corner of Android widgets. */
@Composable
fun AppMark() {
  Box(
    modifier = GlanceModifier.size(20.dp).cornerRadius(6.dp).background(Pal.accent),
    contentAlignment = Alignment.Center,
  ) { Icon(R.drawable.qw_calendar, 12.dp, Pal.onAccent) }
}

@Composable
fun Pill(text: String, d: Dir) {
  Box(
    modifier = GlanceModifier.cornerRadius(999.dp).background(Pal.accent).padding(horizontal = 8.dp, vertical = 2.dp),
  ) { T(text, d, size = 11.sp, color = Pal.onAccent, bold = true) }
}

@Composable
fun IconTile(res: Int, size: Dp) {
  Box(
    modifier = GlanceModifier.size(size).cornerRadius(size * 0.32f).background(Pal.soft),
    contentAlignment = Alignment.Center,
  ) { Icon(res, size * 0.5f, Pal.accent) }
}

@Composable
fun Dot(color: ColorProvider, size: Dp = 6.dp) {
  Box(modifier = GlanceModifier.size(size).cornerRadius(size / 2).background(color)) {}
}

@Composable
fun HDivider() {
  Box(modifier = GlanceModifier.fillMaxWidth().height(1.dp).background(Pal.divider)) {}
}

@Composable
fun VDivider() {
  Box(modifier = GlanceModifier.width(1.dp).fillMaxHeight().background(Pal.divider)) {}
}

@Composable
fun Progress(value: Float, modifier: GlanceModifier = GlanceModifier.fillMaxWidth()) {
  LinearProgressIndicator(
    progress = value.coerceIn(0f, 1f),
    modifier = modifier.height(4.dp),
    color = Pal.accent,
    backgroundColor = Pal.track,
  )
}

@Composable
fun Gap(h: Dp) = Spacer(modifier = GlanceModifier.height(h))

/** The rounded card every widget sits in. */
@Composable
fun Card(open: Action, pad: Dp = 14.dp, content: @Composable () -> Unit) {
  Box(
    modifier = GlanceModifier.fillMaxSize().cornerRadius(24.dp).background(Pal.bg).padding(pad).clickable(open),
  ) { content() }
}

/** A centered icon with a line or two of text (empty states). */
@Composable
fun Message(d: Dir, icon: Int, title: String, sub: String?, big: Boolean, extra: (@Composable () -> Unit)? = null) {
  Column(
    modifier = GlanceModifier.fillMaxSize(),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    IconTile(icon, if (big) 56.dp else 40.dp)
    Gap(8.dp)
    T(title, d, size = if (big) 17.sp else 14.sp, bold = true, lines = 2, center = true)
    if (sub != null) {
      Gap(2.dp)
      T(sub, d, size = 12.sp, color = Pal.muted, center = true)
    }
    if (extra != null) {
      Gap(8.dp)
      extra()
    }
  }
}

/** Opens a screen of the app (Expo Router path, e.g. "timetable", "tasks", "task"). */
fun openApp(context: Context, path: String): Action =
  actionStartActivity(
    Intent(Intent.ACTION_VIEW, Uri.parse("qustudent:///$path"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
  )

/** Fixed-width spacer inside a row. */
@Composable
fun HGap(w: Dp) = Spacer(modifier = GlanceModifier.width(w))

@Composable
fun FillBox(modifier: GlanceModifier = GlanceModifier.fillMaxSize(), content: @Composable () -> Unit) {
  Box(modifier = modifier) { content() }
}
