/**
 * The canvas view transform (P22, NB-49): zoom from "the tallest page fits the band" (minZoomFor, at
 * most 1) up to 4 (400%), and pan. Zoom 1 (100%) is the column filling the band's width.
 *
 *   screen = content x scale + (tx, ty)          content = layout.ts content space (zoom-1 px)
 *   page point (x, y) of page i = content (rect.x + x k, rect.y + y k)   k = layout fit scale
 *
 * Screen coordinates are the canvas view's own (physical) coordinates: the same space as RNGH touch
 * x / y on the canvas detector and as the overlay host above it.
 *
 * Bounds: the pages stay inside the band between the physical insets. At zoom 1 the column fills the
 * band exactly; zoomed in, it can be panned until its edges reach the band edges; zoomed out, it is
 * centered across the band. Vertically the first page can come down to the top inset and the last one
 * up to the bottom inset; a column shorter than the band stays at the top at zoom 1 and is centered
 * when zoomed out (both are the same where the column is exactly the band's height).
 *
 * Every function is a worklet (the gestures run them on the UI runtime).
 */
import type { LayoutInsets } from './layout.ts';
import { LAYOUT_HEADER, layoutContentH, layoutContentW, layoutCount, layoutScale, nearestPageIndex, pageIndexAt, visibleRange } from './layout.ts';

/** 100%: the column fills the band's width. Zooming out goes below it only as far as minZoomFor. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** The smallest zoom ever allowed, whatever the page shape. */
export const MIN_ZOOM_FLOOR = 0.1;
/** Room kept above and below the tallest page at the smallest zoom (screen px). */
export const FIT_MARGIN = 16;

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface ViewSize {
  w: number;
  h: number;
}

/** A point on a page: page index and page points. */
export interface PageHit {
  index: number;
  x: number;
  y: number;
}

/** Clamps a zoom to [min, MAX_ZOOM]; min defaults to 100% (pass minZoomFor to allow zooming out). */
export function clampZoom(s: number, min: number = MIN_ZOOM): number {
  'worklet';
  if (!Number.isFinite(s)) return MIN_ZOOM;
  const lo = min > MAX_ZOOM ? MAX_ZOOM : min;
  return s < lo ? lo : s > MAX_ZOOM ? MAX_ZOOM : s;
}

/**
 * The smallest zoom for this layout and view: the tallest page fits the band from top to bottom with
 * FIT_MARGIN above and below it. Never above 1 (a page that already fits at 100% cannot zoom out) and
 * never below MIN_ZOOM_FLOOR.
 */
export function minZoomFor(layout: ArrayLike<number>, view: ViewSize, insets: LayoutInsets): number {
  'worklet';
  const n = layoutCount(layout);
  let tallest = 0;
  for (let i = 0; i < n; i++) {
    const h = layout[LAYOUT_HEADER + i * 4 + 3];
    if (h > tallest) tallest = h;
  }
  if (!(tallest > 0)) return MIN_ZOOM;
  const bandH = view.h - Math.max(0, insets.top) - Math.max(0, insets.bottom) - 2 * FIT_MARGIN;
  if (!(bandH > 0)) return MIN_ZOOM;
  const fit = bandH / tallest;
  return fit >= MIN_ZOOM ? MIN_ZOOM : fit < MIN_ZOOM_FLOOR ? MIN_ZOOM_FLOOR : fit;
}

/** [minTx, maxTx, minTy, maxTy] for a scale (min === max when the content fits that axis). */
export function translateBounds(scale: number, contentW: number, contentH: number, view: ViewSize, insets: LayoutInsets): number[] {
  'worklet';
  const left = Math.max(0, insets.left);
  const top = Math.max(0, insets.top);
  const bandW = Math.max(1, view.w - left - Math.max(0, insets.right));
  const bandH = Math.max(1, view.h - top - Math.max(0, insets.bottom));
  const cw = contentW * scale;
  const ch = contentH * scale;
  let minTx: number;
  let maxTx: number;
  if (cw <= bandW) {
    minTx = left + (bandW - cw) / 2;
    maxTx = minTx;
  } else {
    minTx = left + bandW - cw;
    maxTx = left;
  }
  let minTy: number;
  let maxTy: number;
  if (ch <= bandH) {
    // Zoomed out, a column shorter than the band sits in its middle; at 100% it stays at the top.
    minTy = scale < MIN_ZOOM ? top + (bandH - ch) / 2 : top;
    maxTy = minTy;
  } else {
    minTy = top + bandH - ch;
    maxTy = top;
  }
  return [minTx, maxTx, minTy, maxTy];
}

function clampTo(v: number, lo: number, hi: number): number {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

/** The viewport with its scale clamped to minZoomFor..4 and its translation inside the bounds. */
export function clampViewport(vp: Viewport, layout: ArrayLike<number>, view: ViewSize, insets: LayoutInsets): Viewport {
  'worklet';
  const scale = clampZoom(vp.scale, minZoomFor(layout, view, insets));
  const b = translateBounds(scale, layoutContentW(layout), layoutContentH(layout), view, insets);
  return { scale, tx: clampTo(vp.tx, b[0], b[1]), ty: clampTo(vp.ty, b[2], b[3]) };
}

/**
 * Zooms to newScale (clamped to [minScale, 4]) keeping the screen point (fx, fy) over the same content
 * point. Pass minZoomFor(...) as minScale to allow zooming out below 100%.
 */
export function zoomAbout(vp: Viewport, fx: number, fy: number, newScale: number, minScale: number = MIN_ZOOM): Viewport {
  'worklet';
  const s = clampZoom(newScale, minScale);
  const r = vp.scale > 0 ? s / vp.scale : 1;
  return { scale: s, tx: fx - (fx - vp.tx) * r, ty: fy - (fy - vp.ty) * r };
}

/** Screen point to content point [cx, cy]. */
export function screenToContent(vp: Viewport, sx: number, sy: number): number[] {
  'worklet';
  const s = vp.scale > 0 ? vp.scale : 1;
  return [(sx - vp.tx) / s, (sy - vp.ty) / s];
}

/** Content point to screen point [sx, sy]. */
export function contentToScreen(vp: Viewport, cx: number, cy: number): number[] {
  'worklet';
  return [cx * vp.scale + vp.tx, cy * vp.scale + vp.ty];
}

/**
 * The page under a screen point, in page points, or null in a gap / beside the column. slop (screen
 * px) widens each page so a stroke can start right at its edge.
 */
export function screenToPage(layout: ArrayLike<number>, vp: Viewport, sx: number, sy: number, slop: number = 0): PageHit | null {
  'worklet';
  const c = screenToContent(vp, sx, sy);
  const s = vp.scale > 0 ? vp.scale : 1;
  const sl = slop / s;
  const i = pageIndexAt(layout, c[1], sl);
  if (i < 0) return null;
  const b = LAYOUT_HEADER + i * 4;
  if (c[0] < layout[b] - sl || c[0] > layout[b] + layout[b + 2] + sl) return null;
  const k = layoutScale(layout);
  return { index: i, x: (c[0] - layout[b]) / k, y: (c[1] - layout[b + 1]) / k };
}

/** Screen point to page points of a GIVEN page (no bounds check: a stroke may leave its page). */
export function screenToPageOf(layout: ArrayLike<number>, vp: Viewport, i: number, sx: number, sy: number): number[] {
  'worklet';
  const c = screenToContent(vp, sx, sy);
  if (i < 0 || i >= layoutCount(layout)) return [NaN, NaN];
  const b = LAYOUT_HEADER + i * 4;
  const k = layoutScale(layout);
  return [(c[0] - layout[b]) / k, (c[1] - layout[b + 1]) / k];
}

/** Page point of page i to screen [sx, sy]. */
export function pageToScreen(layout: ArrayLike<number>, vp: Viewport, i: number, x: number, y: number): number[] {
  'worklet';
  if (i < 0 || i >= layoutCount(layout)) return [NaN, NaN];
  const b = LAYOUT_HEADER + i * 4;
  const k = layoutScale(layout);
  return contentToScreen(vp, layout[b] + x * k, layout[b + 1] + y * k);
}

/** Page i's top-left corner on screen and k = screen px per page point: [x, y, k], or null. */
export function pageOriginOnScreen(layout: ArrayLike<number>, vp: Viewport, i: number): number[] | null {
  'worklet';
  if (i < 0 || i >= layoutCount(layout)) return null;
  const b = LAYOUT_HEADER + i * 4;
  const k = layoutScale(layout);
  return [layout[b] * vp.scale + vp.tx, layout[b + 1] * vp.scale + vp.ty, k * vp.scale];
}

/** The content rectangle the whole view shows: [x0, y0, x1, y1]. */
export function visibleContentRect(vp: Viewport, view: ViewSize): number[] {
  'worklet';
  const a = screenToContent(vp, 0, 0);
  const b = screenToContent(vp, view.w, view.h);
  return [a[0], a[1], b[0], b[1]];
}

/** [first, last] pages the view shows ([-1, -1] when none). */
export function visiblePages(layout: ArrayLike<number>, vp: Viewport, view: ViewSize): number[] {
  'worklet';
  const r = visibleContentRect(vp, view);
  return visibleRange(layout, r[1], r[3]);
}

/** The part of page i on screen in page points {x, y, w, h}, or null when it is off screen. */
export function visiblePageRect(layout: ArrayLike<number>, vp: Viewport, view: ViewSize, i: number): { x: number; y: number; w: number; h: number } | null {
  'worklet';
  if (i < 0 || i >= layoutCount(layout)) return null;
  const r = visibleContentRect(vp, view);
  const b = LAYOUT_HEADER + i * 4;
  const k = layoutScale(layout);
  const x0 = Math.max(r[0], layout[b]);
  const y0 = Math.max(r[1], layout[b + 1]);
  const x1 = Math.min(r[2], layout[b] + layout[b + 2]);
  const y1 = Math.min(r[3], layout[b + 1] + layout[b + 3]);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: (x0 - layout[b]) / k, y: (y0 - layout[b + 1]) / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
}

/**
 * The current page: the one under the middle of the band between the top and bottom insets (or
 * nearest to it). -1 when there are no pages.
 */
export function currentPage(layout: ArrayLike<number>, vp: Viewport, view: ViewSize, insets: LayoutInsets): number {
  'worklet';
  const top = Math.max(0, insets.top);
  const bottom = view.h - Math.max(0, insets.bottom);
  const mid = (top + Math.max(top, bottom)) / 2;
  const c = screenToContent(vp, 0, mid);
  return nearestPageIndex(layout, c[1]);
}

/** The viewport (same scale) that puts page i's top edge `margin` px below the top inset, clamped. */
export function scrollToPage(layout: ArrayLike<number>, vp: Viewport, i: number, view: ViewSize, insets: LayoutInsets, margin: number = 16): Viewport {
  'worklet';
  const n = layoutCount(layout);
  if (n === 0) return clampViewport(vp, layout, view, insets);
  const idx = i < 0 ? 0 : i >= n ? n - 1 : i;
  const top = layout[LAYOUT_HEADER + idx * 4 + 1];
  const ty = Math.max(0, insets.top) + margin - top * vp.scale;
  return clampViewport({ scale: vp.scale, tx: vp.tx, ty }, layout, view, insets);
}

/** The viewport after zooming to newScale about the middle of the band, clamped. */
export function zoomToCenter(vp: Viewport, newScale: number, layout: ArrayLike<number>, view: ViewSize, insets: LayoutInsets): Viewport {
  'worklet';
  const fx = (Math.max(0, insets.left) + view.w - Math.max(0, insets.right)) / 2;
  const fy = (Math.max(0, insets.top) + view.h - Math.max(0, insets.bottom)) / 2;
  return clampViewport(zoomAbout(vp, fx, fy, newScale, minZoomFor(layout, view, insets)), layout, view, insets);
}
