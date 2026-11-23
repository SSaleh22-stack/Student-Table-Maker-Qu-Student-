/**
 * The calculator's machine state (NB-47a): one module singleton for the whole app, so the docked
 * and the floating panel (and a language remount) show the same calculation.
 *
 * - Read with useSyncExternalStore(subscribeCalc, getCalcSnapshot): the snapshot is cached, the same
 *   object until the machine or the loaded flag changes.
 * - Saved to AsyncStorage 'qu-student:notebooks:calc:v1' as encodeMachine(s), which is
 *   JSON.stringify(encodePersist(persist(s))) with bigints as decimal strings, 500 ms after the last
 *   key, and at once when the app goes to the background.
 * - Read in the Tasks.tsx pattern: up to 3 retries, no write before the saved state was read
 *   (readOk), an unreadable save kept aside under ':unreadable', and keys pressed while loading
 *   replayed on the restored machine. decodeMachine (P19 decodePersist) never throws.
 *
 * What persists (P19 persist): mode, setup, memories A–F X Y M, Ans (exact fractions included),
 * matrices, vectors, STAT data and the history. Open menus, screens and the input do not.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';

import { initialMachine, press as pressKey, type KeyState } from '@/notebook/core/calc/keys/machine';
import { cloneRow, validCursor } from '@/notebook/core/calc/keys/editor';
import type { KeyId } from '@/notebook/core/calc/types';

import { decodeMachine, encodeMachine, installCalc } from './installCalc';

export const CALC_STORAGE_KEY = 'qu-student:notebooks:calc:v1';
/** Where a save that could not be read is kept, so the next write never loses it. */
const BACKUP_KEY = 'qu-student:notebooks:calc:v1:unreadable';
const SAVE_DEBOUNCE_MS = 500;
const WRITE_RETRY_MS = 2000;

export interface CalcSnapshot {
  machine: KeyState;
  /** The saved state was read (or every retry failed). Keys still work before that. */
  loaded: boolean;
}

let machine: KeyState | null = null;
let loaded = false;
let readOk = false;
let loading: Promise<void> | null = null;
/** Keys pressed before the saved state was read, replayed on it. */
const pendingKeys: KeyId[] = [];
let snapshot: CalcSnapshot | null = null;
const listeners = new Set<() => void>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: string | null = null;
let chain: Promise<void> = Promise.resolve();
let appStateHooked = false;

function current(): KeyState {
  if (!machine) {
    installCalc();
    machine = initialMachine();
  }
  return machine;
}

function notify(): void {
  snapshot = null;
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

function set(next: KeyState): void {
  if (next === machine) return;
  machine = next;
  scheduleSave();
  notify();
}

// ===== saving

function writeNow(): void {
  if (!readOk) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  let text: string;
  try {
    text = encodeMachine(current());
  } catch {
    return;
  }
  if (text === lastSaved) return;
  lastSaved = text;
  chain = chain
    .then(() => AsyncStorage.setItem(CALC_STORAGE_KEY, text))
    .catch(() => {
      // Storage busy or failing: write the latest state again a little later.
      lastSaved = null;
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          writeNow();
        }, WRITE_RETRY_MS);
      }
    });
}

function scheduleSave(): void {
  if (!readOk) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, SAVE_DEBOUNCE_MS);
}

function onAppState(next: AppStateStatus): void {
  if (next === 'background' || next === 'inactive') writeNow();
}

// ===== loading

/** Reads the saved calculator once (later calls return the same promise). */
export function loadCalc(): Promise<void> {
  if (loading) return loading;
  installCalc();
  if (!appStateHooked) {
    appStateHooked = true;
    AppState.addEventListener('change', onAppState);
  }
  loading = new Promise<void>((resolve) => {
    const finish = () => {
      loaded = true;
      notify();
      resolve();
    };
    const read = async (attempt: number): Promise<void> => {
      let json: string | null;
      try {
        json = await AsyncStorage.getItem(CALC_STORAGE_KEY);
      } catch {
        // Storage busy or failing: try again, and never save over what may be there.
        if (attempt < 3) {
          setTimeout(() => void read(attempt + 1).catch(() => {}), 1000 * (attempt + 1));
          return;
        }
        pendingKeys.length = 0;
        finish();
        return;
      }
      try {
        const { machine: restored, unreadable } = decodeMachine(json);
        if (unreadable && json) await AsyncStorage.setItem(BACKUP_KEY, json).catch(() => {});
        let next = restored;
        for (const k of pendingKeys.splice(0)) next = safePress(next, k);
        machine = next;
        lastSaved = unreadable ? null : json;
        readOk = true;
        scheduleSave();
      } finally {
        // Whatever happens above, the calculator never stays stuck in "loading".
        pendingKeys.length = 0;
        finish();
      }
    };
    void read(0).catch(() => {});
  });
  return loading;
}

// ===== actions

/** press() that never throws: an engine failure leaves the state as it was. */
function safePress(s: KeyState, k: KeyId): KeyState {
  try {
    return pressKey(s, k);
  } catch {
    return s;
  }
}

/** Presses one calculator key. */
export function pressCalc(k: KeyId): void {
  if (!readOk && !loaded) pendingKeys.push(k);
  set(safePress(current(), k));
}

/** True when the calculation input is on screen and nothing covers it (menu, screen, prompt, error). */
function onCalcScreen(s: KeyState): boolean {
  return !s.error && s.menu.length === 0 && !s.screen && !s.prompt && !s.pending && !s.aux.message;
}

/**
 * Places the caret at an editor path (a tap on the LCD input, from P19 pathAt). A tap on a shown
 * result starts editing it there. Ignored on menus, mode screens and prompts, or for a bad path.
 */
export function setCalcCursor(path: number[]): void {
  // Before the saved state is read the change would be lost when it arrives (keys are replayed, taps not).
  if (!loaded) return;
  const s = current();
  if (!onCalcScreen(s) || !validCursor(s.editor.row, path)) return;
  if (!s.result) {
    set({ ...s, editor: { ...s.editor, cursor: path.slice() } });
    return;
  }
  set({
    ...s,
    result: null,
    editor: { ...s.editor, cursor: path.slice() },
    aux: { ...s.aux, live: false, histPos: null, dms: false, fracAlt: false, suffix: null, run: null },
  });
}

/** Puts a history entry's input back in the editor (a tap on a history row), caret at its end. */
export function recallCalcHistory(index: number): void {
  if (!loaded) return;
  const s = current();
  const h = s.history[index];
  if (!h || !onCalcScreen(s)) return;
  const row = cloneRow(h.input);
  set({
    ...s,
    shift: false,
    alpha: false,
    result: null,
    editor: { ...s.editor, row, cursor: [row.length] },
    aux: { ...s.aux, live: false, histPos: null, dms: false, fracAlt: false, suffix: null, run: null },
  });
}

// ===== store

export function subscribeCalc(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Cached: the same object until the machine or the loaded flag changes. */
export function getCalcSnapshot(): CalcSnapshot {
  if (!snapshot) snapshot = { machine: current(), loaded };
  return snapshot;
}

/** Writes any pending change now (e.g. before the editor closes). */
export function flushCalc(): void {
  writeNow();
}
