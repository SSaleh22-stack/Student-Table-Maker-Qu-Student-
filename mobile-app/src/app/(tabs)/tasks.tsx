import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { EmptyTasks } from '@/components/tasks/EmptyTasks';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TasksSummary } from '@/components/tasks/TasksSummary';
import { Toast, type ToastData } from '@/components/Toast';
import { Chip, ScreenHeader } from '@/components/ui';
import { dayName } from '@/lib/courses';
import { arabicMonth } from '@/lib/export/dates';
import { tr } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { fromEnd, ltr, row } from '@/lib/rtl';
import {
  countForFilter,
  formatTaskDate,
  groupTasks,
  nextOccurrence,
  type Task,
  type TaskFilter,
  type TaskSection,
} from '@/lib/tasks';
import { colors, shadow } from '@/lib/theme';
import { useTasks } from '@/store/Tasks';

const TOAST_MS = 5000;
/** The content column on a tablet, so cards don't stretch across a wide iPad. */
const TABLET_MAX = 760;
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "الأحد، 22 نوفمبر" / "Sunday, 22 November" */
const longDate = (d: Date) => `${dayName(DAY_KEYS[d.getDay()])}${tr('، ', ', ')}${d.getDate()} ${arabicMonth(d)}`;

/** "All" comes first and is the default, so opening the tab shows every task at once. */
const filters = (todayCount: number): { key: TaskFilter; label: string }[] => [
  { key: 'all', label: tr('الكل', 'All') },
  {
    key: 'today',
    label: todayCount ? tr(`اليوم · ${ltr(todayCount)}`, `Today · ${todayCount}`) : tr('اليوم', 'Today'),
  },
  { key: 'upcoming', label: tr('القادمة', 'Upcoming') },
  { key: 'done', label: tr('المنجزة', 'Done') },
];

/**
 * A task shows its date only when its section isn't already that date: the "Today" and
 * "Tomorrow" sections say it in their title, the "Overdue" and "Done" sections don't.
 */
const sectionShowsDate = (section: TaskSection, task: Task, now: Date) =>
  !task.date || section.title !== formatTaskDate(task.date, now);

const openTask = (id?: string) => (id ? router.push({ pathname: '/task', params: { id } }) : router.push('/task'));

export default function TasksScreen() {
  const { tasks, loaded, toggleDone } = useTasks();
  const tablet = useIsTablet();
  const { width } = useWindowDimensions();
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const sidePad = tablet ? Math.max(32, (width - TABLET_MAX) / 2) : 16;

  const [filter, setFilter] = useState<TaskFilter>('all');

  // "Now" moves on every minute and whenever the tab comes back, so tasks turn overdue and
  // "Today" rolls over at midnight without reopening the app.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, []),
  );

  const [toast, setToast] = useState<ToastData | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  };
  const showToast = (data: Omit<ToastData, 'id'>) => {
    toastId.current += 1;
    setToast({ ...data, id: toastId.current });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(dismissToast, TOAST_MS);
  };

  /**
   * Ticks a task. Finishing one says so with an undo, since a finished task can drop out of the
   * current filter. A repeating task moves to its next date instead (undo would move it again,
   * so it gets no undo button).
   */
  const toggle = (task: Task) => {
    toggleDone(task.id);
    if (task.done) return;
    if (task.repeat !== 'none') {
      const next = nextOccurrence(task);
      showToast({
        text: tr('أُنجزت المهمة', 'Task done'),
        detail: next ? tr(`التكرار القادم: ${formatTaskDate(next, now)}`, `Next time: ${formatTaskDate(next, now)}`) : undefined,
        tone: 'ok',
      });
      return;
    }
    showToast({ text: tr(`أُنجزت «${task.title}»`, `Done: “${task.title}”`), tone: 'ok', undo: () => toggleDone(task.id) });
  };

  const sections = loaded ? groupTasks(tasks, filter, now) : [];
  const empty = loaded && sections.every((s) => s.tasks.length === 0);
  // The empty state has its own add button, except on "Done", where the floating one stays.
  const emptyAdds = empty && filter !== 'done';

  return (
    <View style={styles.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            tablet && styles.contentTablet,
            { paddingHorizontal: sidePad, paddingBottom: emptyAdds ? 32 : t(104, 120) },
          ]}>
          <ScreenHeader title={tr('مهامي', 'My tasks')} subtitle={longDate(now)} />

          {loaded && tasks.length ? <TasksSummary tasks={tasks} now={now} tablet={tablet} /> : null}

          <View style={[styles.filters, { flexDirection: row }]}>
            {filters(loaded ? countForFilter(tasks, 'today', now) : 0).map((f) => (
              <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>

          {empty ? (
            <EmptyTasks
              filter={filter}
              hasTasks={tasks.length > 0}
              tablet={tablet}
              onAdd={emptyAdds ? () => openTask() : undefined}
            />
          ) : (
            sections
              .filter((s) => s.tasks.length)
              .map((section) => {
                const left = section.tasks.filter((task) => !task.done).length;
                // "2 متبقية" only where done and undone tasks share a section (today's list)
                const mixed = left > 0 && left < section.tasks.length;
                return (
                  <View key={section.key} style={{ gap: t(8, 10) }}>
                    <View style={[styles.sectionHead, { flexDirection: row }]}>
                      <AppText
                        size={t(13, 15)}
                        weight="semibold"
                        color={section.title === tr('متأخرة', 'Overdue') ? colors.danger : colors.muted}
                        accessibilityRole="header"
                        style={{ flex: 1 }}>
                        {section.title}
                      </AppText>
                      {mixed ? (
                        <AppText size={t(12, 13.5)} color={colors.faint}>
                          {tr(`${left} متبقية`, `${left} left`)}
                        </AppText>
                      ) : null}
                    </View>
                    {section.tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        now={now}
                        showDate={sectionShowsDate(section, task, now)}
                        tablet={tablet}
                        onToggle={() => toggle(task)}
                        onPress={() => openTask(task.id)}
                      />
                    ))}
                  </View>
                );
              })
          )}
        </ScrollView>
      </SafeAreaView>

      {loaded && !emptyAdds ? (
        <Pressable
          onPress={() => openTask()}
          accessibilityRole="button"
          accessibilityLabel={tr('مهمة جديدة', 'New task')}
          style={({ pressed }) => [
            styles.fab,
            tablet && styles.fabTablet,
            shadow,
            { flexDirection: row },
            fromEnd(tablet ? sidePad : 16),
            pressed && { opacity: 0.88 },
          ]}>
          <Icon name="plus" size={t(22, 24)} color="#FFFFFF" strokeWidth={2.6} />
          <AppText size={t(15, 17)} weight="semibold" color="#FFFFFF">
            {tr('مهمة جديدة', 'New task')}
          </AppText>
        </Pressable>
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={dismissToast} position="top" inset={tablet ? sidePad : 16} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 8, gap: 14 },
  contentTablet: { width: '100%', paddingTop: 24, gap: 20 },
  filters: { flexWrap: 'wrap', gap: 8 },
  sectionHead: { alignItems: 'center', gap: 8, paddingHorizontal: 4, marginTop: 4 },
  fab: {
    position: 'absolute',
    bottom: 16,
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 26,
    backgroundColor: colors.accent,
  },
  fabTablet: { bottom: 24, minHeight: 58, paddingHorizontal: 24, borderRadius: 29 },
});
