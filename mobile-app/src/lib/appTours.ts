/**
 * The app's own first-time tours (outside the notebook): 'home' (import courses, then build the
 * timetable) the first time the app opens, and 'tasks' the first time the tasks tab opens.
 *
 * - Flags live in AsyncStorage ('qu-student:app-tours:v1'): a tour that finished or was skipped never
 *   shows again on its own. A tour whose targets could not be found leaves its flag unseen.
 * - introDone: the opening animation has finished (the root layout reports it), so a tour never
 *   starts under it.
 * - useAppTour(name) re-renders when the flags load or change.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type AppTourName = 'home' | 'tasks';
export type AppTourFlag = 'unseen' | 'done' | 'skipped';

const KEY = 'qu-student:app-tours:v1';

interface State {
  loaded: boolean;
  introDone: boolean;
  flags: Record<AppTourName, AppTourFlag>;
}

let state: State = { loaded: false, introDone: false, flags: { home: 'unseen', tasks: 'unseen' } };
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const cb of [...listeners]) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const isFlag = (v: unknown): v is AppTourFlag => v === 'unseen' || v === 'done' || v === 'skipped';

let loading = false;
function load(): void {
  if (state.loaded || loading) return;
  loading = true;
  AsyncStorage.getItem(KEY)
    .then((json) => {
      const raw = json ? (JSON.parse(json) as Record<string, unknown>) : {};
      set({
        ...state,
        loaded: true,
        flags: { home: isFlag(raw.home) ? raw.home : 'unseen', tasks: isFlag(raw.tasks) ? raw.tasks : 'unseen' },
      });
    })
    .catch(() => {
      // Unreadable: show nothing rather than a tour every launch.
      set({ ...state, loaded: true, flags: { home: 'skipped', tasks: 'skipped' } });
    })
    .finally(() => {
      loading = false;
    });
}

/** The root layout calls this once the opening animation is gone. */
export function markIntroDone(): void {
  if (!state.introDone) set({ ...state, introDone: true });
}

export function setAppTourFlag(name: AppTourName, flag: AppTourFlag): void {
  const flags = { ...state.flags, [name]: flag };
  set({ ...state, flags });
  AsyncStorage.setItem(KEY, JSON.stringify(flags)).catch(() => {});
}

/** Marks both tours unseen again (they show the next time their screen opens). */
export function resetAppTours(): void {
  setAppTourFlag('home', 'unseen');
  setAppTourFlag('tasks', 'unseen');
}

/** Whether the tour should run now: flags loaded, still unseen, and the intro is gone. */
export function useAppTour(name: AppTourName): boolean {
  load();
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return s.loaded && s.introDone && s.flags[name] === 'unseen';
}
