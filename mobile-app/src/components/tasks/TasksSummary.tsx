/**
 * The teal card at the top of the tasks tab: how many of today's tasks are done, a progress bar,
 * and when the next reminder rings.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { fromEnd, row } from '@/lib/rtl';
import { dateKey, formatTaskDate, formatTime, nextReminderAt, repeatDoneToday, todayKey, type Task } from '@/lib/tasks';
import { colors } from '@/lib/theme';

/** Light text on the teal card (same tint the design uses for the small label). */
const ON_TEAL = '#CDEFF5';

/** The next reminder that will ring, among the tasks still to do (repeating ones roll on to their next period). */
export function nextReminder(tasks: Task[], now: Date): Date | null {
  let next: Date | null = null;
  for (const task of tasks) {
    if (task.done || !task.reminder) continue;
    const at = nextReminderAt(task, now);
    if (at && at.getTime() > now.getTime() && (!next || at.getTime() < next.getTime())) next = at;
  }
  return next;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "3:00 م" for later today, "غداً 8:00 ص" or "الإثنين، 23 نوفمبر 8:00 ص" otherwise. */
const whenLabel = (at: Date, now: Date) => {
  const time = formatTime(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
  const key = dateKey(at);
  return key === todayKey(now) ? time : `${formatTaskDate(key, now)} ${time}`;
};

export function TasksSummary({ tasks, now, tablet }: { tasks: Task[]; now: Date; tablet?: boolean }) {
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const today = todayKey(now);
  // A repeating task ticked off today has already moved to its next date; it still counts as done today.
  const todays = tasks.filter((task) => task.date === today || repeatDoneToday(task, now));
  const done = todays.filter((task) => task.done || repeatDoneToday(task, now)).length;
  const total = todays.length;
  const share = total ? done / total : 0;
  const next = nextReminder(tasks, now);

  const headline = total
    ? tr(`${done} من ${total} مهام منجزة`, `${done} of ${total} tasks done`)
    : tr('لا مهام مجدولة اليوم', 'Nothing scheduled today');

  return (
    <View
      style={[styles.card, tablet && styles.cardTablet]}
      accessible
      accessibilityLabel={[
        tr('مهام اليوم', "Today's tasks"),
        headline,
        next ? tr(`التذكير التالي ${whenLabel(next, now)}`, `Next reminder ${whenLabel(next, now)}`) : '',
      ]
        .filter(Boolean)
        .join('، ')}
      accessibilityRole={total ? 'progressbar' : undefined}
      accessibilityValue={total ? { min: 0, max: total, now: done } : undefined}>
      {/* Soft circle in the corner, like the home screen's teal header */}
      <View style={[styles.glow, fromEnd(-40)]} pointerEvents="none" />
      <View style={{ flexDirection: row, alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <AppText size={t(13, 15)} weight="medium" color={ON_TEAL}>
            {tr('مهام اليوم', "Today's tasks")}
          </AppText>
          <AppText size={t(20, 24)} weight="bold" color="#FFFFFF">
            {headline}
          </AppText>
        </View>
        {next ? (
          <View style={[styles.next, { flexDirection: row }]}>
            <Icon name="bell" size={t(14, 16)} color="#FFFFFF" strokeWidth={2.2} />
            <AppText size={t(11.5, 13)} weight="semibold" color="#FFFFFF" numberOfLines={1}>
              {tr(`التالي ${whenLabel(next, now)}`, `Next ${whenLabel(next, now)}`)}
            </AppText>
          </View>
        ) : null}
      </View>
      {total ? (
        <View style={[styles.track, { flexDirection: row }]}>
          <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: colors.accent,
    overflow: 'hidden',
  },
  cardTablet: { padding: 22, borderRadius: 26, gap: 18 },
  glow: {
    position: 'absolute',
    top: -46,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  next: {
    alignItems: 'center',
    gap: 5,
    maxWidth: '55%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
});
