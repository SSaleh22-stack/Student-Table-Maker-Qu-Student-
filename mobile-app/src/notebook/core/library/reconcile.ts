/**
 * Index <-> disk reconciliation (boot). The notebook folders on disk are the truth; the AsyncStorage
 * index is a fast cache that can lag (its writes are debounced) or be lost.
 *
 * planReconcile (pure) decides, per notebook:
 * - on disk and readable, missing from the index: add an entry (needsThumb when there is no cover).
 * - on disk and readable, in the index: refresh the entry from notebook.json (the store-owned fields
 *   thumbRev, needsThumb, bytes and importing are kept). A notebook saved by a NEWER app (readOnly)
 *   keeps the index's title, location and deletedAt, since ops change only the index for those.
 * - folder without any notebook.json (main, .tmp and .bak all missing) and no index entry: an
 *   interrupted create, so the folder is deleted. With an index entry it is left alone.
 * - notebook.json unreadable: kept on disk; a placeholder entry is added if the index has none, so the
 *   student sees it and can delete it.
 * - a folder whose id is in the purged tombstones and not in the index: an interrupted purge, deleted.
 * - index entry without a folder: removed (no tombstone: nothing was purged on purpose).
 * Ids with an open session are never touched.
 */
import type { FsAdapter } from '../fs/adapter.ts';
import { readJsonRecovering } from '../fs/journal.ts';
import { isNotebookDirName, nbLayout } from '../fs/layout.ts';
import { copyPaper, DEFAULT_PAPER, notebookOf, readNotebookFile } from '../model/index.ts';
import type { Id, IndexCover, IndexEntry, IndexFile, Notebook } from '../model/index.ts';
import { readPageQuiet } from '../session/recover.ts';
import { coverOfPage, entryFromNotebook, removeEntry, upsertEntry } from './derive.ts';

export type DiskNotebook =
  | { id: Id; state: 'ok'; notebook: Notebook; readOnly: boolean; cover: IndexCover | null; hasCover: boolean }
  | { id: Id; state: 'missing' }
  | { id: Id; state: 'unreadable' };

export interface ReconcilePlan {
  upserts: IndexEntry[];
  removeIds: Id[];
  deleteDirs: Id[];
}

const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * Reads every notebook folder under root WITHOUT repairing anything. needCover(id, nb) says whether
 * the first page must be read for the index cover (default: always).
 */
export async function scanNotebooks(fs: FsAdapter, root: string, o?: { needCover?(id: Id, nb: Notebook): boolean; skip?: ReadonlySet<Id> }): Promise<DiskNotebook[]> {
  const layout = nbLayout(root);
  const out: DiskNotebook[] = [];
  for (const e of await fs.list(root)) {
    if (!e.isDir || !isNotebookDirName(e.name) || o?.skip?.has(e.name)) continue;
    const id = e.name;
    const paths = layout.notebook(id);
    const r = await readJsonRecovering(fs, paths.json, readNotebookFile, paths.quarantine, { repair: false });
    if (!r.ok) {
      out.push({ id, state: r.reason });
      continue;
    }
    const nb = { ...notebookOf(r.value), id };
    let cover: IndexCover | null = null;
    if (!o?.needCover || o.needCover(id, nb)) {
      const first = nb.pageIds[0];
      const page = first ? await readPageQuiet(fs, paths, first) : null;
      cover = page && page !== 'unreadable' ? coverOfPage(page) : { kind: 'paper', paper: copyPaper(nb.defaults) };
    }
    const hasCover = await fs.exists(paths.cover);
    out.push({ id, state: 'ok', notebook: nb, readOnly: r.readOnly, cover, hasCover });
  }
  return out;
}

export function placeholderEntry(id: Id): IndexEntry {
  return {
    id,
    title: '',
    createdAt: EPOCH,
    updatedAt: EPOCH,
    pageCount: 0,
    recordingCount: 0,
    hasPdf: false,
    cover: { kind: 'paper', paper: copyPaper(DEFAULT_PAPER) },
    thumbRev: 0,
    contentRev: 0,
  };
}

export function planReconcile(f: IndexFile, disk: readonly DiskNotebook[], o?: { openIds?: ReadonlySet<Id> }): ReconcilePlan {
  const open = o?.openIds ?? new Set<Id>();
  const byId = new Map(f.entries.map((e) => [e.id, e]));
  const purged = new Set(f.purged.map((t) => t.id));
  const onDisk = new Set<Id>();
  const plan: ReconcilePlan = { upserts: [], removeIds: [], deleteDirs: [] };

  for (const d of disk) {
    onDisk.add(d.id);
    if (open.has(d.id)) continue;
    const prev = byId.get(d.id);
    if (!prev && purged.has(d.id)) {
      plan.deleteDirs.push(d.id);
      continue;
    }
    if (d.state === 'missing') {
      if (!prev) plan.deleteDirs.push(d.id);
      continue;
    }
    if (d.state === 'unreadable') {
      if (!prev) plan.upserts.push(placeholderEntry(d.id));
      continue;
    }
    const e = entryFromNotebook(d.notebook, d.cover ?? prev?.cover ?? { kind: 'paper', paper: copyPaper(d.notebook.defaults) });
    if (d.readOnly) {
      e.readOnly = true;
      if (prev) {
        e.title = prev.title;
        delete e.folderId;
        delete e.courseCode;
        delete e.deletedAt;
        if (prev.folderId !== undefined) e.folderId = prev.folderId;
        if (prev.courseCode !== undefined) e.courseCode = prev.courseCode;
        if (prev.deletedAt !== undefined) e.deletedAt = prev.deletedAt;
      }
    }
    if (!prev && !d.hasCover) e.needsThumb = true;
    if (prev && upsertEntry({ ...f, entries: [prev] }, e).entries[0] === prev) continue;
    plan.upserts.push(e);
  }

  for (const e of f.entries) if (!onDisk.has(e.id) && !open.has(e.id)) plan.removeIds.push(e.id);
  return plan;
}

export function applyReconcile(f: IndexFile, plan: ReconcilePlan): IndexFile {
  let out = f;
  for (const id of plan.removeIds) out = removeEntry(out, id);
  for (const id of plan.deleteDirs) out = removeEntry(out, id);
  for (const e of plan.upserts) out = upsertEntry(out, e);
  return out;
}

export const isEmptyPlan = (p: ReconcilePlan): boolean => !p.upserts.length && !p.removeIds.length && !p.deleteDirs.length;
