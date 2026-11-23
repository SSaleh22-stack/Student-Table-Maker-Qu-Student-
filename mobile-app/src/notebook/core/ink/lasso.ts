/**
 * Lasso selection (NB-43). The lasso is a flat x, y polygon in page space (closed implicitly).
 * - Strokes: selected when at least 50 % of their points are inside.
 * - Shapes drawn from points (line, arrow, polygon, triangle with points): the same 50 % rule over
 *   their outline resampled every LASSO_SAMPLE_SPACING pt, so long sides count by length.
 * - Boxed items (rect, ellipse, triangle from a box, text, image): selected when the box center is
 *   inside, or at least 3 of its 4 corners are.
 */
import type { Id, PageItem } from '../model/index.ts';
import { boundsIntersect, boundsOfPoints, boxCenter, boxCorners, itemBounds, shapeOutline } from './bounds.ts';
import { pointInPolygon } from './hittest.ts';
import { resample } from './resample.ts';

export const LASSO_SAMPLE_SPACING = 2;

/** Fraction (0..1) of the points (x, y first in each stride record) that are inside the lasso. */
export function fractionInside(lasso: ArrayLike<number>, pts: ArrayLike<number>, stride: number): number {
  'worklet';
  const n = Math.floor(pts.length / stride);
  if (n === 0) return 0;
  let inside = 0;
  for (let i = 0; i < n; i++) if (pointInPolygon(lasso, pts[i * stride], pts[i * stride + 1])) inside++;
  return inside / n;
}

/** The box rule: center inside, or at least 3 corners inside. */
export function boxInLasso(lasso: ArrayLike<number>, box: { x: number; y: number; w: number; h: number; rot: number }): boolean {
  'worklet';
  const c = boxCenter(box);
  if (pointInPolygon(lasso, c[0], c[1])) return true;
  const k = boxCorners(box);
  let n = 0;
  for (let i = 0; i < 4; i++) if (pointInPolygon(lasso, k[i * 2], k[i * 2 + 1])) n++;
  return n >= 3;
}

/** True when the lasso selects the item. */
export function itemInLasso(lasso: ArrayLike<number>, item: PageItem): boolean {
  'worklet';
  if (item.kind === 'stroke') return fractionInside(lasso, item.pts, 3) >= 0.5;
  if (item.kind === 'shape') {
    const box = item.box;
    const triFromPts = item.shape === 'triangle' && !!item.pts && item.pts.length >= 6;
    if (box && (item.shape === 'rect' || item.shape === 'ellipse' || (item.shape === 'triangle' && !triFromPts))) {
      return boxInLasso(lasso, box);
    }
    const o = shapeOutline(item);
    const pts = o.pts.slice();
    if (o.closed && pts.length >= 4) pts.push(pts[0], pts[1]);
    const dense = resample(pts, LASSO_SAMPLE_SPACING, 2);
    if (o.closed && dense.length >= 4) dense.length -= 2; // do not count the closing point twice
    return fractionInside(lasso, dense, 2) >= 0.5;
  }
  return boxInLasso(lasso, item.box);
}

/** Ids of the items the lasso selects, in item order. Fewer than 3 lasso points select nothing. */
export function selectByLasso(items: readonly PageItem[], lasso: ArrayLike<number>): Id[] {
  'worklet';
  const out: Id[] = [];
  if (lasso.length < 6) return out;
  const lb = boundsOfPoints(lasso, 2);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!boundsIntersect(itemBounds(it), lb)) continue;
    if (itemInLasso(lasso, it)) out.push(it.id);
  }
  return out;
}
