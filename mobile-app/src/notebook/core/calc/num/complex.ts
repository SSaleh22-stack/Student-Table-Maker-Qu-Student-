/**
 * Complex numbers: float parts, plus an exact (Gaussian rational) track when both parts are rational.
 */
import type { Rational } from '../types.ts';
import { ZERO_Q, q, qAdd, qDiv, qMul, qNeg, qSub, fitsExact } from './rational.ts';

export interface C {
  re: number;
  im: number;
}

export interface CQ {
  re: Rational;
  im: Rational;
}

export function cAdd(a: C, b: C): C {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function cSub(a: C, b: C): C {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cMul(a: C, b: C): C {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** a / b; null when b is 0. Uses Smith's algorithm for stability. */
export function cDiv(a: C, b: C): C | null {
  if (b.re === 0 && b.im === 0) return null;
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const den = b.re + b.im * r;
    return { re: (a.re + a.im * r) / den, im: (a.im - a.re * r) / den };
  }
  const r = b.re / b.im;
  const den = b.re * r + b.im;
  return { re: (a.re * r + a.im) / den, im: (a.im * r - a.re) / den };
}

export function cNeg(a: C): C {
  return { re: -a.re, im: -a.im };
}

export function cAbs(a: C): number {
  return Math.hypot(a.re, a.im);
}

/** Argument in radians, in (−π, π]. */
export function cArg(a: C): number {
  if (a.re === 0 && a.im === 0) return 0;
  return Math.atan2(a.im, a.re);
}

export function cConj(a: C): C {
  return { re: a.re, im: -a.im };
}

export function cFromPolar(r: number, thetaRad: number): C {
  return { re: r * Math.cos(thetaRad), im: r * Math.sin(thetaRad) };
}

/** a^k for an integer k (binary powering); null for 0^(k <= 0). */
export function cPowInt(a: C, k: number): C | null {
  if (k === 0) return a.re === 0 && a.im === 0 ? null : { re: 1, im: 0 };
  if (k < 0) {
    const inv = cDiv({ re: 1, im: 0 }, a);
    return inv ? cPowInt(inv, -k) : null;
  }
  let result: C = { re: 1, im: 0 };
  let base = a;
  let m = k;
  while (m > 0) {
    if (m & 1) result = cMul(result, base);
    m = Math.floor(m / 2);
    if (m > 0) base = cMul(base, base);
  }
  return result;
}

/** Principal square root. */
export function cSqrt(a: C): C {
  if (a.im === 0) {
    return a.re >= 0 ? { re: Math.sqrt(a.re), im: 0 } : { re: 0, im: Math.sqrt(-a.re) };
  }
  const m = cAbs(a);
  const re = Math.sqrt((m + a.re) / 2);
  const im = Math.sign(a.im) * Math.sqrt((m - a.re) / 2);
  return { re, im };
}

// ===== exact Gaussian rationals

export function gAdd(a: CQ, b: CQ): CQ {
  return { re: qAdd(a.re, b.re), im: qAdd(a.im, b.im) };
}

export function gSub(a: CQ, b: CQ): CQ {
  return { re: qSub(a.re, b.re), im: qSub(a.im, b.im) };
}

export function gMul(a: CQ, b: CQ): CQ {
  return { re: qSub(qMul(a.re, b.re), qMul(a.im, b.im)), im: qAdd(qMul(a.re, b.im), qMul(a.im, b.re)) };
}

export function gNeg(a: CQ): CQ {
  return { re: qNeg(a.re), im: qNeg(a.im) };
}

export function gConj(a: CQ): CQ {
  return { re: a.re, im: qNeg(a.im) };
}

/** a / b; null when b is 0. */
export function gDiv(a: CQ, b: CQ): CQ | null {
  const den = qAdd(qMul(b.re, b.re), qMul(b.im, b.im));
  if (den.n === 0n) return null;
  const num = gMul(a, gConj(b));
  const re = qDiv(num.re, den);
  const im = qDiv(num.im, den);
  return re && im ? { re, im } : null;
}

export function gFits(a: CQ): boolean {
  return fitsExact(a.re) && fitsExact(a.im);
}

export const G_ZERO: CQ = { re: ZERO_Q, im: ZERO_Q };
export const G_I: CQ = { re: ZERO_Q, im: q(1n) };
