/**
 * Undo patches. A patch records one change of the document; applyPatch replays it forward or back
 * and returns a NEW DocState (the input is never changed).
 *
 * - items: diffed by id; removed/changed items keep their old index, added/changed items their new one.
 * - pages: only the before and after page-id lists. Deleted pages stay on disk as tombstones
 *   (notebook.removedPageIds); undo puts the id back and reloads the page through loadTombstone(pid)
 *   (the DocState cache or a page the caller preloaded from disk). If it returns undefined, the id is
 *   still restored and the session loads the page file lazily.
 * - page: size and background of one page.
 * - meta: title, defaults and recordings of the notebook.
 */
import type { DocState, Id, ItemsPatch, MetaFields, MetaPatch, Page, PageGeometry, PageItem, PagePatch, PagesPatch, Patch } from './types.ts';

// ===== structural equality (plain JSON data)

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(ra[k], rb[k])) return false;
  return true;
}

// ===== building patches

/** Indexes (into pairs) of a longest strictly increasing subsequence of pairs[i][1]. */
function lisIndexes(values: number[]): Set<number> {
  const n = values.length;
  const tails: number[] = [];
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = new Set<number>();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    out.add(k);
    k = prev[k];
  }
  return out;
}

/**
 * The items patch that turns `before` into `after`, or null when nothing changed. Items that are equal
 * in both lists and keep their relative order are left out; everything else is recorded.
 */
export function makeItemsPatch(pageId: Id, before: readonly PageItem[], after: readonly PageItem[]): ItemsPatch | null {
  const afterIndex = new Map<Id, number>();
  after.forEach((it, i) => afterIndex.set(it.id, i));
  // Pairs (beforeIndex, afterIndex) of equal items, in before order.
  const pairBefore: number[] = [];
  const pairAfter: number[] = [];
  before.forEach((it, i) => {
    const j = afterIndex.get(it.id);
    if (j !== undefined && (after[j] === it || deepEqual(after[j], it))) {
      pairBefore.push(i);
      pairAfter.push(j);
    }
  });
  const keep = lisIndexes(pairAfter);
  const keptBefore = new Set<number>();
  const keptAfter = new Set<number>();
  for (const k of keep) {
    keptBefore.add(pairBefore[k]);
    keptAfter.add(pairAfter[k]);
  }
  const b: ItemsPatch['before'] = [];
  const a: ItemsPatch['after'] = [];
  before.forEach((item, index) => {
    if (!keptBefore.has(index)) b.push({ index, item });
  });
  after.forEach((item, index) => {
    if (!keptAfter.has(index)) a.push({ index, item });
  });
  if (b.length === 0 && a.length === 0) return null;
  return { t: 'items', pageId, before: b, after: a };
}

export function makePagesPatch(before: readonly Id[], after: readonly Id[]): PagesPatch | null {
  if (before.length === after.length && before.every((id, i) => id === after[i])) return null;
  return { t: 'pages', before: [...before], after: [...after] };
}

export function makePagePatch(pageId: Id, before: PageGeometry, after: PageGeometry): PagePatch | null {
  if (deepEqual(before.size, after.size) && deepEqual(before.background, after.background)) return null;
  return {
    t: 'page',
    pageId,
    before: { size: { ...before.size }, background: before.background },
    after: { size: { ...after.size }, background: after.background },
  };
}

export function makeMetaPatch(before: MetaFields, after: MetaFields): MetaPatch | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof MetaFields>;
  let changed = false;
  for (const k of keys) if (!deepEqual(before[k], after[k])) changed = true;
  return changed ? { t: 'meta', before: { ...before }, after: { ...after } } : null;
}

// ===== applying patches

export function invertPatch(p: Patch): Patch {
  switch (p.t) {
    case 'items':
      return { t: 'items', pageId: p.pageId, before: p.after, after: p.before };
    case 'pages':
      return { t: 'pages', before: p.after, after: p.before };
    case 'page':
      return { t: 'page', pageId: p.pageId, before: p.after, after: p.before };
    default:
      return { t: 'meta', before: p.after, after: p.before };
  }
}

function applyItems(items: readonly PageItem[], remove: ItemsPatch['before'], add: ItemsPatch['after']): PageItem[] {
  const drop = new Set<Id>();
  for (const r of remove) drop.add(r.item.id);
  for (const r of add) drop.add(r.item.id);
  const out = drop.size ? items.filter((it) => !drop.has(it.id)) : items.slice();
  const sorted = add.length > 1 ? [...add].sort((x, y) => x.index - y.index) : add;
  for (const { index, item } of sorted) {
    const at = Math.max(0, Math.min(out.length, Number.isFinite(index) ? index : out.length));
    out.splice(at, 0, item);
  }
  return out;
}

function withPage(doc: DocState, page: Page): Map<Id, Page> {
  const pages = new Map(doc.pages);
  pages.set(page.id, page);
  return pages;
}

/**
 * Applies p forward (dir 'forward') or undoes it (dir 'back'). Pure: returns a new DocState.
 * loadTombstone(pid) supplies a page that is not in doc.pages (a restored or not-yet-cached page).
 */
export function applyPatch(doc: DocState, p: Patch, dir: 'forward' | 'back', loadTombstone: (pid: Id) => Page | undefined): DocState {
  const q = dir === 'forward' ? p : invertPatch(p);
  const pageOf = (pid: Id): Page | undefined => doc.pages.get(pid) ?? loadTombstone(pid);

  switch (q.t) {
    case 'items': {
      const page = pageOf(q.pageId);
      if (!page) return doc;
      const next: Page = { ...page, items: applyItems(page.items, q.before, q.after) };
      return { notebook: doc.notebook, pages: withPage(doc, next) };
    }
    case 'page': {
      const page = pageOf(q.pageId);
      if (!page) return doc;
      const next: Page = { ...page, size: { ...q.after.size }, background: q.after.background };
      return { notebook: doc.notebook, pages: withPage(doc, next) };
    }
    case 'pages': {
      const nb = doc.notebook;
      const after = [...new Set(q.after)];
      const live = new Set(after);
      const removed: Id[] = nb.removedPageIds.filter((id) => !live.has(id));
      const removedSet = new Set(removed);
      for (const id of q.before) {
        if (!live.has(id) && !removedSet.has(id)) {
          removed.push(id);
          removedSet.add(id);
        }
      }
      let pages = doc.pages;
      for (const id of after) {
        if (pages.has(id)) continue;
        const t = loadTombstone(id);
        if (t) {
          if (pages === doc.pages) pages = new Map(doc.pages);
          pages.set(id, t);
        }
      }
      // Deleted pages stay in the cache: undo can restore them without touching the disk.
      return { notebook: { ...nb, pageIds: after, removedPageIds: removed }, pages };
    }
    default: {
      const nb = { ...doc.notebook };
      const a = q.after;
      if (a.title !== undefined) nb.title = a.title;
      if (a.defaults !== undefined) nb.defaults = { ...a.defaults };
      if (a.recordings !== undefined) nb.recordings = a.recordings;
      return { notebook: nb, pages: doc.pages };
    }
  }
}

/** Applies a list of patches in order (forward) or in reverse order (back). */
export function applyPatches(doc: DocState, list: readonly Patch[], dir: 'forward' | 'back', loadTombstone: (pid: Id) => Page | undefined): DocState {
  let d = doc;
  if (dir === 'forward') for (const p of list) d = applyPatch(d, p, 'forward', loadTombstone);
  else for (let i = list.length - 1; i >= 0; i--) d = applyPatch(d, list[i], 'back', loadTombstone);
  return d;
}

/** Page ids a patch touches (items and page patches), for dirty tracking. */
export function patchPageIds(p: Patch): Id[] {
  if (p.t === 'items' || p.t === 'page') return [p.pageId];
  if (p.t === 'pages') return [...new Set([...p.before, ...p.after])];
  return [];
}

/** Approximate JSON size of a patch in bytes (UTF-16 length of its JSON; good enough for the 8 MB cap). */
export function patchBytes(p: Patch): number {
  try {
    return JSON.stringify(p).length;
  } catch {
    return 0;
  }
}
