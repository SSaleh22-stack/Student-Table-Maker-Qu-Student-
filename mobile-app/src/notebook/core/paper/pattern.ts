/**
 * Paper geometry: the ONLY implementation. PaperPicker, library thumbnails, the Skia painter and the
 * PDF export all draw paper from patternFor, so a page looks the same everywhere.
 *
 * In page points (origin top-left):
 * - lined: rules every 36 pt from y = 120 while y < h - 10, plus a margin line 72 pt from the RIGHT
 *   edge (Arabic-first, as in the Figma paper: x = w - 72, color #F3B4B4, width 1.5)
 * - grid: lines every 18 pt (both directions, starting at 18, edges excluded)
 * - dotted: dots every 18 pt, r = 1
 * - blank: fill only
 * Lines are 1 pt wide, #D6E2EE on white and cream paper, #374151 on dark paper.
 */
import { PAPER_FILL } from '../model/paper.ts';
import type { Hex, PaperPattern, PaperSpec, Size } from '../model/types.ts';

export const LINED_STEP = 36;
export const LINED_TOP = 120;
export const LINED_BOTTOM_GAP = 10;
export const MARGIN_FROM_RIGHT = 72;
export const MARGIN_COLOR: Hex = '#F3B4B4';
export const MARGIN_WIDTH = 1.5;
export const GRID_STEP = 18;
export const DOT_STEP = 18;
export const DOT_R = 1;
export const LINE_WIDTH = 1;
export const LINE_COLOR_LIGHT: Hex = '#D6E2EE';
export const LINE_COLOR_DARK: Hex = '#374151';

/** Guard against absurd sizes: at most this many lines or dots are produced. */
const MAX_MARKS = 20000;

export function lineColorFor(paper: PaperSpec): Hex {
  return paper.color === 'dark' ? LINE_COLOR_DARK : LINE_COLOR_LIGHT;
}

export function patternFor(paper: PaperSpec, size: Size): PaperPattern {
  const w = Number.isFinite(size.w) && size.w > 0 ? size.w : 0;
  const h = Number.isFinite(size.h) && size.h > 0 ? size.h : 0;
  const fill = PAPER_FILL[paper.color] ?? PAPER_FILL.white;
  const lineColor = lineColorFor(paper);
  const out: PaperPattern = { fill, lines: [], dots: [], lineColor, lineWidth: LINE_WIDTH };

  if (paper.style === 'lined') {
    for (let y = LINED_TOP; y < h - LINED_BOTTOM_GAP && out.lines.length < MAX_MARKS; y += LINED_STEP) {
      out.lines.push({ x1: 0, y1: y, x2: w, y2: y });
    }
    if (w > MARGIN_FROM_RIGHT) out.margin = { x: w - MARGIN_FROM_RIGHT, color: MARGIN_COLOR, width: MARGIN_WIDTH };
  } else if (paper.style === 'grid') {
    for (let y = GRID_STEP; y < h && out.lines.length < MAX_MARKS; y += GRID_STEP) {
      out.lines.push({ x1: 0, y1: y, x2: w, y2: y });
    }
    for (let x = GRID_STEP; x < w && out.lines.length < MAX_MARKS; x += GRID_STEP) {
      out.lines.push({ x1: x, y1: 0, x2: x, y2: h });
    }
  } else if (paper.style === 'dotted') {
    for (let y = DOT_STEP; y < h; y += DOT_STEP) {
      for (let x = DOT_STEP; x < w; x += DOT_STEP) {
        if (out.dots.length >= MAX_MARKS) return out;
        out.dots.push({ x, y, r: DOT_R });
      }
    }
  }
  return out;
}
