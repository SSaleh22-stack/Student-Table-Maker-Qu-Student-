/**
 * Notebook transforms around a .qunote file.
 *
 * - forExport(nb, includeRecordings): what goes into the file. Tombstoned pages, the trash date and
 *   the sender's folder id (meaningless on another device) are dropped. Recordings keep only their
 *   finished segments ('done', 'recovered'; a segment still being recorded or lost is left out, and
 *   pendingPath is device-local); a recording with no segment left is dropped. Without recordings,
 *   every recording and audio asset is dropped. stripMarks removes the recording marks of items
 *   whose recording is not in the file.
 * - asCopy(nb, { newId, now }): an imported COPY (NB-73): a new id, new dates, origin 'qunote',
 *   contentRev 0, no location (the import's chosen location is applied by adoptFolder).
 * - asRestore(nb, { now }): a restore keeps the id, dates, origin and contentRev; only the trash
 *   date and tombstones are cleared.
 */
import type { Asset, EncodedItem, Id, Notebook, Recording } from '../model/index.ts';

export function forExport(nb: Notebook, includeRecordings: boolean): Notebook {
  const recordings: Recording[] = [];
  if (includeRecordings) {
    for (const r of nb.recordings) {
      const segments = r.segments
        .filter((s) => s.state === 'done' || s.state === 'recovered')
        .map((s) => {
          const out = { ...s };
          delete out.pendingPath;
          return out;
        });
      if (segments.length) recordings.push({ ...r, segments: segments.map((s) => ({ ...s })) });
    }
  }
  const audioIds = new Set<Id>();
  for (const r of recordings) for (const s of r.segments) audioIds.add(s.fileId);

  const assets: Record<Id, Asset> = {};
  for (const id of Object.keys(nb.assets)) {
    const a = nb.assets[id];
    if (a.kind === 'audio' && !audioIds.has(id)) continue;
    assets[id] = { ...a };
  }

  const out: Notebook = { ...nb, pageIds: [...nb.pageIds], removedPageIds: [], recordings, assets };
  delete out.folderId;
  delete out.deletedAt;
  return out;
}

/** The ids of the recordings a forExport() notebook keeps. */
export function keptRecordingIds(nb: Notebook): Set<Id> {
  return new Set(nb.recordings.map((r) => r.id));
}

/** Items without the recording marks whose recording is not kept. Unchanged items keep their identity. */
export function stripMarks(items: readonly EncodedItem[], kept: ReadonlySet<Id>): EncodedItem[] {
  return items.map((it) => {
    if (!it.rec || kept.has(it.rec.recordingId)) return it;
    const copy = { ...it };
    delete copy.rec;
    return copy;
  });
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function asCopy(nb: Notebook, o: { newId: Id; now: number }): Notebook {
  const now = iso(o.now);
  const out: Notebook = {
    ...nb,
    id: o.newId,
    createdAt: now,
    updatedAt: now,
    removedPageIds: [],
    origin: { kind: 'qunote', name: nb.title },
    contentRev: 0,
  };
  delete out.folderId;
  delete out.courseCode;
  delete out.deletedAt;
  return out;
}

export function asRestore(nb: Notebook, o: { now: number }): Notebook {
  const out: Notebook = { ...nb, removedPageIds: [] };
  delete out.deletedAt;
  if (!out.updatedAt) out.updatedAt = iso(o.now);
  return out;
}
