/**
 * STAT regressions (MODE 3, types 2 to 8), fitted by least squares on weighted points.
 *
 *   A+BX    y = A + Bx                 ln X     y = A + B·ln x
 *   _+CX²   y = A + Bx + Cx²           e^X      y = A·e^(Bx)      (fitted on ln y)
 *   A•B^X   y = A·B^x (on ln y)        A•X^B    y = A·x^B         (fitted on ln x, ln y)
 *   1/X     y = A + B/x
 *
 * r is the correlation coefficient of the fitted (transformed) data; the quadratic has no r.
 * Estimates: ŷ for every type, x̂ for all but the quadratic, x̂1 and x̂2 for the quadratic.
 * Every function returns null where the reference shows Math ERROR (too few points, ln of x ≤ 0 …).
 */
import type { StatKind } from '../types.ts';

export type RegKind = Exclude<StatKind, '1-VAR'>;

export interface WeightedPoint {
  x: number;
  y: number;
  /** Frequency (weight), > 0. */
  f: number;
}

export interface RegFit {
  kind: RegKind;
  A: number;
  B: number;
  /** Quadratic only. */
  C: number | null;
  /** Not for the quadratic; null when it is undefined (all y equal). */
  r: number | null;
}

interface Transform {
  u(x: number): number | null;
  v(y: number): number | null;
}

const TRANSFORMS: Record<Exclude<RegKind, '_+CX²'>, Transform> = {
  'A+BX': { u: (x) => x, v: (y) => y },
  'ln X': { u: (x) => (x > 0 ? Math.log(x) : null), v: (y) => y },
  'e^X': { u: (x) => x, v: (y) => (y > 0 ? Math.log(y) : null) },
  'A•B^X': { u: (x) => x, v: (y) => (y > 0 ? Math.log(y) : null) },
  'A•X^B': { u: (x) => (x > 0 ? Math.log(x) : null), v: (y) => (y > 0 ? Math.log(y) : null) },
  '1/X': { u: (x) => (x !== 0 ? 1 / x : null), v: (y) => y },
};

function finite(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/** Weighted means and centred second moments of (u, v). */
function moments(pts: { u: number; v: number; f: number }[]) {
  let n = 0;
  let su = 0;
  let sv = 0;
  for (const p of pts) {
    n += p.f;
    su += p.f * p.u;
    sv += p.f * p.v;
  }
  const mu = su / n;
  const mv = sv / n;
  let cuu = 0;
  let cuv = 0;
  let cvv = 0;
  for (const p of pts) {
    const du = p.u - mu;
    const dv = p.v - mv;
    cuu += p.f * du * du;
    cuv += p.f * du * dv;
    cvv += p.f * dv * dv;
  }
  return { n, mu, mv, cuu, cuv, cvv };
}

function linearFit(kind: Exclude<RegKind, '_+CX²'>, pts: WeightedPoint[]): RegFit | null {
  const t = TRANSFORMS[kind];
  const uv: { u: number; v: number; f: number }[] = [];
  for (const p of pts) {
    const u = t.u(p.x);
    const v = t.v(p.y);
    if (u === null || v === null) return null;
    uv.push({ u, v, f: p.f });
  }
  if (uv.length === 0) return null;
  const m = moments(uv);
  if (!(m.n > 0) || m.cuu === 0) return null;
  const slope = m.cuv / m.cuu;
  const icpt = m.mv - slope * m.mu;
  const r = m.cvv === 0 ? null : finite(m.cuv / Math.sqrt(m.cuu * m.cvv));
  let A = icpt;
  let B = slope;
  if (kind === 'e^X') A = Math.exp(icpt);
  else if (kind === 'A•B^X') {
    A = Math.exp(icpt);
    B = Math.exp(slope);
  } else if (kind === 'A•X^B') A = Math.exp(icpt);
  if (!Number.isFinite(A) || !Number.isFinite(B)) return null;
  return { kind, A, B, C: null, r: r === null ? null : Math.max(-1, Math.min(1, r)) };
}

function quadraticFit(pts: WeightedPoint[]): RegFit | null {
  if (pts.length === 0) return null;
  let n = 0;
  let sx = 0;
  let sw = 0;
  let sy = 0;
  for (const p of pts) {
    n += p.f;
    sx += p.f * p.x;
    sw += p.f * p.x * p.x;
    sy += p.f * p.y;
  }
  if (!(n > 0)) return null;
  const mx = sx / n;
  const mw = sw / n;
  const my = sy / n;
  let sxx = 0;
  let sxw = 0;
  let sww = 0;
  let sxy = 0;
  let swy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dw = p.x * p.x - mw;
    const dy = p.y - my;
    sxx += p.f * dx * dx;
    sxw += p.f * dx * dw;
    sww += p.f * dw * dw;
    sxy += p.f * dx * dy;
    swy += p.f * dw * dy;
  }
  const den = sxx * sww - sxw * sxw;
  const scale = Math.abs(sxx * sww);
  if (den === 0 || Math.abs(den) <= scale * 1e-13) return null;
  const B = (sxy * sww - swy * sxw) / den;
  const C = (swy * sxx - sxy * sxw) / den;
  const A = my - B * mx - C * mw;
  if (![A, B, C].every(Number.isFinite)) return null;
  return { kind: '_+CX²', A, B, C, r: null };
}

/** Fits a regression. null when it is undefined for the data. */
export function fitRegression(kind: RegKind, pts: WeightedPoint[]): RegFit | null {
  return kind === '_+CX²' ? quadraticFit(pts) : linearFit(kind, pts);
}

/** ŷ: the estimated y at x. */
export function estimateY(fit: RegFit, x: number): number | null {
  const { A, B } = fit;
  switch (fit.kind) {
    case 'A+BX':
      return finite(A + B * x);
    case '_+CX²':
      return finite(A + B * x + (fit.C ?? 0) * x * x);
    case 'ln X':
      return x > 0 ? finite(A + B * Math.log(x)) : null;
    case 'e^X':
      return finite(A * Math.exp(B * x));
    case 'A•B^X':
      return finite(A * Math.pow(B, x));
    case 'A•X^B':
      return x > 0 ? finite(A * Math.pow(x, B)) : null;
    case '1/X':
      return x !== 0 ? finite(A + B / x) : null;
  }
}

/** x̂: the estimated x for y (every type except the quadratic). */
export function estimateX(fit: RegFit, y: number): number | null {
  const { A, B } = fit;
  switch (fit.kind) {
    case 'A+BX':
      return B !== 0 ? finite((y - A) / B) : null;
    case 'ln X':
      return B !== 0 ? finite(Math.exp((y - A) / B)) : null;
    case 'e^X':
      return B !== 0 && A !== 0 && y / A > 0 ? finite(Math.log(y / A) / B) : null;
    case 'A•B^X':
      return A !== 0 && y / A > 0 && B > 0 && B !== 1 ? finite(Math.log(y / A) / Math.log(B)) : null;
    case 'A•X^B':
      return B !== 0 && A !== 0 && y / A > 0 ? finite(Math.pow(y / A, 1 / B)) : null;
    case '1/X':
      return y !== A ? finite(B / (y - A)) : null;
    case '_+CX²':
      return null;
  }
}

/** x̂1 and x̂2 of the quadratic: x̂1 = (−B + √(B² − 4C(A − y))) / 2C, x̂2 with −√. */
export function estimateX12(fit: RegFit, y: number): { x1: number; x2: number } | null {
  if (fit.kind !== '_+CX²' || fit.C === null || fit.C === 0) return null;
  const { A, B, C } = fit;
  const disc = B * B - 4 * C * (A - y);
  if (!(disc >= 0)) return null;
  const s = Math.sqrt(disc);
  const x1 = finite((-B + s) / (2 * C));
  const x2 = finite((-B - s) / (2 * C));
  return x1 === null || x2 === null ? null : { x1, x2 };
}
