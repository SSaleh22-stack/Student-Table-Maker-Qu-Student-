/**
 * CMPLX (MODE 2). The engine itself does complex arithmetic, i, r∠θ entry, Abs, arg, Conjg,
 * ▶r∠θ, ▶a+bi, integer powers and √ of negative numbers. This file adds:
 * - the CMPLX menu (SHIFT 2) in menu order,
 * - what ModeOps.unary answers for the functions the reference does not offer on complex values
 *   (sin, log, x! …: Math ERROR), and Rnd (rounds both parts to the display),
 * - complexValue(), the root builder EQN uses (exact parts when both are rational).
 */
import type { CalcContext, CalcError, CalcValue, CplxValue, FnName, PostOp, Rational } from '../types.ts';
import { complex } from '../num/value.ts';
import { displayedRational, roundForDisplay } from '../format.ts';

/** SHIFT 2 (CMPLX) in menu order: 1 arg, 2 Conjg, 3 ▶r∠θ, 4 ▶a+bi. */
export const CMPLX_MENU = ['arg', 'Conjg', '▶r∠θ', '▶a+bi'] as const satisfies readonly (FnName | PostOp)[];

/** A complex value from float parts, keeping exact parts when both are known (EQN roots). */
export function complexValue(re: number, im: number, exactParts?: { re: Rational; im: Rational } | null): CalcValue {
  return complex(re, im, exactParts ?? null);
}

/** ModeOps.unary for a complex argument. null when a is not complex. */
export function cmplxUnary(name: FnName | PostOp, a: CalcValue, ctx: CalcContext): CalcValue | CalcError | null {
  if (a.t !== 'cplx') return null;
  if (name === 'Rnd') return roundComplex(a, ctx);
  return 'Math ERROR';
}

function roundComplex(a: CplxValue, ctx: CalcContext): CalcValue {
  const part = (x: number) => {
    const r = displayedRational(x, ctx.setup);
    return { x: roundForDisplay(x, ctx.setup), q: r };
  };
  const re = part(a.re);
  const im = part(a.im);
  const ex = re.q && im.q ? { re: re.q, im: im.q } : null;
  return complex(re.x, im.x, ex, a.polar);
}
