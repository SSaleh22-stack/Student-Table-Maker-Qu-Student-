/**
 * INEQ (MODE 9): quadratic and cubic inequalities aX² + bX + c ⋚ 0 and aX³ + bX² + cX + d ⋚ 0.
 *
 * The solution is written as pieces, one string each, the way the reference shows them:
 *   'x<1', '3<x', '1<x<3', 'x≤−1', '−1≤x≤1', 'x=2', 'x≠2', 'All Real Numbers', 'No Solution'.
 * Numbers are formatted like table cells (formatCell) with the given setup, so 1+√2 shows as a surd
 * in MthIO. a = 0 is Math ERROR.
 */
import type { CalcError, CalcSetup, IneqRel } from '../types.ts';
import { defaultSetup } from '../context.ts';
import { formatCell } from '../format.ts';
import { polyRealRoots } from './eqn.ts';

/** INEQ type menu (MODE 9): degree 2 or 3. */
export const INEQ_TYPE_MENU: { deg: 2 | 3; label: string }[] = [
  { deg: 2, label: 'aX²+bX+c' },
  { deg: 3, label: 'aX³+bX²+cX+d' },
];

/** INEQ relation menu, in menu order. */
export const INEQ_REL_MENU: IneqRel[] = ['>', '<', '≥', '≤'];

export const ALL_REAL = 'All Real Numbers';
export const NO_SOLUTION = 'No Solution';

/** One piece of the solution set: an interval (null end = infinite) or a single point. */
export interface IneqPiece {
  lo: number | null;
  loClosed: boolean;
  hi: number | null;
  hiClosed: boolean;
}

function horner(coef: number[], x: number): number {
  return coef.reduce((s, k) => s * x + k, 0);
}

function holds(v: number, rel: IneqRel): boolean {
  switch (rel) {
    case '>':
      return v > 0;
    case '<':
      return v < 0;
    case '≥':
      return v >= 0;
    case '≤':
      return v <= 0;
  }
}

/**
 * The solution set as pieces, from left to right. [] = no solution; one piece with both ends null =
 * every real number.
 */
export function ineqPieces(deg: 2 | 3, coef: number[], rel: IneqRel): IneqPiece[] | CalcError {
  if (coef.length !== deg + 1 || !coef.every(Number.isFinite)) return 'Math ERROR';
  if (coef[0] === 0) return 'Math ERROR';
  const roots = polyRealRoots(coef);
  if (typeof roots === 'string') return roots;
  const strict = rel === '>' || rel === '<';
  // Segments of the line: open interval 0, root 0, open interval 1, …, root k−1, open interval k.
  type Seg = { kind: 'gap'; lo: number | null; hi: number | null; on: boolean } | { kind: 'root'; x: number; on: boolean };
  const segs: Seg[] = [];
  const sample = (lo: number | null, hi: number | null): number => {
    if (lo === null) return hi === null ? 0 : hi - Math.max(1, Math.abs(hi));
    if (hi === null) return lo + Math.max(1, Math.abs(lo));
    return (lo + hi) / 2;
  };
  for (let i = 0; i <= roots.length; i++) {
    const lo = i === 0 ? null : roots[i - 1];
    const hi = i === roots.length ? null : roots[i];
    segs.push({ kind: 'gap', lo, hi, on: holds(horner(coef, sample(lo, hi)), rel) });
    if (i < roots.length) segs.push({ kind: 'root', x: roots[i], on: !strict });
  }
  const pieces: IneqPiece[] = [];
  let cur: IneqPiece | null = null;
  for (const s of segs) {
    if (!s.on) {
      if (cur) pieces.push(cur);
      cur = null;
      continue;
    }
    if (s.kind === 'gap') {
      if (!cur) cur = { lo: s.lo, loClosed: false, hi: s.hi, hiClosed: false };
      else {
        cur.hi = s.hi;
        cur.hiClosed = false;
      }
    } else if (!cur) cur = { lo: s.x, loClosed: true, hi: s.x, hiClosed: true };
    else {
      cur.hi = s.x;
      cur.hiClosed = true;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/** The text lines of a solution set. */
export function ineqText(pieces: IneqPiece[], setup: CalcSetup): string[] {
  if (pieces.length === 0) return [NO_SOLUTION];
  if (pieces.length === 1 && pieces[0].lo === null && pieces[0].hi === null) return [ALL_REAL];
  const num = (x: number) => formatCell(x, setup);
  // Everything except one point: 'x≠r'.
  if (
    pieces.length === 2 &&
    pieces[0].lo === null &&
    pieces[1].hi === null &&
    pieces[0].hi !== null &&
    pieces[0].hi === pieces[1].lo &&
    !pieces[0].hiClosed &&
    !pieces[1].loClosed
  ) {
    return [`x≠${num(pieces[0].hi)}`];
  }
  return pieces.map((p) => {
    if (p.lo !== null && p.hi !== null && p.lo === p.hi) return `x=${num(p.lo)}`;
    const left = p.lo === null ? '' : `${num(p.lo)}${p.loClosed ? '≤' : '<'}`;
    const right = p.hi === null ? '' : `${p.hiClosed ? '≤' : '<'}${num(p.hi)}`;
    return `${left}x${right}`;
  });
}

/** ineqSolve with an explicit setup (number format and decimal mark). */
export function ineqSolveWith(deg: 2 | 3, coef: number[], rel: IneqRel, setup: CalcSetup): { text: string[] } | CalcError {
  const pieces = ineqPieces(deg, coef, rel);
  if (typeof pieces === 'string') return pieces;
  return { text: ineqText(pieces, setup) };
}

/** ModeHooks.ineqSolve: formats with the default setup (MthIO, Norm 1, dot). */
export function ineqSolve(deg: 2 | 3, coef: number[], rel: IneqRel): { text: string[] } | CalcError {
  return ineqSolveWith(deg, coef, rel, defaultSetup());
}
