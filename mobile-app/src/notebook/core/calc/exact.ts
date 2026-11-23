/**
 * Exact forms: fractions, surds (sums of c·√r) and π multiples.
 *
 * - The exact algebra (exAdd, exMul, exInv, exSqrt, exPowInt …) returns null when the result has no
 *   supported exact form, or when it gets too big; the caller then keeps only the float.
 * - exactTrig / exactInvTrig: exact values at multiples of 15° (sin 15° = (√6 − √2)/4 and so on).
 * - recognize(x): finds a short exact form of a float (display only, for results of functions and
 *   numeric methods: asin(0.5) in Rad -> π/6, 2^0.5 -> √2, ∫₀¹x² -> 1/3).
 * - S⇔D and a b/c ⇔ d/c helpers: displayableExact, toMixed.
 */
import type { Exact, Rational, SurdTerm } from './types.ts';
import {
  ONE_Q, ZERO_Q, fitsExact, q, qAdd, qApprox, qDiv, qEq, qInt, qIsInt, qMul, qNeg, qPowInt, qSign, qSub,
  qToNumber, squareFree, babs, digitCount, qFloor, isqrt,
} from './num/rational.ts';

const MAX_TERMS = 4;

export function exQ(r: Rational): Exact {
  return { k: 'q', q: r };
}

export function exInt(n: number | bigint): Exact {
  return { k: 'q', q: qInt(n) };
}

export function exPi(r: Rational): Exact {
  return r.n === 0n ? exQ(ZERO_Q) : { k: 'pi', q: r };
}

interface Terms {
  terms: SurdTerm[];
  pi: boolean;
}

function toTerms(e: Exact): Terms {
  if (e.k === 'q') return { terms: e.q.n === 0n ? [] : [{ c: e.q, r: 1n }], pi: false };
  if (e.k === 'pi') return { terms: e.q.n === 0n ? [] : [{ c: e.q, r: 1n }], pi: true };
  return { terms: e.terms, pi: false };
}

/** Merges equal radicands, drops zeros, sorts by r, and picks the simplest kind. */
function fromTerms(list: SurdTerm[], pi: boolean): Exact | null {
  const byR = new Map<bigint, Rational>();
  for (const t of list) {
    const prev = byR.get(t.r);
    byR.set(t.r, prev ? qAdd(prev, t.c) : t.c);
  }
  const terms: SurdTerm[] = [];
  for (const [r, c] of byR) {
    if (c.n === 0n) continue;
    if (!fitsExact(c)) return null;
    terms.push({ c, r });
  }
  terms.sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
  if (terms.length > MAX_TERMS) return null;
  if (terms.length === 0) return exQ(ZERO_Q);
  if (pi) {
    if (terms.length !== 1 || terms[0].r !== 1n) return null;
    return exPi(terms[0].c);
  }
  if (terms.length === 1 && terms[0].r === 1n) return exQ(terms[0].c);
  return { k: 'surd', terms };
}

/** The rational value of e, when it is one. */
export function exRational(e: Exact): Rational | null {
  if (e.k === 'q') return e.q;
  if (e.k === 'pi') return e.q.n === 0n ? ZERO_Q : null;
  return null;
}

export function exIsZero(e: Exact): boolean {
  const r = exRational(e);
  return r !== null && r.n === 0n;
}

export function exToNumber(e: Exact): number {
  if (e.k === 'q') return qToNumber(e.q);
  if (e.k === 'pi') return qToNumber(e.q) * Math.PI;
  return surdToNumber(e.terms);
}

function floatTerm(t: SurdTerm): number {
  return qToNumber(t.c) * (t.r === 1n ? 1 : Math.sqrt(Number(t.r)));
}

/**
 * The float of Σ c·√r. When all terms have one sign the float sum is accurate. Otherwise terms can
 * cancel (√(10¹⁶+1) − 10⁸ is about 5×10⁻⁹, which a float sum gets badly wrong), so the sum is
 * done in fixed point with bigints: each term c·√r = sign(c)·⌊√(c²·r·10²ᵖ)⌋ is off by less than one
 * unit of 10⁻ᵖ, so once |Σ| ≥ 10²⁰ units the result has far more than the 16 digits a float holds.
 * p doubles until then. A canonical surd (distinct square-free r, no zero c) is never 0, since
 * square roots of distinct square-free integers are linearly independent over the rationals.
 */
function surdToNumber(terms: SurdTerm[]): number {
  let float = 0;
  for (const t of terms) float += floatTerm(t);
  const sign = terms.length > 0 ? qSign(terms[0].c) : 0;
  if (terms.every((t) => qSign(t.c) === sign)) return float;
  for (let p = 40; p <= 2560; p *= 2) {
    const scale = 10n ** BigInt(p);
    let sum = 0n;
    for (const t of terms) {
      const n = babs(t.c.n);
      const mag = t.r === 1n ? (n * scale) / t.c.d : isqrt((n * n * t.r * scale * scale) / (t.c.d * t.c.d));
      sum += t.c.n < 0n ? -mag : mag;
    }
    if (babs(sum) >= 100000000000000000000n) {
      const v = Number.parseFloat(`${babs(sum).toString()}e-${p}`);
      return sum < 0n ? -v : v;
    }
  }
  return float;
}

export function exEq(a: Exact, b: Exact): boolean {
  const ta = toTerms(a);
  const tb = toTerms(b);
  if (ta.terms.length === 0 && tb.terms.length === 0) return true;
  if (ta.pi !== tb.pi || ta.terms.length !== tb.terms.length) return false;
  return ta.terms.every((t, i) => t.r === tb.terms[i].r && qEq(t.c, tb.terms[i].c));
}

export function exNeg(e: Exact): Exact {
  if (e.k === 'q') return exQ(qNeg(e.q));
  if (e.k === 'pi') return exPi(qNeg(e.q));
  return { k: 'surd', terms: e.terms.map((t) => ({ c: qNeg(t.c), r: t.r })) };
}

export function exAdd(a: Exact, b: Exact): Exact | null {
  const ta = toTerms(a);
  const tb = toTerms(b);
  if (ta.terms.length === 0) return b;
  if (tb.terms.length === 0) return a;
  if (ta.pi !== tb.pi) return null;
  return fromTerms([...ta.terms, ...tb.terms], ta.pi);
}

export function exSub(a: Exact, b: Exact): Exact | null {
  return exAdd(a, exNeg(b));
}

export function exMul(a: Exact, b: Exact): Exact | null {
  const ta = toTerms(a);
  const tb = toTerms(b);
  if (ta.terms.length === 0 || tb.terms.length === 0) return exQ(ZERO_Q);
  if (ta.pi && tb.pi) return null;
  const pi = ta.pi || tb.pi;
  const out: SurdTerm[] = [];
  for (const x of ta.terms) {
    for (const y of tb.terms) {
      // √r1·√r2 with both square-free: g = gcd, = g·√((r1/g)(r2/g)).
      let g = 1n;
      let r = x.r * y.r;
      if (x.r !== 1n && y.r !== 1n) {
        g = gcdB(x.r, y.r);
        r = (x.r / g) * (y.r / g);
      }
      out.push({ c: qMul(qMul(x.c, y.c), q(g)), r });
    }
  }
  return fromTerms(out, pi);
}

function gcdB(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** 1 / e. Surds with one or two terms are rationalized with the conjugate. */
export function exInv(e: Exact): Exact | null {
  if (e.k === 'q') {
    const r = qDiv(ONE_Q, e.q);
    return r ? exQ(r) : null;
  }
  if (e.k === 'pi') return null;
  const t = e.terms;
  if (t.length === 1) {
    // 1/(c√r) = √r / (c·r)
    const c = qDiv(ONE_Q, qMul(t[0].c, q(t[0].r)));
    return c ? fromTerms([{ c, r: t[0].r }], false) : null;
  }
  if (t.length === 2) {
    // (a√r + b√s)⁻¹ = (a√r − b√s) / (a²r − b²s)
    const den = qSub(qMul(qMul(t[0].c, t[0].c), q(t[0].r)), qMul(qMul(t[1].c, t[1].c), q(t[1].r)));
    if (den.n === 0n) return null;
    const k = qDiv(ONE_Q, den);
    if (!k) return null;
    return fromTerms([{ c: qMul(t[0].c, k), r: t[0].r }, { c: qNeg(qMul(t[1].c, k)), r: t[1].r }], false);
  }
  return null;
}

export function exDiv(a: Exact, b: Exact): Exact | null {
  // π / π and qπ / rπ are rational.
  if (a.k === 'pi' && b.k === 'pi') {
    const r = qDiv(a.q, b.q);
    return r ? exQ(r) : null;
  }
  if (b.k === 'pi') return exIsZero(a) && b.q.n !== 0n ? exQ(ZERO_Q) : null;
  const inv = exInv(b);
  return inv ? exMul(a, inv) : null;
}

/** √e for a non-negative rational e (and √(qπ²)-style forms are not supported). */
export function exSqrt(e: Exact): Exact | null {
  const r = exRational(e);
  if (!r || r.n < 0n) return null;
  if (r.n === 0n) return exQ(ZERO_Q);
  // √(n/d) = √(n·d) / d
  const prod = r.n * r.d;
  if (prod > 10n ** 30n) return null;
  const sf = squareFree(prod);
  if (!sf) return null;
  return fromTerms([{ c: q(sf.s, r.d), r: sf.r }], false);
}

/** k-th root of a rational when both parts are perfect k-th powers (∛(8/27) = 2/3). */
export function exRoot(e: Exact, k: number): Exact | null {
  if (k === 2) return exSqrt(e);
  const r = exRational(e);
  if (!r || !Number.isInteger(k) || k < 1) return null;
  if (r.n < 0n && k % 2 === 0) return null;
  const n = intRoot(r.n, k);
  const d = intRoot(r.d, k);
  return n !== null && d !== null ? exQ(q(n, d)) : null;
}

function intRoot(n: bigint, k: number): bigint | null {
  if (n < 0n) {
    const r = intRoot(-n, k);
    return r === null ? null : -r;
  }
  if (n < 2n) return n;
  // n >= 2 with at most 120 digits is below 2^400, so it has no exact k-th root for k > 400
  // (and 2^k for a huge k would be a huge bigint).
  if (digitCount(n) > 120 || k > 400) return null;
  const g = BigInt(Math.round(Math.pow(Number(n), 1 / k)));
  const kb = BigInt(k);
  for (const c of [g - 1n, g, g + 1n]) if (c >= 0n && c ** kb === n) return c;
  return null;
}

/** e^k for an integer k (|k| <= 64). */
export function exPowInt(e: Exact, k: number): Exact | null {
  if (!Number.isInteger(k) || Math.abs(k) > 64) return null;
  if (e.k === 'q') {
    const r = qPowInt(e.q, k);
    return r ? exQ(r) : null;
  }
  if (k === 0) return exQ(ONE_Q);
  if (k < 0) {
    const inv = exInv(e);
    return inv ? exPowInt(inv, -k) : null;
  }
  if (e.k === 'pi') return k === 1 ? e : null;
  let result: Exact = exQ(ONE_Q);
  let base: Exact = e;
  let m = k;
  while (m > 0) {
    if (m & 1) {
      const r = exMul(result, base);
      if (!r) return null;
      result = r;
    }
    m >>= 1;
    if (m > 0) {
      const b = exMul(base, base);
      if (!b) return null;
      base = b;
    }
  }
  return result;
}

/** Sign of an exact value (-1, 0, 1), computed from the float (exact forms are never ambiguous here). */
export function exSign(e: Exact): -1 | 0 | 1 {
  if (e.k === 'q') return qSign(e.q);
  if (e.k === 'pi') return qSign(e.q);
  const x = exToNumber(e);
  return x < 0 ? -1 : x > 0 ? 1 : 0;
}

// ===== exact trigonometry at multiples of 15°

const quarter = q(1n, 4n);
/** sin(15°·k) for k = 0..6. */
const SIN_TABLE: Exact[] = [
  exQ(ZERO_Q),
  { k: 'surd', terms: [{ c: qNeg(quarter), r: 2n }, { c: quarter, r: 6n }] },
  exQ(q(1n, 2n)),
  { k: 'surd', terms: [{ c: q(1n, 2n), r: 2n }] },
  { k: 'surd', terms: [{ c: q(1n, 2n), r: 3n }] },
  { k: 'surd', terms: [{ c: quarter, r: 2n }, { c: quarter, r: 6n }] },
  exQ(ONE_Q),
];

function sinStep(k: number): Exact {
  const m = ((k % 24) + 24) % 24;
  if (m <= 6) return SIN_TABLE[m];
  if (m <= 12) return SIN_TABLE[12 - m];
  return exNeg(sinStep(m - 12));
}

/** turn = angle / full turn. Returns null unless the angle is a multiple of 15°. */
function stepOf(turn: Rational): number | null {
  const t = qMul(turn, qInt(24));
  if (!qIsInt(t)) return null;
  const m = t.n % 24n;
  return Number(m < 0n ? m + 24n : m);
}

/** Exact sin, cos or tan at a multiple of 15°. 'undef' for tan at ±90°. null when not exact. */
export function exactTrig(fn: 'sin' | 'cos' | 'tan', turn: Rational): Exact | 'undef' | null {
  const k = stepOf(turn);
  if (k === null) return null;
  if (fn === 'sin') return sinStep(k);
  if (fn === 'cos') return sinStep(k + 6);
  const c = sinStep(k + 6);
  if (exIsZero(c)) return 'undef';
  return exDiv(sinStep(k), c);
}

/**
 * Exact inverse: the principal angle, as a fraction of a full turn, whose sin/cos/tan is e.
 * null when e is not one of the table values.
 */
export function exactInvTrig(fn: 'sin' | 'cos' | 'tan', e: Exact): Rational | null {
  const range = fn === 'sin' ? [-6, 6] : fn === 'cos' ? [0, 12] : [-5, 5];
  for (let k = range[0]; k <= range[1]; k++) {
    const v = fn === 'sin' ? sinStep(k) : fn === 'cos' ? sinStep(k + 6) : exactTrig('tan', q(BigInt(k), 24n));
    if (v && v !== 'undef' && exEq(v, e)) return q(BigInt(k), 24n);
  }
  return null;
}

// ===== recognition of floats (display only)

const SQUARE_FREE: bigint[] = (() => {
  const out: bigint[] = [];
  for (let r = 2; r < 200; r++) {
    let ok = true;
    for (let p = 2; p * p <= r; p++) if (r % (p * p) === 0) ok = false;
    if (ok) out.push(BigInt(r));
  }
  return out;
})();

/** Relative tolerance of recognition (about 100 ulp). */
export const RECOGNIZE_TOL = 2e-14;

/**
 * A short exact form of x, or null: a fraction (denominator <= 10000), c·√r (r < 200, square-free,
 * denominator of c <= 1000) or q·π (denominator <= 1000). Used only for display.
 */
export function recognize(x: number): Exact | null {
  if (!Number.isFinite(x)) return null;
  if (x === 0) return exQ(ZERO_Q);
  const ax = Math.abs(x);
  if (ax >= 1e15 || ax < 1e-10) return null;
  const tol = RECOGNIZE_TOL * ax;
  const r = qApprox(x, 10000, tol);
  if (r) return exQ(r);
  for (const rad of SQUARE_FREE) {
    const s = Math.sqrt(Number(rad));
    const c = qApprox(x / s, 1000, tol / s);
    if (c && babs(c.n) < 1000n) return { k: 'surd', terms: [{ c, r: rad }] };
  }
  const p = qApprox(x / Math.PI, 1000, tol / Math.PI);
  if (p && babs(p.n) < 10000n) return exPi(p);
  return null;
}

// ===== display limits (what the natural display can show)

/**
 * Whether an exact form fits the LCD:
 * - fractions: the digits of numerator and denominator (and the whole part for mixed) total at most 10;
 * - surd terms: |numerator| < 100, radicand < 1000, denominator < 100, at most 2 terms;
 * - π forms: |numerator| < 1000 and denominator < 1000.
 */
export function displayableExact(e: Exact, frac: 'ab/c' | 'd/c'): boolean {
  if (e.k === 'q') {
    if (qIsInt(e.q)) return true;
    if (frac === 'ab/c') {
      const m = toMixed(e.q);
      return digitCount(m.whole) + digitCount(m.num) + digitCount(m.den) <= (m.whole === 0n ? 9 : 10);
    }
    return digitCount(e.q.n) + digitCount(e.q.d) <= 10;
  }
  if (e.k === 'pi') return babs(e.q.n) < 1000n && e.q.d < 1000n;
  if (e.terms.length > 2) return false;
  return e.terms.every((t) =>
    t.r === 1n ? babs(t.c.n) < 1000n && t.c.d < 100n : babs(t.c.n) < 100n && t.c.d < 100n && t.r < 1000n,
  );
}

/** a b/c form of a rational: sign, whole part and proper fraction num/den (num >= 0). */
export function toMixed(r: Rational): { neg: boolean; whole: bigint; num: bigint; den: bigint } {
  const neg = r.n < 0n;
  const n = babs(r.n);
  return { neg, whole: n / r.d, num: n % r.d, den: r.d };
}

/** Rational from a b/c parts. */
export function fromMixed(whole: Rational, num: Rational, den: Rational): Rational | null {
  const f = qDiv(num, den);
  if (!f) return null;
  return whole.n < 0n ? qSub(whole, f) : qAdd(whole, f);
}

/** Exact value of an integer-valued rational floor (for Intg on exact values). */
export function exFloor(e: Exact): Exact | null {
  const r = exRational(e);
  return r ? exQ(qInt(qFloor(r))) : null;
}

/** A rational with a short decimal expansion (denominator 2^a·5^b), so S⇔D shows a decimal. */
export function isTerminating(r: Rational): boolean {
  let d = r.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}
