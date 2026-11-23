/**
 * Pages view grid geometry and drag-reorder index math (P25, Figma 13, NB-24). Pure and worklet-safe:
 * every function starts with 'worklet', so the drag gesture can run it on the UI runtime.
 *
 * Coordinates are PHYSICAL (x from the grid's real left edge), in the grid content's coordinates (the
 * view inside the ScrollView). `rtl` is the READING direction: in Arabic the first page sits at the
 * physical right of the first row, in English at the left. Place results with ui/physical.ts.
 *
 * The grid has `count` pages, then the dashed 'صفحة جديدة' tile in slot `count` (it is not a page and
 * cannot be dragged). A drag works with INSERTION SLOTS 0..count: slot s means "before page s", slot
 * count means "after the last page". movePage(id, toIndex) removes the page first, so dropping page
 * `from` at slot s gives toIndex = s > from ? s - 1 : s (moveIndex); slots from and from + 1 are the
 * page's own place (no move).
 *
 * Columns (gridColumns): compact windows (< 600 pt) 3, regular windows 4, and 6 from 1100 pt.
 */
import type { Id } from '../model/index.ts';

/** Windows narrower than this are compact (the same rule as ui/layout.ts). */
export const GRID_COMPACT_BELOW = 600;
/** Windows at least this wide get WIDE_COLUMNS. */
export const GRID_WIDE_FROM = 1100;
export const COMPACT_COLUMNS = 3;
export const REGULAR_COLUMNS = 4;
export const WIDE_COLUMNS = 6;
/** Thumbnail box height / width (Figma 13: 160 x 226, an A4 portrait page). */
export const THUMB_ASPECT = 226 / 160;
/** Width of the drop bar (Figma 'drop-indicator'). */
export const DROP_BAR_W = 4;

/** Grid columns for a window width. */
export function gridColumns(windowWidth: number): number {
  'worklet';
  if (!(windowWidth >= GRID_COMPACT_BELOW)) return COMPACT_COLUMNS;
  return windowWidth >= GRID_WIDE_FROM ? WIDE_COLUMNS : REGULAR_COLUMNS;
}

export interface GridMetrics {
  /** Content width the grid spans. */
  width: number;
  columns: number;
  /** Thumbnail box width (a cell's width). */
  cellW: number;
  /** Thumbnail box height (cellW x THUMB_ASPECT). */
  thumbH: number;
  /** Room under the thumbnail for the page number and the 'الحالية' pill. */
  labelH: number;
  /** Space between columns. */
  gapX: number;
  /** Space between a row's label and the next row's thumbnails. */
  gapY: number;
  /** Row stride: thumbH + labelH + gapY. */
  rowH: number;
  /** Space above the first row (room for the lifted page's rotation and shadow). */
  padTop: number;
  padBottom: number;
}

export interface GridOptions {
  /** The grid's content width. */
  width: number;
  columns: number;
  compact: boolean;
}

/**
 * Cell sizes for a grid width. Figma 13 (regular): 160 pt cells 30 pt apart, rows 36 pt apart under
 * a 30 pt label. Compact windows use 12 pt and 18 pt gaps. A cell is never narrower than 24 pt.
 */
export function gridMetrics(o: GridOptions): GridMetrics {
  'worklet';
  const columns = Math.max(1, Math.floor(o.columns) || 1);
  const width = Math.max(0, Number.isFinite(o.width) ? o.width : 0);
  const gapX = o.compact ? 12 : columns >= WIDE_COLUMNS ? 24 : 30;
  const gapY = o.compact ? 18 : 30;
  const labelH = o.compact ? 28 : 32;
  const cellW = Math.max(24, (width - gapX * (columns - 1)) / columns);
  const thumbH = Math.round(cellW * THUMB_ASPECT);
  return {
    width,
    columns,
    cellW,
    thumbH,
    labelH,
    gapX,
    gapY,
    rowH: thumbH + labelH + gapY,
    padTop: o.compact ? 10 : 16,
    padBottom: o.compact ? 16 : 24,
  };
}

/** Rows needed for `slots` cells. */
export function rowsFor(slots: number, columns: number): number {
  'worklet';
  const n = Math.max(0, Math.floor(slots) || 0);
  const c = Math.max(1, Math.floor(columns) || 1);
  return Math.ceil(n / c);
}

/** Height of the grid content for `slots` cells (pages plus the add tile). */
export function contentHeight(m: GridMetrics, slots: number): number {
  'worklet';
  const rows = rowsFor(slots, m.columns);
  if (rows === 0) return m.padTop + m.padBottom;
  return m.padTop + rows * m.rowH - m.gapY + m.padBottom;
}

/** Reading-order x (from the reading start edge) -> physical x, for a box of width w. */
function toPhysical(m: GridMetrics, readingX: number, w: number, rtl: boolean): number {
  'worklet';
  return rtl ? m.width - readingX - w : readingX;
}

/** Physical x -> reading-order x. */
function toReading(m: GridMetrics, x: number, rtl: boolean): number {
  'worklet';
  return rtl ? m.width - x : x;
}

/** Top-left of cell `index` (its thumbnail box), physical. */
export function cellOrigin(m: GridMetrics, index: number, rtl: boolean): { x: number; y: number } {
  'worklet';
  const i = Math.max(0, Math.floor(index) || 0);
  const col = i % m.columns;
  const rowIdx = Math.floor(i / m.columns);
  const rx = col * (m.cellW + m.gapX);
  return { x: toPhysical(m, rx, m.cellW, rtl), y: m.padTop + rowIdx * m.rowH };
}

/**
 * The page under a point (its thumbnail or its label), or -1 (a gap, the add tile, below the grid).
 */
export function cellAt(m: GridMetrics, x: number, y: number, count: number, rtl: boolean): number {
  'worklet';
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  const ry = y - m.padTop;
  if (ry < 0) return -1;
  const rowIdx = Math.floor(ry / m.rowH);
  if (ry - rowIdx * m.rowH > m.thumbH + m.labelH) return -1;
  const rx = toReading(m, x, rtl);
  if (rx < 0 || rx > m.width) return -1;
  const stride = m.cellW + m.gapX;
  const col = Math.floor(rx / stride);
  if (col >= m.columns || rx - col * stride > m.cellW) return -1;
  const index = rowIdx * m.columns + col;
  return index < count ? index : -1;
}

/**
 * The insertion slot (0..count) for a drag point: the row under the point (clamped to the grid), and
 * in that row, before the first cell whose center is past the point in reading order. A point below
 * the last row (or over the add tile) gives slot count.
 */
export function slotAt(m: GridMetrics, x: number, y: number, count: number, rtl: boolean): number {
  'worklet';
  const n = Math.max(0, Math.floor(count) || 0);
  if (n === 0) return 0;
  const rows = rowsFor(n, m.columns);
  const ry = (Number.isFinite(y) ? y : 0) - m.padTop + m.gapY / 2;
  if (ry >= rows * m.rowH) return n;
  const rowIdx = Math.max(0, Math.floor(ry / m.rowH));
  const rx = toReading(m, Number.isFinite(x) ? x : 0, rtl);
  const stride = m.cellW + m.gapX;
  let col = Math.floor((rx - m.cellW / 2) / stride) + 1;
  if (col < 0) col = 0;
  if (col > m.columns) col = m.columns;
  const slot = rowIdx * m.columns + col;
  return slot > n ? n : slot;
}

/** The movePage toIndex for dropping page `from` at insertion slot `slot`, or -1 when it stays put. */
export function moveIndex(from: number, slot: number, count: number): number {
  'worklet';
  const n = Math.max(0, Math.floor(count) || 0);
  if (!(from >= 0 && from < n) || !Number.isFinite(slot)) return -1;
  const s = Math.max(0, Math.min(n, Math.floor(slot)));
  const to = s > from ? s - 1 : s;
  return to === from ? -1 : to;
}

/** The page order after moving `from` to toIndex (what movePage does). A new array; bad input copies. */
export function reorderIds(ids: readonly Id[], from: number, toIndex: number): Id[] {
  const out = ids.slice();
  if (!(from >= 0 && from < out.length) || !Number.isFinite(toIndex)) return out;
  const [id] = out.splice(from, 1);
  const to = Math.max(0, Math.min(out.length, Math.floor(toIndex)));
  out.splice(to, 0, id);
  return out;
}

/**
 * Where the drop bar goes for an insertion slot: a DROP_BAR_W wide bar as tall as a thumbnail,
 * centered in the gap before cell `slot`, or in the gap after the previous cell when the slot starts
 * a new row (so dropping after the last page of a row shows the bar at that row's end).
 */
export function dropBar(m: GridMetrics, slot: number, count: number, rtl: boolean): { x: number; y: number; h: number } {
  'worklet';
  const n = Math.max(0, Math.floor(count) || 0);
  const s = Math.max(0, Math.min(n, Math.floor(slot) || 0));
  const half = m.gapX / 2;
  let rowIdx: number;
  let readingCenter: number;
  if (s > 0 && s % m.columns === 0) {
    // After the last cell of the previous row.
    rowIdx = s / m.columns - 1;
    readingCenter = (m.columns - 1) * (m.cellW + m.gapX) + m.cellW + half;
  } else {
    rowIdx = Math.floor(s / m.columns);
    const col = s % m.columns;
    readingCenter = col === 0 ? -half : col * (m.cellW + m.gapX) - half;
  }
  // Keep the bar inside the grid at the row edges.
  const minC = DROP_BAR_W / 2;
  const maxC = m.width - DROP_BAR_W / 2;
  if (readingCenter < minC) readingCenter = minC;
  if (readingCenter > maxC) readingCenter = maxC;
  const readingLeft = readingCenter - DROP_BAR_W / 2;
  return { x: toPhysical(m, readingLeft, DROP_BAR_W, rtl), y: m.padTop + rowIdx * m.rowH, h: m.thumbH };
}

/**
 * The cell range to mount for a scroll position: rows touching [scrollY - overscan x viewport,
 * scrollY + viewport + overscan x viewport], as cell indexes [first, last] (inclusive), clamped to
 * 0..slots-1. last < first when there is nothing to show.
 */
export function visibleRange(
  m: GridMetrics,
  scrollY: number,
  viewportH: number,
  slots: number,
  overscan = 1,
): { first: number; last: number } {
  'worklet';
  const n = Math.max(0, Math.floor(slots) || 0);
  if (n === 0) return { first: 0, last: -1 };
  const vh = Math.max(0, viewportH || 0);
  const extra = vh * Math.max(0, overscan);
  const top = (scrollY || 0) - extra - m.padTop;
  const bottom = (scrollY || 0) + vh + extra - m.padTop;
  const rows = rowsFor(n, m.columns);
  let firstRow = Math.floor(top / m.rowH);
  let lastRow = Math.floor(bottom / m.rowH);
  if (firstRow < 0) firstRow = 0;
  if (lastRow > rows - 1) lastRow = rows - 1;
  if (lastRow < firstRow) return { first: 0, last: -1 };
  return { first: firstRow * m.columns, last: Math.min(n - 1, (lastRow + 1) * m.columns - 1) };
}

/**
 * Auto-scroll while dragging near the top or bottom edge of the viewport: points per frame (negative
 * scrolls up), growing linearly to maxStep at the very edge, 0 elsewhere.
 */
export function autoScrollStep(pointerY: number, viewportH: number, edge = 80, maxStep = 18): number {
  'worklet';
  if (!Number.isFinite(pointerY) || !(viewportH > 0) || !(edge > 0)) return 0;
  const e = Math.min(edge, viewportH / 3);
  if (pointerY < e) return -maxStep * Math.min(1, (e - pointerY) / e);
  if (pointerY > viewportH - e) return maxStep * Math.min(1, (pointerY - (viewportH - e)) / e);
  return 0;
}

/** Clamps a scroll offset to the content. */
export function clampScroll(y: number, contentH: number, viewportH: number): number {
  'worklet';
  const max = Math.max(0, contentH - viewportH);
  if (!(y > 0)) return 0;
  return y > max ? max : y;
}
