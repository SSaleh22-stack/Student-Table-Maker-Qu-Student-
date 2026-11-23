/**
 * Bounds and item geometry.
 * Bounds are flat [minX, minY, maxX, maxY] (empty = [Infinity, Infinity, -Infinity, -Infinity]).
 * Boxes ({x, y, w, h, rot}) rotate by rot radians about their center; x, y is the unrotated top-left.
 *
 * shapeOutline is the one centerline geometry of a shape for hit tests, lasso, erasing and bounds:
 * - line / arrow: the shaft from the first to the last point of pts; an arrow adds its head
 *   (arrowHead, the same head core/shapes draws).
 * - polygon: pts, closed. triangle: pts when it has at least 3 points, else the box's isosceles
 *   triangle (top middle, bottom right, bottom left).
 * - rect: the box corners. ellipse: the box ellipse in ELLIPSE_SEGMENTS segments.
 */
import type { Box, PageItem, ShapeItem, StrokeItem } from '../model/index.ts';
import { getStrokePoints, maxOutlineRadius, strokeOptions } from './freehand.ts';

export const ELLIPSE_SEGMENTS = 48;

export function emptyBounds(): number[] {
  'worklet';
  return [Infinity, Infinity, -Infinity, -Infinity];
}

export function isEmptyBounds(b: ArrayLike<number>): boolean {
  'worklet';
  return !(b[0] <= b[2] && b[1] <= b[3]);
}

/** Bounds of the x, y of each stride-sized record. */
export function boundsOfPoints(pts: ArrayLike<number>, stride: number = 2): number[] {
  'worklet';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const n = Math.floor(pts.length / stride);
  for (let i = 0; i < n; i++) {
    const x = pts[i * stride];
    const y = pts[i * stride + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function inflateBounds(b: ArrayLike<number>, r: number): number[] {
  'worklet';
  if (isEmptyBounds(b)) return emptyBounds();
  return [b[0] - r, b[1] - r, b[2] + r, b[3] + r];
}

export function unionBounds(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  'worklet';
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function boundsIntersect(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  'worklet';
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function boundsContain(b: ArrayLike<number>, x: number, y: number): boolean {
  'worklet';
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

export function boundsCenter(b: ArrayLike<number>): number[] {
  'worklet';
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export function boundsWidth(b: ArrayLike<number>): number {
  'worklet';
  return isEmptyBounds(b) ? 0 : b[2] - b[0];
}

export function boundsHeight(b: ArrayLike<number>): number {
  'worklet';
  return isEmptyBounds(b) ? 0 : b[3] - b[1];
}

/** The 4 corners of a box (flat x, y): top-left, top-right, bottom-right, bottom-left (before rot). */
export function boxCorners(box: Box): number[] {
  'worklet';
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const c = Math.cos(box.rot || 0);
  const s = Math.sin(box.rot || 0);
  const hw = box.w / 2;
  const hh = box.h / 2;
  const out: number[] = [];
  const lx = [-hw, hw, hw, -hw];
  const ly = [-hh, -hh, hh, hh];
  for (let k = 0; k < 4; k++) out.push(cx + lx[k] * c - ly[k] * s, cy + lx[k] * s + ly[k] * c);
  return out;
}

export function boxCenter(box: Box): number[] {
  'worklet';
  return [box.x + box.w / 2, box.y + box.h / 2];
}

export function boundsOfBox(box: Box): number[] {
  'worklet';
  return boundsOfPoints(boxCorners(box), 2);
}

/** (x, y) in the box's own unrotated frame, relative to its center. */
export function toBoxLocal(box: Box, x: number, y: number): number[] {
  'worklet';
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const c = Math.cos(-(box.rot || 0));
  const s = Math.sin(-(box.rot || 0));
  const dx = x - cx;
  const dy = y - cy;
  return [dx * c - dy * s, dx * s + dy * c];
}

export function pointInBox(box: Box, x: number, y: number, pad: number = 0): boolean {
  'worklet';
  const l = toBoxLocal(box, x, y);
  return Math.abs(l[0]) <= box.w / 2 + pad && Math.abs(l[1]) <= box.h / 2 + pad;
}

/** Arrow head half-angle in degrees (the same head as core/shapes recognize.ts arrowHead draws). */
export const ARROW_HEAD_ANGLE_DEG = 30;

/**
 * Arrow head [leftX, leftY, tipX, tipY, rightX, rightY] for a shaft from (x0, y0) to (x1, y1): two
 * barbs of length min(max(10, 4 * width), 0.4 * shaft length) at +-30 degrees from the shaft, the
 * same geometry as core/shapes recognize.ts arrowHead, so hit tests and bounds match what is drawn.
 */
export function arrowHead(x0: number, y0: number, x1: number, y1: number, width: number): number[] {
  'worklet';
  const dx = x0 - x1;
  const dy = y0 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0)) return [x1, y1, x1, y1, x1, y1];
  const head = Math.min(Math.max(10, width * 4), len * 0.4);
  const ux = (dx / len) * head;
  const uy = (dy / len) * head;
  const a = (ARROW_HEAD_ANGLE_DEG * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return [x1 + ux * cs - uy * sn, y1 + ux * sn + uy * cs, x1, y1, x1 + ux * cs + uy * sn, y1 - ux * sn + uy * cs];
}

export interface ShapeOutline {
  /** Flat x, y centerline. Closed outlines do NOT repeat the first point. */
  pts: number[];
  closed: boolean;
}

/** The centerline geometry of a shape (see the file comment). */
export function shapeOutline(s: ShapeItem): ShapeOutline {
  'worklet';
  const pts = s.pts;
  const np = pts ? Math.floor(pts.length / 2) : 0;
  if (s.shape === 'line' || s.shape === 'arrow') {
    if (!pts || np === 0) return { pts: [], closed: false };
    if (np === 1) return { pts: [pts[0], pts[1]], closed: false };
    // the shaft runs from the first to the last point, as the shape is drawn
    const out = [pts[0], pts[1], pts[np * 2 - 2], pts[np * 2 - 1]];
    if (s.shape === 'arrow') {
      const h = arrowHead(pts[0], pts[1], pts[np * 2 - 2], pts[np * 2 - 1], s.width);
      // shaft ... tip, left barb, back to the tip, right barb
      out.push(h[0], h[1], h[2], h[3], h[4], h[5]);
    }
    return { pts: out, closed: false };
  }
  if (s.shape === 'polygon' || (s.shape === 'triangle' && np >= 3)) {
    return { pts: pts ? pts.slice(0, np * 2) : [], closed: true };
  }
  const box = s.box;
  if (!box) {
    return { pts: pts ? pts.slice(0, np * 2) : [], closed: np >= 3 };
  }
  if (s.shape === 'rect') return { pts: boxCorners(box), closed: true };
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const c = Math.cos(box.rot || 0);
  const sn = Math.sin(box.rot || 0);
  const out: number[] = [];
  if (s.shape === 'triangle') {
    const lx = [0, box.w / 2, -box.w / 2];
    const ly = [-box.h / 2, box.h / 2, box.h / 2];
    for (let k = 0; k < 3; k++) out.push(cx + lx[k] * c - ly[k] * sn, cy + lx[k] * sn + ly[k] * c);
    return { pts: out, closed: true };
  }
  // ellipse
  for (let k = 0; k < ELLIPSE_SEGMENTS; k++) {
    const a = (k / ELLIPSE_SEGMENTS) * Math.PI * 2;
    const lx = (Math.cos(a) * box.w) / 2;
    const ly = (Math.sin(a) * box.h) / 2;
    out.push(cx + lx * c - ly * sn, cy + lx * sn + ly * c);
  }
  return { pts: out, closed: true };
}

/** Half the visible ink width of a stroke at its widest (freehand's largest radius). */
export function strokeHalfWidth(s: Pick<StrokeItem, 'tool' | 'width' | 'pressure'>): number {
  'worklet';
  return maxOutlineRadius(strokeOptions(s, true));
}

/**
 * Extra reach of a committed stroke's start cap beyond halfWidth. When the stroke points span less
 * than 3 pt, upstream drops the leading points as end noise and swings the start cap around the
 * first point from the first KEPT outline point, so the cap reaches halfWidth + up to 3 pt (bounded
 * by the stroke's extent) from the first point. Longer strokes keep their first point: 0.
 */
function shortStrokeCapReach(s: Pick<StrokeItem, 'tool' | 'width' | 'pressure' | 'pts'>, b: ArrayLike<number>): number {
  'worklet';
  const pts = s.pts;
  const n = Math.floor(pts.length / 3);
  const diag = Math.hypot(b[2] - b[0], b[3] - b[1]);
  if (diag < 3) return diag;
  const o = (n - 1) * 3;
  // the last stroke point of a committed stroke is the last raw point
  if (Math.hypot(pts[o] - pts[0], pts[o + 1] - pts[1]) >= 3) return 0;
  const sp = getStrokePoints(pts, strokeOptions(s, true));
  const k = Math.floor(sp.length / 7);
  if (k > 0 && sp[(k - 1) * 7 + 6] >= 3) return 0;
  return Math.min(3, diag);
}

/** Axis-aligned bounds of what an item draws (ink width included). */
export function itemBounds(item: PageItem): number[] {
  'worklet';
  if (item.kind === 'stroke') {
    const b = boundsOfPoints(item.pts, 3);
    if (isEmptyBounds(b)) return b;
    // freehand draws a single point as a short capsule to (x + 1, y + 1) (upstream behaviour)
    if (item.pts.length < 6) {
      b[2] += 1;
      b[3] += 1;
    }
    return inflateBounds(b, strokeHalfWidth(item) + shortStrokeCapReach(item, b));
  }
  if (item.kind === 'shape') {
    const box = item.box;
    if (item.shape === 'ellipse' && box) {
      // exact extents of the rotated ellipse (the 48-gon of shapeOutline can sit inside them)
      const c = Math.cos(box.rot || 0);
      const s = Math.sin(box.rot || 0);
      const a = box.w / 2;
      const bb = box.h / 2;
      const hx = Math.sqrt(a * c * (a * c) + bb * s * (bb * s));
      const hy = Math.sqrt(a * s * (a * s) + bb * c * (bb * c));
      const cx = box.x + a;
      const cy = box.y + bb;
      return inflateBounds([cx - hx, cy - hy, cx + hx, cy + hy], item.width / 2);
    }
    return inflateBounds(boundsOfPoints(shapeOutline(item).pts, 2), item.width / 2);
  }
  return boundsOfBox(item.box);
}

/** Union of itemBounds (empty bounds for no items). */
export function itemsBounds(items: readonly PageItem[]): number[] {
  'worklet';
  let b = emptyBounds();
  for (let i = 0; i < items.length; i++) b = unionBounds(b, itemBounds(items[i]));
  return b;
}
