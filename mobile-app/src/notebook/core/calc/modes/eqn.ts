/**
 * EQN (MODE 5): simultaneous linear equations in 2 or 3 unknowns, and quadratic and cubic equations.
 *
 * Coefficients come row by row, as the editor shows them:
 *   lin2  [a1, b1, c1, a2, b2, c2]                 anX + bnY = cn
 *   lin3  [a1, b1, c1, d1, …, a3, b3, c3, d3]      anX + bnY + cnZ = dn
 *   poly2 [a, b, c]                                aX² + bX + c = 0
 *   poly3 [a, b, c, d]                             aX³ + bX² + cX + d = 0
 *
 * Results:
 * - linear: [X, Y] or [X, Y, Z], or 'Infinite Sol' / 'No Solution' when the system is singular.
 * - polynomial: distinct roots, real ones first from largest to smallest, then a complex pair
 *   (positive imaginary part first). A double root appears once. a = 0 is Math ERROR.
 * When every coefficient has a short decimal form the work is exact: X = 1/3, X = 1 ± √2, X = −1 + 2i.
 */
import type { CalcError, CalcValue, EqnKind, Exact, Rational } from '../types.ts';
import { checkValue, complex, real, realQ } from '../num/value.ts';
import { exAdd, exDiv, exQ, exRational, exSqrt, exSub, exToNumber } from '../exact.ts';
import {
  ZERO_Q, qAbs, qAdd, qApprox, qDiv, qIsZero, qMul, qNeg, qSign, qSub, qToNumber,
} from '../num/rational.ts';
import { exactQ } from './matrix.ts';

/** Number of coefficients each type takes. */
export const EQN_COEF_COUNT: Record<EqnKind, number> = { lin2: 6, lin3: 12, poly2: 3, poly3: 4 };

/** Editor grid of each type: rows × columns. */
export const EQN_GRID: Record<EqnKind, { rows: number; cols: number }> = {
  lin2: { rows: 2, cols: 3 },
  lin3: { rows: 3, cols: 4 },
  poly2: { rows: 1, cols: 3 },
  poly3: { rows: 1, cols: 4 },
};

/** EQN type menu lines (MODE 5), in menu order. */
export const EQN_TYPE_MENU: { kind: EqnKind; label: string }[] = [
  { kind: 'lin2', label: 'anX+bnY=cn' },
  { kind: 'lin3', label: 'anX+bnY+cnZ=dn' },
  { kind: 'poly2', label: 'aX²+bX+c=0' },
  { kind: 'poly3', label: 'aX³+bX²+cX+d=0' },
];

/** Column headings of the coefficient editor. */
export const EQN_COLUMNS: Record<EqnKind, string[]> = {
  lin2: ['a', 'b', 'c'],
  lin3: ['a', 'b', 'c', 'd'],
  poly2: ['a', 'b', 'c'],
  poly3: ['a', 'b', 'c', 'd'],
};

/** Result names: X, Y, Z for systems; X1, X2, X3 for polynomials (X alone for a single root). */
export function eqnRootNames(kind: EqnKind, count: number): string[] {
  if (kind === 'lin2') return ['X', 'Y'];
  if (kind === 'lin3') return ['X', 'Y', 'Z'];
  if (count === 1) return ['X'];
  return Array.from({ length: count }, (_, i) => `X${i + 1}`);
}

export type LinearResult = { x: number[]; exact: Rational[] | null } | 'Infinite Sol' | 'No Solution';

function toQ(xs: number[]): Rational[] | null {
  const out: Rational[] = [];
  for (const x of xs) {
    const r = exactQ(x);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

/** Gauss-Jordan on an exact augmented matrix. */
function qSolveLinear(aug: Rational[][], n: number): Rational[] | 'Infinite Sol' | 'No Solution' {
  const m = aug.map((row) => row.slice());
  let rank = 0;
  const pivots: number[] = [];
  for (let c = 0; c < n && rank < m.length; c++) {
    const p = m.findIndex((row, r) => r >= rank && !qIsZero(row[c]));
    if (p < 0) continue;
    [m[rank], m[p]] = [m[p], m[rank]];
    const pv = m[rank][c];
    m[rank] = m[rank].map((x) => qDiv(x, pv) ?? ZERO_Q);
    for (let r = 0; r < m.length; r++) {
      if (r === rank || qIsZero(m[r][c])) continue;
      const f = m[r][c];
      m[r] = m[r].map((x, k) => qSub(x, qMul(f, m[rank][k])));
    }
    pivots.push(c);
    rank++;
  }
  for (let r = rank; r < m.length; r++) if (!qIsZero(m[r][n])) return 'No Solution';
  if (rank < n) return 'Infinite Sol';
  const x: Rational[] = Array.from({ length: n }, () => ZERO_Q);
  pivots.forEach((c, r) => {
    x[c] = m[r][n];
  });
  return x;
}

/** Gauss-Jordan with partial pivoting on floats, with a relative zero tolerance. */
function fSolveLinear(aug: number[][], n: number): number[] | 'Infinite Sol' | 'No Solution' {
  const m = aug.map((row) => {
    const s = Math.max(...row.map((x) => Math.abs(x)));
    return s > 0 ? row.map((x) => x / s) : row.slice();
  });
  const tol = 1e-12;
  let rank = 0;
  const pivots: number[] = [];
  for (let c = 0; c < n && rank < m.length; c++) {
    let p = -1;
    for (let r = rank; r < m.length; r++) if (Math.abs(m[r][c]) > tol && (p < 0 || Math.abs(m[r][c]) > Math.abs(m[p][c]))) p = r;
    if (p < 0) continue;
    [m[rank], m[p]] = [m[p], m[rank]];
    const pv = m[rank][c];
    m[rank] = m[rank].map((x) => x / pv);
    for (let r = 0; r < m.length; r++) {
      if (r === rank) continue;
      const f = m[r][c];
      if (f !== 0) m[r] = m[r].map((x, k) => (k === c ? 0 : x - f * m[rank][k]));
    }
    pivots.push(c);
    rank++;
  }
  for (let r = rank; r < m.length; r++) if (Math.abs(m[r][n]) > tol) return 'No Solution';
  if (rank < n) return 'Infinite Sol';
  const x = Array.from({ length: n }, () => 0);
  pivots.forEach((c, r) => {
    x[c] = m[r][n];
  });
  return x;
}

/** Solves A·x = b (A is n × n). */
export function solveLinear(a: number[][], b: number[]): LinearResult {
  const n = a.length;
  const aug = a.map((row, i) => [...row, b[i]]);
  const qa = aug.map((row) => toQ(row));
  if (qa.every((row): row is Rational[] => row !== null)) {
    const r = qSolveLinear(qa, n);
    if (typeof r === 'string') return r;
    return { x: r.map((v) => qToNumber(v)), exact: r };
  }
  const r = fSolveLinear(aug, n);
  if (typeof r === 'string') return r;
  return { x: r, exact: null };
}

// ===== polynomials

function sortRoots(roots: CalcValue[]): CalcValue[] {
  const re = roots.filter((r): r is Extract<CalcValue, { t: 'real' }> => r.t === 'real');
  const cx = roots.filter((r): r is Extract<CalcValue, { t: 'cplx' }> => r.t === 'cplx');
  re.sort((x, y) => y.x - x.x);
  cx.sort((x, y) => y.im - x.im);
  return [...re, ...cx];
}

function sameRoot(a: CalcValue, b: CalcValue): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y));
  if (a.t === 'real' && b.t === 'real') return close(a.x, b.x);
  if (a.t === 'cplx' && b.t === 'cplx') return close(a.re, b.re) && close(a.im, b.im);
  return false;
}

function dedupe(roots: CalcValue[]): CalcValue[] {
  const out: CalcValue[] = [];
  for (const r of roots) if (!out.some((o) => sameRoot(o, r))) out.push(r);
  return out;
}

/**
 * A root with its exact form. real() takes the float from the exact form, and a surd form sums its
 * terms, which cancels for the small root of X² + 10¹⁰X + 1 (−5·10⁹ + √(2.5·10¹⁹ − 1) reads as 0).
 * So a surd form is kept only when it agrees with the cancellation-free float; otherwise the root is
 * the float alone.
 */
function exactRoot(e: Exact | null, fallback: number): CalcValue {
  if (!e) return real(fallback);
  if (e.k === 'q') return real(exToNumber(e), e);
  const x = exToNumber(e);
  const agrees = Math.abs(x - fallback) <= 1e-12 * Math.max(Math.abs(x), Math.abs(fallback));
  return agrees ? real(fallback, e) : real(fallback);
}

/** (−b + s)/2a and (−b − s)/2a for s = √D > 0, each computed without cancellation. */
function floatPair(a: number, b: number, c: number, s: number): [number, number] {
  if (b >= 0) {
    const minus = (-b - s) / (2 * a);
    return [(2 * c) / (-b - s), minus];
  }
  const plus = (-b + s) / (2 * a);
  return [plus, (2 * c) / (-b + s)];
}

/** Exact quadratic roots for rational a ≠ 0, b, c. */
function qQuadratic(a: Rational, b: Rational, c: Rational): CalcValue[] {
  const d = qSub(qMul(b, b), qMul(qMul(a, c), { n: 4n, d: 1n }));
  const twoA = qMul(a, { n: 2n, d: 1n });
  const mb = qNeg(b);
  const vertex = qDiv(mb, twoA) ?? ZERO_Q;
  const sd = qSign(d);
  if (sd === 0) return [realQ(vertex)];
  const dn = qToNumber(d);
  const an = qToNumber(a);
  const bn = qToNumber(b);
  if (sd > 0) {
    const s = exSqrt(exQ(d));
    const [fPlus, fMinus] = floatPair(an, bn, qToNumber(c), Math.sqrt(dn));
    const num1 = s ? exAdd(exQ(mb), s) : null;
    const num2 = s ? exSub(exQ(mb), s) : null;
    const r1 = num1 ? exDiv(num1, exQ(twoA)) : null;
    const r2 = num2 ? exDiv(num2, exQ(twoA)) : null;
    return [exactRoot(r1, fPlus), exactRoot(r2, fMinus)];
  }
  // Complex pair: vertex ± i·√(−d)/|2a|.
  const s = exSqrt(exQ(qNeg(d)));
  const imE = s ? exDiv(s, exQ(qAbs(twoA))) : null;
  const imQ = imE ? exRational(imE) : null;
  const imF = Math.sqrt(-dn) / Math.abs(2 * an);
  const re = qToNumber(vertex);
  if (imQ) return [complex(re, imF, { re: vertex, im: imQ }), complex(re, -imF, { re: vertex, im: qNeg(imQ) })];
  return [complex(re, imF), complex(re, -imF)];
}

/** Float quadratic roots for a ≠ 0. */
function fQuadratic(a: number, b: number, c: number): CalcValue[] {
  const d = b * b - 4 * a * c;
  const scale = Math.max(b * b, Math.abs(4 * a * c));
  if (Math.abs(d) <= scale * 1e-13) return [real(-b / (2 * a))];
  if (d > 0) {
    const [plus, minus] = floatPair(a, b, c, Math.sqrt(d));
    return [real(plus), real(minus)];
  }
  const re = -b / (2 * a);
  const im = Math.sqrt(-d) / Math.abs(2 * a);
  return [complex(re, im), complex(re, -im)];
}

/** Roots of aX² + bX + c = 0 (a ≠ 0). */
export function solveQuadratic(a: number, b: number, c: number): CalcValue[] | CalcError {
  if (![a, b, c].every(Number.isFinite)) return 'Math ERROR';
  if (a === 0) return 'Math ERROR';
  const qs = toQ([a, b, c]);
  const roots = qs ? qQuadratic(qs[0], qs[1], qs[2]) : fQuadratic(a, b, c);
  return sortRoots(dedupe(roots));
}

function horner(coef: number[], x: number): number {
  return coef.reduce((s, k) => s * x + k, 0);
}

function qHorner(coef: Rational[], x: Rational): Rational {
  return coef.reduce((s, k) => qAdd(qMul(s, x), k), ZERO_Q);
}

/** Newton polishing of a real root of the polynomial (keeps the better of the two). */
function polish(coef: number[], x: number): number {
  const deriv = coef.slice(0, -1).map((k, i) => k * (coef.length - 1 - i));
  let best = x;
  let bestErr = Math.abs(horner(coef, x));
  let cur = x;
  for (let i = 0; i < 8 && bestErr > 0; i++) {
    const d = horner(deriv, cur);
    if (d === 0 || !Number.isFinite(d)) break;
    cur -= horner(coef, cur) / d;
    const err = Math.abs(horner(coef, cur));
    if (!Number.isFinite(cur)) break;
    if (err < bestErr) {
      best = cur;
      bestErr = err;
    }
  }
  return best;
}

/** One real root of the cubic (a ≠ 0), by the trigonometric or Cardano formula, polished. */
function cubicRealRoot(a: number, b: number, c: number, d: number): number {
  const a1 = b / a;
  const a2 = c / a;
  const a3 = d / a;
  const Q = (a1 * a1 - 3 * a2) / 9;
  const R = (2 * a1 * a1 * a1 - 9 * a1 * a2 + 27 * a3) / 54;
  let x: number;
  if (R * R < Q * Q * Q) {
    const th = Math.acos(Math.max(-1, Math.min(1, R / Math.sqrt(Q * Q * Q))));
    x = -2 * Math.sqrt(Q) * Math.cos(th / 3) - a1 / 3;
  } else {
    const A = -Math.sign(R || 1) * Math.cbrt(Math.abs(R) + Math.sqrt(R * R - Q * Q * Q));
    const B = A !== 0 ? Q / A : 0;
    x = A + B - a1 / 3;
  }
  return polish([a, b, c, d], x);
}

/**
 * The quadratic factor a·X² + b2·X + c2 left after dividing the cubic by (X − x0).
 * Forward division (b2 = b + a·x0, c2 = c + b2·x0) is stable when x0 is the smallest root;
 * when |x0| > 1 it can cancel badly (X³ − 10⁶X² + 1 lost its two small roots), so the factor is then
 * read from the other end: c2 = −d / x0, b2 = (c2 − c) / x0.
 */
function deflate(a: number, b: number, c: number, d: number, x0: number): [number, number] {
  if (Math.abs(x0) > 1) {
    const c2 = -d / x0;
    return [(c2 - c) / x0, c2];
  }
  const b2 = b + a * x0;
  return [b2, c + b2 * x0];
}

/** Tries to turn a float root into an exact rational root of the exact cubic. */
function rationalRoot(coef: Rational[], x: number): Rational | null {
  const mag = Math.max(1, Math.abs(x));
  for (const tol of [1e-12, 1e-9, 1e-6, 1e-4]) {
    const cand = qApprox(x, 1e6, tol * mag);
    if (cand && qIsZero(qHorner(coef, cand))) return cand;
  }
  if (Math.abs(x) < 1e-4 && qIsZero(coef[coef.length - 1])) return ZERO_Q;
  return null;
}

/** Roots of aX³ + bX² + cX + d = 0 (a ≠ 0). */
export function solveCubic(a: number, b: number, c: number, d: number): CalcValue[] | CalcError {
  if (![a, b, c, d].every(Number.isFinite)) return 'Math ERROR';
  if (a === 0) return 'Math ERROR';
  const x0 = cubicRealRoot(a, b, c, d);
  const qs = toQ([a, b, c, d]);
  if (qs) {
    // Look for a rational root: the float root first, then the roots of the float deflation.
    const candidates = [x0];
    const [db, dc] = deflate(a, b, c, d, x0);
    const rest = fQuadratic(a, db, dc);
    for (const r of rest) if (r.t === 'real') candidates.push(polish([a, b, c, d], r.x));
    for (const x of candidates) {
      const r = rationalRoot(qs, x);
      if (!r) continue;
      // Exact synthetic division by (X − r).
      const b2 = qAdd(qs[1], qMul(qs[0], r));
      const c2 = qAdd(qs[2], qMul(b2, r));
      const roots = [realQ(r), ...qQuadratic(qs[0], b2, c2)];
      return sortRoots(dedupe(roots));
    }
  }
  const [b2, c2] = deflate(a, b, c, d, x0);
  const rest = fQuadratic(a, b2, c2).map((r) => (r.t === 'real' ? real(polish([a, b, c, d], r.x)) : r));
  return sortRoots(dedupe([real(x0), ...rest]));
}

/** Distinct real roots of a polynomial of degree 2 or 3 (coefficients from the highest power), ascending. */
export function polyRealRoots(coef: number[]): number[] | CalcError {
  const r = coef.length === 3 ? solveQuadratic(coef[0], coef[1], coef[2]) : coef.length === 4 ? solveCubic(coef[0], coef[1], coef[2], coef[3]) : 'Math ERROR';
  if (typeof r === 'string') return r;
  return r.filter((v): v is Extract<CalcValue, { t: 'real' }> => v.t === 'real').map((v) => v.x).sort((x, y) => x - y);
}

/** ModeHooks.eqnSolve. */
export function eqnSolve(kind: EqnKind, coef: number[]): { roots: CalcValue[] } | 'Infinite Sol' | 'No Solution' | CalcError {
  if (coef.length !== EQN_COEF_COUNT[kind] || !coef.every(Number.isFinite)) return 'Math ERROR';
  if (kind === 'lin2' || kind === 'lin3') {
    const n = kind === 'lin2' ? 2 : 3;
    const a: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const row = coef.slice(i * (n + 1), (i + 1) * (n + 1));
      a.push(row.slice(0, n));
      b.push(row[n]);
    }
    const r = solveLinear(a, b);
    if (typeof r === 'string') return r;
    return inRange(r.x.map((x, i) => (r.exact ? realQ(r.exact[i]) : real(x))));
  }
  const roots = kind === 'poly2' ? solveQuadratic(coef[0], coef[1], coef[2]) : solveCubic(coef[0], coef[1], coef[2], coef[3]);
  if (typeof roots === 'string') return roots;
  return inRange(roots);
}

/** The calculator range check on every root (overflow is Math ERROR, underflow becomes 0). */
function inRange(roots: CalcValue[]): { roots: CalcValue[] } | CalcError {
  const out: CalcValue[] = [];
  for (const r of roots) {
    const c = checkValue(r);
    if (typeof c === 'string') return c;
    out.push(c);
  }
  return { roots: out };
}

