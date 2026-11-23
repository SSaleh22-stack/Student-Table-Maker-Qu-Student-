/**
 * Erasing (NB-42). The eraser path is flat x, y page points (its centers); radius is the eraser's
 * radius in pt.
 *
 * - Stroke mode removes every erasable item the path touches.
 * - Pixel mode cuts strokes: the parts of the centerline within radius + the ink's half width of the
 *   path are removed (so the eraser clears the ink under it, caps included) and
 *   each remaining run becomes its own stroke with the same tool, color, width, pressure flag, rec
 *   and at. The FIRST piece keeps the original id, so session.replaceItems puts it back in place
 *   (other pieces are appended); a fully erased stroke goes into removeIds. Unfilled shapes are cut
 *   the same way into plain strokes (pressure off); filled shapes are removed whole.
 * - highlighterOnly limits both modes to highlighter strokes and highlighter shapes (pen ink is never
 *   touched). Text and images are never erased.
 */
import type { Id, PageItem, ShapeItem, StrokeItem } from '../model/index.ts';
import { boundsIntersect, boundsOfPoints, inflateBounds, itemBounds, shapeOutline } from './bounds.ts';
import { resolveFreehand, strokeOptions } from './freehand.ts';
import { distToSegmentSq, isErasable, segmentHitsItem } from './hittest.ts';

/** Pieces shorter than this (pt) are dropped. */
export const MIN_PIECE_LENGTH = 0.5;

/** True when (x, y) is within r of the eraser path (only the segments listed in segs). */
function insidePath(path: ArrayLike<number>, segs: number[], r: number, x: number, y: number): boolean {
  'worklet';
  const n = Math.floor(path.length / 2);
  const r2 = r * r;
  for (let k = 0; k < segs.length; k++) {
    const i = segs[k];
    const j = n === 1 ? 0 : i + 1;
    if (distToSegmentSq(x, y, path[i * 2], path[i * 2 + 1], path[j * 2], path[j * 2 + 1]) <= r2) return true;
  }
  return false;
}

/** Eraser path segment indices whose bounds (inflated by r) meet bounds b. */
function nearSegments(path: ArrayLike<number>, b: ArrayLike<number>, r: number): number[] {
  'worklet';
  const n = Math.floor(path.length / 2);
  const out: number[] = [];
  if (n === 1) {
    if (path[0] + r >= b[0] && path[0] - r <= b[2] && path[1] + r >= b[1] && path[1] - r <= b[3]) out.push(0);
    return out;
  }
  for (let i = 0; i + 1 < n; i++) {
    const ax = path[i * 2];
    const ay = path[i * 2 + 1];
    const bx = path[i * 2 + 2];
    const by = path[i * 2 + 3];
    if (Math.max(ax, bx) + r >= b[0] && Math.min(ax, bx) - r <= b[2] && Math.max(ay, by) + r >= b[1] && Math.min(ay, by) - r <= b[3]) out.push(i);
  }
  return out;
}

function pushLerp(out: number[], pts: ArrayLike<number>, a: number, b: number, stride: number, t: number): void {
  'worklet';
  for (let k = 0; k < stride; k++) out.push(pts[a + k] + (pts[b + k] - pts[a + k]) * t);
}

/**
 * Splits a polyline (x, y first in each stride record) by the eraser path. Returns null when the path
 * does not touch it, else the remaining runs (each a flat array with the same stride; may be empty).
 *
 * The centerline is cut where it comes within radius + pad of the path, where pad is the ink's half
 * width at that point: padBase + padPerP * pressure (pressure = component 2 when stride >= 3, else
 * 0.5). With pad = the half width, the round caps of the remaining pieces end at the eraser's edge, so
 * the eraser removes the ink under it and a thick highlighter visibly opens up.
 */
export function splitPolyline(
  pts: ArrayLike<number>,
  stride: number,
  path: ArrayLike<number>,
  radius: number,
  padBase: number = 0,
  padPerP: number = 0,
): number[][] | null {
  'worklet';
  const n = Math.floor(pts.length / stride);
  if (n === 0 || path.length < 2 || !(radius > 0)) return null;
  const hasP = stride >= 3 && padPerP !== 0;
  // the effective cut radius at the pressure p
  let minR = Infinity;
  let maxR = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = hasP ? pts[i * stride + 2] : 0.5;
    const r = radius + Math.max(0, padBase + padPerP * (p >= 0 ? p : 0.5));
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  const pb = boundsOfPoints(pts, stride);
  const segs = nearSegments(path, pb, maxR);
  if (segs.length === 0) return null;
  const step = minR * 0.25;
  const runs: number[][] = [];
  let cur: number[] = [];
  let touched = false;

  const p0 = hasP ? pts[2] : 0.5;
  let prevIn = insidePath(path, segs, radius + Math.max(0, padBase + padPerP * (p0 >= 0 ? p0 : 0.5)), pts[0], pts[1]);
  if (prevIn) touched = true;
  else for (let k = 0; k < stride; k++) cur.push(pts[k]);
  if (n === 1) return touched ? [] : null;

  for (let i = 1; i < n; i++) {
    const a = (i - 1) * stride;
    const b = i * stride;
    const len = Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]);
    // only the eraser segments near this piece of the polyline
    const sb = [Math.min(pts[a], pts[b]), Math.min(pts[a + 1], pts[b + 1]), Math.max(pts[a], pts[b]), Math.max(pts[a + 1], pts[b + 1])];
    const local: number[] = [];
    const nPath = Math.floor(path.length / 2);
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const j = nPath === 1 ? 0 : s + 1;
      const ax = path[s * 2];
      const ay = path[s * 2 + 1];
      const bx = path[j * 2];
      const by = path[j * 2 + 1];
      if (Math.max(ax, bx) + maxR >= sb[0] && Math.min(ax, bx) - maxR <= sb[2] && Math.max(ay, by) + maxR >= sb[1] && Math.min(ay, by) - maxR <= sb[3]) {
        local.push(s);
      }
    }
    let pa = hasP ? pts[a + 2] : 0.5;
    let pbb = hasP ? pts[b + 2] : 0.5;
    if (!(pa >= 0)) pa = 0.5;
    if (!(pbb >= 0)) pbb = 0.5;
    const ra = radius + Math.max(0, padBase + padPerP * pa);
    const rb = radius + Math.max(0, padBase + padPerP * pbb);
    if (local.length === 0) {
      if (prevIn) {
        // cannot happen for a continuous test, but stay consistent: leave the erased zone here
        cur = [];
        pushLerp(cur, pts, a, b, stride, 0);
      }
      prevIn = false;
      for (let k = 0; k < stride; k++) cur.push(pts[b + k]);
      continue;
    }
    const steps = Math.max(1, Math.min(4096, Math.ceil(len / step)));
    let prevT = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = pts[a] + (pts[b] - pts[a]) * t;
      const y = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * t;
      const inNow = insidePath(path, local, ra + (rb - ra) * t, x, y);
      if (inNow !== prevIn) {
        touched = true;
        // bisect the boundary between prevT and t
        let lo = prevT;
        let hi = t;
        for (let it = 0; it < 14; it++) {
          const m = (lo + hi) / 2;
          const mx = pts[a] + (pts[b] - pts[a]) * m;
          const my = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * m;
          if (insidePath(path, local, ra + (rb - ra) * m, mx, my) === prevIn) lo = m;
          else hi = m;
        }
        // the boundary point on the outside side of the edge
        const tb = prevIn ? hi : lo;
        if (prevIn) {
          cur = [];
          pushLerp(cur, pts, a, b, stride, tb);
        } else {
          pushLerp(cur, pts, a, b, stride, tb);
          runs.push(cur);
          cur = [];
        }
        prevIn = inNow;
      }
      prevT = t;
    }
    if (!prevIn) for (let k = 0; k < stride; k++) cur.push(pts[b + k]);
  }
  if (!prevIn && cur.length > 0) runs.push(cur);
  if (!touched) return null;
  const kept: number[][] = [];
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    const rn = Math.floor(r.length / stride);
    let len = 0;
    for (let i = 1; i < rn; i++) len += Math.hypot(r[i * stride] - r[(i - 1) * stride], r[i * stride + 1] - r[(i - 1) * stride + 1]);
    if (len >= MIN_PIECE_LENGTH) kept.push(r);
  }
  return kept;
}

/**
 * Pixel-erases one stroke. null = untouched; [] = fully erased; else the pieces (the first keeps
 * stroke.id, the others get newId()). Style, pressure flag, rec and at are kept.
 */
export function splitStrokeByEraser(stroke: StrokeItem, path: ArrayLike<number>, radius: number, newId: () => Id): StrokeItem[] | null {
  // freehand radius at pressure p: size * (0.5 - thinning * (0.5 - p)), or size / 2 without thinning
  const R = resolveFreehand(strokeOptions(stroke, true));
  const padBase = R.thinning ? R.size * (0.5 - 0.5 * R.thinning) : R.size / 2;
  const padPerP = R.thinning ? R.size * R.thinning : 0;
  const runs = splitPolyline(stroke.pts, 3, path, radius, padBase, padPerP);
  if (runs === null) return null;
  const out: StrokeItem[] = [];
  for (let k = 0; k < runs.length; k++) {
    const piece: StrokeItem = {
      id: k === 0 ? stroke.id : newId(),
      kind: 'stroke',
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      pressure: stroke.pressure,
      pts: runs[k],
    };
    if (stroke.rec) piece.rec = { recordingId: stroke.rec.recordingId, ms: stroke.rec.ms };
    if (stroke.at !== undefined) piece.at = stroke.at;
    out.push(piece);
  }
  return out;
}

/** Pixel-erases an unfilled shape into plain strokes (same rules as splitStrokeByEraser). */
export function splitShapeByEraser(shape: ShapeItem, path: ArrayLike<number>, radius: number, newId: () => Id): StrokeItem[] | null {
  const o = shapeOutline(shape);
  const np = Math.floor(o.pts.length / 2);
  if (np === 0) return null;
  const flat: number[] = [];
  for (let i = 0; i < np; i++) flat.push(o.pts[i * 2], o.pts[i * 2 + 1], 0.5);
  if (o.closed && np > 2) flat.push(o.pts[0], o.pts[1], 0.5);
  const runs = splitPolyline(flat, 3, path, radius, shape.width / 2, 0);
  if (runs === null) return null;
  if (o.closed && runs.length >= 2) {
    // The outline starts and ends at the same corner: when that corner survived, the last and the
    // first run are one piece.
    const first = runs[0];
    const last = runs[runs.length - 1];
    const ex = flat[flat.length - 3];
    const ey = flat[flat.length - 2];
    if (first[0] === flat[0] && first[1] === flat[1] && last[last.length - 3] === ex && last[last.length - 2] === ey) {
      runs[0] = last.concat(first.slice(3));
      runs.length -= 1;
    }
  }
  const out: StrokeItem[] = [];
  for (let k = 0; k < runs.length; k++) {
    const piece: StrokeItem = {
      id: k === 0 ? shape.id : newId(),
      kind: 'stroke',
      tool: shape.highlighter ? 'highlighter' : 'pen',
      color: shape.color,
      width: shape.width,
      pressure: false,
      pts: runs[k],
    };
    if (shape.rec) piece.rec = { recordingId: shape.rec.recordingId, ms: shape.rec.ms };
    if (shape.at !== undefined) piece.at = shape.at;
    out.push(piece);
  }
  return out;
}

export interface EraseOptions {
  mode: 'stroke' | 'pixel';
  highlighterOnly: boolean;
  newId: () => Id;
}

export interface EraseResult {
  /** Items to remove completely. */
  removeIds: Id[];
  /** Items to add; a piece with an existing id replaces that item in place (replaceItems). */
  add: PageItem[];
}

/** True when any segment (or the single point) of the eraser path touches the item. */
export function pathHitsItem(item: PageItem, path: ArrayLike<number>, radius: number): boolean {
  const n = Math.floor(path.length / 2);
  if (n === 0) return false;
  if (!boundsIntersect(inflateBounds(itemBounds(item), radius), inflateBounds(boundsOfPoints(path, 2), 0))) return false;
  if (n === 1) return segmentHitsItem(item, path[0], path[1], path[0], path[1], radius);
  for (let i = 0; i + 1 < n; i++) {
    if (segmentHitsItem(item, path[i * 2], path[i * 2 + 1], path[i * 2 + 2], path[i * 2 + 3], radius)) return true;
  }
  return false;
}

/**
 * Applies an eraser path to a page's items. The result feeds session.replaceItems(pageId, removeIds,
 * add, label) (or removeItems when add is empty). Both lists are empty when nothing was touched.
 */
export function eraseItems(items: readonly PageItem[], path: ArrayLike<number>, radius: number, o: EraseOptions): EraseResult {
  const removeIds: Id[] = [];
  const add: PageItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!isErasable(it, o.highlighterOnly)) continue;
    if (o.mode === 'stroke' || (it.kind === 'shape' && it.fill)) {
      if (pathHitsItem(it, path, radius)) removeIds.push(it.id);
      continue;
    }
    let pieces: StrokeItem[] | null = null;
    if (it.kind === 'stroke') pieces = splitStrokeByEraser(it, path, radius, o.newId);
    else if (it.kind === 'shape') pieces = splitShapeByEraser(it, path, radius, o.newId);
    if (pieces === null) continue;
    if (pieces.length === 0) removeIds.push(it.id);
    else for (let k = 0; k < pieces.length; k++) add.push(pieces[k]);
  }
  return { removeIds, add };
}
