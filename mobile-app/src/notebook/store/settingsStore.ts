/**
 * Notebook settings in AsyncStorage ('qu-student:notebooks:settings:v1').
 *
 * Same read pattern as Tasks.tsx: up to 3 retries, no write before the saved settings were read
 * (readOk), an unreadable save kept aside under ':unreadable', and changes made while loading
 * replayed on the saved settings.
 *
 * setSettings(patch | updater) deep-merges (core deepMerge: objects merge, arrays are replaced)
 * into the LATEST in-memory settings at call time, so writers pass only the fields they own and a
 * stale patch never clobbers sibling fields. Every change is written right away.
 *
 * Defaults depend on the device: Pen input on tablets, Finger with finger drawing on phones (NB-51).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';

import { TABLET_MIN } from '@/lib/layout';
import { deepMerge, defaultsFor, isRecord, readSettings } from '@/notebook/core/model';
import type { DeepPartial, NotebookSettings } from '@/notebook/core/model';

const STORAGE_KEY = 'qu-student:notebooks:settings:v1';
/** Where a save that could not be read is kept, so it is never lost by the next write. */
const BACKUP_KEY = 'qu-student:notebooks:settings:v1:unreadable';

export type SettingsPatch = DeepPartial<NotebookSettings> | ((s: NotebookSettings) => DeepPartial<NotebookSettings>);

function isTabletDevice(): boolean {
  try {
    const { width, height } = Dimensions.get('screen');
    return Math.min(width, height) >= TABLET_MIN;
  } catch {
    return false;
  }
}

const tablet = isTabletDevice();
let state: NotebookSettings = defaultsFor(tablet);
let loaded = false;
let readOk = false;
let gaveUp = false;
let loading: Promise<void> | null = null;
/** Patches made before the read, replayed (updaters run again) on the saved settings. */
const pending: SettingsPatch[] = [];
const listeners = new Set<() => void>();
let chain: Promise<void> = Promise.resolve();

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

const WRITE_RETRY_MS = 2000;
/** A write is queued and has not started: it will store the latest settings, so no second one is needed. */
let queued = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function write(): void {
  if (!readOk || queued) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  queued = true;
  // The write stores whatever is latest when it runs; changes made meanwhile need no extra write.
  chain = chain
    .then(() => {
      queued = false;
      return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    })
    .catch(() => {
      queued = false;
      // Storage busy or failing: try again a little later with whatever is latest then.
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          write();
        }, WRITE_RETRY_MS);
      }
    });
}

/**
 * next with every part that did not change replaced by the same part of prev (prev itself when
 * nothing changed), so a patch that changes nothing re-renders nothing and memo deps on
 * settings.pen, settings.calc… only change when that part changed.
 */
function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return next;
    const out = next.map((v, i) => share(prev[i], v));
    return out.every((v, i) => v === prev[i]) ? prev : out;
  }
  if (isRecord(prev) && isRecord(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = share(prev[k], next[k]);
      if (!(k in prev) || out[k] !== prev[k]) same = false;
    }
    return same ? prev : out;
  }
  return next;
}

const resolvePatch = (p: SettingsPatch, base: NotebookSettings): DeepPartial<NotebookSettings> => (typeof p === 'function' ? p(base) : p);

export function getSettings(): NotebookSettings {
  return state;
}

export function setSettings(patch: SettingsPatch): void {
  if (!readOk && !gaveUp) pending.push(patch);
  const p = resolvePatch(patch, state);
  if (!p) return;
  const next = share(state, deepMerge(state, p)) as NotebookSettings;
  if (next === state) return;
  state = next;
  write();
  notify();
}

/** Reads the saved settings once (later calls return the same promise). */
export function loadSettings(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    const finish = () => {
      loaded = true;
      notify();
      resolve();
    };
    const read = async (attempt: number): Promise<void> => {
      let json: string | null;
      try {
        json = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        // Storage busy or failing: try again, never save over it.
        if (attempt < 3) {
          setTimeout(() => void read(attempt + 1), 1000 * (attempt + 1));
          return;
        }
        gaveUp = true;
        pending.length = 0;
        finish();
        return;
      }
      let saved = defaultsFor(tablet);
      if (json) {
        let fromDisk: NotebookSettings | null = null;
        try {
          const raw: unknown = JSON.parse(json);
          if (isRecord(raw)) fromDisk = readSettings(raw, tablet);
        } catch {
          fromDisk = null;
        }
        if (fromDisk) saved = fromDisk;
        // Unreadable save: keep a copy aside before the next write replaces it.
        else await AsyncStorage.setItem(BACKUP_KEY, json).catch(() => {});
      }
      readOk = true;
      let next = saved;
      for (const p of pending.splice(0)) {
        try {
          const patch = resolvePatch(p, next);
          if (patch) next = deepMerge(next, patch);
        } catch {
          // A change that no longer applies is dropped.
        }
      }
      state = next;
      write();
      finish();
    };
    void read(0);
  });
  return loading;
}

export const settingsStore = {
  get: getSettings,
  set: setSettings,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  /** The same object until the settings change. */
  getSnapshot: getSettings,
  isLoaded: (): boolean => loaded,
  isReadOk: (): boolean => readOk,
};
