/**
 * Recovery at open and garbage collection at final release (NB-82, PRD 9 reliability).
 *
 * RECOVERY (recoverNotebook, run by the owning session right after notebook.json was read):
 * - An orphan page file (in pages/ but in neither pageIds nor removedPageIds) whose savedAt is not
 *   older than notebook.json's savedAt is APPENDED to pageIds: it was created just before a crash,
 *   after its page file but before notebook.json was saved. An OLDER orphan is garbage left by a GC
 *   that crashed after writing notebook.json and is deleted. An unreadable orphan is left alone.
 * - An asset file (assets/ or audio/) missing from notebook.assets is ADOPTED into it (a crash after
 *   addAsset copied the file but before notebook.json was saved). The next GC drops it if nothing
 *   references it.
 * - A notebook without pages gets one blank page id (a missing page file reads as a blank page).
 *
 * GC (planGc + applyGc, run at final release when the undo history is gone):
 * - Tombstoned page files (removedPageIds) are deleted.
 * - Assets referenced by nothing are deleted. References: image items, pdf and image page
 *   backgrounds, notebook.pending and recording segments. If any live page cannot be read, no asset
 *   is deleted (we cannot know what it references).
 * - notebook.json is written WITHOUT the collected ids first, then the files are deleted, so a crash
 *   in between only leaves unreferenced files (old orphans, removed or adopted next time).
 */
import type { FsAdapter } from '../fs/adapter.ts';
import { bakPath, readJsonRecovering, tmpPath } from '../fs/journal.ts';
import type { NotebookPaths } from '../fs/layout.ts';
import { decodePage, isSafeId, readPageFile } from '../model/index.ts';
import type { Asset, AssetKind, Id, Notebook, Page } from '../model/index.ts';

export interface RecoverResult {
  notebook: Notebook;
  /** True when the notebook differs from what was read (it must be saved). */
  changed: boolean;
  appendedPages: Id[];
  adoptedAssets: Id[];
  /** Orphan page files deleted. */
  removedFiles: string[];
}

/** '<pid>.json', '<pid>.json.tmp' and '<pid>.json.bak' -> pid; anything else -> null. */
export function pageIdOfFile(name: string): Id | null {
  const m = /^(.+)\.json(\.tmp|\.bak)?$/.exec(name);
  return m && isSafeId(m[1]) ? m[1] : null;
}

/** '<id>.<ext>' -> { id, ext }; anything else -> null. */
export function assetOfFile(name: string): { id: Id; ext: string } | null {
  const m = /^([^.]+)\.([a-z0-9]{1,10})$/.exec(name);
  return m && isSafeId(m[1]) ? { id: m[1], ext: m[2] } : null;
}

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

async function removeJournaled(fs: FsAdapter, path: string, out: string[]): Promise<void> {
  for (const p of [path, tmpPath(path), bakPath(path)]) {
    if (await fs.exists(p)) {
      await fs.remove(p);
      out.push(p);
    }
  }
}

export async function recoverNotebook(
  fs: FsAdapter,
  paths: NotebookPaths,
  nb: Notebook,
  savedAt: string,
  o: { newId(): Id; now(): number },
): Promise<RecoverResult> {
  let notebook = nb;
  const appendedPages: Id[] = [];
  const adoptedAssets: Id[] = [];
  const removedFiles: string[] = [];

  // ----- orphan page files
  const known = new Set([...nb.pageIds, ...nb.removedPageIds]);
  const orphanIds = new Set<Id>();
  for (const e of await fs.list(paths.pagesDir)) {
    if (e.isDir) continue;
    const pid = pageIdOfFile(e.name);
    if (pid && !known.has(pid)) orphanIds.add(pid);
  }
  const savedMs = time(savedAt);
  const append: { pid: Id; at: number }[] = [];
  for (const pid of orphanIds) {
    const path = paths.page(pid);
    const r = await readJsonRecovering(fs, path, readPageFile, paths.quarantine, { repair: false, now: o.now });
    if (!r.ok) continue; // unreadable: leave it for a person to look at
    const at = time(r.value.savedAt);
    if (at >= savedMs) append.push({ pid, at });
    else {
      try {
        await removeJournaled(fs, path, removedFiles);
      } catch {
        // Garbage only; the next open tries again.
      }
    }
  }
  append.sort((a, b) => a.at - b.at || (a.pid < b.pid ? -1 : 1));
  if (append.length) {
    for (const a of append) appendedPages.push(a.pid);
    notebook = { ...notebook, pageIds: [...notebook.pageIds, ...appendedPages] };
  }

  // ----- asset files missing from notebook.assets
  const adopt: Asset[] = [];
  const dirs: [string, boolean][] = [
    [paths.assetsDir, false],
    [paths.audioDir, true],
  ];
  for (const [dir, audio] of dirs) {
    for (const e of await fs.list(dir)) {
      if (e.isDir) continue;
      const a = assetOfFile(e.name);
      if (!a || notebook.assets[a.id] || adopt.some((x) => x.id === a.id)) continue;
      const kind: AssetKind = audio ? 'audio' : a.ext === 'pdf' ? 'pdf' : 'image';
      adopt.push({ id: a.id, kind, ext: a.ext, bytes: e.size, addedAt: savedAt });
    }
  }
  if (adopt.length) {
    const assets = { ...notebook.assets };
    for (const a of adopt) {
      assets[a.id] = a;
      adoptedAssets.push(a.id);
    }
    notebook = { ...notebook, assets };
  }

  // ----- never zero pages
  if (notebook.pageIds.length === 0) notebook = { ...notebook, pageIds: [o.newId()] };

  return { notebook, changed: notebook !== nb, appendedPages, adoptedAssets, removedFiles };
}

// ===== GC

/** Asset ids a notebook still needs: page items and backgrounds, pending import, recordings. */
export function referencedAssetIds(nb: Notebook, pages: Iterable<Page>): Set<Id> {
  const out = new Set<Id>();
  for (const page of pages) {
    const bg = page.background;
    if (bg.kind === 'pdf' || bg.kind === 'image') out.add(bg.fileId);
    for (const it of page.items) if (it.kind === 'image') out.add(it.fileId);
  }
  if (nb.pending) out.add(nb.pending.fileId);
  for (const r of nb.recordings) for (const s of r.segments) out.add(s.fileId);
  return out;
}

export interface GcPlan {
  /** The notebook to save BEFORE deleting files. */
  notebook: Notebook;
  deletePages: Id[];
  deleteAssets: Asset[];
  changed: boolean;
}

/**
 * livePages: every page in pageIds, or null when one could not be read (then no asset is deleted).
 */
export function planGc(nb: Notebook, livePages: Page[] | null): GcPlan {
  const live = new Set(nb.pageIds);
  const deletePages = nb.removedPageIds.filter((p) => !live.has(p));
  let deleteAssets: Asset[] = [];
  if (livePages) {
    const refs = referencedAssetIds(nb, livePages);
    deleteAssets = Object.values(nb.assets).filter((a) => !refs.has(a.id));
  }
  if (!deletePages.length && !deleteAssets.length && nb.removedPageIds.length === 0) {
    return { notebook: nb, deletePages, deleteAssets, changed: false };
  }
  const assets = { ...nb.assets };
  for (const a of deleteAssets) delete assets[a.id];
  const notebook: Notebook = { ...nb, removedPageIds: [], assets };
  return { notebook, deletePages, deleteAssets, changed: true };
}

/** Deletes the files of a GC plan (after its notebook was saved). Never throws; returns the paths removed. */
export async function applyGc(fs: FsAdapter, paths: NotebookPaths, plan: GcPlan): Promise<string[]> {
  const removed: string[] = [];
  for (const pid of plan.deletePages) {
    try {
      await removeJournaled(fs, paths.page(pid), removed);
    } catch {
      // An old orphan now; the next open removes it.
    }
  }
  for (const a of plan.deleteAssets) {
    try {
      const p = paths.asset(a);
      if (await fs.exists(p)) {
        await fs.remove(p);
        removed.push(p);
      }
    } catch {
      // Adopted again at the next open, then collected.
    }
  }
  return removed;
}

/** Reads a page file without repairing it (GC, usage). null when missing; 'unreadable' when damaged. */
export async function readPageQuiet(fs: FsAdapter, paths: NotebookPaths, pid: Id): Promise<Page | null | 'unreadable'> {
  const r = await readJsonRecovering(fs, paths.page(pid), readPageFile, paths.quarantine, { repair: false });
  if (!r.ok) return r.reason === 'missing' ? null : 'unreadable';
  return { ...decodePage(r.value.page), id: pid };
}
