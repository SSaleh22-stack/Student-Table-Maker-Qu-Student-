/**
 * Hit testing in page space.
 *
 * Item-level (JS): hitItem, itemDistance, nearestItemWithRec (the play tool, NB-62) and
 * itemsIntersectingSegment (eraser, with a bounding-box prefilter).
 *
 * UI-runtime mirror (P22 eraseMirror / pageMirror) for hitTestFlat:
 * - bboxes: FLAT_BBOX_STRIDE (5) numbers per item: minX, minY, maxX, maxY of its polyline points
 *   (NOT inflated), then halfWidth (half the ink width). A FILLED closed shape stores
 *   -(halfWidth + 1) there instead (flatHalfWidth / flatIsFilled decode it): touching its inside is
 *   a hit too, as in segmentHitsItem.
 * - ptsOffsets: count + 1 numbers; item i's polyline is pts[ptsOffsets[i] .. ptsOffsets[i + 1]).
 * - pts: flat x, y of every item's polyline, back to back. Closed outlines repeat their first point
 *   at the end. A single point is a dot.
 * flatEntry(item) gives one item's { bbox, pts } in exactly this format.
 */
import type { PageItem, StrokeItem } from '../model/index.ts';
import { boundsOfPoints, boxCorners, itemBounds, pointInBox, shapeOutline, strokeHalfWidth, toBoxLocal, boundsIntersect, inflateBounds } from './bounds.ts';

export const FLAT_BBOX_STRIDE = 5;

/** The half ink width stored in the 5th bbox slot of the mirror format. */
export function flatHalfWidth(v: number): number {
  'worklet';
  return v < 0 ? -v - 1 : v;
}

/** True when the 5th bbox slot marks a filled closed shape. */
export function flatIsFilled(v: number): boolean {
  'worklet';
  return v < 0;
}

/** Squared distance from (px, py) to the segment a-b. */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  'worklet';
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  'worklet';
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Squared distance between segments a-b and c-d (0 when they cross). */
export function segmentDistanceSq(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  'worklet';
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    distToSegmentSq(ax, ay, cx, cy, dx, dy),
    distToSegmentSq(bx, by, cx, cy, dx, dy),
    distToSegmentSq(cx, cy, ax, ay, bx, by),
    distToSegmentSq(dx, dy, ax, ay, bx, by),
  );
}

/** Smallest squared distance from (x, y) to a polyline (x, y at the start of each stride record). */
export function polylineDistanceSq(pts: ArrayLike<number>, stride: number, closed: boolean, x: number, y: number): number {
  'worklet';
  const n = Math.floor(pts.length / stride);
  if (n === 0) return Infinity;
  if (n === 1) {
    const dx = pts[0] - x;
    const dy = pts[1] - y;
    return dx * dx + dy * dy;
  }
  let best = Infinity;
  const segs = closed && n > 2 ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * stride;
    const b = ((i + 1) % n) * stride;
    const d = distToSegmentSq(x, y, pts[a], pts[a + 1], pts[b], pts[b + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Smallest squared distance from the segment (x0, y0)-(x1, y1) to a polyline. */
export function polylineSegmentDistanceSq(
  pts: ArrayLike<number>,
  stride: number,
  closed: boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  'worklet';
  const n = Math.floor(pts.length / stride);
  if (n === 0) return Infinity;
  if (n === 1) return distToSegmentSq(pts[0], pts[1], x0, y0, x1, y1);
  let best = Infinity;
  const segs = closed && n > 2 ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * stride;
    const b = ((i + 1) % n) * stride;
    const d = segmentDistanceSq(x0, y0, x1, y1, pts[a], pts[a + 1], pts[b], pts[b + 1]);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/** Even-odd point-in-polygon for a flat x, y polygon. */
export function pointInPolygon(poly: ArrayLike<number>, x: number, y: number, stride: number = 2): boolean {
  'worklet';
  const n = Math.floor(poly.length / stride);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * stride];
    const yi = poly[i * stride + 1];
    const xj = poly[j * stride];
    const yj = poly[j * stride + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, y) to what the item draws: 0 on or inside it. */
export function itemDistance(item: PageItem, x: number, y: number): number {
  'worklet';
  if (item.kind === 'stroke') {
    return Math.max(0, Math.sqrt(polylineDistanceSq(item.pts, 3, false, x, y)) - strokeHalfWidth(item));
  }
  if (item.kind === 'shape') {
    const o = shapeOutline(item);
    if (item.fill && o.closed && pointInPolygon(o.pts, x, y)) return 0;
    return Math.max(0, Math.sqrt(polylineDistanceSq(o.pts, 2, o.closed, x, y)) - item.width / 2);
  }
  const l = toBoxLocal(item.box, x, y);
  const dx = Math.max(0, Math.abs(l[0]) - item.box.w / 2);
  const dy = Math.max(0, Math.abs(l[1]) - item.box.h / 2);
  return Math.hypot(dx, dy);
}

/** True when a touch of the given radius at (x, y) touches the item. */
export function hitItem(item: PageItem, x: number, y: number, radius: number): boolean {
  'worklet';
  if (item.kind === 'text' || item.kind === 'image') return pointInBox(item.box, x, y, radius);
  const b = inflateBounds(itemBounds(item), radius);
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  return itemDistance(item, x, y) <= radius;
}

/**
 * The item made during a recording (item.rec set) nearest to (x, y), within maxDist; null when none.
 * On a tie the later (top-most) item wins.
 */
export function nearestItemWithRec(items: readonly PageItem[], x: number, y: number, maxDist: number): PageItem | null {
  'worklet';
  let best: PageItem | null = null;
  let bestD = Infinity;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.rec) continue;
    const b = inflateBounds(itemBounds(it), maxDist);
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    const d = itemDistance(it, x, y);
    if (d <= maxDist && d <= bestD) {
      best = it;
      bestD = d;
    }
  }
  return best;
}

export interface SegmentHitOptions {
  /** Only highlighter strokes and highlighter shapes (the eraser's 'highlighter only'). */
  highlighterOnly?: boolean;
  /** Consider only strokes and shapes, as the eraser does (default true). */
  inkOnly?: boolean;
}

/** True for items the eraser may touch (strokes and shapes; with highlighterOnly, only highlighter ones). */
export function isErasable(item: PageItem, highlighterOnly: boolean): boolean {
  'worklet';
  if (item.kind === 'stroke') return highlighterOnly ? item.tool === 'highlighter' : true;
  if (item.kind === 'shape') return highlighterOnly ? item.highlighter === true : true;
  return false;
}

/** Exact test: is the item within radius of the segment? */
export function segmentHitsItem(item: PageItem, x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
  'worklet';
  if (item.kind === 'stroke') {
    const r = radius + strokeHalfWidth(item);
    return polylineSegmentDistanceSq(item.pts, 3, false, x0, y0, x1, y1) <= r * r;
  }
  if (item.kind === 'shape') {
    const s = shapeOutline(item);
    if (item.fill && s.closed && (pointInPolygon(s.pts, x0, y0) || pointInPolygon(s.pts, x1, y1))) return true;
    const r = radius + item.width / 2;
    return polylineSegmentDistanceSq(s.pts, 2, s.closed, x0, y0, x1, y1) <= r * r;
  }
  const c = boxCorners(item.box);
  if (pointInPolygon(c, x0, y0) || pointInPolygon(c, x1, y1)) return true;
  return polylineSegmentDistanceSq(c, 2, true, x0, y0, x1, y1) <= radius * radius;
}

/**
 * Ids of items within radius of the segment (x0, y0)-(x1, y1), in item order. A bounding-box test
 * runs before the exact geometry.
 */
export function itemsIntersectingSegment(
  items: readonly PageItem[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  o?: SegmentHitOptions,
): string[] {
  'worklet';
  const hlOnly = !!(o && o.highlighterOnly);
  const inkOnly = !(o && o.inkOnly === false);
  const seg = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (inkOnly || hlOnly) {
      if (!isErasable(it, hlOnly)) continue;
    }
    if (!boundsIntersect(inflateBounds(itemBounds(it), radius), seg)) continue;
    if (segmentHitsItem(it, x0, y0, x1, y1, radius)) out.push(it.id);
  }
  return out;
}

/** x, y of a stroke's points (pressure dropped). */
export function strokeXY(s: Pick<StrokeItem, 'pts'>): number[] {
  'worklet';
  const n = Math.floor(s.pts.length / 3);
  const out: number[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = s.pts[i * 3];
    out[i * 2 + 1] = s.pts[i * 3 + 1];
  }
  return out;
}

/** One item in the mirror format: its polyline bbox + half width, and its polyline. */
export function flatEntry(item: PageItem): { bbox: number[]; pts: number[] } {
  'worklet';
  let pts: number[];
  let half: number;
  if (item.kind === 'stroke') {
    pts = strokeXY(item);
    half = strokeHalfWidth(item);
  } else if (item.kind === 'shape') {
    const s = shapeOutline(item);
    pts = s.pts.slice();
    if (s.closed && pts.length >= 4) pts.push(pts[0], pts[1]);
    half = item.width / 2;
    if (item.fill && s.closed && pts.length >= 8) half = -half - 1;
  } else {
    pts = boxCorners(item.box);
    pts.push(pts[0], pts[1]);
    half = 0;
  }
  const b = boundsOfPoints(pts, 2);
  return { bbox: [b[0], b[1], b[2], b[3], half], pts };
}

/** Even-odd test against the closed ring pts[start .. end) (its last point repeats the first). */
function insideFlatRing(pts: ArrayLike<number>, start: number, end: number, x: number, y: number): boolean {
  'worklet';
  let inside = false;
  for (let k = start; k + 3 < end; k += 2) {
    const xi = pts[k];
    const yi = pts[k + 1];
    const xj = pts[k + 2];
    const yj = pts[k + 3];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Worklet over the mirror format: indices of the items within radius of the eraser segment
 * seg = [x0, y0, x1, y1] (x0 === x1 and y0 === y1 for a single point), in item order.
 */
export function hitTestFlat(
  bboxes: ArrayLike<number>,
  ptsOffsets: ArrayLike<number>,
  pts: ArrayLike<number>,
  seg: ArrayLike<number>,
  radius: number,
): number[] {
  'worklet';
  const out: number[] = [];
  const count = Math.floor(bboxes.length / 5);
  const x0 = seg[0];
  const y0 = seg[1];
  const x1 = seg[2];
  const y1 = seg[3];
  const sMinX = Math.min(x0, x1);
  const sMinY = Math.min(y0, y1);
  const sMaxX = Math.max(x0, x1);
  const sMaxY = Math.max(y0, y1);
  for (let i = 0; i < count; i++) {
    const b = i * 5;
    const hw = bboxes[b + 4];
    const r = radius + (hw < 0 ? -hw - 1 : hw);
    if (bboxes[b] - r > sMaxX || bboxes[b + 2] + r < sMinX || bboxes[b + 1] - r > sMaxY || bboxes[b + 3] + r < sMinY) continue;
    const start = ptsOffsets[i];
    const end = ptsOffsets[i + 1];
    const r2 = r * r;
    if (end - start < 2) continue;
    if (end - start < 4) {
      if (distToSegmentSq(pts[start], pts[start + 1], x0, y0, x1, y1) <= r2) out.push(i);
      continue;
    }
    if (hw < 0 && (insideFlatRing(pts, start, end, x0, y0) || insideFlatRing(pts, start, end, x1, y1))) {
      // inside a filled shape
      out.push(i);
      continue;
    }
    for (let k = start; k + 3 < end; k += 2) {
      if (segmentDistanceSq(x0, y0, x1, y1, pts[k], pts[k + 1], pts[k + 2], pts[k + 3]) <= r2) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}
