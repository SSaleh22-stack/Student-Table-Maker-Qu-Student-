/**
 * Cached page thumbnails as PNG files (the pages grid P25 shows them with expo-image, no Skia canvas
 * per cell; the cover worker P23 copies page 0 at 360 px to thumbs/cover.png).
 *
 * pageThumb(session, pageId, widthPx) -> file:// URI of
 *   Paths.cache/nb-thumbs/<notebookId>/<pageId>_<pageVersion>_<w>.png
 * - The page is loaded first (pageVersion is 0 for a page never loaded), then rendered through
 *   renderPageImage (paintPage.ts) and encoded as PNG. The file is written as .part and moved into
 *   place, so a crash never leaves half a PNG under the final name.
 * - pageVersion changes with every edit (and is unique across sessions), so a changed page gets a
 *   new file name: callers re-request when the version changes. Files of OLDER versions of the same
 *   page and width are deleted after a new one is written (never a newer one).
 * - In-flight dedupe (one render per file name) and at most THUMB_CONCURRENCY (2) renders at a time,
 *   in request order.
 * - The cache folder may be emptied by the system at any time: a missing file is rendered again.
 *
 * JS runtime only. The rendered SkImage is disposed right after encoding (no canvas sees it).
 */
import { ImageFormat } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';

import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';

import { disposeUnseen } from './imageBudget';
import { renderPageImage } from './paintPage';

/** Renders running at once. */
export const THUMB_CONCURRENCY = 2;

const ROOT = 'nb-thumbs';
const MIN_W = 16;
const MAX_W = 2048;

const inFlight = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let running = 0;

function acquireSlot(): Promise<void> {
  if (running < THUMB_CONCURRENCY) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      running += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  running -= 1;
  const next = waiting.shift();
  if (next) next();
}

const safeName = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_');

function thumbDir(notebookId: Id): Directory {
  return new Directory(Paths.cache, ROOT, safeName(notebookId));
}

/** File name of a thumbnail. */
export function thumbFileName(pageId: Id, pageVersion: number, widthPx: number): string {
  return `${safeName(pageId)}_${Math.max(0, Math.floor(pageVersion))}_${widthPx}.png`;
}

function clampWidth(widthPx: number): number {
  const w = Number.isFinite(widthPx) ? Math.round(widthPx) : 360;
  return Math.max(MIN_W, Math.min(MAX_W, w));
}

/**
 * Deletes the files of OLDER versions of the page at this width. A newer version is never touched:
 * two renders of different versions may finish out of order, and the newer file is the one a caller
 * shows.
 */
function deleteOlderVersions(dir: Directory, pageId: Id, version: number, widthPx: number): void {
  try {
    const prefix = `${safeName(pageId)}_`;
    const suffix = `_${widthPx}.png`;
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      const name = entry.name;
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
      const v = Number(name.slice(prefix.length, name.length - suffix.length));
      if (!Number.isInteger(v) || v >= version) continue;
      try {
        entry.delete();
      } catch {
        // Already gone.
      }
    }
  } catch {
    // The folder was emptied meanwhile.
  }
}

async function renderThumb(session: NotebookSession, pageId: Id, version: number, w: number, dir: Directory, name: string): Promise<string> {
  await acquireSlot();
  try {
    const target = new File(dir, name);
    if (target.exists) return target.uri;
    const img = await renderPageImage(session, pageId, w);
    let bytes: Uint8Array;
    try {
      bytes = img.encodeToBytes(ImageFormat.PNG, 100);
    } finally {
      disposeUnseen(img);
    }
    if (!bytes || bytes.length === 0) throw new Error('PNG encoding failed');
    dir.create({ intermediates: true, idempotent: true });
    const part = new File(dir, `${name}.part`);
    if (part.exists) part.delete();
    await part.write(bytes);
    if (target.exists) target.delete();
    await part.move(target);
    deleteOlderVersions(dir, pageId, Math.max(0, Math.floor(version)), w);
    return target.uri;
  } finally {
    releaseSlot();
  }
}

/**
 * file:// URI of a PNG thumbnail of the page, widthPx wide (16..2048), rendered when it is not
 * cached for the page's current version. Rejects when the page cannot be rendered.
 */
export async function pageThumb(session: NotebookSession, pageId: Id, widthPx: number): Promise<string> {
  const w = clampWidth(widthPx);
  if (!session.getPage(pageId)) await session.loadPage(pageId);
  const version = session.pageVersion(pageId);
  const dir = thumbDir(session.id);
  const name = thumbFileName(pageId, version, w);
  const id = `${session.id}/${name}`;
  const existing = inFlight.get(id);
  if (existing) return existing;
  try {
    const f = new File(dir, name);
    if (f.exists) return f.uri;
  } catch {
    // Render it below.
  }
  const p = renderThumb(session, pageId, version, w, dir, name).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, p);
  return p;
}

/** Deletes every cached thumbnail of a notebook (purge). */
export function dropPageThumbs(notebookId: Id): void {
  try {
    const dir = thumbDir(notebookId);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing cached.
  }
}
