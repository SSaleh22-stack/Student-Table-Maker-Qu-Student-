/**
 * Stroke point codec ('d10') for page files.
 *
 * Raw points are flat x, y, p triples. Encoded: the first point is [X0, Y0, P0] and every next point is
 * [Xi - Xi-1, Yi - Yi-1, Pi], where X = round(x * 10), Y = round(y * 10) and P = round(p * 100).
 * Deltas are taken between ROUNDED values, so errors never accumulate: x and y come back within
 * 0.05 pt and p within 0.005. Decoding also accepts raw floats (an item without enc: 'd10').
 */
import type { EncodedItem, EncodedPage, EncodedStroke, Page, PageItem, StrokeItem } from './types.ts';

const q10 = (v: number): number => Math.round((Number.isFinite(v) ? v : 0) * 10);
const q100 = (v: number): number => Math.round((Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0) * 100);

/** Encodes flat x, y, p triples. A trailing partial triple is dropped. */
export function encodePts(pts: readonly number[]): number[] {
  const n = pts.length - (pts.length % 3);
  const out = new Array<number>(n);
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i += 3) {
    const x = q10(pts[i]);
    const y = q10(pts[i + 1]);
    out[i] = x - px;
    out[i + 1] = y - py;
    out[i + 2] = q100(pts[i + 2]);
    px = x;
    py = y;
  }
  // -0 would serialize as 0 anyway; normalize so equality checks are stable.
  for (let i = 0; i < n; i++) if (out[i] === 0) out[i] = 0;
  return out;
}

/** Decodes d10 points back to flat x, y, p triples. */
export function decodePts(enc: readonly number[]): number[] {
  const n = enc.length - (enc.length % 3);
  const out = new Array<number>(n);
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i += 3) {
    x += enc[i];
    y += enc[i + 1];
    out[i] = x / 10;
    out[i + 1] = y / 10;
    // Pressure is 0..1 (a hand-edited or foreign file could hold more).
    out[i + 2] = Math.min(1, Math.max(0, enc[i + 2] / 100));
  }
  return out;
}

export function encodeItem(item: PageItem): EncodedItem {
  if (item.kind !== 'stroke') return item;
  const { pts, ...rest } = item;
  const enc: EncodedStroke = { ...rest, enc: 'd10', pts: encodePts(pts) };
  return enc;
}

export function decodeItem(item: EncodedItem): PageItem {
  if (item.kind !== 'stroke') return item;
  const { enc, pts, ...rest } = item;
  const out: StrokeItem = { ...rest, pts: enc === 'd10' ? decodePts(pts) : rawPts(pts) };
  return out;
}

/** Raw float triples (no enc): whole triples only, pressure kept in 0..1 like decoded points. */
function rawPts(pts: readonly number[]): number[] {
  const n = pts.length - (pts.length % 3);
  const out = pts.slice(0, n);
  for (let i = 2; i < n; i += 3) out[i] = Math.min(1, Math.max(0, out[i]));
  return out;
}

export function encodePage(p: Page): EncodedPage {
  return { id: p.id, size: { w: p.size.w, h: p.size.h }, background: p.background, items: p.items.map(encodeItem) };
}

export function decodePage(e: EncodedPage): Page {
  return { id: e.id, size: { w: e.size.w, h: e.size.h }, background: e.background, items: e.items.map(decodeItem) };
}
