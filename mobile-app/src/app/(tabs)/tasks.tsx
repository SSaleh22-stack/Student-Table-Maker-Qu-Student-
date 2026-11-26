import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { TasksTour } from '@/components/AppTours';
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
import { TOUR_TARGETS } from '@/notebook/contracts/tours';
import { useTourTarget } from '@/notebook/ui/tourTargets';
import { useTasks } from '@/store/Tasks';

const TOAST_MS = 5000;
/** Side margins on a tablet: the list uses the full width of the iPad. */
const TABLET_PAD = 32;
const TABLET_PAD_WIDE = 48;
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

/** "حذف 3 من المهام؟" with Cancel / Delete (window.confirm on web, where Alert has no buttons). */
function confirmDeleteMany(count: number, run: () => void) {
  const title =
    count === 1 ? tr('حذف المهمة؟', 'Delete this task?') : tr(`حذف ${ltr(count)} من المهام؟`, `Delete ${count} tasks?`);
  const message =
    count === 1
      ? tr('ستُحذف المهمة وتذكيرها.', 'The task and its reminder will be removed.')
      : tr('ستُحذف المهام المحددة وتذكيراتها.', 'The selected tasks and their reminders will be removed.');
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: tr('إلغاء', 'Cancel'), style: 'cancel' },
    { text: tr('حذف', 'Delete'), style: 'destructive', onPress: run },
  ]);
}

export default function TasksScreen() {
  const { tasks, loaded, toggleDone, deleteTasks, restoreTasks } = useTasks();
  const tablet = useIsTablet();
  const { width } = useWindowDimensions();
  const summaryRef = useTourTarget(TOUR_TARGETS.tasksSummary);
  const filtersRef = useTourTarget(TOUR_TARGETS.tasksFilters);
  const newRef = useTourTarget(TOUR_TARGETS.tasksNew);
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const sidePad = tablet ? (width >= 1100 ? TABLET_PAD_WIDE : TABLET_PAD) : 16;

  const [filter, setFilter] = useState<TaskFilter>('all');
  /**
   * Multi-select: null while not selecting. A long press on a task starts it with that task; a tap
   * then selects or unselects, and unselecting the last one ends it.
   */
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const selecting = selected !== null;
  const endSelect = useCallback(() => setSelected(null), []);

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
      // Leaving the tab ends a selection, so coming back never finds tasks still picked for deleting.
      return () => setSelected(null);
    }, []),
  );

  // Android's back button ends the selection first.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

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
  const visibleIds = sections.flatMap((s) => s.tasks.map((task) => task.id));
  // Only tasks still in the list count (one may have been deleted from a notification meanwhile).
  const picked = selected ? visibleIds.filter((id) => selected.has(id)) : [];
  const allPicked = selecting && visibleIds.length > 0 && picked.length === visibleIds.length;

  const startSelect = (task: Task) => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    dismissToast();
    setSelected(new Set([task.id]));
  };

  const togglePick = (task: Task) =>
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next.size ? next : null;
    });

  const changeFilter = (f: TaskFilter) => {
    setFilter(f);
    // A filter change keeps only the picked tasks the new filter still shows: nothing hidden is deleted.
    if (selected) {
      const shown = new Set(groupTasks(tasks, f, now).flatMap((s) => s.tasks.map((task) => task.id)));
      const kept = [...selected].filter((id) => shown.has(id));
      setSelected(kept.length ? new Set(kept) : null);
    }
  };

  const deletePicked = () => {
    if (!picked.length) return;
    const ids = picked;
    confirmDeleteMany(ids.length, () => {
      const gone = new Set(ids);
      const removed = tasks.filter((task) => gone.has(task.id));
      deleteTasks(ids);
      setSelected(null);
      showToast({
        text:
          removed.length === 1
            ? tr('حُذفت المهمة', 'Task deleted')
            : tr(`حُذفت ${ltr(removed.length)} من المهام`, `${removed.length} tasks deleted`),
        tone: 'ok',
        undo: () => restoreTasks(removed),
      });
    });
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            tablet && styles.contentTablet,
            { paddingHorizontal: sidePad, paddingBottom: emptyAdds ? 32 : t(104, 120) },
          ]}>
          {selecting ? (
            <SelectionBar
              count={picked.length}
              allPicked={allPicked}
              onCancel={endSelect}
              onToggleAll={() => setSelected(allPicked ? null : new Set(visibleIds))}
            />
          ) : (
            <ScreenHeader title={tr('مهامي', 'My tasks')} subtitle={longDate(now)} />
          )}

          {loaded && tasks.length ? (
            <View ref={summaryRef} collapsable={false}>
              <TasksSummary tasks={tasks} now={now} tablet={tablet} />
            </View>
          ) : null}

          <View ref={filtersRef} collapsable={false} style={[styles.filters, { flexDirection: row }]}>
            {filters(loaded ? countForFilter(tasks, 'today', now) : 0).map((f) => (
              <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => changeFilter(f.key)} />
            ))}
          </View>

          {empty ? (
            <View ref={emptyAdds ? newRef : undefined} collapsable={false}>
              <EmptyTasks
                filter={filter}
                hasTasks={tasks.length > 0}
                tablet={tablet}
                onAdd={emptyAdds ? () => openTask() : undefined}
              />
            </View>
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
                        onPress={() => (selecting ? togglePick(task) : openTask(task.id))}
                        onLongPress={() => (selecting ? togglePick(task) : startSelect(task))}
                        selecting={selecting}
                        selected={!!selected?.has(task.id)}
                      />
                    ))}
                  </View>
                );
              })
          )}
        </ScrollView>
      </SafeAreaView>

      {selecting ? (
        <Pressable
          onPress={deletePicked}
          disabled={!picked.length}
          accessibilityRole="button"
          accessibilityLabel={tr(`حذف ${picked.length} من المهام`, `Delete ${picked.length} tasks`)}
          style={({ pressed }) => [
            styles.fab,
            styles.fabDanger,
            tablet && styles.fabTablet,
            shadow,
            { flexDirection: row },
            fromEnd(tablet ? sidePad : 16),
            pressed && { opacity: 0.88 },
            !picked.length && { opacity: 0.5 },
          ]}>
          <Icon name="trash" size={t(20, 22)} color="#FFFFFF" strokeWidth={2.4} />
          <AppText size={t(15, 17)} weight="semibold" color="#FFFFFF">
            {picked.length > 0 ? tr(`حذف (${ltr(picked.length)})`, `Delete (${picked.length})`) : tr('حذف', 'Delete')}
          </AppText>
        </Pressable>
      ) : loaded && !emptyAdds ? (
        <Pressable
          ref={emptyAdds ? undefined : newRef}
          collapsable={false}
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

      {selecting ? null : <TasksTour />}
      {toast ? <Toast toast={toast} onDismiss={dismissToast} position="top" inset={tablet ? sidePad : 16} /> : null}
    </View>
  );
}

/** Replaces the title while selecting: ✕, "3 محددة", and select all / none. */
function SelectionBar({
  count,
  allPicked,
  onCancel,
  onToggleAll,
}: {
  count: number;
  allPicked: boolean;
  onCancel: () => void;
  onToggleAll: () => void;
}) {
  return (
    <View style={[styles.selectBar, { flexDirection: row }]}>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={tr('إلغاء التحديد', 'Cancel selection')}
        style={({ pressed }) => [styles.selectClose, pressed && { opacity: 0.7 }]}>
        <Icon name="x" size={20} color={colors.text} strokeWidth={2.4} />
      </Pressable>
      <AppText weight="bold" size={20} style={{ flex: 1 }} accessibilityLiveRegion="polite">
        {tr(`${ltr(count)} محددة`, `${count} selected`)}
      </AppText>
      <Pressable
        onPress={onToggleAll}
        hitSlop={8}
        accessibilityRole="button"
        style={({ pressed }) => [styles.selectAll, pressed && { opacity: 0.7 }]}>
        <AppText size={14} weight="semibold" color={colors.accent}>
          {allPicked ? tr('إلغاء تحديد الكل', 'Select none') : tr('تحديد الكل', 'Select all')}
        </AppText>
      </Pressable>
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
  fabDanger: { backgroundColor: colors.danger },
  selectBar: { alignItems: 'center', gap: 12, minHeight: 52 },
  selectClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  selectAll: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.accentSoft },
});
