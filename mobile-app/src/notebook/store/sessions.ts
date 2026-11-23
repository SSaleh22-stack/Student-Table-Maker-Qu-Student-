/**
 * The app's session registry (core createRegistry, 5 s grace) and the flush when the app leaves
 * the foreground (NB-81).
 *
 * - notebookRegistry() creates the registry on first use (native only). Each session saves its
 *   index entry into the index store (upsertEntry keeps the store-owned fields) and reports onSaved.
 * - installAppStateFlush() adds ONE AppState listener (ref-counted): on 'background' and on
 *   'inactive' every open session is flushed, then the index is written at once.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { upsertEntry } from '@/notebook/core/library/derive';
import type { IndexEntry } from '@/notebook/core/model';
import { createRegistry, SESSION_GRACE_MS } from '@/notebook/core/session/registry';
import { openSession } from '@/notebook/core/session/session';
import type { Registry } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';

import { makeSessionDeps, nbClearTimer, nbSetTimer } from './deps';
import { emitSaved } from './events';
import { flushIndexNow, indexStore } from './indexStore';

let registry: Registry | null = null;

const onIndexEntry = (e: IndexEntry): void => {
  indexStore.update((f) => upsertEntry(f, e));
};

/** The registry of open notebook sessions. Throws on web (the notebook needs the native apps). */
export function notebookRegistry(): Registry {
  if (!notebookSupported) throw new Error('The notebook is not available on this platform');
  if (!registry) {
    const deps = makeSessionDeps({ onIndexEntry, onSaved: emitSaved });
    registry = createRegistry({
      open: (id) => openSession(deps, id),
      graceMs: SESSION_GRACE_MS,
      setTimer: nbSetTimer,
      clearTimer: nbClearTimer,
    });
  }
  return registry;
}

/** The registry when it exists (no session was ever opened: null). */
export function existingRegistry(): Registry | null {
  return registry;
}

/** Saves every open session, then writes the index. Never rejects. */
export async function flushNotebooks(): Promise<void> {
  // The index first: the app may be suspended before the sessions finish.
  void flushIndexNow();
  try {
    await registry?.flushAll();
  } catch {
    // flushAll settles every session; nothing else to do.
  }
  await flushIndexNow();
}

let appStateUsers = 0;
let appStateSub: { remove(): void } | null = null;

/** Starts the background flush (one AppState listener however many callers). Returns the stop. */
export function installAppStateFlush(): () => void {
  if (!notebookSupported) return () => {};
  appStateUsers++;
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') void flushNotebooks();
    });
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    appStateUsers--;
    if (appStateUsers <= 0 && appStateSub) {
      appStateUsers = 0;
      appStateSub.remove();
      appStateSub = null;
    }
  };
}
