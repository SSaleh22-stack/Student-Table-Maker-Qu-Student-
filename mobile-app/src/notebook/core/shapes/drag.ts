/**
 * The shape tool's geometry (P28), pure and worklet-safe: the JS tool (tools/shapes/useShapeTool.ts)
 * builds the committed shape with it, and the canvas gesture (canvas/gestures.ts) builds the live
 * preview with it on the UI runtime, so the preview is exactly the shape that will be added.
 */
import type { Hex, Id, ShapeItem, ShapeKind } from '../model/index.ts';

/** A drag shorter than this (page points, on both axes / along the line) adds nothing. */
export const SHAPE_MIN_DRAG = 4;

/** Sides within this fraction of the longer one make a square or a circle. */
export const SHAPE_EQUAL_RATIO = 0.1;

export type ShapeDragKind = Exclude<ShapeKind, 'polygon'>;

export interface ShapeStyleInput {
  color: Hex;
  width: number;
}

/**
 * The shape for a drag from (x0, y0) to (x1, y1) in page points, or null when the drag is too short.
 * - line, arrow: pts [x0, y0, x1, y1] (an arrow points at the release point).
 * - rect, ellipse: the dragged box (rot 0); within SHAPE_EQUAL_RATIO it becomes a square or circle
 *   whose side is the longer one, growing from the start corner in the drag direction.
 * - triangle: the dragged box's isosceles triangle (apex at the top middle) as 3 vertices.
 */
export function shapeFromDrag(
  kind: ShapeDragKind,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style: ShapeStyleInput,
  id: Id,
): ShapeItem | null {
  'worklet';
  if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1))) return null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (kind === 'line' || kind === 'arrow') {
    if (Math.hypot(dx, dy) < SHAPE_MIN_DRAG) return null;
    return { id, kind: 'shape', color: style.color, width: style.width, fill: null, shape: kind, pts: [x0, y0, x1, y1] };
  }
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (Math.max(w, h) < SHAPE_MIN_DRAG) return null;
  if (kind !== 'triangle') {
    const long = Math.max(w, h);
    if (long - Math.min(w, h) <= SHAPE_EQUAL_RATIO * long) {
      w = long;
      h = long;
    }
  }
  const x = dx >= 0 ? x0 : x0 - w;
  const y = dy >= 0 ? y0 : y0 - h;
  if (kind === 'triangle') {
    return { id, kind: 'shape', color: style.color, width: style.width, fill: null, shape: 'triangle', pts: [x + w / 2, y, x + w, y + h, x, y + h] };
  }
  return { id, kind: 'shape', color: style.color, width: style.width, fill: null, shape: kind, box: { x, y, w, h, rot: 0 } };
}
