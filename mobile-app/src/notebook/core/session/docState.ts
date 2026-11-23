/**
 * Pure document edits. Every function takes a DocState and returns { state, patches } with a NEW
 * state (the input is never changed). patches is what goes into the undo history; it is empty for
 * edits that are not undoable (recordings, pending, assets) or when nothing changed.
 *
 * doc.pages is a cache: deleted pages stay in it (and on disk as tombstones in removedPageIds), so
 * iterate notebook.pageIds, never the map. Page edits need the page in doc.pages; an edit of a page
 * that is not loaded does nothing (the session loads pages before editing them).
 */
import {
  applyPatch,
  copyPaper,
  deepEqual,
  makeItemsPatch,
  makeMetaPatch,
  makePagePatch,
  makePagesPatch,
  sizeOf,
  TITLE_MAX,
} from '../model/index.ts';
import type {
  Asset,
  DocState,
  Id,
  Notebook,
  Page,
  PageBackground,
  PageItem,
  PagesPatch,
  PaperSpec,
  Patch,
  PendingImport,
  Recording,
  Size,
} from '../model/index.ts';

export interface Edit {
  state: DocState;
  patches: Patch[];
}

const none = (doc: DocState): Edit => ({ state: doc, patches: [] });

function withPages(doc: DocState, pages: Page[]): Map<Id, Page> {
  const m = new Map(doc.pages);
  for (const p of pages) m.set(p.id, p);
  return m;
}

/** Applies a list of patches forward (used to build the new state from the patches just made). */
function forward(doc: DocState, patches: Patch[]): DocState {
  let d = doc;
  for (const p of patches) d = applyPatch(d, p, 'forward', () => undefined);
  return d;
}

// ===== items

function setItems(doc: DocState, pageId: Id, next: PageItem[]): Edit {
  const page = doc.pages.get(pageId);
  if (!page) return none(doc);
  const patch = makeItemsPatch(pageId, page.items, next);
  if (!patch) return none(doc);
  const state: DocState = { notebook: doc.notebook, pages: withPages(doc, [{ ...page, items: next }]) };
  return { state, patches: [patch] };
}

/** Appends items (an item whose id is already on the page replaces it in place). */
export function addItems(doc: DocState, pageId: Id, items: readonly PageItem[]): Edit {
  const page = doc.pages.get(pageId);
  if (!page || items.length === 0) return none(doc);
  const byId = new Map(items.map((it) => [it.id, it]));
  const next = page.items.map((it) => byId.get(it.id) ?? it);
  const present = new Set(page.items.map((it) => it.id));
  const seen = new Set<Id>();
  for (const it of items) {
    if (present.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    next.push(it);
  }
  return setItems(doc, pageId, next);
}

/** Replaces items by id, keeping their place. Unknown ids are ignored. */
export function updateItems(doc: DocState, pageId: Id, items: readonly PageItem[]): Edit {
  const page = doc.pages.get(pageId);
  if (!page || items.length === 0) return none(doc);
  const byId = new Map(items.map((it) => [it.id, it]));
  return setItems(
    doc,
    pageId,
    page.items.map((it) => byId.get(it.id) ?? it),
  );
}

export function removeItems(doc: DocState, pageId: Id, ids: readonly Id[]): Edit {
  const page = doc.pages.get(pageId);
  if (!page || ids.length === 0) return none(doc);
  const drop = new Set(ids);
  return setItems(
    doc,
    pageId,
    page.items.filter((it) => !drop.has(it.id)),
  );
}

/** Removes some items and adds others in ONE patch (shape snap, pixel erase, paste over). */
export function replaceItems(doc: DocState, pageId: Id, removeIds: readonly Id[], add: readonly PageItem[]): Edit {
  const page = doc.pages.get(pageId);
  if (!page) return none(doc);
  const drop = new Set(removeIds);
  const next = page.items.filter((it) => !drop.has(it.id));
  const present = new Set(next.map((it) => it.id));
  for (const it of add) {
    if (present.has(it.id)) {
      const i = next.findIndex((x) => x.id === it.id);
      next[i] = it;
    } else {
      present.add(it.id);
      next.push(it);
    }
  }
  return setItems(doc, pageId, next);
}

// ===== pages

function setPageIds(doc: DocState, nextIds: Id[], newPages: Page[] = []): Edit {
  const patch = makePagesPatch(doc.notebook.pageIds, nextIds);
  if (!patch) return none(doc);
  const base: DocState = newPages.length ? { notebook: doc.notebook, pages: withPages(doc, newPages) } : doc;
  return { state: forward(base, [patch]), patches: [patch] };
}

/** A new blank page with the notebook defaults (or init), after a page id or at the end. */
export function addPage(doc: DocState, after: Id | 'end', id: Id, init?: Partial<Pick<Page, 'size' | 'background'>>): Edit {
  const nb = doc.notebook;
  const background: PageBackground = init?.background ?? { kind: 'paper', paper: copyPaper(nb.defaults) };
  const size: Size = init?.size
    ? { w: init.size.w, h: init.size.h }
    : background.kind === 'paper'
      ? sizeOf(background.paper)
      : sizeOf(nb.defaults);
  const page: Page = { id, size, background, items: [] };
  const ids = [...nb.pageIds];
  const i = after === 'end' ? -1 : ids.indexOf(after);
  if (i < 0) ids.push(id);
  else ids.splice(i + 1, 0, id);
  return setPageIds(doc, ids, [page]);
}

/** Inserts pages at an index of pageIds (clamped). Ids already in the notebook are skipped. */
export function insertPages(doc: DocState, at: number, pages: readonly Page[]): Edit {
  const nb = doc.notebook;
  const live = new Set(nb.pageIds);
  const add = pages.filter((p, i) => !live.has(p.id) && pages.findIndex((q) => q.id === p.id) === i);
  if (add.length === 0) return none(doc);
  const ids = [...nb.pageIds];
  const idx = Math.max(0, Math.min(ids.length, Number.isFinite(at) ? Math.floor(at) : ids.length));
  ids.splice(idx, 0, ...add.map((p) => p.id));
  return setPageIds(doc, ids, [...add]);
}

/**
 * Copies pages (each copy right after its source). Pages that are not loaded are skipped.
 * newId(sourceId) gives the page ids; items keep their ids (ids are unique per page).
 */
export function duplicatePages(doc: DocState, ids: readonly Id[], newId: (sourceId: Id) => Id): Edit & { newIds: Id[] } {
  const nb = doc.notebook;
  const want = new Set(ids);
  const out: Id[] = [];
  const copies: Page[] = [];
  const next: Id[] = [];
  for (const pid of nb.pageIds) {
    next.push(pid);
    if (!want.has(pid)) continue;
    const src = doc.pages.get(pid);
    if (!src) continue;
    const id = newId(pid);
    copies.push({ id, size: { w: src.size.w, h: src.size.h }, background: src.background, items: src.items.slice() });
    next.push(id);
    out.push(id);
  }
  if (!copies.length) return { ...none(doc), newIds: [] };
  return { ...setPageIds(doc, next, copies), newIds: out };
}

/**
 * Tombstones pages: their ids move to removedPageIds (the files stay until GC at final release).
 * Deleting every page leaves one new blank page with the notebook defaults (newId gives its id).
 */
export function deletePages(doc: DocState, ids: readonly Id[], newId: () => Id): Edit {
  const drop = new Set(ids);
  const nb = doc.notebook;
  const next = nb.pageIds.filter((p) => !drop.has(p));
  if (next.length === nb.pageIds.length) return none(doc);
  if (next.length === 0) {
    const id = newId();
    const page: Page = { id, size: sizeOf(nb.defaults), background: { kind: 'paper', paper: copyPaper(nb.defaults) }, items: [] };
    return setPageIds(doc, [id], [page]);
  }
  return setPageIds(doc, next);
}

/** Moves a page so it ends at toIndex (clamped) of pageIds. */
export function movePage(doc: DocState, id: Id, toIndex: number): Edit {
  const ids = [...doc.notebook.pageIds];
  const from = ids.indexOf(id);
  if (from < 0) return none(doc);
  ids.splice(from, 1);
  const to = Math.max(0, Math.min(ids.length, Number.isFinite(toIndex) ? Math.floor(toIndex) : ids.length));
  ids.splice(to, 0, id);
  return setPageIds(doc, ids);
}

/**
 * Sets the background of pages (a value, or fn(page) -> background, null skips the page).
 * size, when given, is the new size. Otherwise a paper background takes its paper's size and other
 * backgrounds keep the page size. Pages that are not loaded are skipped.
 */
export function setPageBackground(
  doc: DocState,
  ids: readonly Id[],
  bg: PageBackground | ((p: Page) => PageBackground | null),
  size?: Size,
): Edit {
  const patches: Patch[] = [];
  const changed: Page[] = [];
  const seen = new Set<Id>();
  for (const pid of ids) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    const page = doc.pages.get(pid);
    if (!page) continue;
    const next = typeof bg === 'function' ? bg(page) : bg;
    if (!next) continue;
    const nextSize: Size = size ? { w: size.w, h: size.h } : next.kind === 'paper' ? sizeOf(next.paper) : { w: page.size.w, h: page.size.h };
    const patch = makePagePatch(pid, { size: page.size, background: page.background }, { size: nextSize, background: next });
    if (!patch) continue;
    patches.push(patch);
    changed.push({ ...page, size: nextSize, background: next });
  }
  if (!patches.length) return none(doc);
  return { state: { notebook: doc.notebook, pages: withPages(doc, changed) }, patches };
}

// ===== notebook meta

/** The notebook default paper for new pages (NB-23). */
export function setDefaults(doc: DocState, paper: PaperSpec): Edit {
  const patch = makeMetaPatch({ defaults: doc.notebook.defaults }, { defaults: copyPaper(paper) });
  if (!patch) return none(doc);
  return { state: forward(doc, [patch]), patches: [patch] };
}

/** A title is trimmed and capped at 200 characters; an empty title is ignored. */
export function cleanTitle(t: string): string {
  return String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX);
}

export function setMeta(doc: DocState, p: Partial<Pick<Notebook, 'title'>>): Edit {
  if (p.title === undefined) return none(doc);
  const title = cleanTitle(p.title);
  if (!title) return none(doc);
  const patch = makeMetaPatch({ title: doc.notebook.title }, { title });
  if (!patch) return none(doc);
  return { state: forward(doc, [patch]), patches: [patch] };
}

const withNotebook = (doc: DocState, nb: Notebook): Edit => ({ state: { notebook: nb, pages: doc.pages }, patches: [] });

/** No history. */
export function setPending(doc: DocState, p: PendingImport | undefined): Edit {
  const cur = doc.notebook.pending;
  if (deepEqual(cur, p)) return none(doc);
  const nb: Notebook = { ...doc.notebook };
  if (p) nb.pending = p;
  else delete nb.pending;
  return withNotebook(doc, nb);
}

/** No history. */
export function setAsset(doc: DocState, a: Asset): Edit {
  if (deepEqual(doc.notebook.assets[a.id], a)) return none(doc);
  return withNotebook(doc, { ...doc.notebook, assets: { ...doc.notebook.assets, [a.id]: a } });
}

/** No history. A recording with an id that exists replaces it. */
export function addRecording(doc: DocState, r: Recording): Edit {
  const list = doc.notebook.recordings;
  const i = list.findIndex((x) => x.id === r.id);
  const next = i >= 0 ? list.map((x, j) => (j === i ? r : x)) : [...list, r];
  if (i >= 0 && deepEqual(list[i], r)) return none(doc);
  return withNotebook(doc, { ...doc.notebook, recordings: next });
}

/** No history. */
export function updateRecording(doc: DocState, id: Id, patch: Partial<Recording>): Edit {
  const list = doc.notebook.recordings;
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return none(doc);
  const merged: Recording = { ...list[i], ...patch, id };
  if (deepEqual(merged, list[i])) return none(doc);
  return withNotebook(doc, { ...doc.notebook, recordings: list.map((x, j) => (j === i ? merged : x)) });
}

/**
 * ONE undoable change: a meta patch (recordings without this one) plus an items patch for every
 * loaded page whose items carry a mark of it (the marks are stripped). Load all pages first.
 */
export function deleteRecording(doc: DocState, id: Id): Edit {
  const list = doc.notebook.recordings;
  if (!list.some((r) => r.id === id)) return none(doc);
  const meta = makeMetaPatch({ recordings: list }, { recordings: list.filter((r) => r.id !== id) });
  const patches: Patch[] = meta ? [meta] : [];
  const changed: Page[] = [];
  const pids = new Set([...doc.notebook.pageIds, ...doc.pages.keys()]);
  for (const pid of pids) {
    const page = doc.pages.get(pid);
    if (!page || !page.items.some((it) => it.rec?.recordingId === id)) continue;
    const items = page.items.map((it) => {
      if (it.rec?.recordingId !== id) return it;
      const copy = { ...it };
      delete copy.rec;
      return copy;
    });
    const p = makeItemsPatch(pid, page.items, items);
    if (!p) continue;
    patches.push(p);
    changed.push({ ...page, items });
  }
  if (!patches.length) return none(doc);
  const base: DocState = { notebook: doc.notebook, pages: withPages(doc, changed) };
  return { state: meta ? forward(base, [meta]) : base, patches };
}

// ===== rebasing history patches

/**
 * Merges a target order with the current one: ids that only the current list has (added by edits
 * that are not in history, such as a background PDF import) keep their place after their nearest
 * earlier neighbour.
 */
function mergeOrder(target: readonly Id[], current: readonly Id[], known: ReadonlySet<Id>): Id[] {
  const out = [...new Set(target)];
  const inOut = new Set(out);
  for (let i = 0; i < current.length; i++) {
    const id = current[i];
    if (known.has(id) || inOut.has(id)) continue;
    // After the nearest earlier neighbour, else before the nearest later one, else at the end.
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) {
      const k = out.indexOf(current[j]);
      if (k >= 0) at = k + 1;
    }
    for (let j = i + 1; j < current.length && at < 0; j++) {
      const k = out.indexOf(current[j]);
      if (k >= 0) at = k;
    }
    if (at < 0) at = out.length;
    out.splice(at, 0, id);
    inOut.add(id);
  }
  return out;
}

function mergeRecordings(target: readonly Recording[], current: readonly Recording[], known: ReadonlySet<Id>): Recording[] {
  // Recordings the history knows come from the target list, but with their CURRENT content when they
  // still exist (a rename or a duration update after the change is kept).
  const cur = new Map(current.map((r) => [r.id, r]));
  const ids = mergeOrder(
    target.map((r) => r.id),
    current.map((r) => r.id),
    known,
  );
  const tgt = new Map(target.map((r) => [r.id, r]));
  const out: Recording[] = [];
  for (const id of ids) {
    const r = cur.get(id) ?? tgt.get(id);
    if (r) out.push(r);
  }
  return out;
}

/**
 * The patch to apply so that undoing (dir 'back') or redoing (dir 'forward') p gives the right result
 * on the CURRENT document, even when edits without history (insertPages history:false, recordings
 * added or updated) happened since. Pages and recordings patches are rebuilt against the current
 * lists; every other patch is returned as is. Apply the result with the SAME dir.
 */
export function rebasePatch(p: Patch, doc: DocState, dir: 'forward' | 'back'): Patch {
  if (p.t === 'pages') {
    const from = dir === 'back' ? p.after : p.before;
    const target = dir === 'back' ? p.before : p.after;
    const cur = doc.notebook.pageIds;
    if (deepEqual(from, cur)) return p;
    const known = new Set([...p.before, ...p.after]);
    const next = mergeOrder(target, cur, known);
    const q: PagesPatch = dir === 'back' ? { t: 'pages', before: next, after: [...cur] } : { t: 'pages', before: [...cur], after: next };
    return q;
  }
  if (p.t === 'meta' && (p.before.recordings !== undefined || p.after.recordings !== undefined)) {
    const fromSide = dir === 'back' ? p.after : p.before;
    const targetSide = dir === 'back' ? p.before : p.after;
    const cur = doc.notebook.recordings;
    if (deepEqual(fromSide.recordings, cur)) return p;
    const known = new Set([...(p.before.recordings ?? []), ...(p.after.recordings ?? [])].map((r) => r.id));
    const recordings = mergeRecordings(targetSide.recordings ?? [], cur, known);
    const target = { ...targetSide, recordings };
    const from = { ...fromSide, recordings: cur };
    return dir === 'back' ? { t: 'meta', before: target, after: from } : { t: 'meta', before: from, after: target };
  }
  return p;
}

/** Undo (back) or redo (forward) a history entry's patches on the current document, rebased. */
export function applyEntry(doc: DocState, patches: readonly Patch[], dir: 'forward' | 'back', loadTombstone: (pid: Id) => Page | undefined): DocState {
  let d = doc;
  const order = dir === 'forward' ? patches : [...patches].reverse();
  for (const p of order) d = applyPatch(d, rebasePatch(p, d, dir), dir, loadTombstone);
  return d;
}

/** Page ids whose page object differs between two states (changed, added or dropped from the cache). */
export function changedPageIds(prev: DocState, next: DocState): Id[] {
  if (prev.pages === next.pages) return [];
  const out: Id[] = [];
  for (const [id, p] of next.pages) if (prev.pages.get(id) !== p) out.push(id);
  return out;
}
