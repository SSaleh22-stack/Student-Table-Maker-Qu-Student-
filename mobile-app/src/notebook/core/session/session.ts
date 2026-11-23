/**
 * The notebook session: the ONLY writer of a notebook's notebook.json and page files while it is open.
 *
 * - Open: readJsonRecovering({ repair: true }) (the session owns the files), then recoverNotebook().
 *   A newer format gives readOnly: nothing is repaired or written and every edit is ignored.
 * - Pages: a cache of at most lruSize (12) pages. Dirty pages, pages referenced by the undo history
 *   and pages with subscribers are pinned. pageVersion() changes on every change of a page.
 * - Edits go through the pure docState functions; undoable ones push one history entry (P02 history:
 *   200 entries, 8 MB, groups). Undo/redo rebase pages and recordings patches on the current document.
 * - Saving: a 1 s debounced autosave and ONE serial write queue. A flush writes the dirty pages, then
 *   notebook.json (contentRev + 1, updatedAt when content changed), then calls deps.onIndexEntry, then
 *   deps.onSaved. flushPendingNow() puts a notebook.json write at the FRONT of the queue.
 * - getSnapshot() returns the same object until something changes (useSyncExternalStore).
 * - release() is the FINAL release (after the registry's grace): flush, clear history, then GC the
 *   tombstoned page files and unreferenced assets (core/session/recover.ts).
 */
import { dirName } from '../fs/adapter.ts';
import { readJsonRecovering } from '../fs/journal.ts';
import { nbLayout, safeExt } from '../fs/layout.ts';
import type { NotebookPaths } from '../fs/layout.ts';
import {
  blankPage,
  createHistory,
  decodePage,
  makeNotebookFile,
  makePageFile,
  notebookOf,
  patchBytes,
  readNotebookFile,
  readPageFile,
} from '../model/index.ts';
import type { Asset, AssetKind, DocState, Id, IndexCover, Notebook, Page, Patch, PendingImport, Recording } from '../model/index.ts';
import { coverOfPage, entryFromNotebook } from '../library/derive.ts';
import * as ds from './docState.ts';
import type { Edit } from './docState.ts';
import { createAutosave } from './autosave.ts';
import { applyGc, planGc, readPageQuiet, recoverNotebook } from './recover.ts';
import type { AddAssetOptions, LibraryFields, NotebookSession, OpenResult, SaveState, SessionDeps, SessionSnapshot } from './types.ts';
import { createWriteQueue } from './writeQueue.ts';

export const PAGE_LRU_SIZE = 12;

/** The index cover of a notebook: its first page's background, else a guess from its origin. */
export function coverOf(nb: Notebook, firstPage: Page | undefined): IndexCover {
  if (firstPage) return coverOfPage(firstPage);
  if (nb.origin.kind === 'pdf') return { kind: 'pdf' };
  if (nb.origin.kind === 'scan' || nb.origin.kind === 'photos') return { kind: 'image' };
  return { kind: 'paper', paper: { ...nb.defaults } };
}

interface EditOpts {
  history: boolean;
  label: string;
  /** Content changed (updatedAt moves at the next save). Default true. */
  touch?: boolean;
  /** Bump the snapshot even when nothing changed (undo/redo moved the stacks). */
  force?: boolean;
}

export async function openSession(deps: SessionDeps, id: Id): Promise<OpenResult> {
  const paths = nbLayout(deps.root).notebook(id);
  let r;
  try {
    r = await readJsonRecovering(deps.fs, paths.json, readNotebookFile, paths.quarantine, { repair: true, now: deps.now });
  } catch {
    return { error: 'unreadable' };
  }
  if (!r.ok) return { error: r.reason };
  const readOnly = r.readOnly;
  let nb = notebookOf(r.value);
  let needsSave = false;
  let adopted = false;
  if (nb.id !== id) {
    nb = { ...nb, id };
    needsSave = !readOnly;
  }
  if (!readOnly) {
    try {
      const rec = await recoverNotebook(deps.fs, paths, nb, r.value.savedAt, deps);
      nb = rec.notebook;
      needsSave = needsSave || rec.changed;
      adopted = rec.adoptedAssets.length > 0;
    } catch {
      // Recovery is best effort: the notebook as read is still usable.
    }
  }
  const session = createSession(deps, paths, nb, r.value.rev, readOnly, needsSave, adopted);
  if (readOnly) {
    // The index shows the notebook as read-only (it was saved by a newer app version).
    try {
      const first = nb.pageIds[0];
      const page = first ? await readPageQuiet(deps.fs, paths, first) : null;
      const e = entryFromNotebook(nb, coverOf(nb, page && page !== 'unreadable' ? page : undefined));
      e.readOnly = true;
      deps.onIndexEntry(e);
    } catch {
      // Listener errors never fail an open.
    }
  }
  return { session };
}

/** Asset ids a page references (its pdf / image background and image items). */
function pageAssetIds(p: Page): Set<Id> {
  const out = new Set<Id>();
  if (p.background.kind !== 'paper') out.add(p.background.fileId);
  for (const it of p.items) if (it.kind === 'image') out.add(it.fileId);
  return out;
}

/** True when the page referenced an asset that `next` (undefined: dropped) no longer references. */
function holdsAsset(p: Page | undefined, next: Page | undefined): boolean {
  if (!p) return false;
  const before = pageAssetIds(p);
  if (!before.size) return false;
  if (!next) return true;
  const after = pageAssetIds(next);
  for (const id of before) if (!after.has(id)) return true;
  return false;
}

/** True when the change from prev to next may have left an asset without any reference. */
function mayUnreference(prev: DocState, next: DocState, changed: readonly Id[]): boolean {
  const a = prev.notebook;
  const b = next.notebook;
  if (a.assets !== b.assets || a.pending !== b.pending || a.recordings !== b.recordings) return true;
  if (a.pageIds !== b.pageIds) {
    const live = new Set(b.pageIds);
    if (a.pageIds.some((pid) => !live.has(pid))) return true;
  }
  for (const pid of changed) if (holdsAsset(prev.pages.get(pid), next.pages.get(pid))) return true;
  return false;
}

function createSession(
  deps: SessionDeps,
  paths: NotebookPaths,
  initial: Notebook,
  rev: number,
  readOnly: boolean,
  needsSave: boolean,
  adoptedAssets: boolean,
): NotebookSession {
  const { fs } = deps;
  const lruSize = Math.max(1, Math.floor(deps.lruSize ?? PAGE_LRU_SIZE));
  const iso = () => new Date(deps.now()).toISOString();

  let state: DocState = { notebook: initial, pages: new Map() };
  const queue = createWriteQueue(fs);
  queue.seedRev(paths.json, rev);
  const hist = createHistory({ limit: deps.historyLimit, maxBytes: deps.historyMaxBytes });

  // Page versions are unique across sessions: they start at the clock value of the open.
  let clock = Math.max(1, Math.floor(deps.now()));
  const versions = new Map<Id, number>();
  const nextVersion = () => {
    clock = Math.max(clock + 1, Math.floor(deps.now()));
    return clock;
  };

  const dirty = new Set<Id>();
  let metaDirty = false;
  let touchDirty = false;
  const lru = new Map<Id, true>();
  const loading = new Map<Id, Promise<Page>>();
  const pendingOps = new Set<Promise<unknown>>();
  /** Pages an edit waits for (withPages): never evicted until that edit ran. */
  const held = new Map<Id, number>();
  let lastFirstPageId: Id | null = initial.pageIds[0] ?? null;
  let flushing = false;
  let lastError: unknown = null;
  let released = false;
  /**
   * Asset GC at final release reads every live page, so it runs only when this session did
   * something that can leave an asset unreferenced (or recovery adopted stray asset files).
   */
  let assetGcWanted = adoptedAssets;
  /** Pages whose file could not be read (quarantined, shown blank): what they referenced is unknown. */
  const damaged = new Set<Id>();

  let version = 1;
  let snapshot: SessionSnapshot | null = null;
  const subs = new Set<() => void>();
  const pageSubs = new Map<Id, Set<() => void>>();
  const jumpSubs = new Set<(pid: Id) => void>();

  const bump = () => {
    version++;
    snapshot = null;
    for (const cb of [...subs]) cb();
  };
  const notifyPage = (pid: Id) => {
    const set = pageSubs.get(pid);
    if (set) for (const cb of [...set]) cb();
  };
  const touchLru = (pid: Id) => {
    lru.delete(pid);
    lru.set(pid, true);
  };

  const saveState = (): SaveState => {
    if (flushing) return 'saving';
    if (lastError) return 'error';
    if (dirty.size || metaDirty || touchDirty) return 'pending';
    return 'saved';
  };

  // ----- cache eviction

  const evict = () => {
    if (state.pages.size <= lruSize) return;
    const pinned = new Set<Id>(dirty);
    for (const pid of held.keys()) pinned.add(pid);
    for (const [pid, set] of pageSubs) if (set.size) pinned.add(pid);
    // Pages the undo/redo stacks edit must stay: undo is synchronous.
    hist.dropWhere((e) => {
      for (const p of e.patches) if (p.t === 'items' || p.t === 'page') pinned.add(p.pageId);
      return false;
    });
    for (const pid of state.pages.keys()) if (!lru.has(pid)) lru.set(pid, true);
    // The page touched last (just loaded or edited) always stays.
    let newest: Id | undefined;
    for (const pid of lru.keys()) newest = pid;
    if (newest !== undefined) pinned.add(newest);
    const drop: Id[] = [];
    let size = state.pages.size;
    for (const pid of lru.keys()) {
      if (size <= lruSize) break;
      if (pinned.has(pid) || !state.pages.has(pid)) continue;
      drop.push(pid);
      size--;
    }
    if (!drop.length) return;
    const pages = new Map(state.pages);
    for (const pid of drop) {
      pages.delete(pid);
      lru.delete(pid);
    }
    state = { notebook: state.notebook, pages };
  };

  // ----- autosave and flush

  const writePage = (pid: Id): Promise<void> => {
    let v = -1;
    let skipped = false;
    return queue
      .enqueue(paths.page(pid), (r) => {
        const page = state.pages.get(pid);
        if (!page) {
          skipped = true;
          return null;
        }
        v = versions.get(pid) ?? 0;
        return makePageFile(page, { rev: r, savedAt: iso() });
      })
      .then(() => {
        if (skipped || (versions.get(pid) ?? 0) === v) dirty.delete(pid);
      });
  };

  const writeMeta = (o: { front: boolean; touch: boolean }): Promise<void> => {
    let wroteTouch = false;
    const job = (r: number) => {
      const cur = state.notebook;
      wroteTouch = o.touch && touchDirty;
      const next: Notebook = { ...cur, contentRev: cur.contentRev + 1, updatedAt: wroteTouch ? iso() : cur.updatedAt };
      state = { notebook: next, pages: state.pages };
      metaDirty = false;
      if (wroteTouch) touchDirty = false;
      bump();
      return makeNotebookFile(next, { rev: r, savedAt: iso(), app: deps.appVersion });
    };
    const p = o.front ? queue.enqueueFront(paths.json, job) : queue.enqueue(paths.json, job);
    return p.catch((e) => {
      metaDirty = true;
      if (wroteTouch) touchDirty = true;
      throw e;
    });
  };

  // The index cover follows the first page; when it is not in memory, its file is read once.
  let coverCache: { pid: Id; cover: IndexCover } | null = null;
  const indexEntry = async () => {
    const nb = state.notebook;
    const first = nb.pageIds[0];
    const cached = first ? state.pages.get(first) : undefined;
    if (cached) coverCache = { pid: first, cover: coverOf(nb, cached) };
    else if (first && coverCache?.pid !== first) {
      let page: Page | undefined;
      try {
        const p = await readPageQuiet(fs, paths, first);
        if (p && p !== 'unreadable') page = p;
      } catch {
        // Guess from the notebook below.
      }
      coverCache = { pid: first, cover: coverOf(nb, page) };
    }
    const e = entryFromNotebook(state.notebook, coverCache?.cover ?? coverOf(nb, undefined));
    if (readOnly) e.readOnly = true;
    return e;
  };

  const settlePending = async () => {
    while (pendingOps.size) await Promise.allSettled([...pendingOps]);
  };

  const doFlush = async (): Promise<void> => {
    if (readOnly) return;
    await settlePending();
    flushing = true;
    bump();
    try {
      const pids = [...dirty];
      const results = await Promise.allSettled(pids.map(writePage));
      const failed = results.find((x): x is PromiseRejectedResult => x.status === 'rejected');
      if (failed) throw failed.reason;
      if (!pids.length && !metaDirty && !touchDirty) {
        lastError = null;
        return;
      }
      await writeMeta({ front: false, touch: true });
      const nb = state.notebook;
      const first = nb.pageIds[0] ?? null;
      const firstPageChanged = first !== lastFirstPageId || (first !== null && pids.includes(first));
      lastFirstPageId = first;
      lastError = null;
      const entry = await indexEntry();
      try {
        deps.onIndexEntry(entry);
        deps.onSaved(nb.id, { contentRev: nb.contentRev, firstPageChanged });
      } catch {
        // Listener errors never fail a save.
      }
    } catch (e) {
      lastError = e;
      throw e;
    } finally {
      flushing = false;
      evict();
      bump();
    }
  };

  const autosave = createAutosave({
    debounceMs: deps.debounceMs,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    flush: doFlush,
  });

  const track = <T>(p: Promise<T>): Promise<T> => {
    pendingOps.add(p);
    const done = () => {
      pendingOps.delete(p);
    };
    p.then(done, done);
    return p;
  };

  // ----- committing edits

  const commit = (next: DocState, patches: Patch[], o: EditOpts): Id => {
    if (readOnly) return '';
    const prev = state;
    if (next === prev && !patches.length) {
      if (o.force) bump();
      return '';
    }
    state = next;
    const changed = ds.changedPageIds(prev, next);
    if (!assetGcWanted && mayUnreference(prev, next, changed)) assetGcWanted = true;
    for (const pid of changed) {
      versions.set(pid, nextVersion());
      dirty.add(pid);
      touchLru(pid);
    }
    if (prev.notebook !== next.notebook) metaDirty = true;
    if (o.touch !== false) touchDirty = true;
    let entryId: Id = '';
    if (o.history && patches.length) {
      let bytes = 0;
      for (const p of patches) bytes += patchBytes(p);
      hist.push({ id: deps.newId(), label: o.label, patches, at: deps.now(), bytes });
      entryId = hist.top()?.id ?? '';
    }
    bump();
    for (const pid of changed) notifyPage(pid);
    autosave.markDirty();
    evict();
    return entryId;
  };

  const edit = (e: Edit, o: EditOpts): Id => commit(e.state, e.patches, o);

  /**
   * Runs fn now when the pages are in memory, else after loading them (tracked, so flush waits).
   * Every page in ids is held while it waits, so the LRU cannot evict one page while loading the
   * others (an edit of 30 pages would otherwise see only the last 12).
   */
  const withPages = (ids: readonly Id[], fn: () => void): Promise<void> => {
    const missing = ids.filter((pid) => !state.pages.has(pid));
    if (!missing.length) {
      fn();
      return Promise.resolve();
    }
    const hold = [...new Set(ids)];
    for (const pid of hold) held.set(pid, (held.get(pid) ?? 0) + 1);
    const unhold = () => {
      for (const pid of hold) {
        const n = (held.get(pid) ?? 1) - 1;
        if (n > 0) held.set(pid, n);
        else held.delete(pid);
      }
    };
    return track(
      Promise.allSettled(missing.map((pid) => loadPage(pid))).then(() => {
        try {
          fn();
        } finally {
          unhold();
          evict();
        }
      }),
    );
  };

  // ----- pages

  const loadPage = (pid: Id): Promise<Page> => {
    const cached = state.pages.get(pid);
    if (cached) {
      touchLru(pid);
      return Promise.resolve(cached);
    }
    const inFlight = loading.get(pid);
    if (inFlight) return inFlight;
    const p = (async () => {
      let page: Page;
      try {
        const r = await readJsonRecovering(fs, paths.page(pid), readPageFile, paths.quarantine, { repair: !readOnly, now: deps.now });
        if (r.ok) {
          queue.seedRev(paths.page(pid), r.value.rev);
          page = { ...decodePage(r.value.page), id: pid };
        } else {
          if (r.reason === 'unreadable') damaged.add(pid);
          page = blankPage(pid, state.notebook.defaults);
        }
      } catch {
        damaged.add(pid);
        page = blankPage(pid, state.notebook.defaults);
      }
      // An edit may have created the page while it was loading.
      const now = state.pages.get(pid);
      if (now) return now;
      const pages = new Map(state.pages);
      pages.set(pid, page);
      state = { notebook: state.notebook, pages };
      versions.set(pid, nextVersion());
      touchLru(pid);
      notifyPage(pid);
      evict();
      return page;
    })();
    loading.set(pid, p);
    const clear = () => {
      loading.delete(pid);
    };
    p.then(clear, clear);
    return p;
  };

  // ----- GC at final release

  const gc = async () => {
    const nb = state.notebook;
    // Nothing to collect: do not read every page file of a large notebook at each close.
    const scanAssets = assetGcWanted && Object.keys(nb.assets).length > 0;
    if (!nb.removedPageIds.length && !scanAssets) return;
    // live null: tombstones only, no asset is deleted.
    let live: Page[] | null = scanAssets ? [] : null;
    for (const pid of scanAssets ? nb.pageIds : []) {
      if (damaged.has(pid) || !live) {
        live = null;
        break;
      }
      const cached = state.pages.get(pid);
      if (cached) {
        live.push(cached);
        continue;
      }
      const p = await readPageQuiet(fs, paths, pid);
      if (p === 'unreadable') {
        live = null;
        break;
      }
      if (p) live.push(p);
    }
    const plan = planGc(nb, live);
    if (!plan.changed) return;
    const dropPages = new Set(plan.deletePages);
    const dropAssets = new Set(plan.deleteAssets.map((a) => a.id));
    const cur = state.notebook;
    const assets: Record<Id, Asset> = {};
    for (const [k, a] of Object.entries(cur.assets)) if (!dropAssets.has(k)) assets[k] = a;
    const pages = new Map(state.pages);
    for (const pid of dropPages) pages.delete(pid);
    state = { notebook: { ...cur, removedPageIds: cur.removedPageIds.filter((p) => !dropPages.has(p)), assets }, pages };
    metaDirty = true;
    bump();
    await writeMeta({ front: false, touch: false });
    await queue.lock(() => applyGc(fs, paths, plan));
  };

  // ----- the session object

  const s: NotebookSession = {
    get id() {
      return state.notebook.id;
    },
    readOnly,
    get notebook() {
      return state.notebook;
    },

    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    getSnapshot() {
      if (!snapshot) {
        snapshot = { notebook: state.notebook, version, canUndo: hist.canUndo(), canRedo: hist.canRedo(), saveState: saveState() };
      }
      return snapshot;
    },
    subscribePage(pid, cb) {
      let set = pageSubs.get(pid);
      if (!set) {
        set = new Set();
        pageSubs.set(pid, set);
      }
      set.add(cb);
      return () => {
        const cur = pageSubs.get(pid);
        if (!cur) return;
        cur.delete(cb);
        if (!cur.size) pageSubs.delete(pid);
      };
    },
    getPage(pid) {
      const p = state.pages.get(pid);
      if (p) touchLru(pid);
      return p;
    },
    loadPage,
    pageVersion: (pid) => versions.get(pid) ?? 0,

    addItems: (pid, items, label = 'add') => edit(ds.addItems(state, pid, items), { history: true, label }),
    updateItems: (pid, items, label = 'update') => edit(ds.updateItems(state, pid, items), { history: true, label }),
    removeItems: (pid, ids, label = 'remove') => edit(ds.removeItems(state, pid, ids), { history: true, label }),
    replaceItems: (pid, removeIds, add, label) => edit(ds.replaceItems(state, pid, removeIds, add), { history: true, label: label || 'replace' }),

    addPage(after, init) {
      if (readOnly) return '';
      const id = deps.newId();
      edit(ds.addPage(state, after, id, init), { history: true, label: 'addPage' });
      return id;
    },
    insertPages(at, pages, o) {
      if (readOnly) return;
      edit(ds.insertPages(state, at, pages), { history: o?.history !== false, label: 'insertPages' });
    },
    duplicatePages(ids) {
      if (readOnly) return [];
      const live = new Set(state.notebook.pageIds);
      const wanted = ids.filter((pid, i) => live.has(pid) && ids.indexOf(pid) === i);
      // The returned ids follow the order of `ids`; docState asks for ids in page order.
      const idFor = new Map(wanted.map((pid) => [pid, deps.newId()] as const));
      void withPages(wanted, () => {
        const e = ds.duplicatePages(state, wanted, (src) => idFor.get(src) ?? deps.newId());
        edit(e, { history: true, label: 'duplicatePages' });
      }).catch(() => undefined);
      return wanted.map((pid) => idFor.get(pid) as Id);
    },
    deletePages(ids) {
      edit(
        ds.deletePages(state, ids, () => deps.newId()),
        { history: true, label: 'deletePages' },
      );
    },
    movePage(pid, toIndex) {
      edit(ds.movePage(state, pid, toIndex), { history: true, label: 'movePage' });
    },
    setPageBackground(ids, bg, size, o) {
      if (readOnly) return;
      const history = o?.history !== false;
      void withPages(ids, () => {
        const e = ds.setPageBackground(state, ids, bg, size);
        if (!history && e.patches.length) {
          // Undoing an older change of these pages would undo this one too.
          const touched = new Set(ids);
          hist.dropWhere((h) => h.patches.some((p) => p.t === 'page' && touched.has(p.pageId)));
        }
        edit(e, { history, label: 'setPageBackground', force: !history });
      }).catch(() => undefined);
    },
    setDefaults(p) {
      edit(ds.setDefaults(state, p), { history: true, label: 'setDefaults' });
    },
    setMeta(p) {
      edit(ds.setMeta(state, p), { history: true, label: 'setMeta' });
    },
    async setLibraryFields(p: LibraryFields) {
      if (readOnly) return;
      const cur = state.notebook;
      const nb: Notebook = { ...cur };
      const keys: (keyof LibraryFields)[] = ['title', 'folderId', 'courseCode', 'deletedAt'];
      for (const k of keys) {
        if (!(k in p)) continue;
        const v = p[k];
        if (k === 'title') {
          const t = ds.cleanTitle(v ?? '');
          if (t) nb.title = t;
        } else if (v === undefined || v === '') delete nb[k];
        else nb[k] = v;
      }
      if (nb.title !== cur.title || nb.folderId !== cur.folderId || nb.courseCode !== cur.courseCode || nb.deletedAt !== cur.deletedAt) {
        if (nb.title !== cur.title) hist.dropWhere((h) => h.patches.some((x) => x.t === 'meta' && x.before.title !== undefined));
        commit({ notebook: nb, pages: state.pages }, [], { history: false, label: 'library', touch: false });
      }
      await s.flush();
    },

    setPending(p: PendingImport | undefined) {
      edit(ds.setPending(state, p), { history: false, label: 'pending', touch: false });
    },
    async flushPendingNow() {
      if (readOnly) return;
      await writeMeta({ front: true, touch: false });
    },

    async addAsset(srcPath: string, kind: AssetKind, ext: string, o?: AddAssetOptions) {
      if (readOnly) throw new Error('read-only');
      if (o?.id && state.notebook.assets[o.id]) return state.notebook.assets[o.id];
      const id = o?.id ?? deps.newId();
      const e = safeExt(ext);
      const dest = paths.asset({ id, kind, ext: e });
      await fs.mkdirp(dirName(dest));
      if (o?.move) await fs.move(srcPath, dest);
      else await fs.copy(srcPath, dest);
      const bytes = await fs.size(dest);
      const asset: Asset = { id, kind, ext: e, bytes, addedAt: iso() };
      if (o?.name) asset.name = o.name;
      if (o?.pageCount !== undefined) asset.pageCount = o.pageCount;
      edit(ds.setAsset(state, asset), { history: false, label: 'asset' });
      return state.notebook.assets[id] ?? asset;
    },
    assetPath(fileId) {
      const a = state.notebook.assets[fileId];
      return paths.asset(a ?? { id: fileId, kind: 'image', ext: 'bin' });
    },

    addRecording(r: Recording) {
      edit(ds.addRecording(state, r), { history: false, label: 'recording' });
    },
    updateRecording(rid, patch) {
      edit(ds.updateRecording(state, rid, patch), { history: false, label: 'recording' });
    },
    deleteRecording(rid) {
      if (readOnly) return Promise.resolve();
      return withPages(state.notebook.pageIds, () => {
        edit(ds.deleteRecording(state, rid), { history: true, label: 'deleteRecording' });
      });
    },

    beginGroup: (label) => hist.beginGroup(label),
    endGroup: () => hist.endGroup(),
    undo() {
      if (readOnly) return false;
      const e = hist.undo();
      if (!e) return false;
      commit(ds.applyEntry(state, e.patches, 'back', () => undefined), [], { history: false, label: 'undo', force: true });
      return true;
    },
    redo() {
      if (readOnly) return false;
      const e = hist.redo();
      if (!e) return false;
      commit(ds.applyEntry(state, e.patches, 'forward', () => undefined), [], { history: false, label: 'redo', force: true });
      return true;
    },
    canUndo: () => hist.canUndo(),
    canRedo: () => hist.canRedo(),
    topEntryId: () => hist.top()?.id ?? null,
    undoIfTop(entryId) {
      if (!entryId || !hist.isTop(entryId)) return false;
      return s.undo();
    },

    requestJump(pid) {
      for (const cb of [...jumpSubs]) cb(pid);
    },
    onJump(cb) {
      jumpSubs.add(cb);
      return () => {
        jumpSubs.delete(cb);
      };
    },

    async flush() {
      if (readOnly) return;
      await settlePending();
      if (dirty.size || metaDirty || touchDirty) autosave.markDirty();
      await autosave.flushNow();
    },
    async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
      try {
        await s.flush();
      } catch {
        // The files on disk are still a consistent (older) save.
      }
      return queue.lock(fn);
    },
    async release() {
      if (released) return;
      released = true;
      if (readOnly) {
        autosave.cancel();
        return;
      }
      try {
        await s.flush();
      } catch {
        // Kept dirty; autosave keeps retrying.
      }
      hist.clear();
      bump();
      try {
        await gc();
      } catch {
        // GC is best effort: leftovers are collected next time.
      }
    },
  };

  if (needsSave && !readOnly) {
    metaDirty = true;
    autosave.markDirty();
  }
  return s;
}
