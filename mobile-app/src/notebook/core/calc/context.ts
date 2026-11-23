/**
 * Calculator contexts: defaults and pure updates (each returns a new context; the input is unchanged).
 */
import type { CalcContext, CalcMode, CalcSetup, CalcValue, MemName, StatData, VarName } from './types.ts';
import { VAR_NAMES } from './types.ts';
import { DEFAULT_SEED } from './random.ts';
import { ZERO, arith } from './num/value.ts';

/** SETUP defaults (CLR 1 Setup returns here). */
export const DEFAULT_SETUP: CalcSetup = {
  io: 'MthIO',
  angle: 'Deg',
  disp: { mode: 'Norm', n: 1 },
  frac: 'd/c',
  cmplx: 'a+bi',
  statFreq: false,
  table: 'f(x)',
  decimal: 'Dot',
  contrast: 5,
};

export function defaultSetup(): CalcSetup {
  return { ...DEFAULT_SETUP, disp: { ...DEFAULT_SETUP.disp } };
}

export function emptyStat(kind: StatData['kind'] = '1-VAR'): StatData {
  return { kind, x: [], y: [], freq: [] };
}

function zeroVars(): Record<VarName, CalcValue> {
  const v = {} as Record<VarName, CalcValue>;
  for (const n of VAR_NAMES) v[n] = ZERO;
  return v;
}

function emptyMem<T>(): Record<MemName, T | null> {
  return { A: null, B: null, C: null, Ans: null };
}

export function createContext(o: { mode?: CalcMode; setup?: CalcSetup; seed?: number } = {}): CalcContext {
  return {
    mode: o.mode ?? 'COMP',
    setup: o.setup ?? defaultSetup(),
    vars: zeroVars(),
    ans: ZERO,
    base: 10,
    mats: emptyMem(),
    vcts: emptyMem(),
    stat: emptyStat(),
    seed: (o.seed ?? DEFAULT_SEED) >>> 0,
  };
}

export function withVar(ctx: CalcContext, name: VarName, v: CalcValue): CalcContext {
  return { ...ctx, vars: { ...ctx.vars, [name]: v } };
}

/** Stores a result in Ans; a matrix also goes to MatAns and a vector to VctAns. */
export function withAns(ctx: CalcContext, v: CalcValue): CalcContext {
  const next: CalcContext = { ...ctx, ans: v };
  if (v.t === 'mat') next.mats = { ...ctx.mats, Ans: v };
  if (v.t === 'vct') next.vcts = { ...ctx.vcts, Ans: v };
  return next;
}

export function withMode(ctx: CalcContext, mode: CalcMode): CalcContext {
  return { ...ctx, mode };
}

export function withSetup(ctx: CalcContext, setup: CalcSetup): CalcContext {
  return { ...ctx, setup };
}

/** M+ (sign 1) or M− (sign −1): M = M ± v. Only real and complex values. */
export function memoryAdd(ctx: CalcContext, v: CalcValue, sign: 1 | -1): CalcContext | 'Math ERROR' {
  const r = arith(sign === 1 ? '+' : '-', ctx.vars.M, v);
  if (r === null || typeof r === 'string') return 'Math ERROR';
  return withVar(ctx, 'M', r);
}

/** CLR 2 Memory: variables A..F, X, Y, M, Ans and the matrix and vector memories. */
export function clearMemory(ctx: CalcContext): CalcContext {
  return { ...ctx, vars: zeroVars(), ans: ZERO, mats: emptyMem(), vcts: emptyMem() };
}

/** CLR 1 Setup. */
export function clearSetup(ctx: CalcContext): CalcContext {
  return { ...ctx, setup: defaultSetup() };
}

/** CLR 3 All: setup, memory, STAT data, BASE-N radix and mode COMP. The random state is kept. */
export function clearAll(ctx: CalcContext): CalcContext {
  return { ...createContext({ seed: ctx.seed }) };
}
