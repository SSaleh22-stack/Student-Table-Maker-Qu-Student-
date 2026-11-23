/**
 * CalcValue constructors, range checks and the core arithmetic on real and complex values.
 * Matrices, vectors and BASE-N values are not handled here (arith returns null: ask ModeOps).
 */
import type { CalcError, CalcValue, CplxValue, Exact, Rational, RealValue } from '../types.ts';
import { exAdd, exDiv, exMul, exNeg, exQ, exRational, exSub, exToNumber } from '../exact.ts';
import { cAdd, cDiv, cMul, cSub, gAdd, gDiv, gFits, gMul, gSub, type C, type CQ } from './complex.ts';
import { ZERO_Q, fitsExact, qToNumber } from './rational.ts';

/** The calculator's range: |x| < 10^100. Smaller than 10^-99 reads as 0. */
export const MAX_ABS = 1e100;
export const MIN_ABS = 1e-99;

function exactFits(e: Exact): boolean {
  if (e.k === 'q' || e.k === 'pi') return fitsExact(e.q);
  return e.terms.every((t) => fitsExact(t.c));
}

/** A real value. When exact is given (and fits), x is recomputed from it. */
export function real(x: number, exact?: Exact | null): RealValue {
  if (exact && exactFits(exact)) {
    const ex = exToNumber(exact);
    return { t: 'real', x: ex === 0 ? 0 : ex, exact };
  }
  return { t: 'real', x: x === 0 ? 0 : x };
}

export function realQ(r: Rational): RealValue {
  return real(qToNumber(r), exQ(r));
}

export const ZERO: RealValue = { t: 'real', x: 0, exact: { k: 'q', q: ZERO_Q } };
export const ONE: RealValue = { t: 'real', x: 1, exact: { k: 'q', q: { n: 1n, d: 1n } } };

/**
 * A complex value. A zero imaginary part collapses to a real (unless polar is asked for,
 * since ▶r∠θ of a real still shows r∠θ).
 */
export function complex(re: number, im: number, exact?: CQ | null, polar?: boolean): CalcValue {
  const ex = exact && gFits(exact) ? exact : undefined;
  const r = ex ? qToNumber(ex.re) : re;
  const i = ex ? qToNumber(ex.im) : im;
  if (i === 0 && !polar) return real(r, ex ? exQ(ex.re) : undefined);
  const v: CplxValue = { t: 'cplx', re: r === 0 ? 0 : r, im: i === 0 ? 0 : i };
  if (ex) v.exact = ex;
  if (polar) v.polar = true;
  return v;
}

export function isNumeric(v: CalcValue): v is RealValue | CplxValue {
  return v.t === 'real' || v.t === 'cplx';
}

export function isReal(v: CalcValue): v is RealValue {
  return v.t === 'real';
}

/** The real number of v (a real, or a complex with zero imaginary part), else null. */
export function realOf(v: CalcValue): number | null {
  if (v.t === 'real') return v.x;
  if (v.t === 'cplx' && v.im === 0) return v.re;
  return null;
}

export function toC(v: RealValue | CplxValue): C {
  return v.t === 'real' ? { re: v.x, im: 0 } : { re: v.re, im: v.im };
}

/** Exact Gaussian rational of v, when both parts are rational. */
export function toCQ(v: RealValue | CplxValue): CQ | null {
  if (v.t === 'real') {
    const r = v.exact ? exRational(v.exact) : null;
    return r ? { re: r, im: ZERO_Q } : null;
  }
  return v.exact ?? null;
}

function checkNum(x: number): number | null {
  if (!Number.isFinite(x) || Math.abs(x) >= MAX_ABS) return null;
  return Math.abs(x) < MIN_ABS ? 0 : x;
}

/** Range check: overflow (or NaN) is Math ERROR, underflow becomes 0. */
export function checkValue(v: CalcValue): CalcValue | CalcError {
  switch (v.t) {
    case 'real': {
      const x = checkNum(v.x);
      if (x === null) return 'Math ERROR';
      return x === v.x ? v : real(x);
    }
    case 'cplx': {
      const re = checkNum(v.re);
      const im = checkNum(v.im);
      if (re === null || im === null) return 'Math ERROR';
      return re === v.re && im === v.im ? v : complex(re, im, null, v.polar);
    }
    case 'mat':
      return v.m.every((row) => row.every((x) => checkNum(x) !== null)) ? v : 'Math ERROR';
    case 'vct':
      return v.v.every((x) => checkNum(x) !== null) ? v : 'Math ERROR';
    case 'pair':
      return checkNum(v.a) !== null && checkNum(v.b) !== null ? v : 'Math ERROR';
    case 'base':
      return Number.isFinite(v.n) ? v : 'Math ERROR';
  }
}

export type CoreOp = '+' | '-' | '×' | '÷';

/**
 * Core arithmetic on real and complex values. null when an operand is not real or complex.
 * exact = false skips the exact track (used by numeric methods).
 */
export function arith(op: CoreOp, a: CalcValue, b: CalcValue, exact: boolean = true): CalcValue | CalcError | null {
  if (!isNumeric(a) || !isNumeric(b)) return null;
  if (a.t === 'real' && b.t === 'real') {
    if (op === '÷' && b.x === 0) return 'Math ERROR';
    let ex: Exact | null = null;
    if (exact && a.exact && b.exact) {
      ex = op === '+' ? exAdd(a.exact, b.exact) : op === '-' ? exSub(a.exact, b.exact) : op === '×' ? exMul(a.exact, b.exact) : exDiv(a.exact, b.exact);
    }
    const x = op === '+' ? a.x + b.x : op === '-' ? a.x - b.x : op === '×' ? a.x * b.x : a.x / b.x;
    return checkValue(real(x, ex));
  }
  const ca = toC(a);
  const cb = toC(b);
  let r: C | null;
  if (op === '+') r = cAdd(ca, cb);
  else if (op === '-') r = cSub(ca, cb);
  else if (op === '×') r = cMul(ca, cb);
  else r = cDiv(ca, cb);
  if (!r) return 'Math ERROR';
  let ex: CQ | null = null;
  const qa = exact ? toCQ(a) : null;
  const qb = exact ? toCQ(b) : null;
  if (qa && qb) ex = op === '+' ? gAdd(qa, qb) : op === '-' ? gSub(qa, qb) : op === '×' ? gMul(qa, qb) : gDiv(qa, qb);
  return checkValue(complex(r.re, r.im, ex));
}

export function negate(a: CalcValue): CalcValue | null {
  if (a.t === 'real') return real(-a.x, a.exact ? exNeg(a.exact) : null);
  if (a.t === 'cplx') {
    const ex = a.exact ? { re: { n: -a.exact.re.n, d: a.exact.re.d }, im: { n: -a.exact.im.n, d: a.exact.im.d } } : null;
    return complex(-a.re, -a.im, ex, a.polar);
  }
  return null;
}

/** Drops the exact track (numeric methods work on floats). */
export function floatOnly(v: CalcValue): CalcValue {
  if (v.t === 'real' && v.exact) return { t: 'real', x: v.x };
  if (v.t === 'cplx' && v.exact) return { t: 'cplx', re: v.re, im: v.im, ...(v.polar ? { polar: true } : {}) };
  return v;
}
