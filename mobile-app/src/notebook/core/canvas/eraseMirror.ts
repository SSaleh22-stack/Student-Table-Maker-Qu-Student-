/**
 * The eraser mirror (P22, NB-42): a page's erasable items in the flat format core/ink/hittest.ts
 * hitTestFlat reads, so the stroke eraser can hit-test on the UI runtime every pointer move, with no
 * JS hop, and hide what it touches at once (live feedback).
 *
 *   ids      item ids, in page order (only strokes and shapes: text and images are never erased)
 *   bboxes   5 numbers per item: [minX, minY, maxX, maxY, halfWidth] of its polyline (flatEntry)
 *   offsets  count + 1 offsets into pts (flat x, y); closed outlines repeat their first point
 *   pts      every polyline, flat x, y
 *   flags    per item: MIRROR_HIGHLIGHTER for highlighter strokes and highlighter shapes
 *   points   total polyline points (big pages fall back to JS hit testing)
 *   big      true above MIRROR_MAX_POINTS points: then bboxes / offsets / pts are left EMPTY, so the
 *            mirror stays cheap to copy, and the canvas hit-tests on JS at 60 Hz instead.
 *
 * The mirror is rebuilt on JS when a page changes (mirrorFromItems) or extended when items were only
 * appended (mirrorAppend, cheap for a new stroke). Everything here is a worklet and works on plain
 * objects, so the same code runs in Node tests, on JS and on the UI runtime.
 */
import { flatEntry, hitTestFlat } from '../ink/hittest.ts';
import type { PageItem } from '../model/index.ts';

/** Above this many polyline points the mirror is not filled (JS hit testing at 60 Hz instead). */
export const MIRROR_MAX_POINTS = 200_000;
/** flags bit: a highlighter stroke or highlighter shape. */
export const MIRROR_HIGHLIGHTER = 1;

export interface EraseMirror {
  ids: string[];
  bboxes: number[];
  offsets: number[];
  pts: number[];
  flags: number[];
  points: number;
  big: boolean;
}

export function emptyMirror(): EraseMirror {
  'worklet';
  return { ids: [], bboxes: [], offsets: [0], pts: [], flags: [], points: 0, big: false };
}

/** True for the items the mirror holds (strokes and shapes). */
export function mirrorable(item: PageItem): boolean {
  'worklet';
  return item.kind === 'stroke' || item.kind === 'shape';
}

function isHighlighter(item: PageItem): boolean {
  'worklet';
  return (item.kind === 'stroke' && item.tool === 'highlighter') || (item.kind === 'shape' && item.highlighter === true);
}

/** Point count of an item's polyline, as flatEntry would produce it (strokes only; shapes are small). */
function pointCount(item: PageItem): number {
  'worklet';
  if (item.kind === 'stroke') return Math.floor(item.pts.length / 3);
  if (item.kind === 'shape') return item.pts ? Math.floor(item.pts.length / 2) + 1 : 50;
  return 0;
}

/** Appends items (in order) to the mirror, in place. Switches to `big` past MIRROR_MAX_POINTS. */
export function mirrorAppend(m: EraseMirror, items: readonly PageItem[]): EraseMirror {
  'worklet';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!mirrorable(it)) continue;
    m.ids.push(it.id);
    m.flags.push(isHighlighter(it) ? MIRROR_HIGHLIGHTER : 0);
    if (m.big) {
      m.points += pointCount(it);
      continue;
    }
    const e = flatEntry(it);
    const n = e.pts.length / 2;
    if (m.points + n > MIRROR_MAX_POINTS) {
      // Too big for the UI runtime: drop the geometry, keep counting.
      m.big = true;
      m.points += n;
      m.bboxes = [];
      m.offsets = [];
      m.pts = [];
      continue;
    }
    for (let k = 0; k < 5; k++) m.bboxes.push(e.bbox[k]);
    for (let k = 0; k < e.pts.length; k++) m.pts.push(e.pts[k]);
    m.offsets.push(m.pts.length);
    m.points += n;
  }
  return m;
}

/** The mirror of a page's items. */
export function mirrorFromItems(items: readonly PageItem[]): EraseMirror {
  'worklet';
  return mirrorAppend(emptyMirror(), items);
}

/**
 * When `next` is `prev` plus items appended at the end (same objects, same order), the appended
 * items; otherwise null (the mirror must be rebuilt).
 */
export function appendedItems(prev: readonly PageItem[], next: readonly PageItem[]): PageItem[] | null {
  'worklet';
  if (next.length < prev.length) return null;
  for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return null;
  return next.slice(prev.length);
}

/**
 * Ids of the mirrored items within radius of the eraser segment seg = [x0, y0, x1, y1] (page points),
 * in page order. highlighterOnly keeps only highlighter items; `skip` ids (already erased) are left
 * out. Empty for a big mirror (hit-test on JS then).
 */
export function mirrorHits(m: EraseMirror, seg: ArrayLike<number>, radius: number, highlighterOnly: boolean, skip?: readonly string[]): string[] {
  'worklet';
  if (m.big || m.ids.length === 0) return [];
  const idx = hitTestFlat(m.bboxes, m.offsets, m.pts, seg, radius);
  const out: string[] = [];
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (highlighterOnly && (m.flags[i] & MIRROR_HIGHLIGHTER) === 0) continue;
    const id = m.ids[i];
    if (skip && skip.indexOf(id) >= 0) continue;
    out.push(id);
  }
  return out;
}
