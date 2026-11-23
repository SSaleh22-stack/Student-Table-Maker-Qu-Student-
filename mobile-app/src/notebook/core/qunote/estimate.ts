/**
 * The size of a .qunote file before it is written (NB-74: the share screen shows the size with and
 * without recordings). Pure: no disk access.
 *
 * - pageBytes: the total size of the notebook's page files on disk (pages/*.json). They are deflated
 *   in the archive (JSON_DEFLATE_RATIO).
 * - PDFs, images and audio are stored, so they count at their recorded size (Asset.bytes).
 * - Each entry adds its zip headers; the cover is counted at a typical 360 px PNG size.
 * Recordings are counted the way pack.ts exports them (forExport: finished segments only).
 */
import type { Notebook } from '../model/index.ts';
import { forExport } from './remap.ts';

/** Deflated size of notebook and page JSON relative to the raw text (d10-encoded strokes compress well). */
export const JSON_DEFLATE_RATIO = 0.35;
/** Local header + data descriptor + central directory entry for a ~40-char name. */
export const ENTRY_OVERHEAD = 30 + 16 + 46 + 2 * 40;
export const COVER_ESTIMATE = 48 * 1024;
const EOCD = 22;
const MANIFEST_BASE = 400;
const MANIFEST_PER_FILE = 80;

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

function estimate(nb: Notebook, pageBytes: number): number {
  const pages = nb.pageIds.length;
  let files = 1 + pages + 1; // notebook.json, pages, cover
  let stored = COVER_ESTIMATE;
  for (const id of Object.keys(nb.assets)) {
    stored += nonNeg(nb.assets[id].bytes);
    files += 1;
  }
  const notebookJson = JSON.stringify(nb).length;
  const json = (notebookJson + nonNeg(pageBytes)) * JSON_DEFLATE_RATIO;
  const manifest = (MANIFEST_BASE + files * MANIFEST_PER_FILE) * 0.5;
  return Math.round(EOCD + (files + 1) * ENTRY_OVERHEAD + manifest + json + stored);
}

export function estimateQunoteSize(nb: Notebook, pageBytes: number): { withRecordings: number; withoutRecordings: number } {
  const without = forExport(nb, false);
  const withRec = forExport(nb, true);
  const withoutRecordings = estimate(without, pageBytes);
  const withRecordings = withRec.recordings.length ? estimate(withRec, pageBytes) : withoutRecordings;
  return { withRecordings: Math.max(withRecordings, withoutRecordings), withoutRecordings };
}
