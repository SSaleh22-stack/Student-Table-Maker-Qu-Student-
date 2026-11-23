/**
 * Page layout of the canvas (P22, NB-49): every page of the notebook in one vertical column, in
 * CONTENT space. Content space is screen points at zoom 1 (the view transform of viewport.ts maps it
 * to the screen: screen = content x scale + translate). The canvas never mirrors: x always grows to
 * the physical right, whatever the language.
 *
 * - One fit scale k (content px per page point) for the whole notebook: the widest page fills the
 *   band between the physical left and right insets (toolbar, docked calculator) minus a margin. A
 *   uniform k keeps ink, text and zoom the same size on every page.
 * - Pages are centred in the band, PAGE_GAP apart, with PAGE_MARGIN above the first page and below
 *   the last one.
 *
 * The layout is a FLAT number array so it can live in a shared value and be read by worklets:
 *   [k, contentW, contentH, count, x0, y0, w0, h0, x1, y1, w1, h1, ...]   (content px)
 * Every function here is a worklet and allocation-light.
 */

export interface LayoutSize {
  w: number;
  h: number;
}

/** Physical insets (left is always the screen's left). */
export interface LayoutInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface LayoutOptions {
  /** Space between pages, content px (default PAGE_GAP). */
  gap?: number;
  /** Space beside the widest page and above / below the column, content px (default PAGE_MARGIN). */
  margin?: number;
}

/** Content px between two pages. */
export const PAGE_GAP = 20;
/** Content px beside the widest page and above the first / below the last page. */
export const PAGE_MARGIN = 16;
/** Header size of the flat layout. */
export const LAYOUT_HEADER = 4;
/** Smallest fit scale (a view narrower than its margins still lays out). */
export const MIN_FIT_SCALE = 0.05;

/** The band width between the physical insets (at least 1). */
export function bandWidth(viewW: number, insets: LayoutInsets): number {
  'worklet';
  return Math.max(1, viewW - Math.max(0, insets.left) - Math.max(0, insets.right));
}

/**
 * Lays out pages of the given sizes (page points) for a view viewW wide with the given physical
 * insets. Returns the flat layout (see the file header).
 */
export function computeLayout(sizes: readonly LayoutSize[], viewW: number, insets: LayoutInsets, o?: LayoutOptions): number[] {
  'worklet';
  const gap = o && o.gap !== undefined && o.gap >= 0 ? o.gap : PAGE_GAP;
  const margin = o && o.margin !== undefined && o.margin >= 0 ? o.margin : PAGE_MARGIN;
  const band = bandWidth(viewW, insets);
  let maxW = 1;
  for (let i = 0; i < sizes.length; i++) {
    const w = sizes[i].w;
    if (w > maxW && Number.isFinite(w)) maxW = w;
  }
  const k = Math.max(MIN_FIT_SCALE, (band - 2 * margin) / maxW);
  const out: number[] = [k, band, 0, sizes.length];
  let y = margin;
  for (let i = 0; i < sizes.length; i++) {
    const sw = sizes[i].w > 0 && Number.isFinite(sizes[i].w) ? sizes[i].w : maxW;
    const sh = sizes[i].h > 0 && Number.isFinite(sizes[i].h) ? sizes[i].h : sw;
    const w = sw * k;
    const h = sh * k;
    out.push((band - w) / 2, y, w, h);
    y += h + (i < sizes.length - 1 ? gap : 0);
  }
  out[2] = sizes.length > 0 ? y + margin : 2 * margin;
  return out;
}

/** Content px per page point. */
export function layoutScale(l: ArrayLike<number>): number {
  'worklet';
  return l.length >= LAYOUT_HEADER ? l[0] : 1;
}

export function layoutContentW(l: ArrayLike<number>): number {
  'worklet';
  return l.length >= LAYOUT_HEADER ? l[1] : 0;
}

export function layoutContentH(l: ArrayLike<number>): number {
  'worklet';
  return l.length >= LAYOUT_HEADER ? l[2] : 0;
}

export function layoutCount(l: ArrayLike<number>): number {
  'worklet';
  return l.length >= LAYOUT_HEADER ? l[3] : 0;
}

/** [x, y, w, h] of page i in content px, or null when i is out of range. */
export function pageRect(l: ArrayLike<number>, i: number): number[] | null {
  'worklet';
  if (i < 0 || i >= layoutCount(l)) return null;
  const b = LAYOUT_HEADER + i * 4;
  return [l[b], l[b + 1], l[b + 2], l[b + 3]];
}

/** Content y of page i's top edge (NaN when out of range). */
export function pageTop(l: ArrayLike<number>, i: number): number {
  'worklet';
  if (i < 0 || i >= layoutCount(l)) return NaN;
  return l[LAYOUT_HEADER + i * 4 + 1];
}

/**
 * The page whose vertical span contains content y (within slop content px above and below), or -1
 * in a gap or outside the column. Binary search.
 */
export function pageIndexAt(l: ArrayLike<number>, cy: number, slop: number = 0): number {
  'worklet';
  const n = layoutCount(l);
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = LAYOUT_HEADER + mid * 4;
    const top = l[b + 1] - slop;
    const bottom = l[b + 1] + l[b + 3] + slop;
    if (cy < top) hi = mid - 1;
    else if (cy > bottom) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The page containing content y, else the nearest one; -1 only when there are no pages. */
export function nearestPageIndex(l: ArrayLike<number>, cy: number): number {
  'worklet';
  const n = layoutCount(l);
  if (n === 0) return -1;
  const hit = pageIndexAt(l, cy);
  if (hit >= 0) return hit;
  // In a gap or outside: the first page whose top is below cy, compared with the one before it.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (l[LAYOUT_HEADER + mid * 4 + 1] < cy) lo = mid + 1;
    else hi = mid;
  }
  if (lo <= 0) return 0;
  if (lo >= n) return n - 1;
  const prevBottom = l[LAYOUT_HEADER + (lo - 1) * 4 + 1] + l[LAYOUT_HEADER + (lo - 1) * 4 + 3];
  const nextTop = l[LAYOUT_HEADER + lo * 4 + 1];
  return cy - prevBottom <= nextTop - cy ? lo - 1 : lo;
}

/** [first, last] pages overlapping content y0..y1 (inclusive), or [-1, -1] when none. */
export function visibleRange(l: ArrayLike<number>, y0: number, y1: number): number[] {
  'worklet';
  const n = layoutCount(l);
  if (n === 0 || y1 < y0) return [-1, -1];
  // First page whose bottom is at or below y0.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = LAYOUT_HEADER + mid * 4;
    if (l[b + 1] + l[b + 3] < y0) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  if (first >= n || l[LAYOUT_HEADER + first * 4 + 1] > y1) return [-1, -1];
  lo = first;
  hi = n;
  // Last page whose top is at or above y1.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (l[LAYOUT_HEADER + mid * 4 + 1] <= y1) lo = mid + 1;
    else hi = mid;
  }
  return [first, lo - 1];
}

/**
 * Where content point (cx, cy) of layout `from` lands in layout `to`, keeping its position on the
 * same page (page points). Used to keep the view still when pages above load their real size or the
 * band width changes. Falls back to the scaled point when the page does not exist in `to`.
 */
export function remapContentPoint(from: ArrayLike<number>, to: ArrayLike<number>, cx: number, cy: number): number[] {
  'worklet';
  const i = nearestPageIndex(from, cy);
  const kf = layoutScale(from);
  const kt = layoutScale(to);
  if (i < 0 || i >= layoutCount(to)) {
    const r = kf > 0 ? kt / kf : 1;
    return [cx * r, cy * r];
  }
  const bf = LAYOUT_HEADER + i * 4;
  const bt = LAYOUT_HEADER + i * 4;
  const px = (cx - from[bf]) / kf;
  const py = (cy - from[bf + 1]) / kf;
  return [to[bt] + px * kt, to[bt + 1] + py * kt];
}

/** True when both layouts place every page identically. */
export function sameLayout(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  'worklet';
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}
