/**
 * What the tasks tab shows when the chosen filter has nothing in it. Each filter says something
 * different, so an empty "done" list doesn't read like the student has no tasks at all.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { tr } from '@/lib/i18n';
import type { TaskFilter } from '@/lib/tasks';
import { colors } from '@/lib/theme';

const texts = (filter: TaskFilter, hasTasks: boolean) => {
  switch (filter) {
    case 'today':
      return {
        title: tr('لا توجد مهام لليوم', 'No tasks for today'),
        body: hasTasks
          ? tr('مهامك القادمة في تبويب «القادمة»', 'Your later tasks are under “Upcoming”')
          : tr(
              'أضف واجباتك ومواعيدك الشخصية، ونذكّرك بها في الوقت الذي تختاره',
              'Add your homework and personal plans, and we will remind you when you choose',
            ),
      };
    case 'upcoming':
      return {
        title: tr('لا توجد مهام قادمة', 'No upcoming tasks'),
        body: tr('المهام التي لها تاريخ بعد اليوم تظهر هنا', 'Tasks dated after today show up here'),
      };
    case 'done':
      return {
        title: tr('لم تُنجز أي مهمة بعد', 'Nothing done yet'),
        body: tr('اضغط الدائرة بجانب المهمة عند إنجازها، وستظهر هنا', 'Tap the circle next to a task when you finish it'),
      };
    default:
      return {
        title: tr('لا توجد مهام', 'No tasks yet'),
        body: tr(
          'أضف واجباتك ومواعيدك الشخصية، ونذكّرك بها في الوقت الذي تختاره',
          'Add your homework and personal plans, and we will remind you when you choose',
        ),
      };
  }
};

/** The empty state. `onAdd` is left out where adding a task doesn't fit (the "done" filter). */
export function EmptyTasks({
  filter,
  hasTasks,
  tablet,
  onAdd,
}: {
  filter: TaskFilter;
  hasTasks: boolean;
  tablet?: boolean;
  onAdd?: () => void;
}) {
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const { title, body } = texts(filter, hasTasks);
  const ring = t(128, 156);
  const inner = t(88, 108);

  return (
    <View style={styles.wrap}>
      <View style={{ width: ring + 8, height: ring + 8, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[styles.ring, { width: ring, height: ring, borderRadius: ring / 2 }]}>
          <View style={[styles.inner, { width: inner, height: inner, borderRadius: inner / 2 }]}>
            <Icon name={filter === 'done' ? 'check' : 'clipboardCheck'} size={t(40, 48)} color={colors.accent} />
          </View>
        </View>
        {/* Small bell badge on the ring's top corner: tasks come with reminders */}
        <View style={[styles.bell, { width: t(32, 38), height: t(32, 38), borderRadius: t(16, 19) }]}>
          <Icon name="bell" size={t(16, 19)} color="#FFFFFF" strokeWidth={2.2} />
        </View>
      </View>
      <AppText size={t(20, 24)} weight="bold" align="center" accessibilityRole="header" style={{ marginTop: 18 }}>
        {title}
      </AppText>
      <AppText size={t(14, 16)} color={colors.muted} align="center" style={[styles.body, tablet && { maxWidth: 420 }]}>
        {body}
      </AppText>
      {onAdd ? (
        <Button
          label={hasTasks ? tr('أضف مهمة', 'Add a task') : tr('أضف أول مهمة', 'Add your first task')}
          icon="plus"
          onPress={onAdd}
          style={{ marginTop: 20, minWidth: t(180, 220) }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 16 },
  ring: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  inner: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  // A top corner of the ring (the design shows it top-right; either side reads fine)
  bell: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  body: { marginTop: 6, maxWidth: 300 },
});
