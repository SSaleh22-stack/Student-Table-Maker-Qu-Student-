/**
 * PDF tile math (P10). Pure: no I/O, no time. Used by the JS engine (src/notebook/pdf/engine.ts) for
 * cache file names, and by the painter (P16 ink/pdfTiles.ts) and the canvas (P22) to decide which
 * images to ask for.
 *
 * Coordinates are PDF points of the page as DISPLAYED (crop box, page rotation applied), origin
 * top-left, y down, the same space as RegionReq (core/contracts/pdf.ts). A scale is device pixels per
 * page point.
 *
 * Two kinds of image cover a page:
 * - The PREVIEW: the whole page at previewWidth(...) px wide. Its long side is at most
 *   1.5 x the screen's long side in pixels (PRD9-open-time: one cheap render shows the first page).
 * - TILES, once the page is shown larger than the preview can carry sharply (needsTiles). Tiles are
 *   TILE_PX x TILE_PX pixel squares of a LEVEL: level k renders the page at 2^(k/2) px per point. The
 *   level is the smallest one at or above the on-screen scale, so tiles are never upscaled
 *   (PRD9-pdf-clarity: sharp at every zoom), and a small zoom change keeps the same level, so the
 *   same cached tiles are reused.
 */
import type { RegionReq } from '../contracts/pdf.ts';

/** Tile edge in pixels (edge tiles are smaller). */
export const TILE_PX = 512;

/** The preview's long side is at most this many times the screen's long side in pixels. */
export const PREVIEW_SCREEN_FACTOR = 1.5;

/** Hard cap on the preview's long side, whatever the screen (memory on 3-4 GB devices). */
export const PREVIEW_MAX_LONG_PX = 4096;

/** Smallest preview long side, so tiny screens or bad input still get a usable image. */
export const PREVIEW_MIN_LONG_PX = 64;

/** Levels per doubling of the scale: level k = 2^(k / LEVELS_PER_OCTAVE) px per point. */
export const LEVELS_PER_OCTAVE = 2;

/**
 * Tiles take over when the page is shown more than this many times larger than the preview's own
 * scale. Up to 10 percent of upscaling is not visible.
 */
export const TILE_THRESHOLD = 1.1;

/** Size of a page in points. */
export interface PageSizeLike {
  w: number;
  h: number;
}

/** A rectangle in page points. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One tile: a RegionReq for the native renderer plus where it sits in the level's grid. */
export interface TileSpec extends RegionReq {
  /** Stable id within one document: page, level, column and row (see tileKey). */
  key: string;
  level: number;
  col: number;
  row: number;
  /** Pixels per point of this tile's level. */
  scale: number;
}

export interface TileSet {
  level: number;
  scale: number;
  /** Columns and rows of the whole page at this level. */
  cols: number;
  rows: number;
  /** Tiles covering the visible part (plus the margin), nearest to the visible centre first. */
  tiles: TileSpec[];
}

export interface TilesForOptions {
  /** 0-based page index. */
  page: number;
  /** Displayed page size in points. */
  size: PageSizeLike;
  /** On-screen scale in device px per page point (fit scale x zoom x pixel ratio). */
  pxPerPt: number;
  /** The visible part of the page, in page points (clipped to the page here). */
  visible: PageRect;
  /** Tile edge in px (default TILE_PX). */
  tilePx?: number;
  /** Extra rings of tiles around the visible ones, rendered ahead of panning (default 0). */
  marginTiles?: number;
  /**
   * At most this many tiles (default: no cap). When the sharp level needs more, coarser levels are
   * used until the set fits; the result's level then says how sharp it is.
   */
  maxTiles?: number;
}

const finitePos = (v: number): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Width in px of a page's preview image: the long side is PREVIEW_SCREEN_FACTOR x the screen's long
 * side in device pixels, clamped to [PREVIEW_MIN_LONG_PX, PREVIEW_MAX_LONG_PX]. An invalid page size
 * is treated as square.
 */
export function previewWidth(size: PageSizeLike, screenLongPx: number): number {
  const w = finitePos(size?.w) ? size.w : 1;
  const h = finitePos(size?.h) ? size.h : 1;
  const screen = finitePos(screenLongPx) ? screenLongPx : PREVIEW_MIN_LONG_PX / PREVIEW_SCREEN_FACTOR;
  const long = Math.min(PREVIEW_MAX_LONG_PX, Math.max(PREVIEW_MIN_LONG_PX, Math.floor(screen * PREVIEW_SCREEN_FACTOR)));
  return w >= h ? long : Math.max(1, Math.floor((long * w) / h));
}

/** Height in px of a whole-page image widthPx wide (the rule the native renderPage uses). */
export function pageHeightPx(size: PageSizeLike, widthPx: number): number {
  if (!finitePos(size?.w) || !finitePos(size?.h) || !finitePos(widthPx)) return 1;
  return Math.max(1, Math.round((widthPx * size.h) / size.w));
}

/** Pixels per point of a whole-page image widthPx wide. */
export function previewScale(size: PageSizeLike, widthPx: number): number {
  return finitePos(size?.w) && finitePos(widthPx) ? widthPx / size.w : 0;
}

/** True when the page shown at pxPerPt needs tiles on top of a preview of previewPxPerPt. */
export function needsTiles(pxPerPt: number, previewPxPerPt: number): boolean {
  if (!finitePos(pxPerPt)) return false;
  if (!finitePos(previewPxPerPt)) return true;
  return pxPerPt > previewPxPerPt * TILE_THRESHOLD;
}

/** The smallest level whose scale is at or above pxPerPt. */
export function levelFor(pxPerPt: number): number {
  const s = finitePos(pxPerPt) ? pxPerPt : 1;
  // The epsilon keeps an exact level scale (2, 2.828…, 4) on its own level despite float noise.
  // `+ 0` turns -0 into 0, so keys never read '-0'.
  return Math.ceil(LEVELS_PER_OCTAVE * Math.log2(s) - 1e-9) + 0;
}

/** Pixels per point of a level. */
export function levelScale(level: number): number {
  return Math.pow(2, level / LEVELS_PER_OCTAVE);
}

/** Whole-page pixel size and grid of a level. */
export function tileGrid(size: PageSizeLike, level: number, tilePx: number = TILE_PX): { scale: number; widthPx: number; heightPx: number; cols: number; rows: number } {
  const scale = levelScale(level);
  const t = finitePos(tilePx) ? Math.floor(tilePx) : TILE_PX;
  const widthPx = finitePos(size?.w) ? Math.max(1, Math.ceil(size.w * scale - 1e-6)) : 1;
  const heightPx = finitePos(size?.h) ? Math.max(1, Math.ceil(size.h * scale - 1e-6)) : 1;
  return { scale, widthPx, heightPx, cols: Math.ceil(widthPx / t), rows: Math.ceil(heightPx / t) };
}

/** Stable tile id within one document. */
export function tileKey(page: number, level: number, col: number, row: number): string {
  return `${page}/${level}/${col}_${row}`;
}

/** The tile at (col, row) of a level. Edge tiles are cut to the page. */
export function tileAt(page: number, size: PageSizeLike, level: number, col: number, row: number, tilePx: number = TILE_PX): TileSpec {
  const g = tileGrid(size, level, tilePx);
  const t = finitePos(tilePx) ? Math.floor(tilePx) : TILE_PX;
  const px0 = col * t;
  const py0 = row * t;
  const px1 = Math.min(px0 + t, g.widthPx);
  const py1 = Math.min(py0 + t, g.heightPx);
  const x = px0 / g.scale;
  const y = py0 / g.scale;
  // The last column or row stops at the page edge (it may cover a fraction of a pixel less).
  const w = Math.min(px1 / g.scale, size.w) - x;
  const h = Math.min(py1 / g.scale, size.h) - y;
  return { key: tileKey(page, level, col, row), page, level, col, row, scale: g.scale, x, y, w, h, widthPx: px1 - px0, heightPx: py1 - py0 };
}

/** The visible rectangle clipped to the page, or null when nothing of the page is visible. */
export function clipToPage(size: PageSizeLike, r: PageRect): PageRect | null {
  if (!finitePos(size?.w) || !finitePos(size?.h) || !r) return null;
  const vals = [r.x, r.y, r.w, r.h];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const x0 = Math.max(0, Math.min(r.x, r.x + r.w));
  const y0 = Math.max(0, Math.min(r.y, r.y + r.h));
  const x1 = Math.min(size.w, Math.max(r.x, r.x + r.w));
  const y1 = Math.min(size.h, Math.max(r.y, r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

interface GridRange {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

function rangeFor(size: PageSizeLike, vis: PageRect, level: number, tilePx: number, margin: number): GridRange & { cols: number; rows: number } {
  const g = tileGrid(size, level, tilePx);
  const t = Math.floor(tilePx);
  // A tile is needed when the visible rect overlaps it by more than float noise.
  const eps = 1e-6;
  const c0 = Math.max(0, Math.floor((vis.x * g.scale + eps) / t) - margin);
  const r0 = Math.max(0, Math.floor((vis.y * g.scale + eps) / t) - margin);
  const c1 = Math.min(g.cols - 1, Math.ceil(((vis.x + vis.w) * g.scale - eps) / t) - 1 + margin);
  const r1 = Math.min(g.rows - 1, Math.ceil(((vis.y + vis.h) * g.scale - eps) / t) - 1 + margin);
  return { c0, c1: Math.max(c0, c1), r0, r1: Math.max(r0, r1), cols: g.cols, rows: g.rows };
}

const countOf = (r: GridRange): number => (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1);

/**
 * The tiles that cover the visible part of a page at the on-screen scale. Nothing visible gives an
 * empty list (the level is still reported).
 */
export function tilesFor(o: TilesForOptions): TileSet {
  const tilePx = finitePos(o.tilePx ?? TILE_PX) ? Math.floor(o.tilePx ?? TILE_PX) : TILE_PX;
  const margin = Math.max(0, Math.floor(o.marginTiles ?? 0));
  const maxTiles = o.maxTiles !== undefined && finitePos(o.maxTiles) ? Math.max(1, Math.floor(o.maxTiles)) : Infinity;
  let level = levelFor(o.pxPerPt);
  const vis = clipToPage(o.size, o.visible);
  if (!vis) {
    const g = tileGrid(o.size, level, tilePx);
    return { level, scale: g.scale, cols: g.cols, rows: g.rows, tiles: [] };
  }
  let range = rangeFor(o.size, vis, level, tilePx, margin);
  // Coarser levels until the set fits. A level whose whole page is one tile always fits.
  for (let guard = 0; countOf(range) > maxTiles && guard < 64; guard++) {
    level -= 1;
    range = rangeFor(o.size, vis, level, tilePx, margin);
  }
  const scale = levelScale(level);
  const cx = (vis.x + vis.w / 2) * scale;
  const cy = (vis.y + vis.h / 2) * scale;
  const tiles: { tile: TileSpec; d: number }[] = [];
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      const tile = tileAt(o.page, o.size, level, col, row, tilePx);
      const dx = (col + 0.5) * tilePx - cx;
      const dy = (row + 0.5) * tilePx - cy;
      tiles.push({ tile, d: dx * dx + dy * dy });
    }
  }
  tiles.sort((a, b) => a.d - b.d || a.tile.row - b.tile.row || a.tile.col - b.tile.col);
  return { level, scale, cols: range.cols, rows: range.rows, tiles: tiles.map((t) => t.tile) };
}

/** The RegionReq part of a tile (what PdfHandle.renderRegion takes). */
export function regionOf(t: TileSpec): RegionReq {
  return { page: t.page, x: t.x, y: t.y, w: t.w, h: t.h, widthPx: t.widthPx, heightPx: t.heightPx };
}

// ===== cache naming (src/notebook/pdf/engine.ts, tileCache.ts)

/**
 * A PDF path without its file:// scheme, percent-decoded, without duplicate slashes, and cut to the
 * part from the notebooks folder on ('notebooks/<id>/assets/<fileId>.pdf') when it has one. iOS can
 * move the app's container (new UUID in the path) across updates, so the tail is what identifies a
 * notebook asset between launches.
 */
export function pdfPathTail(path: string): string {
  let p = String(path ?? '').trim();
  p = p.replace(/^file:\/\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Not percent-encoded (a raw path with a lone '%'): keep it as it is.
  }
  p = p.replace(/\/{2,}/g, '/');
  const i = p.lastIndexOf('/notebooks/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/** FNV-1a over UTF-16 code units, 32 bits, from a seed. */
function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A 16-hex-digit hash (two independent 32-bit FNV-1a runs). Not cryptographic. */
export function hashString(s: string): string {
  const a = fnv1a(s, 0x811c9dc5);
  const b = fnv1a(s, 0x050c5d1f ^ s.length);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Cache folder name of one PDF (from its path tail, so it survives a container move). */
export function pdfCacheId(path: string): string {
  return hashString(pdfPathTail(path));
}

/** Points as integer hundredths, for file names. */
const cpt = (v: number): string => String(Math.round(v * 100));

/** Cache key (file name stem) of a region render. */
export function regionCacheKey(r: RegionReq): string {
  return `r${r.page}_${cpt(r.x)}_${cpt(r.y)}_${cpt(r.w)}_${cpt(r.h)}_${r.widthPx}x${r.heightPx}`;
}

/** Cache key (file name stem) of a whole-page render widthPx wide. */
export function pageCacheKey(page: number, widthPx: number): string {
  return `p${page}_w${widthPx}`;
}
