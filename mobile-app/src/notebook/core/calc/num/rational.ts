/**
 * Exact rationals on bigint. Every function returns a normalized Rational (d > 0, reduced).
 * Values whose numerator or denominator reach 10^100 are "too big": callers drop the exact form
 * (fitsExact) and continue with the float.
 */
import type { Rational } from '../types.ts';

export const ZERO_Q: Rational = { n: 0n, d: 1n };
export const ONE_Q: Rational = { n: 1n, d: 1n };
/** Exact forms are dropped once a part reaches this size. */
export const EXACT_LIMIT = 10n ** 100n;

export function babs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Builds a normalized rational. Throws RangeError on a zero denominator (callers check first). */
export function q(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RangeError('zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { n: 0n, d: 1n };
  const g = bgcd(n, d);
  return g === 1n ? { n, d } : { n: n / g, d: d / g };
}

export function qInt(n: number | bigint): Rational {
  return { n: BigInt(n), d: 1n };
}

export function qIsZero(a: Rational): boolean {
  return a.n === 0n;
}

export function qIsInt(a: Rational): boolean {
  return a.d === 1n;
}

export function qSign(a: Rational): -1 | 0 | 1 {
  return a.n < 0n ? -1 : a.n > 0n ? 1 : 0;
}

export function qEq(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

export function qCmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function qAdd(a: Rational, b: Rational): Rational {
  if (a.d === b.d) return q(a.n + b.n, a.d);
  return q(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function qSub(a: Rational, b: Rational): Rational {
  return qAdd(a, qNeg(b));
}

export function qMul(a: Rational, b: Rational): Rational {
  return q(a.n * b.n, a.d * b.d);
}

/** a / b; null when b is zero. */
export function qDiv(a: Rational, b: Rational): Rational | null {
  if (b.n === 0n) return null;
  return q(a.n * b.d, a.d * b.n);
}

export function qNeg(a: Rational): Rational {
  return a.n === 0n ? a : { n: -a.n, d: a.d };
}

export function qAbs(a: Rational): Rational {
  return a.n < 0n ? { n: -a.n, d: a.d } : a;
}

/** 1 / a; null for zero. */
export function qInv(a: Rational): Rational | null {
  return qDiv(ONE_Q, a);
}

/** a^k for an integer k; null for 0^(k <= 0) or when the result would be too big. */
export function qPowInt(a: Rational, k: number): Rational | null {
  if (!Number.isInteger(k)) return null;
  if (k === 0) return a.n === 0n ? null : ONE_Q;
  if (a.n === 0n) return k > 0 ? ZERO_Q : null;
  const m = Math.abs(k);
  // Size guard: digits(n or d) * m must stay below the limit.
  const size = Math.max(digitCount(a.n), digitCount(a.d));
  if ((size - 1) * m > 100) return null;
  const big = BigInt(m);
  const r = q(a.n ** big, a.d ** big);
  if (!fitsExact(r)) return null;
  return k > 0 ? r : qInv(r);
}

/** Floor of a rational, as a bigint. */
export function qFloor(a: Rational): bigint {
  const t = a.n / a.d; // truncates toward zero
  return a.n < 0n && t * a.d !== a.n ? t - 1n : t;
}

/** Truncation toward zero. */
export function qTrunc(a: Rational): bigint {
  return a.n / a.d;
}

export function fitsExact(a: Rational): boolean {
  return babs(a.n) < EXACT_LIMIT && a.d < EXACT_LIMIT;
}

/** Number of decimal digits of |a| (0 has 1 digit). */
export function digitCount(a: bigint): number {
  return babs(a).toString().length;
}

/** Correctly rounded-ish float value (exact for safe integers; ~1 ulp otherwise). */
export function qToNumber(a: Rational): number {
  if (a.d === 1n) return Number(a.n);
  const nAbs = babs(a.n);
  if (nAbs <= 9007199254740991n && a.d <= 9007199254740991n) return Number(a.n) / Number(a.d);
  // Scale so the integer quotient carries about 20 significant digits.
  const shift = Math.max(0, 20 + digitCount(a.d) - digitCount(nAbs));
  const scaled = (nAbs * 10n ** BigInt(shift)) / a.d;
  const v = Number.parseFloat(`${scaled.toString()}e-${shift}`);
  return a.n < 0n ? -v : v;
}

/**
 * Parses a decimal literal ('12', '0.25', '.5', '3.') with an optional power-of-ten exponent.
 * Returns null for anything else (two dots, no digits).
 */
export function qFromDecimal(text: string, exp10: number = 0): Rational | null {
  if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return null;
  const dot = text.indexOf('.');
  const intPart = dot < 0 ? text : text.slice(0, dot);
  const fracPart = dot < 0 ? '' : text.slice(dot + 1);
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
  let n = BigInt(digits);
  let d = 10n ** BigInt(fracPart.length);
  if (exp10 > 0) n *= 10n ** BigInt(exp10);
  else if (exp10 < 0) d *= 10n ** BigInt(-exp10);
  return q(n, d);
}

/**
 * Exact rational of a finite float when it has a short decimal form (up to 15 significant digits),
 * e.g. 0.1 -> 1/10. Returns null for non-finite numbers.
 */
export function qFromNumber(x: number): Rational | null {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x) && Math.abs(x) <= Number.MAX_SAFE_INTEGER) return qInt(x);
  const s = x.toPrecision(15);
  const m = /^(-?)(\d+(?:\.\d+)?)(?:e([+-]\d+))?$/.exec(s);
  if (!m) return null;
  const r = qFromDecimal(m[2], m[3] ? Number(m[3]) : 0);
  if (!r) return null;
  return m[1] === '-' ? qNeg(r) : r;
}

/**
 * Best rational approximation of x with denominator <= maxDen (continued fractions).
 * Returns null when none is within tol (absolute).
 */
export function qApprox(x: number, maxDen: number, tol: number): Rational | null {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1n : 1n;
  let v = Math.abs(x);
  if (v > 1e15) return null;
  let h0 = 1n, h1 = 0n; // numerators
  let k0 = 0n, k1 = 1n; // denominators
  const maxD = BigInt(Math.floor(maxDen));
  let rem = v;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(rem);
    const ab = BigInt(a);
    const h2 = ab * h0 + h1;
    const k2 = ab * k0 + k1;
    if (k2 > maxD) break;
    h1 = h0; h0 = h2;
    k1 = k0; k0 = k2;
    if (Math.abs(Number(h0) / Number(k0) - v) <= tol) return q(sign * h0, k0);
    const f = rem - a;
    if (f < 1e-18) break;
    rem = 1 / f;
  }
  if (k0 > 0n && Math.abs(Number(h0) / Number(k0) - v) <= tol) return q(sign * h0, k0);
  return null;
}

/** Integer square root (floor) of a non-negative bigint. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('negative');
  if (n < 2n) return n;
  if (n <= 4503599627370496n) {
    // Below 2^52 the float square root is within one of the answer.
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (x * x > n) x -= 1n;
    while ((x + 1n) * (x + 1n) <= n) x += 1n;
    return x;
  }
  // Newton from above (2^(bits/2 + 1) > √n) decreases monotonically to the floor. This works for
  // values far past the float range, where Math.sqrt(Number(n)) would be Infinity.
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** Integer k-th root when n is a perfect k-th power (n may be negative for odd k), else null. */
export function exactIntRoot(n: bigint, k: number): bigint | null {
  if (k < 1 || !Number.isInteger(k)) return null;
  if (k === 1) return n;
  if (n < 0n) {
    if (k % 2 === 0) return null;
    const r = exactIntRoot(-n, k);
    return r === null ? null : -r;
  }
  if (n < 2n) return n;
  // n >= 2 has no exact k-th root once 2^k > n (and 2^k for a huge k would be a huge bigint).
  if (k > digitCount(n) * 4) return null;
  const guess = BigInt(Math.round(Math.pow(Number(n), 1 / k)));
  const kb = BigInt(k);
  for (const c of [guess - 1n, guess, guess + 1n]) {
    if (c >= 0n && c ** kb === n) return c;
  }
  return null;
}

/**
 * Splits n > 0 into s² · r with r square-free, by trial division up to `limit` (default 10^5).
 * Returns null when n has a factor above the limit that could hide a square (n too big to be sure).
 */
export function squareFree(n: bigint, limit: number = 100000): { s: bigint; r: bigint } | null {
  if (n <= 0n) return null;
  let s = 1n;
  let r = 1n;
  let m = n;
  const lim = BigInt(limit);
  for (let p = 2n; p <= lim && p * p <= m; p += p === 2n ? 1n : 2n) {
    if (m % p !== 0n) continue;
    let e = 0;
    while (m % p === 0n) {
      m /= p;
      e++;
    }
    if (e >= 2) s *= p ** BigInt(Math.floor(e / 2));
    if (e % 2 === 1) r *= p;
  }
  if (m > 1n) {
    // m has no factor <= limit. If m < limit² it is prime; otherwise it might be p² for a big prime.
    if (m >= lim * lim) {
      const sq = isqrt(m);
      if (sq * sq === m) return { s: s * sq, r };
      // m could still be p²·q; give up on exactness for such big numbers.
      if (m >= lim * lim * lim) return null;
    }
    r *= m;
  }
  return { s, r };
}

/** Factorial as a bigint. */
export function bfact(n: number): bigint {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}
