import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { dayName, formatTimeRangeShort, fromMinutes } from '@/lib/courses';
import { row } from '@/lib/rtl';
import type { ClashPair, ExamClash } from '@/lib/schedule';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';

/** "CS101 · 02" */
const label = (c: Course) => `${c.code} · ${c.section}`;

/** When two sections overlap, grouped by time: "الأحد، الأربعاء 10–11:30" */
export const clashWhen = (overlaps: ClashPair['overlaps']) => {
  const byTime = new Map<string, string[]>();
  for (const o of overlaps) {
    const time = formatTimeRangeShort(fromMinutes(o.start), fromMinutes(o.end));
    const days = byTime.get(time) ?? [];
    if (!days.includes(o.day)) days.push(o.day);
    byTime.set(time, days);
  }
  return [...byTime].map(([time, days]) => `${days.map(dayName).join(tr('، ', ', '))} ${time}`).join(' · ');
};

/** Bold course codes joined with "و": "CS101 و MATH201" */
const codes = (courses: Course[]) =>
  courses.map((c, i) => (
    <AppText key={c.code} size={11.5} weight="bold" color={colors.clash}>
      {i > 0 ? tr(' و ', ' and ') : ''}
      {c.code}
    </AppText>
  ));

/** One warning line: an icon and its text. */
function Line({ icon, size = 13, children }: { icon: IconName; size?: number; children: ReactNode }) {
  return (
    <View style={[styles.line, { flexDirection: row }]}>
      <Icon name={icon} size={size} color={colors.clash} />
      <AppText size={11.5} color={colors.clash} style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

/** Closed notes stay closed when the screen re-renders or switches layout, until the conflicts change. */
let closedKey: string | null = null;

/**
 * Every conflict in the timetable (shown under it), one short note each:
 * sections that meet at the same time, and courses whose final exams share a period.
 * The X hides the notes until the conflicts change.
 */
export function ClashNotes({ pairs, exams = [], max = 2 }: { pairs: ClashPair[]; exams?: ExamClash[]; max?: number }) {
  const [all, setAll] = useState(false);
  const [closed, setClosed] = useState(closedKey);

  const lines = [
    ...pairs.map((p) => ({
      key: `${p.a.id}|${p.b.id}`,
      node: (
        <Line icon="alert">
          <AppText size={11.5} weight="bold" color={colors.clash}>
            {label(p.a)}
          </AppText>
          {tr(' يتعارض مع ', ' clashes with ')}
          <AppText size={11.5} weight="bold" color={colors.clash}>
            {label(p.b)}
          </AppText>
          {` — ${clashWhen(p.overlaps)}`}
        </Line>
      ),
    })),
    ...exams.map((e) => ({
      key: `exam:${e.period}:${e.courses.map((c) => c.code).join(',')}`,
      node: (
        <Line icon="calendar">
          {tr(e.courses.length > 2 ? 'اختبارات ' : 'اختبار ', 'Exams of ')}
          {codes(e.courses)}
          {tr(` في نفس الفترة ${e.period}`, ` are in the same period ${e.period}`)}
        </Line>
      ),
    })),
  ];
  const key = lines.map((l) => l.key).join('/');
  // Any change to the conflicts forgets the close, so a new conflict always shows.
  if (closed !== null && closed !== key) setClosed(null);
  useEffect(() => {
    closedKey = closed;
  }, [closed]);
  if (lines.length === 0 || closed === key) return null;

  const close = () => setClosed(key);
  const shown = all ? lines : lines.slice(0, max);
  return (
    <View style={[styles.box, { flexDirection: row }]} accessibilityLiveRegion="polite">
      <View style={{ flex: 1, gap: 4 }}>
        {shown.map((l) => (
          <View key={l.key}>{l.node}</View>
        ))}
        {lines.length > max ? (
          <Pressable onPress={() => setAll((a) => !a)} accessibilityRole="button" hitSlop={6}>
            <AppText size={11.5} weight="bold" color={colors.clash}>
              {all ? tr('عرض أقل', 'Show less') : tr(`+ ${lines.length - max} تعارضات أخرى`, `+ ${lines.length - max} more clashes`)}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={tr('إغلاق التنبيه', 'Close the alert')}
        hitSlop={10}
        style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.clashBorder }]}>
        <Icon name="x" size={13} color={colors.clash} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

/** The conflicts of one section, as notes under it (summary list). */
export function SectionClashNotes({
  section,
  pairs,
  exams = [],
}: {
  section: Course;
  pairs: ClashPair[];
  exams?: ExamClash[];
}) {
  const mine = pairs.filter((p) => p.a.id === section.id || p.b.id === section.id);
  const examMates = exams
    .filter((e) => e.period === section.finalExam?.date?.trim() && e.courses.some((c) => c.code === section.code))
    .flatMap((e) => e.courses.filter((c) => c.code !== section.code));
  if (mine.length === 0 && examMates.length === 0) return null;
  return (
    <View style={{ gap: 2, marginTop: 4 }}>
      {mine.map((p) => {
        const other = p.a.id === section.id ? p.b : p.a;
        return (
          <Line key={other.id} icon="alert" size={12}>
            {tr('يتعارض مع', 'Clashes with')}{' '}
            <AppText size={11.5} weight="bold" color={colors.clash}>
              {label(other)}
            </AppText>
            {` — ${clashWhen(p.overlaps)}`}
          </Line>
        );
      })}
      {examMates.length > 0 ? (
        <Line icon="calendar" size={12}>
          {tr('نفس فترة الاختبار مع ', 'Same exam period as ')}
          {codes(examMates)}
        </Line>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 8,
    gap: 8,
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.clashSoft,
  },
  line: { alignItems: 'flex-start', gap: 6 },
  close: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
});
