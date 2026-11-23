/**
 * The functions and postfix operators the engine evaluates itself on real and complex values.
 * Each returns null when it is "not mine" (a matrix, vector, BASE-N value, or a mode-only function
 * such as det, Trn, Dot, Not, Neg, ▶t, ▶Dec): eval.ts then asks ModeOps.
 *
 * Angles: trig input and inverse-trig output follow SETUP angle. Multiples of 15° are exact.
 * Pol and Rec store their two results in X and Y. x! takes integers 0 to 69 (exact).
 */
import type { AngleUnit, CalcContext, CalcError, CalcValue, Exact, FnName, PostOp, Rational, RealValue } from './types.ts';
import {
  exNeg, exPi, exPowInt, exQ, exRational, exRoot, exSign, exSqrt, exToNumber, exactInvTrig, exactTrig,
} from './exact.ts';
import { ONE, ZERO, arith, checkValue, complex, isNumeric, real, realQ, toC, toCQ } from './num/value.ts';
import { cAbs, cArg, cPowInt, cSqrt, gConj, gDiv, gMul, type CQ } from './num/complex.ts';
import { ONE_Q, bfact, q, qAdd, qDiv, qFloor, qInt, qMul, qPowInt, qTrunc } from './num/rational.ts';
import { displayedRational, roundForDisplay } from './format.ts';
import { ranInt } from './random.ts';
import { withVar } from './context.ts';

/** A value, or a value plus the updated context (Pol, Rec, RanInt#), an error, or null (not mine). */
export type FnResult = CalcValue | { t: 'withCtx'; value: CalcValue; ctx: CalcContext } | CalcError | null;

const FULL_TURN: Record<AngleUnit, number> = { Deg: 360, Rad: 2 * Math.PI, Gra: 400 };
/** Largest |angle| trig accepts (Deg 9×10⁹, Rad 5×10⁷π, Gra 10¹⁰). */
const TRIG_LIMIT: Record<AngleUnit, number> = { Deg: 9e9, Rad: 5e7 * Math.PI, Gra: 1e10 };

/** The angle as a fraction of a full turn, exactly, when possible. */
export function turnOf(v: RealValue, unit: AngleUnit): Rational | null {
  if (!v.exact) return null;
  if (unit === 'Rad') {
    if (v.exact.k === 'pi') return qDiv(v.exact.q, qInt(2));
    const r = exRational(v.exact);
    return r && r.n === 0n ? r : null;
  }
  const r = exRational(v.exact);
  return r ? qDiv(r, qInt(unit === 'Deg' ? 360 : 400)) : null;
}

/** A full-turn fraction as an exact angle in unit. */
export function angleOfTurn(turn: Rational, unit: AngleUnit): Exact {
  if (unit === 'Rad') return exPi(qMul(turn, qInt(2)));
  return exQ(qMul(turn, qInt(unit === 'Deg' ? 360 : 400)));
}

export function toRadians(x: number, unit: AngleUnit): number {
  if (unit === 'Rad') return x;
  // Reduce first so large degree values keep their accuracy.
  const full = FULL_TURN[unit];
  const r = x % full;
  return (r / full) * 2 * Math.PI;
}

export function fromRadians(rad: number, unit: AngleUnit): number {
  return unit === 'Rad' ? rad : (rad / (2 * Math.PI)) * FULL_TURN[unit];
}

/** Converts an angle value from one unit to another (DRG ° ʳ ᵍ suffixes). */
export function convertAngle(v: RealValue, from: AngleUnit, to: AngleUnit): RealValue {
  if (from === to) return v;
  const turn = turnOf(v, from);
  if (turn) return real(0, angleOfTurn(turn, to));
  return real((v.x / FULL_TURN[from]) * FULL_TURN[to]);
}

function realArg(v: CalcValue): RealValue | null {
  if (v.t === 'real') return v;
  if (v.t === 'cplx' && v.im === 0) return real(v.re, v.exact ? exQ(v.exact.re) : null);
  return null;
}

function trig(fn: 'sin' | 'cos' | 'tan', v: RealValue, unit: AngleUnit, exact: boolean): CalcValue | CalcError {
  if (Math.abs(v.x) >= TRIG_LIMIT[unit]) return 'Math ERROR';
  const turn = exact ? turnOf(v, unit) : null;
  const t = turn ?? (unit === 'Rad' ? null : (() => {
    // Float input in Deg/Gra: exact table for whole multiples of 15° (or 50/3 grad).
    const steps = (v.x / FULL_TURN[unit]) * 24;
    return Number.isInteger(steps) ? q(BigInt(steps), 24n) : null;
  })());
  if (t) {
    const e = exactTrig(fn, t);
    if (e === 'undef') return 'Math ERROR';
    if (e) return exact ? real(0, e) : real(exToNumber(e));
  }
  const rad = toRadians(v.x, unit);
  const y = fn === 'sin' ? Math.sin(rad) : fn === 'cos' ? Math.cos(rad) : Math.tan(rad);
  return checkValue(real(y));
}

function invTrig(fn: 'sin' | 'cos' | 'tan', v: RealValue, unit: AngleUnit, exact: boolean): CalcValue | CalcError {
  if (fn !== 'tan' && Math.abs(v.x) > 1) return 'Math ERROR';
  if (exact && v.exact) {
    const turn = exactInvTrig(fn, v.exact);
    if (turn) return real(0, angleOfTurn(turn, unit));
  }
  const x = fn !== 'tan' ? Math.max(-1, Math.min(1, v.x)) : v.x;
  const rad = fn === 'sin' ? Math.asin(x) : fn === 'cos' ? Math.acos(x) : Math.atan(x);
  return real(fromRadians(rad, unit));
}

/** Standard normal CDF Φ(t), accurate to about 1e-15. */
export function normalCdf(t: number): number {
  return 0.5 * erfc(-t / Math.SQRT2);
}

function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 3) return 1 - erfSeries(x);
  // Continued fraction (modified Lentz) for x >= 3.
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 300; n++) {
    const an = n / 2;
    D = x + an * D;
    D = D === 0 ? tiny : D;
    C = x + an / C;
    C = C === 0 ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

function erfSeries(x: number): number {
  // erf(x) = 2/√π · e^{-x²} · Σ 2^n x^{2n+1} / (1·3·…·(2n+1))  (all terms positive: no cancellation)
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n++) {
    term *= (2 * x * x) / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
}

function realResult(x: number): CalcValue | CalcError {
  if (Number.isNaN(x)) return 'Math ERROR';
  return checkValue(real(x));
}

/** Exact log base b of x when x is b^k for a small integer k. */
function exactLog(x: Rational, b: Rational, approx: number): Exact | null {
  const k = Math.round(approx);
  if (Math.abs(approx - k) > 1e-9 || Math.abs(k) > 400) return null;
  const p = qPowInt(b, k);
  return p && p.n === x.n && p.d === x.d ? exQ(qInt(k)) : null;
}

function exactRational(v: RealValue, exact: boolean): Rational | null {
  return exact && v.exact ? exRational(v.exact) : null;
}

function integerOf(v: RealValue): number | null {
  const r = v.exact ? exRational(v.exact) : null;
  if (r) return r.d === 1n && r.n >= -9007199254740991n && r.n <= 9007199254740991n ? Number(r.n) : null;
  return Number.isInteger(v.x) ? v.x : null;
}

function sqrtValue(v: CalcValue, ctx: CalcContext, exact: boolean): CalcValue | CalcError | null {
  const r = realArg(v);
  if (r) {
    if (r.x >= 0) {
      const ex = exact && r.exact ? exSqrt(r.exact) : null;
      return real(Math.sqrt(r.x), ex);
    }
    if (ctx.mode !== 'CMPLX') return 'Math ERROR';
    const ex = exact && r.exact ? exSqrt(exNeg(r.exact)) : null;
    const exR = ex ? exRational(ex) : null;
    return complex(0, Math.sqrt(-r.x), exR ? { re: q(0n), im: exR } : null);
  }
  if (v.t === 'cplx') {
    const s = cSqrt(toC(v));
    return checkValue(complex(s.re, s.im));
  }
  return null;
}

export function nthRoot(x: RealValue, n: number, exact: boolean): CalcValue | CalcError {
  if (n === 0) return 'Math ERROR';
  if (x.x < 0 && !(Number.isInteger(n) && Math.abs(n) % 2 === 1)) return 'Math ERROR';
  if (Number.isInteger(n) && n > 0 && exact && x.exact) {
    const e = exRoot(x.exact, n);
    if (e) return real(0, e);
  }
  const mag = Math.pow(Math.abs(x.x), 1 / n);
  return realResult(x.x < 0 ? -mag : mag);
}

/** xʸ on real or complex values (complex: integer exponents). */
export function power(a: CalcValue, b: CalcValue, exact: boolean): CalcValue | CalcError | null {
  if (!isNumeric(a) || !isNumeric(b)) return null;
  const br = realArg(b);
  if (a.t === 'cplx' || !br) {
    if (!br || !Number.isInteger(br.x) || Math.abs(br.x) > 1000) return 'Math ERROR';
    const r = cPowInt(toC(a), br.x);
    if (!r) return 'Math ERROR';
    let ex: CQ | null = null;
    const qa = exact && isNumeric(a) ? toCQ(a) : null;
    if (qa && Math.abs(br.x) <= 32) {
      let acc: CQ | null = { re: ONE_Q, im: q(0n) };
      for (let i = 0; i < Math.abs(br.x) && acc; i++) acc = gMul(acc, qa);
      ex = acc && br.x < 0 ? gDiv({ re: ONE_Q, im: q(0n) }, acc) : acc;
    }
    return checkValue(complex(r.re, r.im, ex));
  }
  const ar = a as RealValue;
  const k = integerOf(br);
  if (ar.x === 0) {
    if (br.x > 0) return ZERO;
    return 'Math ERROR';
  }
  if (k !== null) {
    if (exact && ar.exact && Math.abs(k) <= 64) {
      const e = exPowInt(ar.exact, k);
      if (e && Math.abs(exToNumber(e)) < 1e100) return checkValue(real(0, e));
    }
    return realResult(Math.pow(ar.x, k));
  }
  // Rational exponent p/q: exact roots, and negative bases with odd q.
  const er = exactRational(br, exact);
  if (er && er.d === 1n) {
    // An integer exponent too big for a safe integer: floats only (the sign from its parity).
    if (ar.x < 0) {
      const m = Math.pow(-ar.x, br.x);
      return realResult(er.n % 2n !== 0n ? -m : m);
    }
    return realResult(Math.pow(ar.x, br.x));
  }
  if (er) {
    const qd = er.d;
    const pn = er.n;
    if (qd <= 99n) {
      const rootN = Number(qd);
      const root = nthRoot(ar, rootN, exact);
      if (typeof root === 'string') return root;
      return power(root, real(Number(pn), exQ(qInt(pn))), exact);
    }
  }
  if (ar.x < 0) return 'Math ERROR';
  return realResult(Math.pow(ar.x, br.x));
}

function nPrC(kind: 'nPr' | 'nCr', n: RealValue, r: RealValue): CalcValue | CalcError {
  const ni = integerOf(n);
  const ri = integerOf(r);
  if (ni === null || ri === null || ni < 0 || ri < 0 || ri > ni || ni >= 1e10) return 'Math ERROR';
  if (kind === 'nPr') {
    if (ri > 70) return 'Math ERROR';
    let p = 1n;
    for (let i = 0; i < ri; i++) p *= BigInt(ni - i);
    return checkValue(realQ(q(p)));
  }
  const k = Math.min(ri, ni - ri);
  if (k > 400) return 'Math ERROR';
  let c = 1n;
  for (let i = 1; i <= k; i++) c = (c * BigInt(ni - k + i)) / BigInt(i);
  return checkValue(realQ(q(c)));
}

/** nPr, nCr and the polar entry r∠θ (CMPLX). null for non-real operands. */
export function binaryFn(op: 'nPr' | 'nCr' | '∠', a: CalcValue, b: CalcValue, ctx: CalcContext, exact: boolean): CalcValue | CalcError | null {
  const ar = realArg(a);
  const br = realArg(b);
  if (!ar || !br) return null;
  if (op !== '∠') return nPrC(op, ar, br);
  if (ctx.mode !== 'CMPLX') return 'Syntax ERROR';
  const c = trig('cos', br, ctx.setup.angle, exact);
  const s = trig('sin', br, ctx.setup.angle, exact);
  if (typeof c === 'string' || typeof s === 'string') return 'Math ERROR';
  const re = arith('×', ar, c, exact);
  const im = arith('×', ar, s, exact);
  if (!re || !im || typeof re === 'string' || typeof im === 'string') return 'Math ERROR';
  const reQ = re.t === 'real' && re.exact ? exRational(re.exact) : null;
  const imQ = im.t === 'real' && im.exact ? exRational(im.exact) : null;
  return complex((re as RealValue).x, (im as RealValue).x, reQ && imQ ? { re: reQ, im: imQ } : null);
}

/**
 * Applies a function. args are the evaluated arguments (fn arity is checked by eval.ts).
 * Pol, Rec and RanInt# return an updated context.
 */
export function applyFn(name: FnName, args: CalcValue[], ctx: CalcContext, exact: boolean): FnResult {
  const unit = ctx.setup.angle;
  const a0 = args[0];
  const r0 = a0 ? realArg(a0) : null;
  switch (name) {
    case 'sin':
    case 'cos':
    case 'tan':
      return r0 ? trig(name, r0, unit, exact) : null;
    case 'sin⁻¹':
    case 'cos⁻¹':
    case 'tan⁻¹':
      return r0 ? invTrig(name === 'sin⁻¹' ? 'sin' : name === 'cos⁻¹' ? 'cos' : 'tan', r0, unit, exact) : null;
    case 'sinh':
      return r0 ? realResult(Math.sinh(r0.x)) : null;
    case 'cosh':
      return r0 ? realResult(Math.cosh(r0.x)) : null;
    case 'tanh':
      return r0 ? realResult(Math.tanh(r0.x)) : null;
    case 'sinh⁻¹':
      return r0 ? realResult(Math.asinh(r0.x)) : null;
    case 'cosh⁻¹':
      if (!r0) return null;
      return r0.x < 1 ? 'Math ERROR' : realResult(Math.acosh(r0.x));
    case 'tanh⁻¹':
      if (!r0) return null;
      return Math.abs(r0.x) >= 1 ? 'Math ERROR' : realResult(Math.atanh(r0.x));
    case 'log': {
      if (args.length === 2) {
        const b = realArg(args[0]);
        const x = realArg(args[1]);
        if (!b || !x) return null;
        if (b.x <= 0 || b.x === 1 || x.x <= 0) return 'Math ERROR';
        const y = Math.log(x.x) / Math.log(b.x);
        const qx = exactRational(x, exact);
        const qb = exactRational(b, exact);
        const ex = qx && qb ? exactLog(qx, qb, y) : null;
        return ex ? real(0, ex) : realResult(y);
      }
      if (!r0) return null;
      if (r0.x <= 0) return 'Math ERROR';
      const y = Math.log10(r0.x);
      const qx = exactRational(r0, exact);
      const ex = qx ? exactLog(qx, qInt(10), y) : null;
      return ex ? real(0, ex) : realResult(y);
    }
    case 'ln':
      if (!r0) return null;
      if (r0.x <= 0) return 'Math ERROR';
      if (r0.x === 1) return ZERO;
      return realResult(Math.log(r0.x));
    case '10^': {
      if (!r0) return null;
      const k = integerOf(r0);
      if (exact && k !== null && Math.abs(k) <= 99) return realQ(qPowInt(qInt(10), k) ?? ONE_Q);
      return power(real(10, exQ(qInt(10))), r0, exact);
    }
    case 'e^':
      if (!r0) return null;
      if (r0.x === 0) return ONE;
      return realResult(Math.exp(r0.x));
    case '√':
      return a0 ? sqrtValue(a0, ctx, exact) : null;
    case '∛':
      if (!r0) return null;
      return nthRoot(r0, 3, exact);
    case 'Abs': {
      if (r0) return real(Math.abs(r0.x), r0.exact && exSign(r0.exact) < 0 ? exNeg(r0.exact) : r0.exact);
      if (a0 && a0.t === 'cplx') {
        const ex = exact && a0.exact ? exSqrt(exQ(qAddSquares(a0.exact))) : null;
        return real(cAbs(toC(a0)), ex);
      }
      return null;
    }
    case 'arg': {
      if (r0) return r0.x < 0 ? real(0, angleOfTurn(q(1n, 2n), unit)) : ZERO;
      if (a0 && a0.t === 'cplx') {
        const c = toC(a0);
        const t = exact && a0.exact ? polarTurn(a0.exact) : null;
        return t ? real(0, angleOfTurn(t, unit)) : real(fromRadians(cArg(c), unit));
      }
      return null;
    }
    case 'Conjg':
      if (r0) return r0;
      if (a0 && a0.t === 'cplx') return complex(a0.re, -a0.im, a0.exact ? gConj(a0.exact) : null);
      return null;
    case 'Pol': {
      const x = realArg(args[0]);
      const y = realArg(args[1]);
      if (!x || !y) return null;
      const r = Math.hypot(x.x, y.x);
      let rv: RealValue = real(r);
      const qx = exactRational(x, exact);
      const qy = exactRational(y, exact);
      if (qx && qy) {
        const ex = exSqrt(exQ(qAddSquares({ re: qx, im: qy })));
        if (ex) rv = real(0, ex);
      }
      let th: RealValue;
      const t = qx && qy ? polarTurn({ re: qx, im: qy }) : null;
      if (t) th = real(0, angleOfTurn(t, unit));
      else th = real(x.x === 0 && y.x === 0 ? 0 : fromRadians(Math.atan2(y.x, x.x), unit));
      const next = withVar(withVar(ctx, 'X', rv), 'Y', th);
      return { t: 'withCtx', value: { t: 'pair', kind: 'pol', a: rv.x, b: th.x }, ctx: next };
    }
    case 'Rec': {
      const r = realArg(args[0]);
      const th = realArg(args[1]);
      if (!r || !th) return null;
      const c = trig('cos', th, unit, exact);
      const s = trig('sin', th, unit, exact);
      if (typeof c === 'string' || typeof s === 'string') return 'Math ERROR';
      const xv = arith('×', r, c, exact);
      const yv = arith('×', r, s, exact);
      if (!xv || !yv || typeof xv === 'string' || typeof yv === 'string') return 'Math ERROR';
      const next = withVar(withVar(ctx, 'X', xv), 'Y', yv);
      return { t: 'withCtx', value: { t: 'pair', kind: 'rec', a: (xv as RealValue).x, b: (yv as RealValue).x }, ctx: next };
    }
    case 'Rnd': {
      if (!r0) return null;
      const rq = displayedRational(r0.x, ctx.setup);
      return rq ? realQ(rq) : real(roundForDisplay(r0.x, ctx.setup));
    }
    case 'RanInt#': {
      const a = realArg(args[0]);
      const b = realArg(args[1]);
      if (!a || !b) return null;
      const ai = integerOf(a);
      const bi = integerOf(b);
      if (ai === null || bi === null || ai >= bi || bi - ai >= 1e10) return 'Math ERROR';
      const d = ranInt(ai, bi, ctx.seed);
      return { t: 'withCtx', value: realQ(qInt(d.value)), ctx: { ...ctx, seed: d.seed } };
    }
    case 'Int': {
      if (!r0) return null;
      const rq = exactRational(r0, exact);
      return rq ? realQ(qInt(qTrunc(rq))) : real(Math.trunc(r0.x));
    }
    case 'Intg': {
      if (!r0) return null;
      const rq = exactRational(r0, exact);
      return rq ? realQ(qInt(qFloor(rq))) : real(Math.floor(r0.x));
    }
    case 'P(':
      return r0 ? realResult(normalCdf(r0.x)) : null;
    case 'Q(':
      return r0 ? realResult(normalCdf(r0.x) - 0.5) : null;
    case 'R(':
      // 1 − Φ(t) = Φ(−t), without the cancellation for large t.
      return r0 ? realResult(normalCdf(-r0.x)) : null;
    case 'det':
    case 'Trn':
    case 'Dot':
    case 'Not':
    case 'Neg':
      return null;
  }
}

function qAddSquares(z: CQ): Rational {
  return qAdd(qMul(z.re, z.re), qMul(z.im, z.im));
}

/** Exact argument (as a turn fraction) of a Gaussian rational at a multiple of 15°. */
function polarTurn(z: CQ): Rational | null {
  if (z.re.n === 0n && z.im.n === 0n) return q(0n);
  // tan θ = im/re with the quadrant from the signs.
  if (z.re.n === 0n) return q(z.im.n > 0n ? 1n : -1n, 4n);
  const t = qDiv(z.im, z.re);
  if (!t) return null;
  const base = exactInvTrig('tan', exQ(t));
  if (!base) {
    // tan θ may be a surd (e.g. √3) only when parts are surds; rational parts give 0 or ±1 here.
    return null;
  }
  if (z.re.n > 0n) return base;
  // Second or third quadrant: add or subtract half a turn.
  return z.im.n >= 0n ? qAdd(base, q(1n, 2n)) : qAdd(base, q(-1n, 2n));
}


/** Postfix operators on real and complex values. null = not mine. */
export function applyPost(op: PostOp, a: CalcValue, ctx: CalcContext, exact: boolean): CalcValue | CalcError | null {
  const r = realArg(a);
  switch (op) {
    case '!': {
      if (!r) return null;
      const n = integerOf(r);
      if (n === null || n < 0 || n > 69) return 'Math ERROR';
      return realQ(q(bfact(n)));
    }
    case '%':
      if (!isNumeric(a)) return null;
      return arith('÷', a, realQ(qInt(100)), exact);
    case '⁻¹':
      if (!isNumeric(a)) return null;
      return arith('÷', ONE, a, exact);
    case '²':
      if (!isNumeric(a)) return null;
      return arith('×', a, a, exact);
    case '³': {
      if (!isNumeric(a)) return null;
      const sq = arith('×', a, a, exact);
      if (!sq || typeof sq === 'string') return sq;
      return arith('×', sq, a, exact);
    }
    case '°':
      return r ? convertAngle(r, 'Deg', ctx.setup.angle) : null;
    case 'ʳ':
      return r ? convertAngle(r, 'Rad', ctx.setup.angle) : null;
    case 'ᵍ':
      return r ? convertAngle(r, 'Gra', ctx.setup.angle) : null;
    case '▶r∠θ':
      if (a.t === 'real') return complex(a.x, 0, a.exact && exRational(a.exact) ? { re: exRational(a.exact) as Rational, im: q(0n) } : null, true);
      if (a.t === 'cplx') return { ...a, polar: true };
      return null;
    case '▶a+bi':
      if (a.t === 'real') return a;
      if (a.t === 'cplx') {
        const { polar: _p, ...rest } = a;
        void _p;
        return rest;
      }
      return null;
    case '▶t':
    case '▶Dec':
    case '▶Hex':
    case '▶Bin':
    case '▶Oct':
      return null;
  }
}
