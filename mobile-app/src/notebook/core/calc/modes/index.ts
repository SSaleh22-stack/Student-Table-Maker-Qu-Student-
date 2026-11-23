/**
 * Calculator modes (NB-47a): MATRIX, VECTOR, CMPLX, BASE-N, STAT (regressions and distributions),
 * EQN, INEQ, TABLE, RATIO, CONST, CONV and DRG.
 *
 * installModes() registers modeOps with the engine (registry.setModeOps) and the CONST table
 * (registry.setConstTable). Call it once at start-up (P24 installCalc), before the first evaluate.
 *
 * ModeOps dispatch (the engine asks only for what it does not do itself):
 * - binary: a BASE-N value or a logic operator -> basen; a matrix -> matrix; a vector or '·' ->
 *   vector. Anything else is not ours (null, which the engine shows as Math ERROR).
 * - unary: matrices (det, Trn, Abs, x², x³, x⁻¹), vectors (Abs), ▶t (STAT), complex values
 *   (Rnd; the rest is Math ERROR), BASE-N (Not, Neg, ▶Dec, ▶Hex, ▶Bin, ▶Oct). det or Trn of a
 *   non-matrix is Math ERROR; Not, Neg and the radix conversions outside BASE-N are Syntax ERROR.
 */
import type { CalcContext, CalcError, CalcValue, FnName, ModeBinOp, ModeOps, PostOp, Radix, StatVar } from '../types.ts';
import { setConstTable, setModeOps } from '../registry.ts';
import { baseBinary, baseUnary, parseBase } from './basen.ts';
import { matBinary, matUnary } from './matrix.ts';
import { vctBinary, vctUnary } from './vector.ts';
import { cmplxUnary } from './cmplx.ts';
import { distrUnary } from './distr.ts';
import { statVarValue } from './stat.ts';
import { CONST_TABLE, constValue } from './const.ts';
import { conv } from './conv.ts';

export { modeHooks } from './hooks.ts';
export { BASE_LOGIC_MENU, RADIX_OF_SUFFIX, baseText, fitsRadix, radixName } from './basen.ts';
export { MAT_DIMS, isValidDims, zeroMat } from './matrix.ts';
export { VCT_DIMS, isValidDim, zeroVct } from './vector.ts';
export { CMPLX_MENU } from './cmplx.ts';
export { STAT_MAX_ROWS, STAT_MAX_ROWS_FREQ, STAT_MAX_ROWS_1VAR, STAT_MAX_ROWS_1VAR_FREQ, isPaired, statMaxRows, statMenus, type StatMenus } from './stat.ts';
export { DISTR_MENU } from './distr.ts';
export { EQN_COEF_COUNT, EQN_COLUMNS, EQN_GRID, EQN_TYPE_MENU, eqnRootNames } from './eqn.ts';
export { INEQ_REL_MENU, INEQ_TYPE_MENU, ineqSolveWith } from './ineq.ts';
export { TABLE_ERROR_CELL, TABLE_MAX_ROWS_F, TABLE_MAX_ROWS_FG, TABLE_TIME_LIMIT_MS, tableBuildWith, tableMaxRows } from './table.ts';
export { RATIO_INPUTS, RATIO_TYPE_MENU } from './ratio.ts';
export { CONST_TABLE } from './const.ts';
export { CONV_TABLE, convLabel } from './conv.ts';
export { DRG_MENU } from './drg.ts';

const RADIX_SUFFIXES: readonly (FnName | PostOp)[] = ['▶Dec', '▶Hex', '▶Bin', '▶Oct'];

function binary(op: ModeBinOp, a: CalcValue, b: CalcValue, ctx: CalcContext): CalcValue | CalcError | null {
  const logic = op === 'and' || op === 'or' || op === 'xor' || op === 'xnor';
  if (a.t === 'base' || b.t === 'base' || logic) return baseBinary(op, a, b, ctx);
  if (a.t === 'mat' || b.t === 'mat') return matBinary(op, a, b);
  if (a.t === 'vct' || b.t === 'vct' || op === '·') return vctBinary(op, a, b);
  return null;
}

function unary(name: FnName | PostOp, a: CalcValue, ctx: CalcContext): CalcValue | CalcError | null {
  if (a.t === 'base') return baseUnary(name, a, ctx);
  if (a.t === 'mat') return matUnary(name, a);
  if (a.t === 'vct') return vctUnary(name, a);
  if (name === '▶t') return distrUnary(name, a, ctx);
  if (name === 'det' || name === 'Trn') return 'Math ERROR';
  if (name === 'Not' || name === 'Neg' || RADIX_SUFFIXES.includes(name)) {
    return ctx.mode === 'BASE-N' ? baseUnary(name, a, ctx) : 'Syntax ERROR';
  }
  if (a.t === 'cplx') return cmplxUnary(name, a, ctx);
  return null;
}

/** The ModeOps registered with the engine. */
export const modeOps: ModeOps = {
  binary,
  unary,
  statVar(name: StatVar, ctx: CalcContext, arg?: number) {
    return statVarValue(name, ctx.stat, arg);
  },
  conv,
  constValue,
  parseBase(digits: string, base: Radix) {
    return parseBase(digits, base);
  },
};

/** Registers the modes with the engine (idempotent). */
export function installModes(): void {
  setModeOps(modeOps);
  setConstTable(CONST_TABLE);
}
