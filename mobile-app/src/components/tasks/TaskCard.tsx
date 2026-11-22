/**
 * One row in the tasks list: a round checkbox, the title, and a meta line (time or date, course,
 * repeat). The reminder (or "done") pill sits at the end of the row.
 */
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { CodeBadge, Tag } from '@/components/ui';
import { getCourseTheme } from '@/lib/courses';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { formatTaskDate, formatTime, isOverdue, reminderLabel, repeatLabel, type Task } from '@/lib/tasks';
import { colors } from '@/lib/theme';

interface TaskCardProps {
  task: Task;
  /** Show the task's date in the meta line (off when the section is already that date) */
  showDate: boolean;
  now: Date;
  tablet?: boolean;
  onToggle: () => void;
  onPress: () => void;
}

export function TaskCard({ task, showDate, now, tablet, onToggle, onPress }: TaskCardProps) {
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const overdue = isOverdue(task, now);
  const metaColor = overdue ? colors.danger : colors.faint;

  // Meta line: "3:00 م" (with the date in front when the section doesn't say it), or the date
  // alone, or "طوال اليوم" for a date with no time.
  let whenIcon: IconName | null = null;
  let whenText = '';
  if (task.time) {
    whenIcon = 'clock';
    const time = formatTime(task.time);
    whenText = showDate && task.date ? `${formatTaskDate(task.date, now)} · ${time}` : time;
  } else if (task.date) {
    whenIcon = 'calendar';
    whenText = showDate ? formatTaskDate(task.date, now) : tr('طوال اليوم', 'All day');
  }
  const repeating = task.repeat !== 'none';
  const hasMeta = !!whenIcon || !!task.courseCode || repeating || overdue;
  const course = task.courseCode ? getCourseTheme(task.courseCode) : null;

  // The card is one element for screen readers (the checkbox inside it can't get focus), so it
  // says everything the row shows and offers ticking off as an action.
  const a11y = [
    task.title,
    whenText,
    task.courseCode,
    repeating ? repeatLabel(task.repeat) : '',
    !task.done && task.reminder
      ? `${tr('تذكير', 'Reminder')} ${reminderLabel(task.reminder, !!task.time, task.reminderCustom)}`
      : '',
    overdue ? tr('متأخرة', 'Overdue') : '',
    task.done ? tr('منجزة', 'Done') : '',
  ]
    .filter(Boolean)
    .join('، ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={tr('فتح المهمة للتعديل', 'Opens the task to edit it')}
      accessibilityState={{ checked: task.done }}
      accessibilityActions={[
        { name: 'activate' },
        { name: 'toggle', label: task.done ? tr('إلغاء الإنجاز', 'Mark not done') : tr('إنجاز', 'Mark done') },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'toggle') onToggle();
        else if (e.nativeEvent.actionName === 'activate') onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        { flexDirection: row, alignItems: hasMeta ? 'flex-start' : 'center' },
        tablet && styles.cardTablet,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}>
      <Checkbox done={task.done} size={t(24, 28)} onPress={onToggle} title={task.title} />

      <View style={styles.body}>
        <AppText
          size={t(15, 17)}
          weight="semibold"
          color={task.done ? colors.faint : colors.text}
          numberOfLines={2}
          style={task.done ? styles.strike : undefined}>
          {task.title}
        </AppText>
        {hasMeta ? (
          <View style={[styles.meta, { flexDirection: row }]}>
            {whenIcon ? (
              <View style={[styles.metaItem, { flexDirection: row }]}>
                <Icon name={whenIcon} size={t(14, 16)} color={metaColor} strokeWidth={2.2} />
                <AppText size={t(12.5, 14)} weight="medium" color={metaColor}>
                  {whenText}
                </AppText>
              </View>
            ) : null}
            {course && task.courseCode ? (
              <CodeBadge code={task.courseCode} bg={course.bg} fg={course.text} />
            ) : null}
            {repeating ? (
              <View style={[styles.metaItem, { flexDirection: row }]}>
                <Icon name="refresh" size={t(13, 15)} color={colors.faint} strokeWidth={2.2} />
                <AppText size={t(12, 13.5)} color={colors.faint}>
                  {repeatLabel(task.repeat)}
                </AppText>
              </View>
            ) : null}
            {overdue ? <Tag label={tr('متأخرة', 'Overdue')} tone="danger" /> : null}
          </View>
        ) : null}
      </View>

      {task.done ? (
        <Pill icon="check" label={tr('منجزة', 'Done')} bg={colors.successSoft} fg={colors.success} tablet={tablet} />
      ) : task.reminder ? (
        <Pill
          icon="bell"
          label={reminderLabel(task.reminder, !!task.time, task.reminderCustom)}
          bg={colors.accentSoft}
          fg={colors.accentDark}
          tablet={tablet}
        />
      ) : null}
    </Pressable>
  );
}

function Pill({ icon, label, bg, fg, tablet }: { icon: IconName; label: string; bg: string; fg: string; tablet?: boolean }) {
  return (
    <View style={[styles.pill, tablet && styles.pillTablet, { flexDirection: row, backgroundColor: bg }]}>
      <Icon name={icon} size={tablet ? 15 : 13} color={fg} strokeWidth={2.2} />
      <AppText size={tablet ? 13 : 11.5} weight="semibold" color={fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * The round checkbox. It gives a small bounce when ticked, so finishing a task feels like
 * something happened even before the list moves it.
 */
function Checkbox({ done, size, title, onPress }: { done: boolean; size: number; title: string; onPress: () => void }) {
  const scale = useSharedValue(1);
  const first = useRef(true);

  useEffect(() => {
    // No bounce on the first render, only when the user ticks it.
    if (first.current) {
      first.current = false;
      return;
    }
    if (done) scale.set(withSequence(withTiming(0.8, { duration: 90 }), withSpring(1, { damping: 8, stiffness: 260 })));
  }, [done, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={done ? tr(`إلغاء إنجاز ${title}`, `Mark ${title} as not done`) : tr(`إنجاز ${title}`, `Mark ${title} as done`)}
      style={styles.checkHit}>
      <Animated.View
        style={[
          styles.check,
          { width: size, height: size, borderRadius: size / 2 },
          done ? styles.checkOn : null,
          animated,
        ]}>
        {done ? <Icon name="check" size={Math.round(size * 0.66)} color="#FFFFFF" strokeWidth={3} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  cardTablet: { gap: 14, minHeight: 66, paddingHorizontal: 18, paddingVertical: 15, borderRadius: 20 },
  body: { flex: 1, gap: 4 },
  strike: { textDecorationLine: 'line-through' },
  meta: { alignItems: 'center', flexWrap: 'wrap', columnGap: 10, rowGap: 4 },
  metaItem: { alignItems: 'center', gap: 4 },
  pill: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 150,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillTablet: { maxWidth: 220, paddingHorizontal: 11, paddingVertical: 4 },
  checkHit: { paddingTop: 1 },
  check: {
    borderWidth: 2,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
