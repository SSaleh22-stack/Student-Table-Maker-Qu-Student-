/**
 * Shape recognition for hold-to-snap (NB-44) and the clean outlines of shape items.
 *
 * recognizeShape(pts) looks at one hand-drawn stroke and returns the clean shape it most likely is,
 * or null (the stroke then stays as drawn). Kinds are tried in the order line, arrow, ellipse, rect,
 * triangle, polygon:
 * - open strokes can only be a line or an arrow
 * - closed strokes are fitted both as an ellipse and as a polygon; the ellipse wins unless the
 *   polygon follows the stroke clearly better (POLYGON_BEATS_ELLIPSE), which keeps hand-drawn
 *   hexagons and octagons from turning into circles
 * - a polygon with 4 right-ish corners is a rect, 3 sides a triangle, 4 to 8 convex sides a polygon
 * Strokes smaller than SHAPE_MIN_SIZE (handwriting) are never shapes.
 *
 * Pure and worklet-annotated: the canvas may run it on the UI runtime when the hold detector enters
 * 'holding', then send the plain candidate to JS with scheduleOnRN. toShapeItem (JS, ids are made
 * on JS) turns it into a ShapeItem in the stroke's color and width.
 *
 * Geometry stored on ShapeItem (page points):
 * - line, arrow: pts = [x1, y1, x2, y2]; an arrow points from (x1, y1) to its tip (x2, y2)
 * - triangle, polygon: pts = the vertices in drawing order, closed implicitly
 * - rect, ellipse: box = { x, y, w, h, rot }, the unrotated box turned by rot about its center;
 *   rot is in [-PI/4, PI/4) and exactly 0 when snapped. A square or circle has w === h.
 */
import type { Box, Hex, Id, RecMark, ShapeItem, ShapeKind } from '../model/index.ts';
import { boundsOf, closedness, pathLength, pointsOf, resample, rotateAbout, shortStraw } from './corners.ts';
import type { Pt } from './corners.ts';
import { ellipseBox, ellipseOk, fitArrow, fitEllipse, fitLine, fitPolygon, isRectangular, polygonOk, rectBox } from './fit.ts';
import type { PolyFit } from './fit.ts';

/** What the student sees named: square and circle are rect and ellipse after their snaps. */
export type ShapeVariant = 'line' | 'arrow' | 'rect' | 'square' | 'ellipse' | 'circle' | 'triangle' | 'polygon';

export interface ShapeCandidate {
  /** ShapeItem.shape. */
  kind: ShapeKind;
  variant: ShapeVariant;
  /** 2 for line and arrow, 0 for ellipse, otherwise the number of vertices. */
  sides: number;
  /** line, arrow, triangle, polygon (flat x, y pairs; see the file header). */
  pts?: number[];
  /** rect, ellipse. */
  box?: Box;
  /** Fit error (rms distance / size); 0 is perfect. */
  error: number;
}

export interface ShapeStyle {
  color: Hex;
  width: number;
  fill?: Hex | null;
  highlighter?: boolean;
}

/** A stroke whose bounding box is smaller than this on both sides (page points) is never a shape. */
export const SHAPE_MIN_SIZE = 20;
/** A closed stroke is a polygon rather than an ellipse when its polygon rms is below this fraction of the ellipse rms. */
export const POLYGON_BEATS_ELLIPSE = 0.7;
export const MAX_POLYGON_SIDES = 8;
/** Resampling: bounding diagonal / RESAMPLE_DIVISOR, but never more than RESAMPLE_MAX_POINTS points. */
export const RESAMPLE_DIVISOR = 40;
export const RESAMPLE_MAX_POINTS = 400;
/** Arrow heads drawn by shapeOutline: angle from the shaft and length. */
export const ARROW_HEAD_DEG = 30;

function flatOf(pts: Pt[]): number[] {
  'worklet';
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) out.push(pts[i].x, pts[i].y);
  return out;
}

function polygonCandidate(f: PolyFit): ShapeCandidate | null {
  'worklet';
  const n = f.verts.length;
  if (n < 3 || n > MAX_POLYGON_SIDES) return null;
  if (n === 4 && isRectangular(f)) {
    const r = rectBox(f.verts);
    return { kind: 'rect', variant: r.square ? 'square' : 'rect', sides: 4, box: r.box, error: f.rms };
  }
  if (!f.convex) return null;
  if (n === 3) return { kind: 'triangle', variant: 'triangle', sides: 3, pts: flatOf(f.verts), error: f.rms };
  return { kind: 'polygon', variant: 'polygon', sides: n, pts: flatOf(f.verts), error: f.rms };
}

/**
 * Recognizes one stroke. pts is flat: stride 3 is the stroke format (x, y, pressure), stride 2 plain
 * x, y pairs. Returns null when nothing matches.
 */
export function recognizeShape(pts: ArrayLike<number>, stride: number = 3): ShapeCandidate | null {
  'worklet';
  const raw = pointsOf(pts, stride);
  if (raw.length < 2) return null;
  const b = boundsOf(raw);
  if (Math.max(b.w, b.h) < SHAPE_MIN_SIZE) return null;
  const total = pathLength(raw, false);
  const spacing = Math.max(b.diag / RESAMPLE_DIVISOR, total / RESAMPLE_MAX_POINTS);
  const rs = resample(raw, spacing, false);
  if (rs.length < 3) return null;

  // 1. line
  const line = fitLine(rs);
  if (line) return { kind: 'line', variant: 'line', sides: 2, pts: [line.a.x, line.a.y, line.b.x, line.b.y], error: line.error };

  const cl = closedness(rs);
  if (!cl.closed) {
    // 2. arrow
    let arrow = fitArrow(shortStraw(rs, false));
    if (!arrow) {
      // A small head on a long shaft spans only a few samples at the normal spacing, too few for
      // ShortStraw's straws to see its corners: try again at twice the resolution.
      const fine = resample(raw, Math.max(b.diag / (2 * RESAMPLE_DIVISOR), total / (2 * RESAMPLE_MAX_POINTS)), false);
      arrow = fitArrow(shortStraw(fine, false));
    }
    if (arrow) return { kind: 'arrow', variant: 'arrow', sides: 2, pts: [arrow.tail.x, arrow.tail.y, arrow.tip.x, arrow.tip.y], error: arrow.error };
    return null;
  }

  const loop = resample(cl.pts, spacing, true);
  if (loop.length < 8) return null;
  const ell = fitEllipse(loop);
  const poly = fitPolygon(shortStraw(loop, true));
  const polyCand = poly && polygonOk(poly) ? polygonCandidate(poly) : null;
  // 3. ellipse, unless a polygon follows the stroke clearly better
  if (ell && ellipseOk(ell)) {
    if (polyCand && poly && poly.rms < POLYGON_BEATS_ELLIPSE * ell.rms) return polyCand;
    const e = ellipseBox(ell);
    return { kind: 'ellipse', variant: e.circle ? 'circle' : 'ellipse', sides: 0, box: e.box, error: ell.rms };
  }
  // 4-6. rect, triangle, polygon
  return polyCand;
}

/** The clean shape item for a candidate, in the hand-drawn stroke's style. Run on JS (ids are made there). */
export function toShapeItem(c: ShapeCandidate, style: ShapeStyle, id: Id, rec?: RecMark, at?: number): ShapeItem {
  'worklet';
  const item: ShapeItem = { id, kind: 'shape', shape: c.kind, color: style.color, width: style.width, fill: style.fill ?? null };
  if (style.highlighter === true) item.highlighter = true;
  if (c.pts) item.pts = c.pts.slice();
  if (c.box) item.box = { x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h, rot: c.box.rot };
  if (rec) item.rec = { recordingId: rec.recordingId, ms: rec.ms };
  if (at !== undefined && Number.isFinite(at)) item.at = at;
  return item;
}

/** The two hook ends of an arrow head drawn at tip, for a stroke width. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): [number, number, number, number] {
  'worklet';
  const dx = x1 - x2;
  const dy = y1 - y2;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (!(l > 0)) return [x2, y2, x2, y2];
  const head = Math.min(Math.max(10, width * 4), l * 0.4);
  const ux = (dx / l) * head;
  const uy = (dy / l) * head;
  const a = (ARROW_HEAD_DEG * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return [x2 + ux * cs - uy * sn, y2 + ux * sn + uy * cs, x2 + ux * cs + uy * sn, y2 - ux * sn + uy * cs];
}

export interface OutlinePath {
  /** Flat x, y pairs in page points. */
  pts: number[];
  closed: boolean;
}

/**
 * Polylines that draw a shape (for the dashed snap preview and any painter that wants plain paths).
 * Ellipses are approximated with `segments` points (default 72).
 */
export function shapeOutline(s: Pick<ShapeItem, 'shape' | 'pts' | 'box'> & { width?: number }, segments: number = 72): OutlinePath[] {
  'worklet';
  const box = s.box;
  const pts = s.pts;
  if ((s.shape === 'rect' || s.shape === 'ellipse') && box) {
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const out: number[] = [];
    if (s.shape === 'rect') {
      const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ];
      for (let i = 0; i < 4; i++) {
        const p = rotateAbout(corners[i], c, box.rot);
        out.push(p.x, p.y);
      }
    } else {
      const n = Math.max(8, Math.floor(segments));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const p = rotateAbout({ x: c.x + (box.w / 2) * Math.cos(t), y: c.y + (box.h / 2) * Math.sin(t) }, c, box.rot);
        out.push(p.x, p.y);
      }
    }
    return [{ pts: out, closed: true }];
  }
  if (!pts || pts.length < 4) return [];
  const n = pts.length - (pts.length % 2);
  if (s.shape === 'line' || s.shape === 'arrow') {
    const shaft = [pts[0], pts[1], pts[n - 2], pts[n - 1]];
    if (s.shape === 'line') return [{ pts: shaft, closed: false }];
    const h = arrowHead(shaft[0], shaft[1], shaft[2], shaft[3], s.width ?? 3);
    return [
      { pts: shaft, closed: false },
      { pts: [h[0], h[1], shaft[2], shaft[3], h[2], h[3]], closed: false },
    ];
  }
  return [{ pts: pts.slice(0, n), closed: true }];
}
