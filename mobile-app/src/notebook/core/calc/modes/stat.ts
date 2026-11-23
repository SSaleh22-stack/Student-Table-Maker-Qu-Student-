/**
 * STAT (MODE 3): the statistics editor's limits, the statistics variables and the STAT menus.
 *
 * - Editor rows, as on the reference: 1-VAR holds 80 rows (40 with the FREQ column on); the paired
 *   types hold 40 rows (26 with FREQ on). FREQ is the SETUP STAT setting.
 * - n is the total frequency. Rows with frequency 0 are left out; a negative frequency makes every
 *   value undefined (Math ERROR).
 * - σx and σy are population deviations, sx and sy sample deviations (n − 1).
 * - Q1, med and Q3 (1-VAR only): med is the median; Q1 and Q3 are the medians of the lower and upper
 *   halves, leaving the median out when n is odd. They need whole-number frequencies.
 * - Σx³, Σx²y and Σx⁴ exist for every paired type (the reference Sum menu lists them for A+BX too);
 *   C belongs to the quadratic type, r to the other regressions.
 * statCompute gives null for every value that is not available or not defined for the data; the
 * estimated values x̂, x̂1, x̂2 and ŷ need an argument, so statCompute always gives null for them.
 */
import type { CalcError, CalcValue, StatData, StatKind, StatVar } from '../types.ts';
import { STAT_VARS } from '../types.ts';
import { real } from '../num/value.ts';
import { estimateX, estimateX12, estimateY, fitRegression, type RegFit, type RegKind, type WeightedPoint } from './regression.ts';

/** Paired types (X and Y columns): 40 rows, or 26 with the FREQ column. */
export const STAT_MAX_ROWS = 40;
export const STAT_MAX_ROWS_FREQ = 26;
/** 1-VAR (X column only): 80 rows, or 40 with the FREQ column. */
export const STAT_MAX_ROWS_1VAR = 80;
export const STAT_MAX_ROWS_1VAR_FREQ = 40;

/**
 * Rows the STAT editor holds with the FREQ column off or on. Without kind it gives the paired-type
 * limits (the smaller ones); pass the statistics type to get the 1-VAR limits.
 */
export function statMaxRows(freqOn: boolean, kind?: StatKind): number {
  if (kind === '1-VAR') return freqOn ? STAT_MAX_ROWS_1VAR_FREQ : STAT_MAX_ROWS_1VAR;
  return freqOn ? STAT_MAX_ROWS_FREQ : STAT_MAX_ROWS;
}

/** True for the paired-variable (regression) types. */
export function isPaired(kind: StatKind): kind is RegKind {
  return kind !== '1-VAR';
}

/** The weighted points of the data (frequency-0 rows dropped). null when a frequency is invalid. */
export function statPoints(data: StatData): WeightedPoint[] | null {
  const out: WeightedPoint[] = [];
  for (let i = 0; i < data.x.length; i++) {
    const x = data.x[i];
    const y = data.y[i] ?? 0;
    const f = data.freq[i] ?? 1;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(f) || f < 0) return null;
    if (f === 0) continue;
    out.push({ x, y, f });
  }
  return out;
}

/** Every statistics variable undefined (the compiler checks that the record covers STAT_VARS). */
function emptyRecord(): Record<StatVar, number | null> {
  return {
    n: null, 'x̄': null, 'σx': null, sx: null, 'ȳ': null, 'σy': null, sy: null,
    'Σx': null, 'Σx²': null, 'Σy': null, 'Σy²': null, 'Σxy': null, 'Σx³': null, 'Σx²y': null, 'Σx⁴': null,
    minX: null, maxX: null, minY: null, maxY: null, Q1: null, med: null, Q3: null,
    A: null, B: null, C: null, r: null, 'x̂': null, 'x̂1': null, 'x̂2': null, 'ŷ': null,
  };
}

/** The value at 1-based position k of the data expanded by frequency (sorted values). */
function at(sorted: { x: number; f: number }[], k: number): number {
  let seen = 0;
  for (const s of sorted) {
    seen += s.f;
    if (k <= seen) return s.x;
  }
  return sorted[sorted.length - 1].x;
}

/** Median of positions lo..hi (1-based, inclusive) of the expanded data. */
function medianOf(sorted: { x: number; f: number }[], lo: number, hi: number): number {
  const count = hi - lo + 1;
  const mid = lo + Math.floor((count - 1) / 2);
  return count % 2 === 1 ? at(sorted, mid) : (at(sorted, mid) + at(sorted, mid + 1)) / 2;
}

/** Q1, med and Q3, or null when a frequency is not a whole number. */
export function quartiles(pts: { x: number; f: number }[]): { q1: number; med: number; q3: number } | null {
  if (pts.length === 0) return null;
  if (!pts.every((p) => Number.isInteger(p.f))) return null;
  const sorted = pts.map((p) => ({ x: p.x, f: p.f })).sort((a, b) => a.x - b.x);
  const n = sorted.reduce((s, p) => s + p.f, 0);
  const med = medianOf(sorted, 1, n);
  if (n === 1) return { q1: med, med, q3: med };
  const half = Math.floor(n / 2);
  const q1 = medianOf(sorted, 1, half);
  const q3 = medianOf(sorted, n - half + 1, n);
  return { q1, med, q3 };
}

function deviations(pts: WeightedPoint[], pick: (p: WeightedPoint) => number, n: number) {
  let s = 0;
  for (const p of pts) s += p.f * pick(p);
  const mean = s / n;
  let ss = 0;
  for (const p of pts) {
    const d = pick(p) - mean;
    ss += p.f * d * d;
  }
  return {
    mean,
    sigma: Math.sqrt(ss / n),
    s: n > 1 ? Math.sqrt(ss / (n - 1)) : null,
  };
}

/** Every statistics variable of the data (null = not available or not defined). */
export function statCompute(data: StatData): Record<StatVar, number | null> {
  const out = emptyRecord();
  const pts = statPoints(data);
  if (!pts) return out;
  const paired = isPaired(data.kind);
  const quad = data.kind === '_+CX²';
  let n = 0;
  let sx = 0;
  let sx2 = 0;
  let sy = 0;
  let sy2 = 0;
  let sxy = 0;
  let sx3 = 0;
  let sx2y = 0;
  let sx4 = 0;
  for (const { x, y, f } of pts) {
    n += f;
    sx += f * x;
    sx2 += f * x * x;
    sy += f * y;
    sy2 += f * y * y;
    sxy += f * x * y;
    sx3 += f * x * x * x;
    sx2y += f * x * x * y;
    sx4 += f * x * x * x * x;
  }
  out.n = n;
  out['Σx'] = sx;
  out['Σx²'] = sx2;
  if (paired) {
    out['Σy'] = sy;
    out['Σy²'] = sy2;
    out['Σxy'] = sxy;
    out['Σx³'] = sx3;
    out['Σx²y'] = sx2y;
    out['Σx⁴'] = sx4;
  }
  if (n > 0 && pts.length > 0) {
    const dx = deviations(pts, (p) => p.x, n);
    out['x̄'] = dx.mean;
    out['σx'] = dx.sigma;
    out.sx = dx.s;
    out.minX = Math.min(...pts.map((p) => p.x));
    out.maxX = Math.max(...pts.map((p) => p.x));
    if (paired) {
      const dy = deviations(pts, (p) => p.y, n);
      out['ȳ'] = dy.mean;
      out['σy'] = dy.sigma;
      out.sy = dy.s;
      out.minY = Math.min(...pts.map((p) => p.y));
      out.maxY = Math.max(...pts.map((p) => p.y));
    } else {
      const qs = quartiles(pts);
      if (qs) {
        out.Q1 = qs.q1;
        out.med = qs.med;
        out.Q3 = qs.q3;
      }
    }
  }
  if (isPaired(data.kind)) {
    const fit = fitRegression(data.kind, pts);
    if (fit) {
      out.A = fit.A;
      out.B = fit.B;
      if (quad) out.C = fit.C;
      else out.r = fit.r;
    }
  }
  for (const v of STAT_VARS) {
    const x = out[v];
    if (x !== null && !Number.isFinite(x)) out[v] = null;
  }
  return out;
}

/** The regression of the data, or null (1-VAR, too few points, invalid values). */
export function statFit(data: StatData): RegFit | null {
  if (!isPaired(data.kind)) return null;
  const pts = statPoints(data);
  return pts ? fitRegression(data.kind, pts) : null;
}

/**
 * ModeOps.statVar: one statistics variable as a value. x̂, x̂1, x̂2 and ŷ take arg (the value written
 * before them). Anything undefined is Math ERROR.
 */
export function statVarValue(name: StatVar, data: StatData, arg?: number): CalcValue | CalcError {
  if (name === 'x̂' || name === 'x̂1' || name === 'x̂2' || name === 'ŷ') {
    if (arg === undefined) return 'Syntax ERROR';
    const fit = statFit(data);
    if (!fit) return 'Math ERROR';
    const quad = fit.kind === '_+CX²';
    let r: number | null = null;
    if (name === 'ŷ') r = estimateY(fit, arg);
    else if (name === 'x̂') r = quad ? null : estimateX(fit, arg);
    else if (quad) {
      const both = estimateX12(fit, arg);
      r = both ? (name === 'x̂1' ? both.x1 : both.x2) : null;
    }
    return r === null ? 'Math ERROR' : real(r);
  }
  const v = statCompute(data)[name];
  return v === null ? 'Math ERROR' : real(v);
}

/** The STAT menu pages (SHIFT 1) for a statistics type, each in menu order. */
export interface StatMenus {
  sum: StatVar[];
  var: StatVar[];
  /** Empty for 1-VAR. */
  reg: StatVar[];
  minmax: StatVar[];
  /** The Distr page (P( Q( R( ▶t) exists only for 1-VAR. */
  distr: boolean;
}

export function statMenus(kind: StatKind): StatMenus {
  if (!isPaired(kind)) {
    return { sum: ['Σx²', 'Σx'], var: ['n', 'x̄', 'σx', 'sx'], reg: [], minmax: ['minX', 'maxX', 'Q1', 'med', 'Q3'], distr: true };
  }
  const quad = kind === '_+CX²';
  return {
    sum: ['Σx²', 'Σx', 'Σy²', 'Σy', 'Σxy', 'Σx³', 'Σx²y', 'Σx⁴'],
    var: ['n', 'x̄', 'σx', 'sx', 'ȳ', 'σy', 'sy'],
    reg: quad ? ['A', 'B', 'C', 'x̂1', 'x̂2', 'ŷ'] : ['A', 'B', 'r', 'x̂', 'ŷ'],
    minmax: ['minX', 'maxX', 'minY', 'maxY'],
    distr: false,
  };
}
