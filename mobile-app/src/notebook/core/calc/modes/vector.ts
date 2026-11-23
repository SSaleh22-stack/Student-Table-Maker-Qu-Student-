/**
 * VECTOR (MODE 8): VctA, VctB, VctC and VctAns with 2 or 3 elements.
 *
 * - + and −: same dimension (else Dimension ERROR).
 * - ×: scalar × vector, vector × scalar, and vector × vector = the cross product (2-element vectors
 *   give a 3-element result [0, 0, a1b2 − a2b1]).
 * - ÷: vector ÷ scalar. · (Dot): the dot product. Abs: the length.
 * Exact (rational) arithmetic is used whenever every element has a short decimal form.
 */
import type { CalcError, CalcValue, FnName, ModeBinOp, PostOp, Rational, VctValue } from '../types.ts';
import { real } from '../num/value.ts';
import { exQ, exSqrt } from '../exact.ts';
import { ZERO_Q, qAdd, qDiv, qMul, qSub, qToNumber } from '../num/rational.ts';
import { exactQ } from './matrix.ts';

export const VCT_DIMS = { min: 2, max: 3 } as const;

export function makeVct(v: number[]): VctValue {
  return { t: 'vct', v: v.map((x) => (x === 0 ? 0 : x)) };
}

export function zeroVct(dim: number): VctValue {
  return makeVct(Array.from({ length: dim }, () => 0));
}

export function isValidDim(dim: number): boolean {
  return Number.isInteger(dim) && dim >= VCT_DIMS.min && dim <= VCT_DIMS.max;
}

function toQ(v: number[]): Rational[] | null {
  const out: Rational[] = [];
  for (const x of v) {
    const r = exactQ(x);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

function fromQ(v: Rational[]): VctValue {
  return makeVct(v.map((x) => qToNumber(x)));
}

export function vctAddSub(op: '+' | '-', a: VctValue, b: VctValue): VctValue | CalcError {
  if (a.v.length !== b.v.length) return 'Dimension ERROR';
  const qa = toQ(a.v);
  const qb = toQ(b.v);
  if (qa && qb) return fromQ(qa.map((x, i) => (op === '+' ? qAdd(x, qb[i]) : qSub(x, qb[i]))));
  return makeVct(a.v.map((x, i) => (op === '+' ? x + b.v[i] : x - b.v[i])));
}

export function vctScale(a: VctValue, k: number): VctValue {
  const qa = toQ(a.v);
  const qk = exactQ(k);
  if (qa && qk) return fromQ(qa.map((x) => qMul(x, qk)));
  return makeVct(a.v.map((x) => x * k));
}

export function vctDivScalar(a: VctValue, k: number): VctValue | CalcError {
  if (k === 0) return 'Math ERROR';
  const qa = toQ(a.v);
  const qk = exactQ(k);
  if (qa && qk) return fromQ(qa.map((x) => qDiv(x, qk) ?? ZERO_Q));
  return makeVct(a.v.map((x) => x / k));
}

/** The dot product as a real value (exact when the elements are). */
export function vctDot(a: VctValue, b: VctValue): CalcValue | CalcError {
  if (a.v.length !== b.v.length) return 'Dimension ERROR';
  const qa = toQ(a.v);
  const qb = toQ(b.v);
  if (qa && qb) {
    const s = qa.reduce((acc, x, i) => qAdd(acc, qMul(x, qb[i])), ZERO_Q);
    return real(qToNumber(s), exQ(s));
  }
  return real(a.v.reduce((s, x, i) => s + x * b.v[i], 0));
}

/** The cross product (a 3-element vector). */
export function vctCross(a: VctValue, b: VctValue): VctValue | CalcError {
  if (a.v.length !== b.v.length) return 'Dimension ERROR';
  const pad = (v: number[]) => (v.length === 2 ? [v[0], v[1], 0] : v);
  const x = pad(a.v);
  const y = pad(b.v);
  const qx = toQ(x);
  const qy = toQ(y);
  if (qx && qy) {
    return fromQ([
      qSub(qMul(qx[1], qy[2]), qMul(qx[2], qy[1])),
      qSub(qMul(qx[2], qy[0]), qMul(qx[0], qy[2])),
      qSub(qMul(qx[0], qy[1]), qMul(qx[1], qy[0])),
    ]);
  }
  return makeVct([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]);
}

/** The length |a| (exact as a surd when the elements are rational: |[1,1]| = √2). */
export function vctAbs(a: VctValue): CalcValue {
  const qa = toQ(a.v);
  if (qa) {
    const s = qa.reduce((acc, x) => qAdd(acc, qMul(x, x)), ZERO_Q);
    const ex = exSqrt(exQ(s));
    if (ex) return real(Math.sqrt(qToNumber(s)), ex);
  }
  return real(Math.hypot(...a.v));
}

function scalarOf(v: CalcValue): number | CalcError | null {
  if (v.t === 'real') return v.x;
  if (v.t === 'cplx') return v.im === 0 ? v.re : 'Math ERROR';
  return null;
}

/** Binary operators with at least one vector operand. null when neither operand is a vector. */
export function vctBinary(op: ModeBinOp, a: CalcValue, b: CalcValue): CalcValue | CalcError | null {
  if (a.t !== 'vct' && b.t !== 'vct') return op === '·' ? 'Syntax ERROR' : null;
  if (a.t === 'vct' && b.t === 'vct') {
    if (op === '+' || op === '-') return vctAddSub(op, a, b);
    if (op === '×') return vctCross(a, b);
    if (op === '·') return vctDot(a, b);
    return 'Syntax ERROR';
  }
  const vct = a.t === 'vct' ? a : b.t === 'vct' ? b : null;
  if (!vct) return null;
  const k = scalarOf(a.t === 'vct' ? b : a);
  if (k === null) return 'Syntax ERROR';
  if (typeof k === 'string') return k;
  if (op === '×') return vctScale(vct, k);
  if (op === '÷' && a.t === 'vct') return vctDivScalar(vct, k);
  return 'Syntax ERROR';
}

/** Functions on a vector. null when a is not a vector. */
export function vctUnary(name: FnName | PostOp, a: CalcValue): CalcValue | CalcError | null {
  if (a.t !== 'vct') return null;
  if (name === 'Abs') return vctAbs(a);
  if (name === 'Neg') return vctScale(a, -1);
  return 'Math ERROR';
}
