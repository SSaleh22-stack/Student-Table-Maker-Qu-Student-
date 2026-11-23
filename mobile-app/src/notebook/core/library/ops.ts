/**
 * Library operations (NB-11, NB-12, NB-13): create, import, rename, duplicate, move, trash, restore,
 * purge, folders, orphan course folders, and boot-time cleanup.
 *
 * Writers:
 * - notebook.json of an OPEN notebook is written only by its session: ops call
 *   session.setLibraryFields (deps.sessions). A closed notebook's file is read (repair: true, ops own
 *   it then) and rewritten with rev + 1. A notebook saved by a newer app (readOnly) is never written:
 *   its index entry changes only.
 * - The index (deps.index) holds entries, folders, courseNames and purged tombstones.
 *   library.json mirrors folders and courseNames (journaled, through one write queue) for backup and
 *   restore.
 * - Ops on the same notebook run one after another.
 *
 * Rules:
 * - purge deletes the notebook folder for good and appends { id, at } to index.purged (the backup
 *   planner deletes remote copies only for those ids). The tombstone is recorded BEFORE the folder is
 *   deleted, so an interrupted purge is finished by the next boot (reconcile).
 * - Course folders in the timetable (deps.chosenCodes) cannot be renamed, converted or deleted (NB-12).
 *   An orphan course folder can be converted into a user folder (convertCourseFolder) or deleted.
 * - Trashed notebooks are purged after 30 days (boot).
 */
import { joinPath } from '../fs/adapter.ts';
import { readJsonRecovering, writeJsonAtomic } from '../fs/journal.ts';
import { nbLayout, safeExt } from '../fs/layout.ts';
import type { NotebookPaths } from '../fs/layout.ts';
import {
  copyPaper,
  isSafeId,
  locationFields,
  makeLibraryFile,
  makeNotebookFile,
  makePageFile,
  NAME_MAX,
  notebookOf,
  prunePurged,
  readLibraryFile,
  readNotebookFile,
} from '../model/index.ts';
import type { Asset, Folder, Id, IndexEntry, IndexFile, LocationKey, Notebook, Page } from '../model/index.ts';
import { cleanTitle } from '../session/docState.ts';
import { readPageQuiet, recoverNotebook } from '../session/recover.ts';
import type { BootReport, CreateFromPages, LibraryFields, LibraryOps, LibraryOpsDeps } from '../session/types.ts';
import { createWriteQueue } from '../session/writeQueue.ts';
import { liveClipIds } from './clipboard.ts';
import { coverOfPage, entryFromNotebook, entryLocation, patchEntry, removeEntry, trashExpired, updateCourseNames, upsertEntry } from './derive.ts';
import { applyReconcile, isEmptyPlan, planReconcile, scanNotebooks } from './reconcile.ts';

/** Inbox files older than this are removed at boot. */
export const INBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class LibraryError extends Error {
  code: 'in-timetable' | 'no-folder' | 'exists' | 'not-notebook' | 'empty-name' | 'missing' | 'unreadable' | 'read-only';
  constructor(code: LibraryError['code'], message?: string) {
    super(message ?? code);
    this.name = 'LibraryError';
    this.code = code;
  }
}

/** A folder name: whitespace collapsed, trimmed, at most 200 characters. */
export function cleanName(name: string): string {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/**
 * The epoch (ms) at the start of an .inbox entry name ('<epochMs>-name' or '<epochSeconds>_name'),
 * or null. Entries without one are treated as stale.
 */
export function inboxTime(name: string): number | null {
  const m = /^(\d{10,16})(?=[-_.]|$)/.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  return n < 1e12 ? n * 1000 : n;
}

function applyFields(nb: Notebook, p: LibraryFields): Notebook {
  const out: Notebook = { ...nb };
  if ('title' in p) {
    const t = cleanTitle(p.title ?? '');
    if (t) out.title = t;
  }
  for (const k of ['folderId', 'courseCode', 'deletedAt'] as const) {
    if (!(k in p)) continue;
    const v = p[k];
    if (v === undefined || v === '') delete out[k];
    else out[k] = v;
  }
  return out;
}

function sameFields(nb: Notebook, p: LibraryFields): boolean {
  const next = applyFields(nb, p);
  return next.title === nb.title && next.folderId === nb.folderId && next.courseCode === nb.courseCode && next.deletedAt === nb.deletedAt;
}

export function createLibraryOps(d: LibraryOpsDeps): LibraryOps {
  const { fs } = d;
  const layout = nbLayout(d.root);
  const iso = () => new Date(d.now()).toISOString();
  const libQueue = createWriteQueue(fs);
  let libWrite: Promise<void> = Promise.resolve();
  let libWaiting = false;
  const locks = new Map<Id, Promise<unknown>>();
  const activeJobs = new Set<Id>();
  /** Notebook folders being written by create / createFromPages (boot must not take them for interrupted creates). */
  const creating = new Set<Id>();

  const changed = () => {
    try {
      d.onChanged?.();
    } catch {
      // Listener errors never fail an op.
    }
  };
  const update = (fn: (f: IndexFile) => IndexFile) => d.index.update(fn);
  const entryOf = (id: Id): IndexEntry | undefined => d.index.get().entries.find((e) => e.id === id);
  const inTimetable = (code: string) => (d.chosenCodes?.() ?? []).includes(code);
  const folderExists = (id: Id | undefined) => !!id && d.index.get().folders.some((f) => f.id === id);

  /** Runs ops on one notebook one after another. */
  function serial<T>(id: Id, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve();
    const p = prev.then(fn, fn);
    const tail = p.then(
      () => undefined,
      () => undefined,
    );
    locks.set(id, tail);
    void tail.then(() => {
      if (locks.get(id) === tail) locks.delete(id);
    });
    return p;
  }

  function scheduleLibrary(): Promise<void> {
    if (libWaiting) return libWrite;
    libWaiting = true;
    libWrite = libQueue
      .enqueue(layout.library, (rev) => {
        libWaiting = false;
        const f = d.index.get();
        return makeLibraryFile({ folders: f.folders, courseNames: f.courseNames }, { rev, savedAt: iso() });
      })
      .catch(() => {
        libWaiting = false;
      });
    return libWrite;
  }

  /** Writes library fields into notebook.json (through the session when it is open). */
  async function editNotebook(id: Id, fields: LibraryFields): Promise<'ok' | 'readOnly' | 'missing' | 'unreadable'> {
    const s = d.sessions?.get(id) ?? null;
    if (s) {
      if (s.readOnly) return 'readOnly';
      if (!sameFields(s.notebook, fields)) await s.setLibraryFields(fields);
      return 'ok';
    }
    const paths = layout.notebook(id);
    const r = await readJsonRecovering(fs, paths.json, readNotebookFile, paths.quarantine, { repair: true, now: d.now });
    if (!r.ok) return r.reason;
    if (r.readOnly) return 'readOnly';
    let nb = notebookOf(r.value);
    if (nb.id !== id) nb = { ...nb, id };
    if (sameFields(nb, fields)) return 'ok';
    // The ops own the files now, like a session at open: recover first. A new savedAt would
    // otherwise make a page file left by a crash look like old GC garbage, and the next open would
    // delete it instead of appending it.
    try {
      nb = (await recoverNotebook(fs, paths, nb, r.value.savedAt, d)).notebook;
    } catch {
      // Best effort: the notebook as read is still consistent.
    }
    const next = applyFields(nb, fields);
    next.contentRev = nb.contentRev + 1;
    await writeJsonAtomic(fs, paths.json, makeNotebookFile(next, { rev: r.value.rev + 1, savedAt: iso(), app: d.appVersion }));
    return 'ok';
  }

  /** The index part of library fields (undefined clears). */
  const entryFields = (p: LibraryFields): Partial<IndexEntry> => {
    const out: Partial<IndexEntry> = {};
    if ('title' in p) {
      const t = cleanTitle(p.title ?? '');
      if (t) out.title = t;
    }
    if ('folderId' in p) out.folderId = p.folderId || undefined;
    if ('courseCode' in p) out.courseCode = p.courseCode || undefined;
    if ('deletedAt' in p) out.deletedAt = p.deletedAt || undefined;
    return out;
  };

  const setFields = (id: Id, p: LibraryFields): Promise<void> =>
    serial(id, async () => {
      await editNotebook(id, p);
      update((f) => patchEntry(f, id, entryFields(p)));
      changed();
    });

  async function writeNotebookFiles(nb: Notebook, pages: Page[], savedAt: string): Promise<void> {
    const paths = layout.notebook(nb.id);
    if (pages.length) await fs.mkdirp(paths.pagesDir);
    for (const p of pages) await writeJsonAtomic(fs, paths.page(p.id), makePageFile(p, { rev: 1, savedAt }));
    await writeJsonAtomic(fs, paths.json, makeNotebookFile(nb, { rev: 1, savedAt, app: d.appVersion }));
  }

  function locationOrUnfiled(l: LocationKey): LocationKey {
    if (l.kind === 'folder' && !folderExists(l.id)) return { kind: 'unfiled' };
    if (l.kind === 'course' && !l.code.trim()) return { kind: 'unfiled' };
    return l;
  }

  function setLocation(nb: Notebook, l: LocationKey): Notebook {
    const out: Notebook = { ...nb };
    delete out.folderId;
    delete out.courseCode;
    const loc = locationFields(locationOrUnfiled(l));
    if (loc.folderId) out.folderId = loc.folderId;
    if (loc.courseCode) out.courseCode = loc.courseCode;
    return out;
  }

  /** createFromPages after its checks: assets, then pages, then notebook.json, then the index entry. */
  async function writeFromPages(id: Id, paths: NotebookPaths, i: CreateFromPages): Promise<Id> {
    const now = iso();
    const defaults = copyPaper(i.defaults ?? { style: 'blank', color: 'white', size: 'a4' });
    const pages: Page[] = i.pages.filter((p) => isSafeId(p.id));
    if (!pages.length) {
      pages.push({ id: d.newId(), size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: copyPaper(defaults) }, items: [] });
    }
    await fs.mkdirp(paths.dir);
    // 1. assets
    const assets: Record<Id, Asset> = {};
    for (const a of i.assets ?? []) {
      if (!isSafeId(a.id)) continue;
      const asset: Asset = { id: a.id, kind: a.kind, ext: safeExt(a.ext), bytes: 0, addedAt: now };
      if (a.name) asset.name = a.name;
      if (a.pageCount !== undefined) asset.pageCount = a.pageCount;
      const dest = paths.asset(asset);
      await fs.mkdirp(a.kind === 'audio' ? paths.audioDir : paths.assetsDir);
      if (a.move) await fs.move(a.srcPath, dest);
      else await fs.copy(a.srcPath, dest);
      asset.bytes = await fs.size(dest);
      assets[asset.id] = asset;
    }
    // 2. pages, 3. notebook.json (last: a folder without it is an interrupted create)
    let nb: Notebook = {
      id,
      title: cleanTitle(i.title),
      createdAt: now,
      updatedAt: now,
      defaults,
      pageIds: pages.map((p) => p.id),
      removedPageIds: [],
      recordings: [],
      assets,
      origin: { ...i.origin },
      contentRev: 0,
    };
    if (i.pending) nb.pending = i.pending;
    nb = setLocation(nb, i.location);
    await writeNotebookFiles(nb, pages, now);
    const e = entryFromNotebook(nb, coverOfPage(pages[0]));
    e.needsThumb = true;
    update((f) => upsertEntry(f, e));
    changed();
    return id;
  }

  const ops: LibraryOps = {
    async create(i) {
      const id = d.newId();
      const now = iso();
      const paths = layout.notebook(id);
      const nb = setLocation(
        {
          id,
          title: cleanTitle(i.title),
          createdAt: now,
          updatedAt: now,
          defaults: copyPaper(i.paper),
          pageIds: [d.newId()],
          removedPageIds: [],
          recordings: [],
          assets: {},
          origin: { kind: 'blank' },
          contentRev: 0,
        },
        i.location,
      );
      creating.add(id);
      try {
        await fs.mkdirp(paths.dir);
        // The first page has no file yet: a missing page file reads as a blank page with the defaults.
        await writeJsonAtomic(fs, paths.json, makeNotebookFile(nb, { rev: 1, savedAt: now, app: d.appVersion }));
      } finally {
        creating.delete(id);
      }
      update((f) => upsertEntry(f, entryFromNotebook(nb, { kind: 'paper', paper: copyPaper(i.paper) })));
      changed();
      return id;
    },

    async createFromPages(i: CreateFromPages) {
      const id = i.id ?? d.newId();
      if (!isSafeId(id)) throw new LibraryError('not-notebook', `bad id ${id}`);
      const paths = layout.notebook(id);
      if (creating.has(id)) throw new LibraryError('exists');
      creating.add(id);
      try {
        if (await fs.exists(paths.dir)) throw new LibraryError('exists');
        return await writeFromPages(id, paths, i);
      } finally {
        creating.delete(id);
      }
    },

    async adoptFolder(dir, location) {
      const json = joinPath(dir, 'notebook.json');
      const r = await readJsonRecovering(fs, json, readNotebookFile, joinPath(dir, 'quarantine'), { repair: false });
      if (!r.ok) throw new LibraryError('not-notebook');
      const id = r.value.id;
      if (!isSafeId(id)) throw new LibraryError('not-notebook', `bad id ${id}`);
      return serial(id, async () => {
        const paths = layout.notebook(id);
        if (await fs.exists(paths.dir)) {
          if (entryOf(id) || d.sessions?.get(id)) throw new LibraryError('exists');
          await fs.remove(paths.dir);
        }
        await fs.mkdirp(layout.root);
        await fs.move(dir, paths.dir);
        let nb = notebookOf(r.value);
        const fields: LibraryFields = { deletedAt: undefined };
        const loc = location ?? entryLocation(nb, d.index.get().folders);
        const lf = locationFields(locationOrUnfiled(loc));
        fields.folderId = lf.folderId;
        fields.courseCode = lf.courseCode;
        // A read-only notebook (newer app) is never written: only its index entry gets the location.
        if (!r.readOnly) await editNotebook(id, fields);
        nb = applyFields(nb, fields);
        const hasCover = await fs.exists(paths.cover);
        const first = nb.pageIds[0];
        let cover: IndexEntry['cover'] = { kind: 'paper', paper: copyPaper(nb.defaults) };
        if (first) {
          const page = await readPageQuiet(fs, paths, first);
          if (page && page !== 'unreadable') cover = coverOfPage(page);
        }
        const e = entryFromNotebook(nb, cover);
        if (r.readOnly) e.readOnly = true;
        if (!hasCover) e.needsThumb = true;
        update((f) => ({ ...upsertEntry(f, e), purged: f.purged.filter((t) => t.id !== id) }));
        changed();
        return id;
      });
    },

    async rename(id, title) {
      const t = cleanTitle(title);
      if (!t) return;
      await setFields(id, { title: t });
    },

    async duplicate(id) {
      return serial(id, async () => {
        const src = layout.notebook(id);
        const job = await ops.stagingJob();
        try {
          const tmp = joinPath(job.dir, 'nb');
          const copy = () => fs.copy(src.dir, tmp);
          const s = d.sessions?.get(id) ?? null;
          if (s) await s.withWriteLock(copy);
          else await copy();
          const r = await readJsonRecovering(fs, joinPath(tmp, 'notebook.json'), readNotebookFile, joinPath(tmp, 'quarantine'), { repair: false });
          if (!r.ok) throw new LibraryError(r.reason);
          // A newer app's format cannot be rewritten without losing what this version does not know.
          if (r.readOnly) throw new LibraryError('read-only');
          let nb = notebookOf(r.value);
          // A closed source may still hold a page file from a crash: keep it in the copy too.
          try {
            nb = (await recoverNotebook(fs, nbLayout(job.dir).notebook('nb'), nb, r.value.savedAt, d)).notebook;
          } catch {
            // Best effort.
          }
          const newId = d.newId();
          const now = iso();
          // Tombstoned pages and quarantined saves stay with the original.
          for (const pid of nb.removedPageIds) {
            for (const suffix of ['', '.tmp', '.bak']) await fs.remove(joinPath(tmp, 'pages', `${pid}.json${suffix}`));
          }
          await fs.remove(joinPath(tmp, 'quarantine'));
          const title = cleanTitle(d.copyTitle ? d.copyTitle(nb.title) : nb.title) || nb.title;
          const copyNb: Notebook = {
            ...nb,
            id: newId,
            title,
            createdAt: now,
            updatedAt: now,
            removedPageIds: [],
            origin: { kind: 'duplicate', name: nb.title },
            contentRev: 0,
          };
          delete copyNb.deletedAt;
          await writeJsonAtomic(fs, joinPath(tmp, 'notebook.json'), makeNotebookFile(copyNb, { rev: r.value.rev + 1, savedAt: now, app: d.appVersion }));
          await fs.move(tmp, layout.notebook(newId).dir);
          const srcEntry = entryOf(id);
          const e = entryFromNotebook(copyNb, srcEntry?.cover ?? { kind: 'paper', paper: copyPaper(nb.defaults) });
          const hasCover = await fs.exists(layout.notebook(newId).cover);
          if (hasCover && srcEntry) e.thumbRev = srcEntry.thumbRev;
          else e.needsThumb = true;
          update((f) => upsertEntry(f, e));
          changed();
          return newId;
        } finally {
          await ops.endStagingJob(job.id);
        }
      });
    },

    async move(id, to) {
      if (to.kind === 'folder' && !folderExists(to.id)) throw new LibraryError('no-folder');
      const lf = locationFields(locationOrUnfiled(to));
      await setFields(id, { folderId: lf.folderId, courseCode: lf.courseCode });
    },

    async trash(id) {
      await setFields(id, { deletedAt: iso() });
    },

    async restore(id) {
      const e = entryOf(id);
      const p: LibraryFields = { deletedAt: undefined };
      if (e?.folderId && !folderExists(e.folderId)) p.folderId = undefined;
      await setFields(id, p);
    },

    purge(id) {
      return serial(id, async () => {
        await d.sessions?.evict(id);
        const at = iso();
        update((f) => ({ ...removeEntry(f, id), purged: prunePurged([...f.purged, { id, at }], d.now()) }));
        changed();
        await fs.remove(layout.notebook(id).dir);
      });
    },

    async emptyTrash() {
      const ids = d.index
        .get()
        .entries.filter((e) => !!e.deletedAt)
        .map((e) => e.id);
      for (const id of ids) await ops.purge(id);
    },

    createFolder(name) {
      const n = cleanName(name);
      if (!n) throw new LibraryError('empty-name');
      const f0 = d.index.get();
      const order = f0.folders.reduce((m, f) => Math.max(m, f.order), -1) + 1;
      const folder: Folder = { id: d.newId(), name: n, createdAt: iso(), order };
      update((f) => ({ ...f, folders: [...f.folders, folder] }));
      void scheduleLibrary();
      changed();
      return folder;
    },

    renameFolder(id, name) {
      const n = cleanName(name);
      if (!n || !folderExists(id)) return;
      update((f) => ({ ...f, folders: f.folders.map((x) => (x.id === id ? { ...x, name: n } : x)) }));
      void scheduleLibrary();
      changed();
    },

    async deleteFolder(id, mode) {
      const inFolder = d.index.get().entries.filter((e) => e.folderId === id);
      for (const e of inFolder) {
        if (mode === 'trash' && !e.deletedAt) await ops.trash(e.id);
        else await setFields(e.id, { folderId: undefined });
      }
      update((f) => ({ ...f, folders: f.folders.filter((x) => x.id !== id) }));
      void scheduleLibrary();
      changed();
    },

    async convertCourseFolder(code, newName) {
      if (inTimetable(code)) throw new LibraryError('in-timetable');
      const n = cleanName(newName);
      if (!n) throw new LibraryError('empty-name');
      const folder = ops.createFolder(n);
      const f0 = d.index.get();
      const members = f0.entries.filter((e) => {
        const loc = entryLocation(e, f0.folders.filter((x) => x.id !== folder.id));
        return loc.kind === 'course' && loc.code === code;
      });
      for (const e of members) await setFields(e.id, { folderId: folder.id, courseCode: undefined });
      update((f) => {
        if (!(code in f.courseNames)) return f;
        const names = { ...f.courseNames };
        delete names[code];
        return { ...f, courseNames: names };
      });
      void scheduleLibrary();
      changed();
      return folder;
    },

    async deleteCourseFolder(code, mode) {
      if (inTimetable(code)) throw new LibraryError('in-timetable');
      const f0 = d.index.get();
      const members = f0.entries.filter((e) => {
        const loc = entryLocation(e, f0.folders);
        return loc.kind === 'course' && loc.code === code;
      });
      for (const e of members) {
        if (mode === 'trash' && !e.deletedAt) await ops.trash(e.id);
        else await setFields(e.id, { courseCode: undefined, folderId: undefined });
      }
      if (mode === 'unfile') {
        update((f) => {
          if (!(code in f.courseNames)) return f;
          const names = { ...f.courseNames };
          delete names[code];
          return { ...f, courseNames: names };
        });
        void scheduleLibrary();
      }
      changed();
    },

    syncCourseNames(chosen) {
      const before = d.index.get();
      const after = updateCourseNames(before, chosen);
      if (after === before) return;
      update((f) => updateCourseNames(f, chosen));
      void scheduleLibrary();
      changed();
    },

    async stagingJob() {
      const id = d.newId();
      activeJobs.add(id);
      const dir = layout.stagingJob(id);
      await fs.mkdirp(dir);
      return { id, dir };
    },

    async endStagingJob(id) {
      activeJobs.delete(id);
      try {
        await fs.remove(layout.stagingJob(id));
      } catch {
        // Wiped at the next boot.
      }
    },

    async boot(): Promise<BootReport> {
      const report: BootReport = { stagingRemoved: 0, inboxRemoved: 0, purged: [], added: [], removed: [], updated: [], deletedDirs: [] };
      const now = d.now();

      // 1. .staging (import work folders and clipboard copies), except folders in use.
      try {
        const live = liveClipIds();
        for (const e of await fs.list(layout.staging)) {
          if (e.name === 'clipboard' && e.isDir) {
            const clipDir = joinPath(layout.staging, 'clipboard');
            for (const c of await fs.list(clipDir)) {
              if (live.has(c.name)) continue;
              await fs.remove(joinPath(clipDir, c.name));
              report.stagingRemoved++;
            }
            continue;
          }
          if (activeJobs.has(e.name)) continue;
          await fs.remove(joinPath(layout.staging, e.name));
          report.stagingRemoved++;
        }
      } catch {
        // Next boot.
      }

      // 2. .inbox entries older than 24 h (or without a time in their name).
      try {
        for (const e of await fs.list(layout.inbox)) {
          const t = inboxTime(e.name);
          if (t !== null && now - t < INBOX_MAX_AGE_MS) continue;
          await fs.remove(joinPath(layout.inbox, e.name));
          report.inboxRemoved++;
        }
      } catch {
        // Next boot.
      }

      // 3. Trash older than 30 days.
      for (const id of trashExpired(d.index.get(), now)) {
        try {
          await ops.purge(id);
          report.purged.push(id);
        } catch {
          // Next boot.
        }
      }

      // 4. library.json <-> index: bring back folders and course names the index lost.
      try {
        const lr = await readJsonRecovering(fs, layout.library, readLibraryFile, joinPath(layout.root, '.quarantine'), { repair: true, now: d.now });
        if (lr.ok) libQueue.seedRev(layout.library, lr.value.rev);
        const lib = lr.ok ? lr.value : null;
        if (lib) {
          update((f) => {
            const have = new Set(f.folders.map((x) => x.id));
            const add = lib.folders.filter((x) => !have.has(x.id));
            const names = { ...f.courseNames };
            let namesChanged = false;
            for (const [k, v] of Object.entries(lib.courseNames)) {
              if (!(k in names)) {
                names[k] = v;
                namesChanged = true;
              }
            }
            if (!add.length && !namesChanged) return f;
            return { ...f, folders: [...f.folders, ...add], courseNames: names };
          });
        }
        const f = d.index.get();
        if (!lib || JSON.stringify(lib.folders) !== JSON.stringify(f.folders) || JSON.stringify(lib.courseNames) !== JSON.stringify(f.courseNames)) {
          if (lib || f.folders.length || Object.keys(f.courseNames).length) void scheduleLibrary();
        }
      } catch {
        // Next boot.
      }

      // 5. Reconcile the index with the notebook folders.
      try {
        const f = d.index.get();
        const byId = new Map(f.entries.map((e) => [e.id, e]));
        // Open sessions and notebooks being created right now are never touched.
        const open = new Set<Id>(creating);
        for (const e of f.entries) if (d.sessions?.get(e.id)) open.add(e.id);
        const disk = await scanNotebooks(fs, d.root, {
          needCover: (id, nb) => {
            const e = byId.get(id);
            return !e || e.contentRev !== nb.contentRev;
          },
          skip: open,
        });
        for (const x of disk) if (d.sessions?.get(x.id) || creating.has(x.id)) open.add(x.id);
        const plan = planReconcile(d.index.get(), disk, { openIds: open });
        for (const id of plan.deleteDirs) {
          try {
            await fs.remove(layout.notebook(id).dir);
            report.deletedDirs.push(id);
          } catch {
            // Next boot.
          }
        }
        if (!isEmptyPlan(plan)) {
          const known = new Set(d.index.get().entries.map((e) => e.id));
          for (const e of plan.upserts) (known.has(e.id) ? report.updated : report.added).push(e.id);
          report.removed.push(...plan.removeIds);
          update((x) => applyReconcile(x, plan));
        }
      } catch {
        // Next boot.
      }

      changed();
      return report;
    },

    libraryWritten: () => libWrite,
  };
  return ops;
}
