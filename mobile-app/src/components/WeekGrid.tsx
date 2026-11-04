import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { activityLabel, dayName, getCourseTheme, hour12, WEEK_DAYS } from '@/lib/courses';
import { fromStart, ltr, row } from '@/lib/rtl';
import { blocksOf, blocksOverlap, gridHours, layoutDay, markedBlocks } from '@/lib/schedule';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';

interface WeekGridProps {
  chosen: Course[];
  /**
   * The section added last. Its clashing blocks get a red border, so the student sees which
   * one caused the clash; while `flash` is on (just added) its other blocks get a teal outline.
   */
  lastAddedId?: string | null;
  flash?: boolean;
  /** Height of one hour once the course panel has settled; decides how much text fits in a block. */
  hourHeight?: number;
  /** Live height of one hour while the course panel is dragged (runs on the UI thread). */
  hourSV?: SharedValue<number>;
  compact?: boolean;
  /** iPad: bigger day names, hours and block text. */
  large?: boolean;
  /** Tap a block: show everything about its section. */
  onPressBlock?: (section: Course) => void;
  /** A section shown as a dashed outline before it is added (orange where it would clash). */
  preview?: Course | null;
  /** Tap the dashed preview: add that section. */
  onPressPreview?: (section: Course) => void;
}

/** 810 → "1:30" (12-hour clock) */
const clockTime = (minutes: number) => `${hour12(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;

/** 600 → "10", 810 → "1:30": whole hours without ":00", so the time fits a narrow phone column */
const shortTime = (minutes: number) => (minutes % 60 === 0 ? String(hour12(minutes / 60)) : clockTime(minutes));

/** Block border and side padding: the space they take is left out when fitting the text. */
const BLOCK_BORDER = 1.5;
const BLOCK_PAD_X = 2.5;

/**
 * Rough width of a short Latin/number label in em (IBM Plex, bold): enough to pick one text size
 * that fits every block's course code and time.
 */
const textEm = (text: string) =>
  [...text].reduce(
    (n, ch) =>
      n +
      (/[0-9]/.test(ch)
        ? 0.62
        : /[MW]/.test(ch)
          ? 0.88
          : /[:.]/.test(ch)
            ? 0.3
            : /[–-]/.test(ch)
              ? 0.56
              : /[A-Z]/.test(ch)
                ? 0.7
                : 0),
    0,
  );

/** Names the activity on lab/training blocks; plain lectures (نظري) stay unlabelled. */
const labActivity = (course: Course) => {
  const a = activityLabel(course);
  return a && a !== 'نظري' && a !== 'Lecture' ? a : null;
};

/**
 * The weekly timetable. Blocks are placed in percentages of the day column, so when the
 * grid's height animates (the course panel is dragged) every block follows without re-rendering.
 */
export function WeekGrid({
  chosen,
  lastAddedId,
  flash = false,
  hourHeight = 28,
  hourSV,
  compact = true,
  large = false,
  onPressBlock,
  preview,
  onPressPreview,
}: WeekGridProps) {
  // A preview of a section that is already in the timetable adds nothing.
  const ghost = preview && !chosen.some((c) => c.id === preview.id) ? preview : null;
  const { from, to } = gridHours(ghost ? [...chosen, ghost] : chosen);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const span = hours.length * 60;

  const bodyStyle = useAnimatedStyle(() => ({
    height: hours.length * (hourSV ? hourSV.get() : hourHeight),
  }));
  const big = large && !compact;
  // Very tall hour rows (an iPad held upright): blocks have room for slightly larger text.
  const tall = big && hourHeight >= 110;

  // Only blocks that overlap a block of another section are marked, not the whole course.
  const chosenItems = markedBlocks(chosen);
  const ghostItems = ghost
    ? blocksOf(ghost).map((block) => ({
        block,
        clash: chosenItems.some((it) => blocksOverlap(block, it.block)),
        ghost: true,
      }))
    : [];
  const items = [...chosenItems, ...ghostItems];

  // One text size for every block's code and time, the largest that fits the longest of them
  // in a day column, so no block looks smaller than the others. Blocks sharing a column (a clash)
  // shrink on their own.
  const [colW, setColW] = useState(0);
  const inner = colW - 2 * (BLOCK_BORDER + BLOCK_PAD_X) - 1;
  const timeText = (start: number, end: number) =>
    compact ? `${shortTime(start)}–${shortTime(end)}` : `${clockTime(start)}–${clockTime(end)}`;
  const longestCode = Math.max(4, ...items.map((it) => textEm(it.block.course.code)));
  const longestTime = Math.max(3, ...items.map((it) => textEm(timeText(it.block.start, it.block.end))));
  const codeMax = tall ? 15 : big ? 13 : 11;
  const timeMax = tall ? 13.5 : big ? 12 : 10.5;
  const codeSize = colW ? Math.max(8, Math.min(codeMax, inner / longestCode)) : big ? 13 : 10;
  const timeSize = colW ? Math.max(8, Math.min(timeMax, inner / longestTime)) : big ? 12 : 9.5;

  const pct = (minutes: number) => `${(minutes / span) * 100}%` as const;

  return (
    <View>
      <View style={[styles.headRow, { flexDirection: row }]}>
        <View style={[styles.timeCol, big && styles.timeColBig]} />
        {WEEK_DAYS.map((d) => (
          <AppText
            key={d}
            size={big ? 13 : 11}
            weight="semibold"
            color={colors.muted}
            align="center"
            style={styles.dayHead}>
            {dayName(d)}
          </AppText>
        ))}
      </View>
      <Animated.View style={[{ flexDirection: row }, hourSV ? bodyStyle : { height: hours.length * hourHeight }]}>
        <View style={[styles.timeCol, big && styles.timeColBig]}>
          {hours.map((h) => (
            <View key={h} style={styles.hourCell}>
              <AppText
                size={big ? 13.5 : 12}
                weight="semibold"
                color={colors.muted}
                align="center"
                style={{ lineHeight: big ? 17 : 15 }}>
                {hour12(h)}
              </AppText>
            </View>
          ))}
        </View>
        {WEEK_DAYS.map((day) => {
          const dayItems = layoutDay(items.filter((it) => it.block.day === day));
          return (
            <View
              key={day}
              style={styles.dayCol}
              onLayout={day === WEEK_DAYS[0] ? (e) => setColW(Math.round(e.nativeEvent.layout.width)) : undefined}>
              {hours.map((h, i) => (
                <View
                  key={h}
                  style={[styles.hourCell, { backgroundColor: i % 2 === 0 ? colors.surfaceMuted : colors.surface }]}
                />
              ))}
              {dayItems.map((it, i) => {
                const theme = getCourseTheme(it.course.code);
                // Height in points once settled: decides how many lines of text to show.
                const h = ((it.end - it.start) / 60) * hourHeight;
                const width = `${100 / it.lanes}%` as const;
                const offset = `${(100 / it.lanes) * it.lane}%` as const;
                const fg = it.clash ? colors.clash : it.ghost ? colors.accentDark : theme.text;
                const isLast = !it.ghost && lastAddedId === it.course.id;
                const press = it.ghost ? onPressPreview : onPressBlock;
                const fullTime = ltr(`${clockTime(it.start)}–${clockTime(it.end)}`);
                const time = ltr(timeText(it.start, it.end));
                const lab = labActivity(it.course);
                // Same text size in every block; only blocks sharing a column (a clash) shrink to fit.
                const squeezed = it.lanes > 1;
                return (
                  <Pressable
                    key={`${it.course.id}-${it.ghost ? 'preview' : 'block'}-${i}`}
                    onPress={press ? () => press(it.course) : undefined}
                    disabled={!press}
                    accessibilityRole="button"
                    accessibilityLabel={`${it.ghost ? tr('معاينة: ', 'Preview: ') : ''}${it.course.code} ${it.course.name}${tr('، الشعبة ', ', section ')}${it.course.section}${tr('، ', ', ')}${dayName(day)} ${fullTime}${it.ghost && it.clash ? tr('، تتعارض', ', clashes') : ''}`}
                    accessibilityHint={it.ghost ? tr('اضغط لإضافة الشعبة إلى جدولك', 'Tap to add this section to your timetable') : tr('اضغط لعرض تفاصيل الشعبة', 'Tap to see the section details')}
                    style={({ pressed }) => [
                      styles.block,
                      {
                        top: pct(it.start - from * 60),
                        bottom: pct(from * 60 + span - it.end),
                        width,
                        ...fromStart(offset),
                      },
                      it.ghost
                        ? [styles.ghost, it.clash && styles.ghostClash]
                        : it.clash
                          ? styles.clash
                          : { backgroundColor: theme.bg },
                      isLast && (it.clash ? styles.lastClash : flash && styles.highlight),
                      pressed && { opacity: 0.7 },
                    ]}>
                    <AppText
                      size={codeSize}
                      weight="bold"
                      color={fg}
                      numberOfLines={1}
                      adjustsFontSizeToFit={squeezed}
                      minimumFontScale={0.6}
                      style={{ lineHeight: Math.round(codeSize * 1.4) }}>
                      {it.course.code}
                    </AppText>
                    {/* The time, not the room: the room is in the details shown on tap. */}
                    {h > 30 ? (
                      <AppText
                        size={timeSize}
                        weight="medium"
                        color={fg}
                        numberOfLines={1}
                        adjustsFontSizeToFit={squeezed}
                        minimumFontScale={0.6}
                        style={{ lineHeight: Math.round(timeSize * 1.4) }}>
                        {time}
                      </AppText>
                    ) : null}
                    {!compact && h > (big ? 64 : 56) ? (
                      <AppText
                        size={tall ? 13 : big ? 12 : 11}
                        color={fg}
                        numberOfLines={h < 96 ? 1 : tall ? 3 : 2}
                        style={{ opacity: 0.9 }}>
                        {it.course.name}
                      </AppText>
                    ) : null}
                    {it.ghost && h > (compact ? 44 : 50) ? (
                      <AppText size={big ? 11.5 : compact ? 9 : 10.5} weight="semibold" color={fg} numberOfLines={1}>
                        {it.clash ? tr('تتعارض', 'Clash') : tr('معاينة', 'Preview')}
                      </AppText>
                    ) : null}
                    {!it.ghost && lab && h > (compact ? 50 : big ? 84 : 76) ? (
                      <AppText
                        size={big ? 11.5 : compact ? 9 : 10.5}
                        color={fg}
                        numberOfLines={1}
                        style={{ opacity: 0.85 }}>
                        {lab}
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { paddingBottom: 5 },
  timeCol: { width: 22 },
  timeColBig: { width: 34 },
  dayHead: { flex: 1 },
  dayCol: { flex: 1, marginHorizontal: 1, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  hourCell: { flex: 1 },
  // Every block has the same border width (transparent unless marked), so marking a block
  // (clash, just added, preview) only changes colours and never shrinks the text inside it.
  block: {
    position: 'absolute',
    marginVertical: 1,
    borderRadius: 7,
    borderWidth: BLOCK_BORDER,
    borderColor: 'transparent',
    paddingHorizontal: BLOCK_PAD_X,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  clash: { backgroundColor: colors.clashSoft, borderStyle: 'dashed', borderColor: '#E07B1F' },
  highlight: { borderColor: colors.accent },
  lastClash: { borderStyle: 'solid', borderColor: colors.dangerBar },
  ghost: { backgroundColor: 'rgba(221, 240, 244, 0.85)', borderStyle: 'dashed', borderColor: colors.accent },
  ghostClash: { backgroundColor: 'rgba(255, 241, 226, 0.92)', borderColor: '#C2410C' },
});
