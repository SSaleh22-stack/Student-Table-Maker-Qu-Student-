/**
 * The notebook index in AsyncStorage ('qu-student:notebooks:v1'): entries, folders, courseNames and
 * purged tombstones (NB-80). The notebooks themselves are files (core/session, core/library).
 *
 * It follows the Tasks.tsx pattern:
 * - the read is tried again up to 3 times (1 s, 2 s, 3 s) when AsyncStorage fails;
 * - nothing is written until the saved index was read (readOk), so a failed read never turns into
 *   saving an empty index over the student's library;
 * - a save that cannot be read is kept aside under ':unreadable' before the next write replaces it;
 * - changes made while loading are kept: every update() before the read is replayed on the saved
 *   index once it is read.
 *
 * Writes are debounced by 300 ms and always write the latest index; flushIndexNow() writes at once
 * (the app going to the background). This is the IndexAccess the library ops use.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { emptyIndex, readIndex } from '@/notebook/core/model';
import type { IndexFile } from '@/notebook/core/model';
import type { IndexAccess } from '@/notebook/core/session/types';

const STORAGE_KEY = 'qu-student:notebooks:v1';
/** Where a save that could not be read is kept, so it is never lost by the next write. */
const BACKUP_KEY = 'qu-student:notebooks:v1:unreadable';
const WRITE_DEBOUNCE_MS = 300;
const WRITE_RETRY_MS = 2000;

let state: IndexFile = emptyIndex();
let loaded = false;
let readOk = false;
/** The read failed every time: changes stay in memory only (and are not kept for a replay). */
let gaveUp = false;
let loading: Promise<void> | null = null;
/** Updates made before the read, replayed on the saved index. */
const pending: ((f: IndexFile) => IndexFile)[] = [];
const listeners = new Set<() => void>();

let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
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

function schedule(ms: number): void {
  if (!readOk) return;
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushIndexNow();
  }, ms);
}

/** Writes the latest index now (when it changed and was read). Never rejects. */
export function flushIndexNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!readOk || !dirty) return chain;
  dirty = false;
  chain = chain
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)))
    .catch(() => {
      // Storage busy or failing: try again a little later with whatever is latest then.
      schedule(WRITE_RETRY_MS);
    });
  return chain;
}

function getIndex(): IndexFile {
  return state;
}

function updateIndex(fn: (f: IndexFile) => IndexFile): void {
  if (!readOk && !gaveUp) pending.push(fn);
  const next = fn(state);
  if (next === state) return;
  state = next;
  schedule(WRITE_DEBOUNCE_MS);
  notify();
}

/** Reads the saved index once (later calls return the same promise). */
export function loadIndex(): Promise<void> {
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
        // Storage busy or failing (e.g. started in the background): try again, never save over it.
        if (attempt < 3) {
          setTimeout(() => void read(attempt + 1), 1000 * (attempt + 1));
          return;
        }
        gaveUp = true;
        pending.length = 0;
        finish();
        return;
      }
      let saved: IndexFile = emptyIndex();
      if (json) {
        let index: IndexFile | null = null;
        try {
          index = readIndex(JSON.parse(json), Date.now());
        } catch {
          index = null;
        }
        if (index) saved = index;
        // Unreadable save: keep a copy aside before the next write replaces it.
        else await AsyncStorage.setItem(BACKUP_KEY, json).catch(() => {});
      }
      readOk = true;
      // Keep everything changed while the save was still loading.
      let next = saved;
      for (const fn of pending.splice(0)) {
        try {
          next = fn(next);
        } catch {
          // A change that no longer applies is dropped.
        }
      }
      state = next;
      // Written once now that writing is allowed (expired tombstones, replayed changes).
      schedule(0);
      finish();
    };
    void read(0);
  });
  return loading;
}

export const indexStore = {
  get: getIndex,
  update: updateIndex,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  /** The same object until the index changes. */
  getSnapshot: getIndex,
  /** The read finished (successfully or after every retry failed). */
  isLoaded: (): boolean => loaded,
  /** The saved index was read: writes are allowed. */
  isReadOk: (): boolean => readOk,
};

/** The IndexAccess passed to the library ops. */
export const indexAccess: IndexAccess = { get: getIndex, update: updateIndex };
