/**
 * The app's side of the injected dependencies of the notebook core (P03): the expo-file-system
 * adapter, the notebooks root, the clock, ids, timers and the app version.
 *
 * Nothing here touches the disk at import time: nbRoot() creates Paths.document/notebooks on first
 * use, and it is only called on iOS and Android (the store never calls it on web).
 */
import Constants from 'expo-constants';

import type { FsAdapter } from '@/notebook/core/fs/adapter';
import { newId } from '@/notebook/core/model';
import type { Id } from '@/notebook/core/model';
import type { LibraryOpsDeps, SessionDeps } from '@/notebook/core/session/types';
import { expoFs, freeBytes, notebooksRoot } from '@/notebook/fs/expoFs';

/** Written into every notebook.json ("app"). */
export const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';

export const nbFs: FsAdapter = expoFs;

/** A new random id (pages, items, notebooks, clipboard folders). JS only. */
export const nbNewId = (): Id => newId();

export const nbNow = (): number => Date.now();

export const nbSetTimer = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);

export const nbClearTimer = (h: unknown): void => {
  clearTimeout(h as ReturnType<typeof setTimeout>);
};

/** Paths.document/notebooks (created on first call). Native only. */
export const nbRoot = (): string => notebooksRoot();

/** Free device space in bytes, or null when it cannot be read. */
export function nbFreeBytes(): number | null {
  try {
    const n = freeBytes();
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** SessionDeps for openSession, with the store's index and event hooks. */
export function makeSessionDeps(hooks: Pick<SessionDeps, 'onIndexEntry' | 'onSaved'>): SessionDeps {
  return {
    fs: nbFs,
    root: nbRoot(),
    now: nbNow,
    newId: nbNewId,
    setTimer: nbSetTimer,
    clearTimer: nbClearTimer,
    appVersion,
    onIndexEntry: hooks.onIndexEntry,
    onSaved: hooks.onSaved,
  };
}

/** LibraryOpsDeps for createLibraryOps, with the store's index, registry and callbacks. */
export function makeLibraryDeps(o: Pick<LibraryOpsDeps, 'index' | 'sessions' | 'chosenCodes' | 'copyTitle' | 'onChanged'>): LibraryOpsDeps {
  return {
    fs: nbFs,
    root: nbRoot(),
    now: nbNow,
    newId: nbNewId,
    appVersion,
    index: o.index,
    sessions: o.sessions,
    chosenCodes: o.chosenCodes,
    copyTitle: o.copyTitle,
    onChanged: o.onChanged,
  };
}
