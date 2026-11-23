/**
 * Export page ranges (NB-70) and the export sheet's range steppers (Figma 14).
 *
 * - PageRange (core/contracts/pdf.ts): 'all' | 'current' | { from, to }, from/to 1-based and inclusive.
 * - resolvePageRange turns a range into the 0-based page indices to export, in notebook order. A
 *   range outside the notebook is clamped into it (never an empty list for a non-empty notebook).
 * - The steppers 'من' and 'إلى' run over 1..N with from <= to enforced: 'من' never passes 'إلى'
 *   and 'إلى' never goes under 'من' (canStepRange tells the sheet which buttons to disable).
 * - rangeChipLabel is the chip text once 'نطاق' is chosen: 'نطاق: 2 – 5' (en dash between spaces).
 */
import type { PageRange } from '../contracts/pdf.ts';

export interface PageSpan {
  /** 1-based, inclusive. */
  from: number;
  /** 1-based, inclusive. */
  to: number;
}

export type RangeEnd = 'from' | 'to';

const toInt = (v: number, fallback: number): number => (Number.isFinite(v) ? Math.round(v) : fallback);

/** The page count as a non-negative integer. */
function countOf(pageCount: number): number {
  return Math.max(0, Math.floor(Number.isFinite(pageCount) ? pageCount : 0));
}

/** from and to inside 1..pageCount with from <= to (an empty notebook gives { from: 1, to: 1 }). */
export function clampSpan(span: PageSpan, pageCount: number): PageSpan {
  const n = Math.max(1, countOf(pageCount));
  let from = Math.min(n, Math.max(1, toInt(span.from, 1)));
  let to = Math.min(n, Math.max(1, toInt(span.to, n)));
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }
  return { from, to };
}

/** The span the steppers start with: the whole notebook. */
export function defaultSpan(pageCount: number): PageSpan {
  return { from: 1, to: Math.max(1, countOf(pageCount)) };
}

/** Whether the stepper `end` can move by delta (+1 / -1) without leaving 1..N or crossing the other end. */
export function canStepRange(span: PageSpan, end: RangeEnd, delta: number, pageCount: number): boolean {
  const s = clampSpan(span, pageCount);
  const n = Math.max(1, countOf(pageCount));
  const d = Math.sign(delta);
  if (d === 0) return false;
  if (end === 'from') {
    const next = s.from + d;
    return next >= 1 && next <= s.to;
  }
  const next = s.to + d;
  return next >= s.from && next <= n;
}

/** The span after moving `end` by delta, clamped so 1 <= from <= to <= N. */
export function stepRange(span: PageSpan, end: RangeEnd, delta: number, pageCount: number): PageSpan {
  const s = clampSpan(span, pageCount);
  const n = Math.max(1, countOf(pageCount));
  const d = toInt(delta, 0);
  if (end === 'from') return { from: Math.min(s.to, Math.max(1, s.from + d)), to: s.to };
  return { from: s.from, to: Math.max(s.from, Math.min(n, s.to + d)) };
}

/** Sets one end to a value, keeping 1 <= from <= to <= N (the other end follows when crossed). */
export function setRangeEnd(span: PageSpan, end: RangeEnd, value: number, pageCount: number): PageSpan {
  const s = clampSpan(span, pageCount);
  const n = Math.max(1, countOf(pageCount));
  const v = Math.min(n, Math.max(1, toInt(value, end === 'from' ? s.from : s.to)));
  if (end === 'from') return { from: v, to: Math.max(v, s.to) };
  return { from: Math.min(v, s.from), to: v };
}

/**
 * 0-based page indices of a range, in notebook order. 'current' is the page on screen (clamped into
 * the notebook); a span is clamped into 1..N. An empty notebook gives [].
 */
export function resolvePageRange(range: PageRange, pageCount: number, currentIndex: number): number[] {
  const n = countOf(pageCount);
  if (n === 0) return [];
  if (range === 'all') return Array.from({ length: n }, (_, i) => i);
  if (range === 'current') return [Math.min(n - 1, Math.max(0, toInt(currentIndex, 0)))];
  const s = clampSpan(range, n);
  const out: number[] = [];
  for (let i = s.from; i <= s.to; i++) out.push(i - 1);
  return out;
}

/** Number of pages a range exports. */
export function rangeCount(range: PageRange, pageCount: number, currentIndex: number): number {
  return resolvePageRange(range, pageCount, currentIndex).length;
}

/** The 'نطاق' chip text once a span is chosen: 'نطاق: 2 – 5' / 'Range: 2 – 5'. */
export function rangeChipLabel(span: PageSpan, lang: 'ar' | 'en'): string {
  return `${lang === 'en' ? 'Range' : 'نطاق'}: ${span.from} – ${span.to}`;
}

/**
 * A safe file name for an exported file: no path, reserved, control or bidi control characters, at
 * most 80 characters before the extension, never starting with a dot. fallback replaces an empty title.
 */
export function exportFileName(title: string, ext: string, fallback: string): string {
  const clean = (s: string): string =>
    String(s ?? '')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 80)
      .trim();
  const base = clean(title) || clean(fallback) || 'export';
  const e = String(ext ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return e ? `${base}.${e}` : base;
}
