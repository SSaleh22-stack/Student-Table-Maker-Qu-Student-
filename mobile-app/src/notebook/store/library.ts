/**
 * NotebooksStore: the library ops (core createLibraryOps), the index and settings stores, the
 * session registry, the clipboard and the events, as one app-wide object (module singleton).
 *
 * Thin binding only: every rule lives in core (P03). This file
 * - builds the ops once (native only) with the index store, the registry (ops on an open notebook
 *   go through its session), the chosen course codes (folders still in the timetable are protected,
 *   NB-12) and a tr() copy title;
 * - keeps the timetable's chosen courses (NotebooksProvider passes useAppData().chosen) and records
 *   their names with ops.syncCourseNames whenever they change (NB-11: nothing moves on its own);
 * - exposes a cached snapshot for useSyncExternalStore (same object until the index, the settings,
 *   the chosen courses or the loaded flag change).
 *
 * On web nothing touches the disk: the store is loaded and empty, and ops reject.
 *
 * Contract extensions (accepted in P30 integration): beyond the shared NotebooksStore contract this
 * adds releaseSession (pairs with openSession, which acquires a registry reference),
 * deleteCourseFolder, stagingJob/endStagingJob and libraryWritten (core LibraryOps extras), and
 * clipboard.clear/subscribe.
 */
import { courseFolders, listEntries, patchEntry, sections as sectionsOf } from '@/notebook/core/library/derive';
import { LibraryError, createLibraryOps } from '@/notebook/core/library/ops';
import { computeUsage } from '@/notebook/core/library/usage';
import type { CourseFolder, Folder, Id, IndexEntry, IndexFile, LocationKey, NotebookSettings, PaperSpec, SortKey } from '@/notebook/core/model';
import type { CreateFromPages, LibraryOps, NotebookSession, Sections, StorageUsage } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';
import { tr } from '@/lib/i18n';

import { notebookClipboard, type NotebookClipboard } from './clipboard';
import { makeLibraryDeps, nbFreeBytes, nbFs, nbRoot } from './deps';
import { emitLibraryChanged, emitThumbRequested, notebookEvents, type NotebookEvents } from './events';
import { indexAccess, indexStore, loadIndex } from './indexStore';
import { notebookRegistry } from './sessions';
import { setSettings, settingsStore, type SettingsPatch } from './settingsStore';

export interface ChosenCourse {
  code: string;
  name: string;
}

export interface NotebooksStore {
  /** The index and the settings were read (always true on web). */
  loaded: boolean;
  /** Every index entry, trashed ones included (use list() for a view). */
  entries: IndexEntry[];
  folders: Folder[];
  /** Timetable course folders first (inTimetable), then orphan course folders. */
  courseFolders: CourseFolder[];
  settings: NotebookSettings;
  /** Deep-merged into the LATEST settings at call time, written right away. */
  setSettings(patch: SettingsPatch): void;
  list(where: LocationKey | 'deleted' | 'all', sort: SortKey, query?: string): IndexEntry[];
  sections(sort: SortKey, query?: string): Sections;

  createNotebook(i: { title: string; location: LocationKey; paper: PaperSpec }): Promise<Id>;
  createFromPages(i: CreateFromPages): Promise<Id>;
  adoptFolder(dir: string, location: LocationKey | null): Promise<Id>;
  renameNotebook(id: Id, t: string): Promise<void>;
  duplicateNotebook(id: Id): Promise<Id>;
  moveNotebook(id: Id, to: LocationKey): Promise<void>;
  trashNotebook(id: Id): Promise<void>;
  restoreNotebook(id: Id): Promise<void>;
  purgeNotebook(id: Id): Promise<void>;
  emptyTrash(): Promise<void>;
  createFolder(name: string): Folder;
  renameFolder(id: Id, name: string): void;
  deleteFolder(id: Id, nb: 'unfile' | 'trash'): Promise<void>;
  /** An orphan course folder becomes a user folder. */
  convertCourseFolder(code: string, newName: string): Promise<Folder>;
  /** Deletes an orphan course folder: its notebooks are unfiled or trashed. */
  deleteCourseFolder(code: string, nb: 'unfile' | 'trash'): Promise<void>;

  /** Acquires a registry reference (rejects with LibraryError 'missing' | 'unreadable'). Pair with releaseSession. */
  openSession(id: Id): Promise<NotebookSession>;
  /** Drops the reference openSession took (the session closes after the 5 s grace). */
  releaseSession(id: Id): void;

  /** Marks the notebook as needing a new cover and emits events.onThumbRequested. */
  requestThumb(id: Id): void;
  /** The cover was written (P23 only): thumbRev + 1, needsThumb cleared. */
  setThumb(id: Id): void;
  /** Background import progress on the card; undefined clears it. */
  setImporting(id: Id, p?: { done: number; total: number }): void;

  usage(): Promise<StorageUsage>;
  /** low = free < max(1 GB, 3 x needed). When free space cannot be read: { low: false, freeBytes: 0 }. */
  isLowStorage(neededBytes?: number): { low: boolean; freeBytes: number };

  /** A staging work folder boot() leaves alone while in use (imports, restores). */
  stagingJob(): Promise<{ id: Id; dir: string }>;
  endStagingJob(id: Id): Promise<void>;
  /** Resolves when library.json holds the latest folders and course names. */
  libraryWritten(): Promise<void>;

  clipboard: NotebookClipboard;
  events: NotebookEvents;
}

const GB = 1024 * 1024 * 1024;

let ops: LibraryOps | null = null;
let chosen: readonly ChosenCourse[] = [];
let booted: Promise<void> | null = null;

const unsupported = () => new Error('The notebook is not available on this platform');

/** The library ops (created on first use). Throws on web. */
export function libraryOps(): LibraryOps {
  if (!notebookSupported) throw unsupported();
  if (!ops) {
    ops = createLibraryOps(
      makeLibraryDeps({
        index: indexAccess,
        sessions: notebookRegistry(),
        chosenCodes: () => chosen.map((c) => c.code),
        copyTitle: (t) => tr(`${t} (نسخة)`, `${t} (copy)`),
        onChanged: emitLibraryChanged,
      }),
    );
  }
  return ops;
}

/**
 * Runs an op once the saved index was read (an op started at app launch, from a link or a share,
 * must see the student's library, not the empty one in memory before the read), turning a
 * synchronous failure (web, bad input) into a rejection.
 */
async function withOps<T>(fn: (o: LibraryOps) => Promise<T>): Promise<T> {
  const o = libraryOps();
  if (!indexStore.isLoaded()) await loadIndex();
  return fn(o);
}

// ===== chosen courses

const sameChosen = (a: readonly ChosenCourse[], b: readonly ChosenCourse[]) =>
  a.length === b.length && a.every((c, i) => c.code === b[i].code && c.name === b[i].name);

/** Records the timetable's course names (only once the saved index was read). */
export function syncChosenCourses(): void {
  if (!notebookSupported || !indexStore.isReadOk()) return;
  try {
    libraryOps().syncCourseNames(chosen.slice());
  } catch {
    // Next change.
  }
}

/** The timetable's chosen sections (several may share a code; core keeps the first per code). */
export function setChosenCourses(list: readonly ChosenCourse[]): void {
  const next = list.map((c) => ({ code: String(c.code ?? ''), name: String(c.name ?? '') }));
  if (sameChosen(next, chosen)) return;
  chosen = next;
  notify();
  syncChosenCourses();
}

// ===== boot

/** Cleans staging and inbox, purges old trash and reconciles the index with the disk (once per app run). */
export function bootLibrary(): Promise<void> {
  if (!notebookSupported || !indexStore.isReadOk()) return Promise.resolve();
  if (!booted) {
    booted = (async () => {
      try {
        await libraryOps().boot();
      } catch {
        // Boot is best effort; the next app start tries again.
      }
    })();
  }
  return booted;
}

// ===== snapshot

const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

indexStore.subscribe(notify);
settingsStore.subscribe(notify);

const isLoaded = (): boolean => !notebookSupported || (indexStore.isLoaded() && settingsStore.isLoaded());

const updateEntry = (id: Id, fn: (e: IndexEntry) => Partial<IndexEntry> | null) =>
  indexStore.update((f: IndexFile) => {
    const e = f.entries.find((x) => x.id === id);
    if (!e) return f;
    const patch = fn(e);
    return patch ? patchEntry(f, id, patch) : f;
  });

const methods: Omit<NotebooksStore, 'loaded' | 'entries' | 'folders' | 'courseFolders' | 'settings'> = {
  setSettings,
  list: (where, sort, query) => listEntries(indexStore.get(), where, sort, query, chosen),
  sections: (sort, query) => {
    const f = indexStore.get();
    return sectionsOf(f, courseFolders(chosen, f), sort, query, chosen);
  },

  createNotebook: (i) => withOps((o) => o.create(i)),
  createFromPages: (i) => withOps((o) => o.createFromPages(i)),
  adoptFolder: (dir, location) => withOps((o) => o.adoptFolder(dir, location)),
  renameNotebook: (id, t) => withOps((o) => o.rename(id, t)),
  duplicateNotebook: (id) => withOps((o) => o.duplicate(id)),
  moveNotebook: (id, to) => withOps((o) => o.move(id, to)),
  trashNotebook: (id) => withOps((o) => o.trash(id)),
  restoreNotebook: (id) => withOps((o) => o.restore(id)),
  purgeNotebook: (id) => withOps((o) => o.purge(id)),
  emptyTrash: () => withOps((o) => o.emptyTrash()),
  createFolder: (name) => libraryOps().createFolder(name),
  renameFolder: (id, name) => libraryOps().renameFolder(id, name),
  deleteFolder: (id, nb) => withOps((o) => o.deleteFolder(id, nb)),
  convertCourseFolder: (code, newName) => withOps((o) => o.convertCourseFolder(code, newName)),
  deleteCourseFolder: (code, nb) => withOps((o) => o.deleteCourseFolder(code, nb)),

  async openSession(id) {
    const r = await notebookRegistry().acquire(id);
    if ('session' in r) return r.session;
    throw new LibraryError(r.error);
  },
  releaseSession(id) {
    if (notebookSupported) notebookRegistry().release(id);
  },

  requestThumb(id) {
    if (!notebookSupported) return;
    updateEntry(id, (e) => (e.needsThumb ? null : { needsThumb: true }));
    emitThumbRequested(id);
  },
  setThumb(id) {
    updateEntry(id, (e) => ({ thumbRev: e.thumbRev + 1, needsThumb: undefined }));
  },
  setImporting(id, p) {
    updateEntry(id, (e) => {
      if (!p) return e.importing ? { importing: undefined } : null;
      const total = Math.max(0, Math.floor(p.total));
      const done = Math.min(total, Math.max(0, Math.floor(p.done)));
      if (e.importing && e.importing.done === done && e.importing.total === total) return null;
      return { importing: { done, total } };
    });
  },

  async usage() {
    if (!notebookSupported) throw unsupported();
    const u = await computeUsage(nbFs, nbRoot());
    return { ...u, free: nbFreeBytes() ?? 0 };
  },
  isLowStorage(neededBytes = 0) {
    const free = notebookSupported ? nbFreeBytes() : null;
    if (free === null) return { low: false, freeBytes: 0 };
    const needed = Number.isFinite(neededBytes) && neededBytes > 0 ? neededBytes : 0;
    return { low: free < Math.max(GB, 3 * needed), freeBytes: free };
  },

  stagingJob: () => withOps((o) => o.stagingJob()),
  endStagingJob: (id) => withOps((o) => o.endStagingJob(id)),
  libraryWritten: () => (ops ? ops.libraryWritten() : Promise.resolve()),

  clipboard: notebookClipboard,
  events: notebookEvents,
};

let snapshot: NotebooksStore | null = null;
let inputs: { index: IndexFile; settings: NotebookSettings; chosen: readonly ChosenCourse[]; loaded: boolean } | null = null;

/** The store as one object, the same until something it shows changed. */
export function getStoreSnapshot(): NotebooksStore {
  const index = indexStore.get();
  const settings = settingsStore.get();
  const loaded = isLoaded();
  if (snapshot && inputs && inputs.index === index && inputs.settings === settings && inputs.chosen === chosen && inputs.loaded === loaded) {
    return snapshot;
  }
  inputs = { index, settings, chosen, loaded };
  snapshot = {
    ...methods,
    loaded,
    entries: index.entries,
    folders: index.folders,
    courseFolders: courseFolders(chosen, index),
    settings,
  };
  return snapshot;
}

export function subscribeStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let mounted = 0;
/** NotebooksProvider rendered (set during its render, so its children's mount effects, which run before its own, see the store). */
let rendered = false;

/** Called while NotebooksProvider renders. Idempotent. */
export function markStoreRendered(): void {
  rendered = true;
}

/** NotebooksProvider marks the store as mounted (getNotebooksStore is null before). */
export function markStoreMounted(): () => void {
  mounted++;
  rendered = true;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    mounted = Math.max(0, mounted - 1);
    if (mounted === 0) rendered = false;
  };
}

export const isStoreMounted = (): boolean => mounted > 0 || rendered;
