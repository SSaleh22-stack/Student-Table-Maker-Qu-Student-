/**
 * The cover thumbnail worker (NB-14): the ONLY writer of notebooks/<id>/thumbs/cover.png.
 *
 * useThumbnailWorker() is mounted once, by NotebookServices (P30). It is a MODULE SINGLETON with a
 * reference count: mounting it twice (a remount, StrictMode, a second host by mistake) still runs ONE
 * worker; the worker stops when the last mount goes away. thumbnailWorkerStats() is the test hook.
 *
 * What it does:
 * - Listens to store events: onSaved with firstPageChanged, and onThumbRequested (store.requestThumb,
 *   e.g. after an import). Each request is debounced 3 s per notebook, so a burst of saves while the
 *   student writes on page 1 gives one render after they pause.
 * - A per-notebook mutex: at most one render per notebook at a time. A request that arrives while a
 *   render runs supersedes it: the running render's result is dropped (not written) and the notebook
 *   is rendered once more afterwards.
 * - A render: page 0 through pageThumb (P16) at COVER_WIDTH_PX (360), copied to thumbs/cover.png.tmp
 *   and moved over thumbs/cover.png (never half a file under the real name), then store.setThumb(id)
 *   (thumbRev + 1, needsThumb cleared), which the library's cards use to reload the cover.
 * - Idle backfill: once the index is loaded, and after every library change, notebooks with
 *   thumbRev 0 or needsThumb are rendered one by one with a pause between them. Trashed notebooks are
 *   skipped (they are rendered again when restored and edited, or requested). A notebook that failed
 *   MAX_FAILURES times is left alone until something requests it again.
 *
 * The session comes from the store (openSession / releaseSession), so a notebook open in the editor
 * is rendered from its live state. JS runtime only. Does nothing on web.
 */
import { useEffect } from 'react';

import { nbLayout } from '@/notebook/core/fs/layout';
import type { Id, IndexEntry } from '@/notebook/core/model';
import { notebookSupported } from '@/notebook/flags';
import { expoFs, notebooksRoot } from '@/notebook/fs/expoFs';
import { pageThumb } from '@/notebook/ink';
import { getNotebooksStore, notebookEvents, type NotebooksStore } from '@/notebook/store/hooks';

/** Cover width in pixels (thumbs/cover.png). */
export const COVER_WIDTH_PX = 360;
/** Debounce per notebook between a save/request and the render. */
export const COVER_DEBOUNCE_MS = 3000;
/** First backfill pass after the worker starts. */
const BACKFILL_START_MS = 4000;
/** Pause between two backfill renders. */
const BACKFILL_GAP_MS = 1500;
/** Retry interval while the index is not loaded yet. */
const WAIT_LOADED_MS = 2000;
/** After this many failed renders a notebook is not backfilled again (an explicit request still renders it). */
const MAX_FAILURES = 3;

interface NotebookState {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** Run again when the current render ends. */
  again: boolean;
  /** Bumped by every request; a render whose generation is old is dropped. */
  gen: number;
}

interface Worker {
  stop(): void;
}

function warn(message: string, e?: unknown): void {
  if (__DEV__) console.warn(`[thumbnails] ${message}`, e ?? '');
}

const sleep = (ms: number, timers: Set<ReturnType<typeof setTimeout>>) =>
  new Promise<void>((resolve) => {
    const h = setTimeout(() => {
      timers.delete(h);
      resolve();
    }, ms);
    timers.add(h);
  });

/** Copies the rendered PNG into place: cover.png.tmp, then a move over cover.png. */
async function writeCover(id: Id, pngUri: string): Promise<boolean> {
  const paths = nbLayout(notebooksRoot()).notebook(id);
  // Purged meanwhile: never re-create the folder of a deleted notebook.
  if (!(await expoFs.exists(paths.json))) return false;
  await expoFs.mkdirp(paths.thumbsDir);
  const tmp = `${paths.cover}.tmp`;
  try {
    await expoFs.copy(pngUri, tmp);
    await expoFs.move(tmp, paths.cover);
  } catch (e) {
    await expoFs.remove(tmp).catch(() => {});
    throw e;
  }
  return true;
}

function needsCover(e: IndexEntry): boolean {
  return !e.deletedAt && (e.thumbRev === 0 || e.needsThumb === true);
}

function startWorker(): Worker {
  let stopped = false;
  const states = new Map<Id, NotebookState>();
  const failures = new Map<Id, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let backfilling = false;
  let backfillAgain = false;

  const stateOf = (id: Id): NotebookState => {
    let st = states.get(id);
    if (!st) {
      st = { timer: null, running: false, again: false, gen: 0 };
      states.set(id, st);
    }
    return st;
  };

  const forget = (id: Id) => {
    const st = states.get(id);
    if (st && !st.running && !st.timer && !st.again) states.delete(id);
  };

  /**
   * One render of notebook id: 'written' when the cover was written, 'dropped' when it was gone,
   * trashed, superseded or the worker stopped, 'empty' when there is no page to draw (counted as a
   * failure, so the backfill does not reopen the notebook on every library change).
   */
  async function render(store: NotebooksStore, id: Id, superseded: () => boolean): Promise<'written' | 'dropped' | 'empty'> {
    const entry = store.entries.find((e) => e.id === id);
    if (!entry || entry.deletedAt) return 'dropped';
    const session = await store.openSession(id);
    try {
      const first = session.notebook.pageIds[0];
      if (!first) return 'empty';
      const uri = await pageThumb(session, first, COVER_WIDTH_PX);
      if (stopped || superseded()) return 'dropped';
      if (!(await writeCover(id, uri))) return 'dropped';
      if (stopped) return 'written';
      // The store may have been remounted meanwhile: use the current one.
      (getNotebooksStore() ?? store).setThumb(id);
      return 'written';
    } finally {
      store.releaseSession(id);
    }
  }

  async function run(id: Id): Promise<void> {
    const st = stateOf(id);
    if (st.running) {
      st.again = true;
      return;
    }
    const store = getNotebooksStore();
    if (!store || !store.loaded) {
      // Not ready yet: try again later.
      schedule(id, WAIT_LOADED_MS);
      return;
    }
    st.running = true;
    const gen = st.gen;
    try {
      const result = await render(store, id, () => stateOf(id).gen !== gen);
      if (result === 'written') failures.delete(id);
      else if (result === 'empty') failures.set(id, (failures.get(id) ?? 0) + 1);
    } catch (e) {
      failures.set(id, (failures.get(id) ?? 0) + 1);
      warn(`cover of ${id} failed`, e);
    } finally {
      st.running = false;
      if (st.again && !stopped) {
        st.again = false;
        void run(id);
      } else {
        forget(id);
      }
    }
  }

  function schedule(id: Id, delay: number = COVER_DEBOUNCE_MS): void {
    if (stopped) return;
    const st = stateOf(id);
    st.gen += 1;
    if (st.timer) {
      clearTimeout(st.timer);
      timers.delete(st.timer);
    }
    const h = setTimeout(() => {
      timers.delete(h);
      st.timer = null;
      if (!stopped) void run(id);
    }, delay);
    st.timer = h;
    timers.add(h);
  }

  async function backfill(): Promise<void> {
    if (stopped) return;
    if (backfilling) {
      backfillAgain = true;
      return;
    }
    backfilling = true;
    try {
      do {
        backfillAgain = false;
        const store = getNotebooksStore();
        if (!store || !store.loaded) {
          await sleep(WAIT_LOADED_MS, timers);
          backfillAgain = true;
          continue;
        }
        const todo = store.entries.filter((e) => needsCover(e) && (failures.get(e.id) ?? 0) < MAX_FAILURES).map((e) => e.id);
        for (const id of todo) {
          if (stopped) return;
          const st = states.get(id);
          // A pending or running render covers it already.
          if (st && (st.running || st.timer)) continue;
          // Still needed? (an event may have rendered it meanwhile)
          const now = getNotebooksStore()?.entries.find((e) => e.id === id);
          if (!now || !needsCover(now)) continue;
          await run(id);
          await sleep(BACKFILL_GAP_MS, timers);
        }
      } while (backfillAgain && !stopped);
    } finally {
      backfilling = false;
    }
  }

  const offSaved = notebookEvents.onSaved((id, info) => {
    if (info.firstPageChanged) schedule(id);
  });
  const offRequested = notebookEvents.onThumbRequested((id) => {
    failures.delete(id);
    schedule(id);
  });
  const offLibrary = notebookEvents.onLibraryChanged(() => {
    void backfill();
  });
  const startTimer = setTimeout(() => {
    timers.delete(startTimer);
    void backfill();
  }, BACKFILL_START_MS);
  timers.add(startTimer);

  return {
    stop() {
      stopped = true;
      offSaved();
      offRequested();
      offLibrary();
      for (const h of timers) clearTimeout(h);
      timers.clear();
      for (const st of states.values()) st.timer = null;
      states.clear();
    },
  };
}

// ===== the module singleton

let refs = 0;
let worker: Worker | null = null;
let starts = 0;

/** Takes a reference on the worker (starting it on the first one). Returns the release function. */
export function acquireThumbnailWorker(): () => void {
  if (!notebookSupported) return () => {};
  refs += 1;
  if (refs === 1 && !worker) {
    worker = startWorker();
    starts += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0 && worker) {
      worker.stop();
      worker = null;
    }
  };
}

/** Test and debug hook: mounts (refs), workers started so far (starts), and whether one runs now. */
export function thumbnailWorkerStats(): { refs: number; starts: number; running: boolean } {
  return { refs, starts, running: worker !== null };
}

/**
 * Runs the cover worker while mounted. Mount it ONLY in NotebookServices; extra mounts share the
 * same worker (ref-counted).
 */
export function useThumbnailWorker(): void {
  useEffect(() => acquireThumbnailWorker(), []);
}
