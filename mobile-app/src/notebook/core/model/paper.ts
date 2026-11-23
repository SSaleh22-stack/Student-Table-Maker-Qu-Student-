/** Paper sizes, colors and defaults (NB-20, NB-21, NB-22). Sizes are in PDF points. */
import type { Hex, Id, Page, PageSizeKey, PaperColor, PaperSpec, PaperStyle, Size } from './types.ts';

export const PAPER_STYLES: readonly PaperStyle[] = ['blank', 'lined', 'grid', 'dotted'];
export const PAPER_COLORS: readonly PaperColor[] = ['white', 'cream', 'dark'];
/** A4 portrait is the default (NB-22). */
export const PAGE_SIZE_KEYS: readonly PageSizeKey[] = ['a4', 'a4-landscape', 'letter', 'wide'];

export const PAGE_SIZES: Readonly<Record<PageSizeKey, Readonly<Size>>> = {
  a4: { w: 595.28, h: 841.89 },
  'a4-landscape': { w: 841.89, h: 595.28 },
  letter: { w: 612, h: 792 },
  wide: { w: 960, h: 540 },
};

export const PAPER_FILL: Readonly<Record<PaperColor, Hex>> = {
  white: '#FFFFFF',
  cream: '#FBF6E9',
  dark: '#1F2937',
};

export const DEFAULT_PAPER: Readonly<PaperSpec> = { style: 'lined', color: 'white', size: 'a4' };

/** The page size of a size key or a paper spec. Always a fresh object. */
export function sizeOf(p: PageSizeKey | PaperSpec): Size {
  const key = typeof p === 'string' ? p : p.size;
  const s = PAGE_SIZES[key] ?? PAGE_SIZES.a4;
  return { w: s.w, h: s.h };
}

/** The size key whose size matches (within 0.5 pt), or null for a custom size such as a PDF page. */
export function sizeKeyOf(size: Size): PageSizeKey | null {
  for (const key of PAGE_SIZE_KEYS) {
    const s = PAGE_SIZES[key];
    if (Math.abs(s.w - size.w) <= 0.5 && Math.abs(s.h - size.h) <= 0.5) return key;
  }
  return null;
}

export function samePaper(a: PaperSpec, b: PaperSpec): boolean {
  return a.style === b.style && a.color === b.color && a.size === b.size;
}

export function copyPaper(p: PaperSpec): PaperSpec {
  return { style: p.style, color: p.color, size: p.size };
}

/** An empty paper page (also what a missing page file reads as). */
export function blankPage(id: Id, paper: PaperSpec = DEFAULT_PAPER, size?: Size): Page {
  const s = size ? { w: size.w, h: size.h } : sizeOf(paper);
  return { id, size: s, background: { kind: 'paper', paper: copyPaper(paper) }, items: [] };
}
