/**
 * RATIO (MODE 10): A:B = X:D and A:B = C:X.
 *
 * ratioSolve(kind, a, b, c) takes the three known values in editor order:
 *   'A:B=X:D'  (A, B, D)  ->  X = A·D / B   (B = 0 is Math ERROR)
 *   'A:B=C:X'  (A, B, C)  ->  X = B·C / A   (A = 0 is Math ERROR)
 */
import type { CalcError, RatioKind } from '../types.ts';
import { qDiv, qMul, qToNumber } from '../num/rational.ts';
import { exactQ } from './matrix.ts';

/** RATIO type menu, in menu order. */
export const RATIO_TYPE_MENU: RatioKind[] = ['A:B=X:D', 'A:B=C:X'];

/** The names of the three inputs of each type, in editor order. */
export const RATIO_INPUTS: Record<RatioKind, [string, string, string]> = {
  'A:B=X:D': ['A', 'B', 'D'],
  'A:B=C:X': ['A', 'B', 'C'],
};

function product(p: number, q: number, d: number): number | CalcError {
  if (d === 0) return 'Math ERROR';
  const qp = exactQ(p);
  const qq = exactQ(q);
  const qd = exactQ(d);
  if (qp && qq && qd) {
    const r = qDiv(qMul(qp, qq), qd);
    if (r) return qToNumber(r);
  }
  return (p * q) / d;
}

/** ModeHooks.ratioSolve. */
export function ratioSolve(kind: RatioKind, a: number, b: number, c: number): number | CalcError {
  if (![a, b, c].every(Number.isFinite)) return 'Math ERROR';
  const x = kind === 'A:B=X:D' ? product(a, c, b) : product(b, c, a);
  if (typeof x === 'string') return x;
  if (!Number.isFinite(x) || Math.abs(x) >= 1e100) return 'Math ERROR';
  return Math.abs(x) < 1e-99 ? 0 : x;
}
