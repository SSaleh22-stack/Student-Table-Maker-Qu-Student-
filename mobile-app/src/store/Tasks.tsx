/**
 * Personal tasks ("مهامي"), saved on the device with AsyncStorage, apart from the timetable data
 * so clearing the timetable never deletes a student's tasks.
 *
 * Reminders follow the saved tasks: after every change the tasks that changed get their
 * notification rescheduled (or cancelled), so screens only edit tasks and never touch reminders,
 * except for asking permission when a reminder is first set.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { WidgetToggle } from '../../modules/qu-widgets';
import { useLang } from '@/lib/i18n';
import { cancelTaskReminder, resyncAllReminders, snoozeReminder, syncTaskReminder } from '@/lib/reminders';
import {
  cleanCustomReminder,
  isDateKey,
  isTimeKey,
  nextOccurrence,
  normalizeDraft,
  type ReminderOffset,
  type Repeat,
  type Task,
  type TaskDraft,
} from '@/lib/tasks';

const STORAGE_KEY = 'qu-student:tasks:v1';
/** Where a save that could not be read is kept, so it is never lost by the next write. */
const BACKUP_KEY = 'qu-student:tasks:v1:unreadable';

const SNOOZE_MINUTES = 10;

interface Persisted {
  version: 1;
  tasks: Task[];
}

interface TasksValue {
  tasks: Task[];
  loaded: boolean;
  /** The saved list was really read (false while a failed read is retried, or if it never works). */
  saved: boolean;
  addTask: (d: TaskDraft) => Task;
  updateTask: (id: string, d: TaskDraft) => void;
  deleteTask: (id: string) => void;
  /** Deletes several tasks at once (the tasks list's selection). */
  deleteTasks: (ids: readonly string[]) => void;
  /** Puts deleted tasks back as they were (the undo after deleting). Ids already in the list are skipped. */
  restoreTasks: (tasks: readonly Task[]) => void;
  /** Ticks a task off (or back on). A repeating task moves to its next date and stays open. */
  toggleDone: (id: string) => void;
  /** Reminds again in a few minutes (10 by default); the task itself does not change. */
  snooze: (id: string, minutes?: number) => void;
  /**
   * Applies ticks made on a home-screen widget while the app was in the background. A tick is
   * skipped when the task is gone, already in that state, or has moved to another date since.
   */
  applyWidgetToggles: (toggles: readonly WidgetToggle[]) => void;
  getTask: (id: string) => Task | undefined;
}

const REMINDERS: readonly ReminderOffset[] = ['atTime', '10m', '1h', '1d', 'morning', 'custom'];
const REPEATS: readonly Repeat[] = ['none', 'daily', 'weekly'];

/**
 * The task ticked off (or back on) at `when` (now, or when it was ticked on a widget). A repeating
 * task moves to its next date after that day and stays open.
 */
const flipped = (t: Task, when: Date = new Date()): Task => {
  if (!t.done) {
    // Like phone reminder apps: finishing one occurrence moves the task to the next one.
    const next = nextOccurrence(t, when);
    // completedAt records which day's occurrence was finished (for the summary card).
    if (next) return { ...t, date: next, completedAt: when.toISOString() };
    return { ...t, done: true, completedAt: when.toISOString() };
  }
  return { ...t, done: false, completedAt: undefined };
};

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Rebuilds a saved task field by field, so an older or damaged save cannot crash the list. */
const readTask = (raw: unknown): Task | null => {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id || typeof t.title !== 'string') return null;
  const done = t.done === true;
  const repeat = REPEATS.includes(t.repeat as Repeat) ? (t.repeat as Repeat) : 'none';
  const time = isTimeKey(t.time) ? t.time : undefined;
  let reminder = REMINDERS.includes(t.reminder as ReminderOffset) ? (t.reminder as ReminderOffset) : null;
  // A custom reminder without a usable value (damaged, or a 'before' that lost its time) is dropped.
  const reminderCustom = reminder === 'custom' ? cleanCustomReminder(t.reminderCustom, !!time) : undefined;
  if (reminder === 'custom' && !reminderCustom) reminder = null;
  return {
    id: t.id,
    title: t.title,
    notes: optionalString(t.notes),
    date: isDateKey(t.date) ? t.date : undefined,
    time,
    reminder,
    reminderCustom,
    repeat,
    courseCode: optionalString(t.courseCode),
    done,
    // A repeating task stays open, but keeps when its last occurrence was ticked off.
    completedAt: done || repeat !== 'none' ? optionalString(t.completedAt) : undefined,
    createdAt: optionalString(t.createdAt) ?? new Date(0).toISOString(),
  };
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const TasksContext = createContext<TasksValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  // The latest list, so actions called one after another (or from a notification) see each other's changes.
  const latest = useRef<Task[]>([]);
  // What the reminders were last synced against, to reschedule only the tasks that changed.
  const synced = useRef<Map<string, Task> | null>(null);
  // Set once the saved list was read (or there was none). Until then nothing is written back or
  // resynced: a failed read must not turn into saving an empty list over the student's tasks.
  const readOk = useRef(false);
  const lang = useLang();
  const syncedLang = useRef(lang);

  const commit = useCallback((next: Task[]) => {
    latest.current = next;
    setTasks(next);
  }, []);

  useEffect(() => {
    let alive = true;
    const read = async (attempt: number) => {
      let json: string | null;
      try {
        json = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        // Storage busy or failing (e.g. started in the background): try again, never save over it.
        if (alive && attempt < 3) setTimeout(() => read(attempt + 1), 1000 * (attempt + 1));
        return;
      }
      let list: Task[] = [];
      if (json) {
        let saved: Partial<Persisted> | null = null;
        try {
          saved = JSON.parse(json) as Partial<Persisted>;
        } catch {
          saved = null;
        }
        if (saved && Array.isArray(saved.tasks)) {
          list = saved.tasks.map(readTask).filter((t): t is Task => t !== null);
        } else {
          // Unreadable save: keep a copy aside before the next write replaces it.
          await AsyncStorage.setItem(BACKUP_KEY, json).catch(() => {});
        }
      }
      if (!alive) return;
      readOk.current = true;
      setSaved(true);
      // Keep anything added while the save was still loading. Always a new list, so the save and
      // the reminder effects run now that writing is allowed.
      const known = new Set(list.map((t) => t.id));
      commit([...list, ...latest.current.filter((t) => !known.has(t.id))]);
    };
    read(0).finally(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [commit]);

  // Saved right away (not debounced): a task ticked off from a notification button may be the
  // only thing the app does before the phone suspends it again.
  useEffect(() => {
    if (!loaded || !readOk.current) return;
    const data: Persisted = { version: 1, tasks };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
  }, [tasks, loaded]);

  useEffect(() => {
    if (!loaded || !readOk.current) return;
    const prev = synced.current;
    synced.current = new Map(tasks.map((t) => [t.id, t]));
    // First run after loading, or the language changed (the reminder text follows the language).
    if (!prev || syncedLang.current !== lang) {
      syncedLang.current = lang;
      resyncAllReminders(tasks);
      return;
    }
    for (const t of tasks) if (prev.get(t.id) !== t) syncTaskReminder(t);
    for (const id of prev.keys()) if (!synced.current.has(id)) cancelTaskReminder(id);
  }, [tasks, loaded, lang]);

  const addTask = useCallback(
    (d: TaskDraft): Task => {
      const task: Task = { ...normalizeDraft(d), id: newId(), done: false, createdAt: new Date().toISOString() };
      commit([...latest.current, task]);
      return task;
    },
    [commit],
  );

  const updateTask = useCallback(
    (id: string, d: TaskDraft) => {
      const draft = normalizeDraft(d);
      commit(latest.current.map((t) => (t.id === id ? { ...t, ...draft } : t)));
    },
    [commit],
  );

  const deleteTask = useCallback(
    (id: string) => {
      commit(latest.current.filter((t) => t.id !== id));
    },
    [commit],
  );

  const deleteTasks = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      commit(latest.current.filter((t) => !gone.has(t.id)));
    },
    [commit],
  );

  const restoreTasks = useCallback(
    (back: readonly Task[]) => {
      const known = new Set(latest.current.map((t) => t.id));
      const missing = back.filter((t) => !known.has(t.id));
      if (missing.length) commit([...latest.current, ...missing]);
    },
    [commit],
  );

  const toggleDone = useCallback(
    (id: string) => {
      commit(latest.current.map((t) => (t.id === id ? flipped(t) : t)));
    },
    [commit],
  );

  const applyWidgetToggles = useCallback(
    (toggles: readonly WidgetToggle[]) => {
      let changed = false;
      let list = latest.current;
      for (const w of toggles) {
        list = list.map((t) => {
          if (t.id !== w.id || t.done === w.done || (t.date ?? null) !== w.date) return t;
          changed = true;
          // At the tick's own time: a daily task ticked Monday and applied Wednesday moves to Tuesday.
          return flipped(t, w.at ? new Date(w.at) : new Date());
        });
      }
      if (changed) commit(list);
    },
    [commit],
  );

  const snooze = useCallback((id: string, minutes = SNOOZE_MINUTES) => {
    const task = latest.current.find((t) => t.id === id);
    if (task && !task.done) snoozeReminder(task, minutes);
  }, []);

  // Reads the rendered list (not the ref) so a memoized screen asking for a task re-reads it after a change.
  const getTask = useCallback((id: string) => tasks.find((t) => t.id === id), [tasks]);

  const value = useMemo<TasksValue>(
    () => ({
      tasks,
      loaded,
      saved,
      addTask,
      updateTask,
      deleteTask,
      deleteTasks,
      restoreTasks,
      toggleDone,
      snooze,
      applyWidgetToggles,
      getTask,
    }),
    [tasks, loaded, saved, addTask, updateTask, deleteTask, deleteTasks, restoreTasks, toggleDone, snooze, applyWidgetToggles, getTask],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksValue {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error('useTasks must be used inside TasksProvider');
  return ctx;
}
