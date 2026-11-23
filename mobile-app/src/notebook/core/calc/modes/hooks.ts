/**
 * modeHooks: the mode solvers and tables the key machine (P19) calls through setModeHooks.
 * P24 wires it once: installModes(); setModeHooks(modeHooks).
 */
import type { ModeHooks } from '../types.ts';
import { eqnSolve } from './eqn.ts';
import { ineqSolve } from './ineq.ts';
import { tableBuild } from './table.ts';
import { ratioSolve } from './ratio.ts';
import { statCompute } from './stat.ts';
import { CONST_TABLE } from './const.ts';
import { CONV_TABLE } from './conv.ts';

export const modeHooks: ModeHooks = {
  eqnSolve,
  ineqSolve,
  tableBuild,
  ratioSolve,
  statCompute,
  constTable: CONST_TABLE,
  convTable: CONV_TABLE,
  matDims: { min: 1, max: 3 },
  vctDims: { min: 2, max: 3 },
};
