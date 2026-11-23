/**
 * Copy, cut and paste of page items, also across pages and notebooks (NB-43).
 *
 * stageClipboard copies every asset the items reference (image items) into
 * .staging/clipboard/<clipId>/ AT COPY OR CUT TIME, so a paste still works after the source notebook
 * was closed and its GC deleted the asset (a cut image is no longer referenced there).
 * pasteClipboard adds the staged assets to the target notebook (an asset id already in it is reused),
 * remaps the items' fileIds, gives the items new ids, moves them by (dx, dy) and adds them in ONE
 * history entry. Recording marks are dropped unless the target has that recording.
 *
 * The store keeps one ClipboardData in memory and calls discardClipboard on the previous one.
 * boot() keeps the staged folders of live clipboards (liveClipIds) and wipes the rest.
 */
import { joinPath } from '../fs/adapter.ts';
import type { FsAdapter } from '../fs/adapter.ts';
import { nbLayout, safeExt } from '../fs/layout.ts';
import type { Asset, Box, Id, PageItem } from '../model/index.ts';
import type { ClipboardData, NotebookSession } from '../session/types.ts';

const live = new Set<Id>();

/** Clip ids whose staged folders are in use (boot() does not wipe them). */
export function liveClipIds(): ReadonlySet<Id> {
  return live;
}

const cloneItems = (items: readonly PageItem[]): PageItem[] => JSON.parse(JSON.stringify(items)) as PageItem[];

/** Asset ids the items reference. */
export function itemAssetIds(items: readonly PageItem[]): Id[] {
  const out: Id[] = [];
  for (const it of items) if (it.kind === 'image' && !out.includes(it.fileId)) out.push(it.fileId);
  return out;
}

export async function stageClipboard(fs: FsAdapter, root: string, session: NotebookSession, items: readonly PageItem[], newId: () => Id): Promise<ClipboardData> {
  const clipId = newId();
  const dir = nbLayout(root).clipboardDir(clipId);
  const assets: ClipboardData['assets'] = [];
  live.add(clipId);
  try {
    const ids = itemAssetIds(items);
    if (ids.length) await fs.mkdirp(dir);
    for (const id of ids) {
      const asset = session.notebook.assets[id];
      if (!asset) continue;
      const src = session.assetPath(id);
      if (!(await fs.exists(src))) continue;
      const stagedPath = joinPath(dir, `${asset.id}.${safeExt(asset.ext)}`);
      await fs.copy(src, stagedPath);
      assets.push({ asset: { ...asset }, stagedPath });
    }
  } catch (e) {
    live.delete(clipId);
    try {
      await fs.remove(dir);
    } catch {
      // boot() wipes it.
    }
    throw e;
  }
  return { clipId, sourceNotebookId: session.id, items: cloneItems(items), assets };
}

/** Deletes a clipboard's staged files (when it is replaced or cleared). Never throws. */
export async function discardClipboard(fs: FsAdapter, root: string, data: ClipboardData | null): Promise<void> {
  if (!data) return;
  live.delete(data.clipId);
  try {
    await fs.remove(nbLayout(root).clipboardDir(data.clipId));
  } catch {
    // boot() wipes it.
  }
}

const moveBox = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

function movePts(pts: readonly number[], stride: number, dx: number, dy: number): number[] {
  const out = pts.slice();
  for (let i = 0; i + 1 < out.length; i += stride) {
    out[i] += dx;
    out[i + 1] += dy;
  }
  return out;
}

/** A copy of an item moved by (dx, dy), with a new id. */
export function translateItem(it: PageItem, dx: number, dy: number, id: Id): PageItem {
  switch (it.kind) {
    case 'stroke':
      return { ...it, id, pts: movePts(it.pts, 3, dx, dy) };
    case 'shape': {
      const s = { ...it, id };
      if (it.pts) s.pts = movePts(it.pts, 2, dx, dy);
      if (it.box) s.box = moveBox(it.box, dx, dy);
      return s;
    }
    case 'text':
      return { ...it, id, box: moveBox(it.box, dx, dy) };
    default:
      return { ...it, id, box: moveBox(it.box, dx, dy) };
  }
}

export async function pasteClipboard(session: NotebookSession, pageId: Id, data: ClipboardData, at: { dx: number; dy: number }, newId: () => Id): Promise<Id[]> {
  if (session.readOnly || !data.items.length) return [];
  if (!session.getPage(pageId)) await session.loadPage(pageId);
  const remap = new Map<Id, Id>();
  for (const { asset, stagedPath } of data.assets) {
    const have: Asset | undefined = session.notebook.assets[asset.id];
    if (have && have.kind === asset.kind) {
      remap.set(asset.id, have.id);
      continue;
    }
    // A different asset with the same id (practically impossible) gets a new id.
    const id = have ? newId() : asset.id;
    const added = await session.addAsset(stagedPath, asset.kind, asset.ext, { id, name: asset.name, pageCount: asset.pageCount });
    remap.set(asset.id, added.id);
  }
  const recordings = new Set(session.notebook.recordings.map((r) => r.id));
  const dx = Number.isFinite(at.dx) ? at.dx : 0;
  const dy = Number.isFinite(at.dy) ? at.dy : 0;
  const items: PageItem[] = [];
  for (const src of data.items) {
    let it = translateItem(src, dx, dy, newId());
    if (it.kind === 'image') {
      const fid = remap.get(it.fileId);
      if (!fid && !session.notebook.assets[it.fileId]) continue; // its file is gone
      if (fid) it = { ...it, fileId: fid };
    }
    if (it.rec && !recordings.has(it.rec.recordingId)) {
      const copy = { ...it };
      delete copy.rec;
      it = copy;
    }
    items.push(it);
  }
  if (!items.length) return [];
  session.addItems(pageId, items, 'paste');
  return items.map((i) => i.id);
}
