/**
 * Lasso selection math (P27, NB-43 / NB-47), pure. Every function is a worklet, so the handle gestures
 * can run it on the UI thread.
 *
 * - The selection FRAME is an oriented box {cx, cy, w, h, rot} in page points. A single boxed item (a
 *   text box, an image, or a rect / ellipse / box triangle shape) uses its own box, so the handles sit
 *   on it and follow its rotation; anything else uses the axis-aligned bounds of the items (ink width
 *   included), with rot 0.
 * - handleTransform(frame, handle, dx, dy) gives the page-space matrix for a handle dragged by
 *   (dx, dy) page points:
 *   - 'move': a translation;
 *   - corners ('tl', 'tr', 'br', 'bl'): a UNIFORM scale about the opposite corner;
 *   - edges ('t', 'r', 'b', 'l'): a ONE-AXIS scale (along the frame's own axis) about the opposite edge,
 *     so strokes are stretched non-uniformly;
 *   - 'rotate': a rotation about the frame center that snaps to multiples of 15° near them.
 *   Sizes never go below minSize (default 4 pt) and the frame never flips.
 * - transformOptionsFor(handle): how applyMatrixToItem treats widths and text for that handle (an edge
 *   keeps stroke widths and reflows text; corners scale them).
 * - presetScale(bounds, pct): the 50 / 75 / 125 / 150 / 200 % presets, about the selection center.
 * - sizeChipText(size, lang): 'عرض 330 · ارتفاع 210' / 'W 330 · H 210' (rounded points, Latin digits).
 * - pasteOffset(bounds, target, page): the (dx, dy) that centers pasted items on a point, kept on the page.
 * - Image crop (NB-47): applyCrop(item, crop) keeps the visible part where it was on the page;
 *   dragCropRect / fitAspect drive the crop sheet in display units.
 */
import type { Box, Hex, ImageItem, PageItem } from '../model/index.ts';
import { itemsBounds, isEmptyBounds } from '../ink/bounds.ts';
import { hitItem } from '../ink/hittest.ts';
import { matIdentity, matMultiply, matRotate, matRotateAt, matScale, matScaleAt, matTranslate } from '../ink/matrix.ts';
import type { Mat } from '../ink/matrix.ts';
import { applyMatrixToBox, scaleAbout } from '../ink/transform.ts';
import type { TransformOptions } from '../ink/transform.ts';

// ===== frame and handles

/** An oriented box in page points: center, size and rotation (radians about the center). */
export interface SelFrame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

export type HandleKind = 'corner' | 'edge' | 'rotate' | 'move';
/** Corners and edges are named in the frame's own (unrotated) axes: t = top, r = right, … */
export type HandleId = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l' | 'rotate' | 'move';

/** The 8 resize handles: 4 corners and 4 edge midpoints. */
export const RESIZE_HANDLES: readonly HandleId[] = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];

/** Smallest frame side a resize can produce (page points). */
export const MIN_SELECTION_SIZE = 4;
/** Largest scale one corner / edge drag can produce. */
export const MAX_HANDLE_SCALE = 50;
/** Rotation snaps to multiples of this (15°)... */
export const ROTATE_SNAP_STEP = Math.PI / 12;
/** ...when within this of one (4°). */
export const ROTATE_SNAP_TOLERANCE = (4 * Math.PI) / 180;
/** The size presets of 'تغيير الحجم', in percent. */
export const SIZE_PRESETS: readonly number[] = [50, 75, 125, 150, 200];
/** How far a paste without a target point is nudged from the original (page points). */
export const PASTE_NUDGE = 20;

export function handleKind(h: HandleId): HandleKind {
  'worklet';
  if (h === 'move' || h === 'rotate') return h;
  return h.length === 2 ? 'corner' : 'edge';
}

/** The handle's position in the frame's unit square: fx, fy in -1..1 (x right, y down; 0 = middle). */
export function handleLocal(h: HandleId): number[] {
  'worklet';
  switch (h) {
    case 'tl':
      return [-1, -1];
    case 't':
      return [0, -1];
    case 'tr':
      return [1, -1];
    case 'r':
      return [1, 0];
    case 'br':
      return [1, 1];
    case 'b':
      return [0, 1];
    case 'bl':
      return [-1, 1];
    case 'l':
      return [-1, 0];
    case 'rotate':
      return [0, -1];
    default:
      return [0, 0];
  }
}

function normAngle(a: number): number {
  'worklet';
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return Math.abs(r) < 1e-12 ? 0 : r;
}

/** The page point at (fx * w/2, fy * h/2) in the frame's own axes. */
export function framePoint(f: SelFrame, fx: number, fy: number): number[] {
  'worklet';
  const lx = (fx * f.w) / 2;
  const ly = (fy * f.h) / 2;
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return [f.cx + lx * c - ly * s, f.cy + lx * s + ly * c];
}

export function frameToBox(f: SelFrame): Box {
  'worklet';
  return { x: f.cx - f.w / 2, y: f.cy - f.h / 2, w: f.w, h: f.h, rot: f.rot };
}

export function boxToFrame(b: Box): SelFrame {
  'worklet';
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot: b.rot || 0 };
}

/** The frame under a matrix (exact for moves, rotations, uniform scales and scales along its axes). */
export function transformFrame(f: SelFrame, m: ArrayLike<number>): SelFrame {
  'worklet';
  if (m.length !== 6) return f;
  return boxToFrame(applyMatrixToBox(frameToBox(f), m));
}

/** Axis-aligned bounds [minX, minY, maxX, maxY] of what the items draw, or null for none. */
export function selectionBounds(items: readonly PageItem[]): number[] | null {
  'worklet';
  if (!items.length) return null;
  const b = itemsBounds(items);
  return isEmptyBounds(b) ? null : b;
}

/** The frame the handles are drawn on (see the header), or null for no items. */
export function selectionFrame(items: readonly PageItem[]): SelFrame | null {
  'worklet';
  if (items.length === 1) {
    const it = items[0];
    if (it.kind === 'text' || it.kind === 'image') return boxToFrame(it.box);
    if (it.kind === 'shape' && it.box) {
      // A triangle with 3+ points is drawn from its points (bounds.ts shapeOutline), not its box.
      const fromPts = it.shape === 'triangle' && !!it.pts && it.pts.length >= 6;
      if ((it.shape === 'rect' || it.shape === 'ellipse' || it.shape === 'triangle') && !fromPts) return boxToFrame(it.box);
    }
  }
  const b = selectionBounds(items);
  if (!b) return null;
  return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1], rot: 0 };
}

/** Snaps an angle to the nearest multiple of step when it is within tol of it. */
export function snapRotation(angle: number, step: number = ROTATE_SNAP_STEP, tol: number = ROTATE_SNAP_TOLERANCE): number {
  'worklet';
  const k = Math.round(angle / step);
  const snapped = k * step;
  return Math.abs(angle - snapped) <= tol ? normAngle(snapped) : normAngle(angle);
}

export interface HandleOptions {
  /** Snap rotations to 15° (default true). */
  snap?: boolean;
  /** Smallest frame side (default MIN_SELECTION_SIZE). */
  minSize?: number;
  /** Distance of the rotate handle above the frame's top edge, in page points (default 0). */
  rotateOffset?: number;
}

/** T(a) · R(rot) · S(sx, sy) · R(-rot) · T(-a): a scale along the frame's own axes about a. */
function axisScaleAt(ax: number, ay: number, rot: number, sx: number, sy: number): Mat {
  'worklet';
  if (Math.abs(rot) < 1e-12) return matScaleAt(ax, ay, sx, sy);
  return matMultiply(
    matTranslate(ax, ay),
    matMultiply(matRotate(rot), matMultiply(matScale(sx, sy), matMultiply(matRotate(-rot), matTranslate(-ax, -ay)))),
  );
}

function clampScale(s: number, side: number, minSize: number): number {
  'worklet';
  const lo = side > 0 ? Math.min(1, minSize / side) : 1;
  if (!Number.isFinite(s)) return 1;
  return Math.min(MAX_HANDLE_SCALE, Math.max(lo, s));
}

/**
 * The page-space matrix for `handle` dragged by (dx, dy) page points from where it started (the
 * handle's own position; for 'rotate', rotateOffset above the top edge's middle).
 */
export function handleTransform(frame: SelFrame, handle: HandleId, dx: number, dy: number, o?: HandleOptions): Mat {
  'worklet';
  const kind = handleKind(handle);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return matIdentity();
  if (kind === 'move') return matTranslate(dx, dy);
  const minSize = o && o.minSize !== undefined ? o.minSize : MIN_SELECTION_SIZE;
  const rot = frame.rot || 0;
  const hl = handleLocal(handle);
  const fx = hl[0];
  const fy = hl[1];
  if (kind === 'rotate') {
    const off = o && o.rotateOffset !== undefined ? o.rotateOffset : 0;
    const r = frame.h / 2 + off;
    const sx = frame.cx + r * Math.sin(rot);
    const sy = frame.cy - r * Math.cos(rot);
    const px = sx + dx - frame.cx;
    const py = sy + dy - frame.cy;
    if (px * px + py * py < 1e-12) return matIdentity();
    let delta = Math.atan2(py, px) - (rot - Math.PI / 2);
    if (!(o && o.snap === false)) delta = snapRotation(rot + delta) - rot;
    delta = normAngle(delta);
    return delta === 0 ? matIdentity() : matRotateAt(frame.cx, frame.cy, delta);
  }
  const anchor = framePoint(frame, -fx, -fy);
  const start = framePoint(frame, fx, fy);
  const cx = start[0] + dx - anchor[0];
  const cy = start[1] + dy - anchor[1];
  if (kind === 'corner') {
    const vx = start[0] - anchor[0];
    const vy = start[1] - anchor[1];
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-12) return matIdentity();
    const s = clampScale((cx * vx + cy * vy) / len2, Math.max(frame.w, frame.h), minSize);
    return matScaleAt(anchor[0], anchor[1], s, s);
  }
  // Edge: project onto the frame's own axis.
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  if (fx !== 0) {
    if (!(frame.w > 1e-9)) return matIdentity();
    const along = (cx * c + cy * sn) * fx;
    return axisScaleAt(anchor[0], anchor[1], rot, clampScale(along / frame.w, frame.w, minSize), 1);
  }
  if (!(frame.h > 1e-9)) return matIdentity();
  const along = (-cx * sn + cy * c) * fy;
  return axisScaleAt(anchor[0], anchor[1], rot, 1, clampScale(along / frame.h, frame.h, minSize));
}

/** applyMatrixToItem options for a handle: edges keep widths and reflow text; corners scale them. */
export function transformOptionsFor(handle: HandleId): TransformOptions {
  'worklet';
  if (handleKind(handle) === 'edge') return { scaleWidth: false, textMode: 'reflow' };
  return { scaleWidth: true, textMode: 'scale' };
}

/** The matrix of a size preset (percent) about the center of bounds ([minX, minY, maxX, maxY]). */
export function presetScale(bounds: ArrayLike<number>, pct: number): Mat {
  'worklet';
  if (!(pct > 0) || bounds.length < 4) return matIdentity();
  return scaleAbout(bounds, pct / 100);
}

/** The preset chip label ('50%'). */
export function presetLabel(pct: number): string {
  'worklet';
  return `${Math.round(pct)}%`;
}

/** 'عرض 330 · ارتفاع 210' (ar) or 'W 330 · H 210' (en): a frame / {w, h} / bounds array, rounded. */
export function sizeChipText(size: ArrayLike<number> | { w: number; h: number }, lang: 'ar' | 'en'): string {
  'worklet';
  let w = 0;
  let h = 0;
  if ('w' in size && 'h' in size && typeof size.w === 'number') {
    w = size.w;
    h = size.h;
  } else {
    const b = size as ArrayLike<number>;
    if (b.length >= 4 && Number.isFinite(b[0]) && Number.isFinite(b[2])) {
      w = b[2] - b[0];
      h = b[3] - b[1];
    }
  }
  const rw = Math.max(0, Math.round(Number.isFinite(w) ? w : 0));
  const rh = Math.max(0, Math.round(Number.isFinite(h) ? h : 0));
  return lang === 'ar' ? `عرض ${rw} · ارتفاع ${rh}` : `W ${rw} · H ${rh}`;
}

function placeAxis(min: number, size: number, d: number, pageSize: number | undefined): number {
  'worklet';
  if (pageSize === undefined || !(pageSize > 0)) return d;
  const lo = min + d;
  if (size >= pageSize) return (pageSize - size) / 2 - min;
  if (lo < 0) return -min;
  if (lo + size > pageSize) return pageSize - size - min;
  return d;
}

/**
 * The offset for pasting items with these bounds: centered on target (a tapped point or the visible
 * center), else nudged by PASTE_NUDGE. With a page size, the items are kept on the page (centered
 * when larger than it).
 */
export function pasteOffset(
  bounds: ArrayLike<number> | null,
  target: { x: number; y: number } | null,
  page?: { w: number; h: number } | null,
  nudge: number = PASTE_NUDGE,
): { dx: number; dy: number } {
  'worklet';
  if (!bounds || bounds.length < 4 || isEmptyBounds(bounds)) return { dx: 0, dy: 0 };
  const w = bounds[2] - bounds[0];
  const h = bounds[3] - bounds[1];
  let dx = nudge;
  let dy = nudge;
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    dx = target.x - (bounds[0] + bounds[2]) / 2;
    dy = target.y - (bounds[1] + bounds[3]) / 2;
  }
  return {
    dx: placeAxis(bounds[0], w, dx, page ? page.w : undefined),
    dy: placeAxis(bounds[1], h, dy, page ? page.h : undefined),
  };
}

/**
 * The matrix that maps page points of one page onto another so they stay where they are on screen
 * (dropping a selection on another page). Origins are the pages' screen top-left and px per point.
 */
export function pageToPageMatrix(from: { x: number; y: number; k: number }, to: { x: number; y: number; k: number }): Mat {
  'worklet';
  if (!(to.k > 0) || !(from.k > 0)) return matIdentity();
  const s = from.k / to.k;
  return [s, 0, 0, s, (from.x - to.x) / to.k, (from.y - to.y) / to.k];
}

/** The top-most item within radius of (x, y), or null. */
export function itemAt(items: readonly PageItem[], x: number, y: number, radius: number): PageItem | null {
  'worklet';
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitItem(items[i], x, y, radius)) return items[i];
  }
  return null;
}

/** The color the menu's 'اللون' dot shows: the first colored item's color, or null (only images). */
export function selectionColor(items: readonly PageItem[]): Hex | null {
  'worklet';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'image') return it.color;
  }
  return null;
}

/** True when every colored item is highlighter ink (the menu then offers the highlighter colors). */
export function isHighlighterSelection(items: readonly PageItem[]): boolean {
  'worklet';
  let any = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'image') continue;
    any = true;
    const hl = (it.kind === 'stroke' && it.tool === 'highlighter') || (it.kind === 'shape' && it.highlighter === true);
    if (!hl) return false;
  }
  return any;
}

/** The items that change when recolored (images and items already in that color are left out). */
export function recolorItems(items: readonly PageItem[], color: Hex): PageItem[] {
  'worklet';
  const out: PageItem[] = [];
  const want = color.toLowerCase();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'image') continue;
    if (it.color.toLowerCase() === want) continue;
    out.push({ ...it, color });
  }
  return out;
}

// ===== image crop (normalized 0..1 of the source image)

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
/** The smallest crop side, as a fraction of the image. */
export const MIN_CROP = 0.02;

/** The crop aspect chips: 'حر' (free), 1:1, 4:3, 3:4 and 16:9 (width / height). */
export const CROP_ASPECTS: readonly { key: 'free' | '1:1' | '4:3' | '3:4' | '16:9'; ratio: number | null }[] = [
  { key: 'free', ratio: null },
  { key: '1:1', ratio: 1 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '3:4', ratio: 3 / 4 },
  { key: '16:9', ratio: 16 / 9 },
];

function clamp01(v: number): number {
  'worklet';
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** A valid crop inside the image, or null when it is (almost) the whole image. */
export function normalizeCrop(c: CropRect | null | undefined): CropRect | null {
  'worklet';
  if (!c) return null;
  let x = clamp01(c.x);
  let y = clamp01(c.y);
  let w = Math.max(MIN_CROP, Math.min(1, Number.isFinite(c.w) ? c.w : 1));
  let h = Math.max(MIN_CROP, Math.min(1, Number.isFinite(c.h) ? c.h : 1));
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  const eps = 1e-4;
  if (x < eps && y < eps && w > 1 - eps && h > 1 - eps) return null;
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  return { x, y, w, h };
}

/**
 * The image item with a new crop (null = the whole image). The visible part keeps its scale and its
 * place on the page: the box shrinks or grows around it, along the image's rotation.
 */
export function applyCrop(item: ImageItem, crop: CropRect | null): ImageItem {
  'worklet';
  const c0 = item.crop ?? FULL_CROP;
  const c1n = normalizeCrop(crop);
  const c1 = c1n ?? FULL_CROP;
  const box = item.box;
  const sx = c0.w > 0 ? box.w / c0.w : box.w;
  const sy = c0.h > 0 ? box.h / c0.h : box.h;
  const w = c1.w * sx;
  const h = c1.h * sy;
  const lx = (c1.x + c1.w / 2 - (c0.x + c0.w / 2)) * sx;
  const ly = (c1.y + c1.h / 2 - (c0.y + c0.h / 2)) * sy;
  const rot = box.rot || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = box.x + box.w / 2 + lx * cos - ly * sin;
  const cy = box.y + box.h / 2 + lx * sin + ly * cos;
  return { ...item, box: { x: cx - w / 2, y: cy - h / 2, w, h, rot: box.rot }, crop: c1n };
}

/** A normalized crop in display units of an image shown at bounds.w x bounds.h. */
export function cropToDisplay(c: CropRect | null, bounds: { w: number; h: number }): CropRect {
  'worklet';
  const n = c ?? FULL_CROP;
  return { x: n.x * bounds.w, y: n.y * bounds.h, w: n.w * bounds.w, h: n.h * bounds.h };
}

/** A display rect back to a normalized crop (null when it covers the whole image). */
export function displayToCrop(r: CropRect, bounds: { w: number; h: number }): CropRect | null {
  'worklet';
  if (!(bounds.w > 0) || !(bounds.h > 0)) return null;
  return normalizeCrop({ x: r.x / bounds.w, y: r.y / bounds.h, w: r.w / bounds.w, h: r.h / bounds.h });
}

function fitInside(w: number, h: number, maxW: number, maxH: number, ratio: number): number[] {
  'worklet';
  let nw = w;
  let nh = h;
  if (nw > maxW) {
    nw = maxW;
    nh = nw / ratio;
  }
  if (nh > maxH) {
    nh = maxH;
    nw = nh * ratio;
  }
  return [nw, nh];
}

/**
 * The crop rect (display units, inside bounds) after dragging a crop handle by (dx, dy) from `start`.
 * 'move' slides the rect; corners and edges resize it, keeping `ratio` (width / height) when given.
 */
export function dragCropRect(
  start: CropRect,
  handle: HandleId,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
  ratio: number | null,
  min: number,
): CropRect {
  'worklet';
  const BW = bounds.w;
  const BH = bounds.h;
  const mn = Math.max(1, Math.min(min, BW, BH));
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ...start };
  if (handle === 'move' || handle === 'rotate') {
    const x = Math.min(BW - start.w, Math.max(0, start.x + dx));
    const y = Math.min(BH - start.h, Math.max(0, start.y + dy));
    return { x: Math.max(0, x), y: Math.max(0, y), w: start.w, h: start.h };
  }
  const hl = handleLocal(handle);
  const fx = hl[0];
  const fy = hl[1];
  let l = start.x;
  let t = start.y;
  let r = start.x + start.w;
  let b = start.y + start.h;
  if (ratio === null || !(ratio > 0)) {
    if (fx < 0) l = Math.min(r - mn, Math.max(0, l + dx));
    if (fx > 0) r = Math.max(l + mn, Math.min(BW, r + dx));
    if (fy < 0) t = Math.min(b - mn, Math.max(0, t + dy));
    if (fy > 0) b = Math.max(t + mn, Math.min(BH, b + dy));
    return { x: l, y: t, w: r - l, h: b - t };
  }
  const minW = Math.max(mn, mn * ratio);
  if (fx !== 0 && fy !== 0) {
    // Corner: the opposite corner stays.
    const ax = fx > 0 ? l : r;
    const ay = fy > 0 ? t : b;
    const px = (fx > 0 ? r : l) + dx;
    const py = (fy > 0 ? b : t) + dy;
    const w = Math.max(minW, (px - ax) * fx, (py - ay) * fy * ratio);
    const maxW = fx > 0 ? BW - ax : ax;
    const maxH = fy > 0 ? BH - ay : ay;
    const s = fitInside(w, w / ratio, maxW, maxH, ratio);
    const nx = fx > 0 ? ax : ax - s[0];
    const ny = fy > 0 ? ay : ay - s[1];
    return { x: nx, y: ny, w: s[0], h: s[1] };
  }
  if (fx !== 0) {
    // Left / right edge: the other edge stays, the height follows and stays centered.
    const ax = fx > 0 ? l : r;
    const maxW = fx > 0 ? BW - ax : ax;
    const w = Math.min(maxW, Math.max(minW, ((fx > 0 ? r : l) + dx - ax) * fx));
    const s = fitInside(w, w / ratio, maxW, BH, ratio);
    const cy = (t + b) / 2;
    const ny = Math.min(BH - s[1], Math.max(0, cy - s[1] / 2));
    return { x: fx > 0 ? ax : ax - s[0], y: Math.max(0, ny), w: s[0], h: s[1] };
  }
  // Top / bottom edge.
  const ay = fy > 0 ? t : b;
  const maxH = fy > 0 ? BH - ay : ay;
  const h = Math.min(maxH, Math.max(minW / ratio, ((fy > 0 ? b : t) + dy - ay) * fy));
  const s = fitInside(h * ratio, h, BW, maxH, ratio);
  const cx = (l + r) / 2;
  const nx = Math.min(BW - s[0], Math.max(0, cx - s[0] / 2));
  return { x: Math.max(0, nx), y: fy > 0 ? ay : ay - s[1], w: s[0], h: s[1] };
}

/**
 * The largest rect of `ratio` inside `rect`, centered on it and kept inside bounds (the aspect chips).
 * null ratio ('حر') returns the rect unchanged.
 */
export function fitAspect(rect: CropRect, ratio: number | null, bounds: { w: number; h: number }): CropRect {
  'worklet';
  if (ratio === null || !(ratio > 0)) return { ...rect };
  let w = Math.min(rect.w, rect.h * ratio);
  let h = w / ratio;
  if (w > bounds.w) {
    w = bounds.w;
    h = w / ratio;
  }
  if (h > bounds.h) {
    h = bounds.h;
    w = h * ratio;
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = Math.min(bounds.w - w, Math.max(0, cx - w / 2));
  const y = Math.min(bounds.h - h, Math.max(0, cy - h / 2));
  return { x: Math.max(0, x), y: Math.max(0, y), w, h };
}

/** Where an image of iw x ih fits (contain) in an area, centered: {x, y, w, h}. */
export function fitContain(iw: number, ih: number, areaW: number, areaH: number): CropRect {
  'worklet';
  if (!(iw > 0) || !(ih > 0) || !(areaW > 0) || !(areaH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(areaW / iw, areaH / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: (areaW - w) / 2, y: (areaH - h) / 2, w, h };
}

/**
 * The box of a newly inserted image (insertImage): centered on (cx, cy), at most maxFrac (0.6) of the
 * page width and 0.8 of its height, never larger than its own pixel size, kept on the page.
 */
export function insertImageBox(
  imgW: number,
  imgH: number,
  page: { w: number; h: number },
  center: { x: number; y: number },
  maxFrac: number = 0.6,
): Box {
  'worklet';
  const iw = imgW > 0 ? imgW : 4;
  const ih = imgH > 0 ? imgH : 3;
  let w = Math.min(page.w * maxFrac, imgW > 0 ? imgW : page.w * maxFrac);
  let h = (w * ih) / iw;
  const maxH = page.h * 0.8;
  if (h > maxH) {
    h = maxH;
    w = (h * iw) / ih;
  }
  const x = Math.min(page.w - w, Math.max(0, center.x - w / 2));
  const y = Math.min(page.h - h, Math.max(0, center.y - h / 2));
  return { x: Math.max(0, x), y: Math.max(0, y), w, h, rot: 0 };
}
