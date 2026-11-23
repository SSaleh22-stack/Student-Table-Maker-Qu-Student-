/**
 * Applying matrices to items (lasso move, resize, rotate; paste offset).
 * - Strokes and point shapes: every point is transformed; width scales by sqrt(|det|) unless
 *   scaleWidth is false.
 * - Boxed items: the center is transformed, and w, h and rot follow the transformed box axes.
 *   (A non-uniform scale of a rotated box keeps the box's own axes: the result stays a box.)
 * - Text: textMode 'scale' (default) also scales the font size by sqrt(|det|); 'reflow' keeps the
 *   size and only changes box.w (the height is recomputed by the text layout after commit).
 * - Images keep their crop.
 * The input item is never changed.
 */
import type { Box, PageItem, ShapeItem } from '../model/index.ts';
import { matApplyFlat, matScaleAt, matTranslate, matUniformScale } from './matrix.ts';
import type { Mat } from './matrix.ts';

export interface TransformOptions {
  /** Scale stroke and shape widths with the matrix (default true). */
  scaleWidth?: boolean;
  /** How text reacts to scaling (default 'scale'). */
  textMode?: 'scale' | 'reflow';
}

function normAngle(a: number): number {
  'worklet';
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return Math.abs(r) < 1e-12 ? 0 : r;
}

/** A box under a matrix: new center, axis lengths and rotation. */
export function applyMatrixToBox(box: Box, m: ArrayLike<number>): Box {
  'worklet';
  const rot = box.rot || 0;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const ncx = m[0] * cx + m[2] * cy + m[4];
  const ncy = m[1] * cx + m[3] * cy + m[5];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const ax = m[0] * c + m[2] * s;
  const ay = m[1] * c + m[3] * s;
  const bx = m[0] * -s + m[2] * c;
  const by = m[1] * -s + m[3] * c;
  const sxl = Math.hypot(ax, ay);
  const syl = Math.hypot(bx, by);
  const w = box.w * sxl;
  const h = box.h * syl;
  const nrot = sxl > 0 ? normAngle(Math.atan2(ay, ax)) : rot;
  return { x: ncx - w / 2, y: ncy - h / 2, w, h, rot: nrot };
}

function transformOne(item: PageItem, m: ArrayLike<number>, o?: TransformOptions): PageItem {
  'worklet';
  const scaleWidth = !(o && o.scaleWidth === false);
  const k = matUniformScale(m);
  if (item.kind === 'stroke') {
    return { ...item, pts: matApplyFlat(m, item.pts, 3), width: scaleWidth ? item.width * k : item.width };
  }
  if (item.kind === 'shape') {
    const next: ShapeItem = { ...item, width: scaleWidth ? item.width * k : item.width };
    if (item.pts) next.pts = matApplyFlat(m, item.pts, 2);
    if (item.box) next.box = applyMatrixToBox(item.box, m);
    return next;
  }
  if (item.kind === 'text') {
    const nb = applyMatrixToBox(item.box, m);
    if (o && o.textMode === 'reflow') {
      return { ...item, box: { ...nb, h: item.box.h, y: nb.y + (nb.h - item.box.h) / 2 } };
    }
    return { ...item, box: nb, size: item.size * k };
  }
  return { ...item, box: applyMatrixToBox(item.box, m), crop: item.crop ? { ...item.crop } : null };
}

/** The item under the matrix m (a new object of the same kind). */
export function applyMatrixToItem<T extends PageItem>(item: T, m: Mat | ArrayLike<number>, o?: TransformOptions): T {
  'worklet';
  return transformOne(item, m, o) as T;
}

/** Every item under the matrix. */
export function applyMatrixToItems<T extends PageItem>(items: readonly T[], m: Mat | ArrayLike<number>, o?: TransformOptions): T[] {
  'worklet';
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) out.push(applyMatrixToItem(items[i], m, o));
  return out;
}

/** The item moved by (dx, dy). */
export function translateItem<T extends PageItem>(item: T, dx: number, dy: number): T {
  'worklet';
  return applyMatrixToItem(item, matTranslate(dx, dy));
}

/**
 * The matrix of a preset resize (50 %, 100 %, 200 %...): scales by factor about the center of
 * bounds ([minX, minY, maxX, maxY]).
 */
export function scaleAbout(bounds: ArrayLike<number>, factor: number): Mat {
  'worklet';
  return matScaleAt((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, factor, factor);
}
