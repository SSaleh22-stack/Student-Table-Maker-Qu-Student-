/**
 * STAT Distr (1-VAR): P(t), Q(t), R(t) and the normalized variate x▶t.
 *
 * The engine evaluates P(, Q( and R( itself (functions.ts normalCdf); they are repeated here for
 * the mode tests and tools. ▶t needs the statistics data, so it goes through ModeOps.unary:
 * t = (x − x̄) / σx, using the population deviation, as on the reference.
 */
import type { CalcContext, CalcError, CalcValue, FnName, PostOp, StatData } from '../types.ts';
import { normalCdf } from '../functions.ts';
import { real } from '../num/value.ts';
import { statPoints } from './stat.ts';

/** The Distr page in menu order. */
export const DISTR_MENU = ['P(', 'Q(', 'R(', '▶t'] as const satisfies readonly (FnName | PostOp)[];

/** P(t) = Φ(t), the area left of t under the standard normal curve. */
export function distP(t: number): number {
  return normalCdf(t);
}

/** Q(t) = Φ(t) − 0.5, the area between 0 and t (negative for t < 0). */
export function distQ(t: number): number {
  return normalCdf(t) - 0.5;
}

/** R(t) = 1 − Φ(t), the area right of t. */
export function distR(t: number): number {
  return normalCdf(-t);
}

/** t = (x − x̄) / σx for the data, or null when σx is 0 or there is no data. */
export function normalizedVariate(x: number, data: StatData): number | null {
  const pts = statPoints(data);
  if (!pts || pts.length === 0) return null;
  let n = 0;
  let s = 0;
  for (const p of pts) {
    n += p.f;
    s += p.f * p.x;
  }
  if (!(n > 0)) return null;
  const mean = s / n;
  let ss = 0;
  for (const p of pts) ss += p.f * (p.x - mean) * (p.x - mean);
  const sigma = Math.sqrt(ss / n);
  if (sigma === 0) return null;
  const t = (x - mean) / sigma;
  return Number.isFinite(t) ? t : null;
}

/** ModeOps.unary for ▶t. null for every other name. */
export function distrUnary(name: FnName | PostOp, a: CalcValue, ctx: CalcContext): CalcValue | CalcError | null {
  if (name !== '▶t') return null;
  const x = a.t === 'real' ? a.x : a.t === 'cplx' && a.im === 0 ? a.re : null;
  if (x === null) return 'Math ERROR';
  const t = normalizedVariate(x, ctx.stat);
  return t === null ? 'Math ERROR' : real(t);
}
