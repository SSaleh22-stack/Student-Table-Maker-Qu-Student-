/**
 * Calculator history and persistence.
 *
 * - persist(s): the MachinePersist of a state (mode, setup, context, the last 30 history entries).
 * - encodePersist(p): JSON-safe copy. Every Rational becomes RationalJson { n, d } with decimal
 *   strings, and a surd term's r becomes a decimal string, in vars, Ans, matrices, vectors and the
 *   history. JSON.stringify of the result never throws.
 * - decodePersist(raw): validates anything (usually JSON.parse output), rebuilds the bigints and
 *   replaces every invalid part with its default. It never throws; garbage gives a fresh machine.
 */
import type {
  AngleUnit, CalcContext, CalcMode, CalcSetup, CalcValue, DispFormat, Exact, MachinePersist, MachineState, MathNode, MathRow,
  MatValue, MemName, Radix, Rational, StatData, SurdTerm, VarName, VctValue,
} from '../types.ts';
import { BIN_OPS, CALC_MODES, FN_NAMES, MEM_NAMES, POST_OPS, STAT_KINDS, STAT_VARS, VAR_NAMES } from '../types.ts';
import { createContext, defaultSetup, emptyStat } from '../context.ts';
import { DEFAULT_SEED } from '../random.ts';
import { ZERO } from '../num/value.ts';

/** History entries kept (in memory and persisted). */
export const HISTORY_MAX = 30;

export type HistoryEntry = { input: MathRow; result: string };

/** history with one more entry, trimmed to the last HISTORY_MAX. */
export function pushHistory(history: readonly HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
  const out = [...history, e];
  return out.length > HISTORY_MAX ? out.slice(out.length - HISTORY_MAX) : out;
}

// ===== JSON shapes

export interface RationalJson {
  n: string;
  d: string;
}
export type ExactJson =
  | { k: 'q'; q: RationalJson }
  | { k: 'surd'; terms: { c: RationalJson; r: string }[] }
  | { k: 'pi'; q: RationalJson };
export type CalcValueJson =
  | { t: 'real'; x: number; exact?: ExactJson }
  | { t: 'cplx'; re: number; im: number; exact?: { re: RationalJson; im: RationalJson }; polar?: boolean }
  | { t: 'mat'; m: number[][] }
  | { t: 'vct'; v: number[] }
  | { t: 'base'; n: number }
  | { t: 'pair'; kind: 'pol' | 'rec'; a: number; b: number };
export interface CalcContextJson {
  mode: CalcMode;
  setup: CalcSetup;
  vars: Record<VarName, CalcValueJson>;
  ans: CalcValueJson;
  base: Radix;
  mats: Record<MemName, { t: 'mat'; m: number[][] } | null>;
  vcts: Record<MemName, { t: 'vct'; v: number[] } | null>;
  stat: StatData;
  seed: number;
}
export interface MachinePersistJson {
  v: 1;
  mode: CalcMode;
  setup: CalcSetup;
  ctx: CalcContextJson;
  history: HistoryEntry[];
}

// ===== persist

export function persist(s: MachineState): MachinePersist {
  // ctx.mode and ctx.setup are authoritative (MachineState.mode and .setup only mirror them).
  const ctx: CalcContext = s.ctx;
  return { v: 1, mode: ctx.mode, setup: ctx.setup, ctx, history: s.history.slice(-HISTORY_MAX) };
}

// ===== encode

const qJson = (r: Rational): RationalJson => ({ n: r.n.toString(), d: r.d.toString() });

function exactJson(e: Exact): ExactJson {
  if (e.k === 'q') return { k: 'q', q: qJson(e.q) };
  if (e.k === 'pi') return { k: 'pi', q: qJson(e.q) };
  return { k: 'surd', terms: e.terms.map((t) => ({ c: qJson(t.c), r: t.r.toString() })) };
}

export function encodeValue(v: CalcValue): CalcValueJson {
  switch (v.t) {
    case 'real': return v.exact ? { t: 'real', x: v.x, exact: exactJson(v.exact) } : { t: 'real', x: v.x };
    case 'cplx': {
      const out: CalcValueJson = { t: 'cplx', re: v.re, im: v.im };
      if (v.exact) out.exact = { re: qJson(v.exact.re), im: qJson(v.exact.im) };
      if (v.polar) out.polar = true;
      return out;
    }
    case 'mat': return { t: 'mat', m: v.m.map((r) => r.slice()) };
    case 'vct': return { t: 'vct', v: v.v.slice() };
    case 'base': return { t: 'base', n: v.n };
    case 'pair': return { t: 'pair', kind: v.kind, a: v.a, b: v.b };
  }
}

function plainRow(row: MathRow): MathRow {
  // MathRows hold no bigints; a JSON round trip gives a detached plain copy.
  return JSON.parse(JSON.stringify(row)) as MathRow;
}

export function encodePersist(p: MachinePersist): MachinePersistJson {
  const c = p.ctx;
  const vars = {} as Record<VarName, CalcValueJson>;
  for (const n of VAR_NAMES) vars[n] = encodeValue(c.vars[n] ?? ZERO);
  const mats = {} as CalcContextJson['mats'];
  const vcts = {} as CalcContextJson['vcts'];
  for (const n of MEM_NAMES) {
    const m = c.mats[n];
    const v = c.vcts[n];
    mats[n] = m ? { t: 'mat', m: m.m.map((r) => r.slice()) } : null;
    vcts[n] = v ? { t: 'vct', v: v.v.slice() } : null;
  }
  return {
    v: 1,
    mode: p.mode,
    setup: { ...p.setup, disp: { ...p.setup.disp } },
    ctx: {
      mode: c.mode,
      setup: { ...c.setup, disp: { ...c.setup.disp } },
      vars,
      ans: encodeValue(c.ans),
      base: c.base,
      mats,
      vcts,
      stat: { kind: c.stat.kind, x: c.stat.x.slice(), y: c.stat.y.slice(), freq: c.stat.freq.slice() },
      seed: c.seed,
    },
    history: p.history.map((h) => ({ input: plainRow(h.input), result: String(h.result) })),
  };
}

// ===== decode

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const INT_RE = /^-?\d{1,400}$/;
const NAT_RE = /^\d{1,400}$/;

function bigOf(x: unknown, re: RegExp): bigint | null {
  if (typeof x === 'string' && re.test(x)) return BigInt(x);
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number' && Number.isSafeInteger(x)) return BigInt(x);
  return null;
}

function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** A RationalJson (or a Rational) back to a normalized Rational, or null. */
export function decodeRational(raw: unknown): Rational | null {
  if (!isObj(raw)) return null;
  let n = bigOf(raw.n, INT_RE);
  let d = bigOf(raw.d, INT_RE);
  if (n === null || d === null || d === 0n) return null;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { n: 0n, d: 1n };
  const g = bgcd(n, d);
  return g === 1n ? { n, d } : { n: n / g, d: d / g };
}

function decodeExact(raw: unknown): Exact | null {
  if (!isObj(raw)) return null;
  if (raw.k === 'q' || raw.k === 'pi') {
    const q = decodeRational(raw.q);
    return q ? { k: raw.k, q } : null;
  }
  if (raw.k === 'surd' && Array.isArray(raw.terms) && raw.terms.length >= 1 && raw.terms.length <= 4) {
    const terms: SurdTerm[] = [];
    for (const t of raw.terms) {
      if (!isObj(t)) return null;
      const c = decodeRational(t.c);
      const r = bigOf(t.r, NAT_RE);
      if (!c || r === null || r < 1n) return null;
      terms.push({ c, r });
    }
    return { k: 'surd', terms };
  }
  return null;
}

function numberGrid(raw: unknown, minR: number, maxR: number, minC: number, maxC: number): number[][] | null {
  if (!Array.isArray(raw) || raw.length < minR || raw.length > maxR) return null;
  const rows: number[][] = [];
  let cols = -1;
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < minC || r.length > maxC) return null;
    if (cols !== -1 && r.length !== cols) return null;
    cols = r.length;
    if (!r.every(isNum)) return null;
    rows.push((r as number[]).slice());
  }
  return rows;
}

function decodeMat(raw: unknown): MatValue | null {
  if (!isObj(raw) || raw.t !== 'mat') return null;
  const m = numberGrid(raw.m, 1, 3, 1, 3);
  return m ? { t: 'mat', m } : null;
}

function decodeVct(raw: unknown): VctValue | null {
  if (!isObj(raw) || raw.t !== 'vct' || !Array.isArray(raw.v)) return null;
  if (raw.v.length < 2 || raw.v.length > 3 || !raw.v.every(isNum)) return null;
  return { t: 'vct', v: (raw.v as number[]).slice() };
}

/** Any persisted value back to a CalcValue, or null when it is not valid. */
export function decodeValue(raw: unknown): CalcValue | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'real': {
      if (!isNum(raw.x)) return null;
      const exact = raw.exact === undefined ? null : decodeExact(raw.exact);
      return exact ? { t: 'real', x: raw.x, exact } : { t: 'real', x: raw.x };
    }
    case 'cplx': {
      if (!isNum(raw.re) || !isNum(raw.im)) return null;
      const v: CalcValue = { t: 'cplx', re: raw.re, im: raw.im };
      if (isObj(raw.exact)) {
        const re = decodeRational(raw.exact.re);
        const im = decodeRational(raw.exact.im);
        if (re && im) v.exact = { re, im };
      }
      if (raw.polar === true) v.polar = true;
      return v;
    }
    case 'mat': return decodeMat(raw);
    case 'vct': return decodeVct(raw);
    case 'base': return isNum(raw.n) && Number.isInteger(raw.n) ? { t: 'base', n: raw.n | 0 } : null;
    case 'pair':
      return (raw.kind === 'pol' || raw.kind === 'rec') && isNum(raw.a) && isNum(raw.b) ? { t: 'pair', kind: raw.kind, a: raw.a, b: raw.b } : null;
    default: return null;
  }
}

const oneOf = <T extends string>(x: unknown, list: readonly T[]): T | null => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : null);

function decodeDisp(raw: unknown): DispFormat | null {
  if (!isObj(raw) || !isNum(raw.n) || !Number.isInteger(raw.n)) return null;
  if (raw.mode === 'Norm' && (raw.n === 1 || raw.n === 2)) return { mode: 'Norm', n: raw.n };
  if ((raw.mode === 'Fix' || raw.mode === 'Sci') && raw.n >= 0 && raw.n <= 9) return { mode: raw.mode, n: raw.n };
  return null;
}

export function decodeSetup(raw: unknown): CalcSetup {
  const d = defaultSetup();
  if (!isObj(raw)) return d;
  const contrast = isNum(raw.contrast) && Number.isInteger(raw.contrast) && raw.contrast >= 1 && raw.contrast <= 9 ? raw.contrast : d.contrast;
  return {
    io: oneOf(raw.io, ['MthIO', 'LineIO'] as const) ?? d.io,
    angle: oneOf<AngleUnit>(raw.angle, ['Deg', 'Rad', 'Gra']) ?? d.angle,
    disp: decodeDisp(raw.disp) ?? d.disp,
    frac: oneOf(raw.frac, ['ab/c', 'd/c'] as const) ?? d.frac,
    cmplx: oneOf(raw.cmplx, ['a+bi', 'r∠θ'] as const) ?? d.cmplx,
    statFreq: typeof raw.statFreq === 'boolean' ? raw.statFreq : d.statFreq,
    table: oneOf(raw.table, ['f(x)', 'f(x),g(x)'] as const) ?? d.table,
    decimal: oneOf(raw.decimal, ['Dot', 'Comma'] as const) ?? d.decimal,
    contrast,
  };
}

function decodeStat(raw: unknown): StatData {
  if (!isObj(raw)) return emptyStat();
  const kind = oneOf(raw.kind, STAT_KINDS) ?? '1-VAR';
  const nums = (a: unknown): number[] | null => (Array.isArray(a) && a.every(isNum) ? (a as number[]).slice() : null);
  const x = nums(raw.x);
  if (!x) return emptyStat(kind);
  const len = Math.min(x.length, 80);
  const y = nums(raw.y);
  const freq = nums(raw.freq);
  return {
    kind,
    x: x.slice(0, len),
    y: y && y.length >= len ? y.slice(0, len) : new Array<number>(len).fill(0),
    freq: freq && freq.length >= len ? freq.slice(0, len) : new Array<number>(len).fill(1),
  };
}

// MathRow validation (history inputs)

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
const SYMS = ['π', 'e', 'i', 'Ran#'] as const;
const PREFIXES = ['d', 'h', 'b', 'o'] as const;
const POSTS = [...POST_OPS, 'E'] as const;
const MAX_DEPTH = 30;
const MAX_ROW_NODES = 1000;

function decodeRow(raw: unknown, depth: number, budget: { n: number }): MathRow | null {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return null;
  const out: MathRow = [];
  for (const r of raw) {
    if (--budget.n < 0) return null;
    const n = decodeNode(r, depth, budget);
    if (!n) return null;
    out.push(n);
  }
  return out;
}

function decodeNode(raw: unknown, depth: number, budget: { n: number }): MathNode | null {
  if (!isObj(raw)) return null;
  const row = (x: unknown) => decodeRow(x, depth + 1, budget);
  const idx = (x: unknown) => (isNum(x) && Number.isInteger(x) && x >= 1 && x <= 99 ? x : null);
  switch (raw.k) {
    case 'digit': { const d = oneOf(raw.d, DIGITS); return d ? { k: 'digit', d } : null; }
    case 'op': { const op = oneOf(raw.op, BIN_OPS); return op ? { k: 'op', op } : null; }
    case 'neg': case 'lpar': case 'rpar': case 'comma': case 'colon': case 'eq': case 'ans': case 'dms':
      return { k: raw.k };
    case 'var': { const name = oneOf(raw.name, VAR_NAMES); return name ? { k: 'var', name } : null; }
    case 'sym': { const name = oneOf(raw.name, SYMS); return name ? { k: 'sym', name } : null; }
    case 'const': { const index = idx(raw.index); return index ? { k: 'const', index } : null; }
    case 'conv': { const index = idx(raw.index); return index ? { k: 'conv', index } : null; }
    case 'statvar': { const name = oneOf(raw.name, STAT_VARS); return name ? { k: 'statvar', name } : null; }
    case 'baseprefix': { const base = oneOf(raw.base, PREFIXES); return base ? { k: 'baseprefix', base } : null; }
    case 'mat': case 'vct': { const name = oneOf(raw.name, MEM_NAMES); return name ? { k: raw.k, name } : null; }
    case 'post': { const op = oneOf(raw.op, POSTS); return op ? { k: 'post', op } : null; }
    case 'fn': {
      const name = oneOf(raw.name, FN_NAMES);
      if (!name || !Array.isArray(raw.args) || raw.args.length > 3) return null;
      const args: MathRow[] = [];
      for (const a of raw.args) {
        const r = row(a);
        if (!r) return null;
        args.push(r);
      }
      return { k: 'fn', name, args };
    }
    case 'frac': { const num = row(raw.num); const den = row(raw.den); return num && den ? { k: 'frac', num, den } : null; }
    case 'mixed': {
      const whole = row(raw.whole); const num = row(raw.num); const den = row(raw.den);
      return whole && num && den ? { k: 'mixed', whole, num, den } : null;
    }
    case 'pow': { const exp = row(raw.exp); return exp ? { k: 'pow', exp } : null; }
    case 'root': { const index = row(raw.index); const radicand = row(raw.radicand); return index && radicand ? { k: 'root', index, radicand } : null; }
    case 'logb': { const base = row(raw.base); const arg = row(raw.arg); return base && arg ? { k: 'logb', base, arg } : null; }
    case 'integral': case 'sum': {
      const f = row(raw.f); const a = row(raw.a); const b = row(raw.b);
      return f && a && b ? { k: raw.k, f, a, b } : null;
    }
    case 'deriv': { const f = row(raw.f); const at = row(raw.at); return f && at ? { k: 'deriv', f, at } : null; }
    default: return null;
  }
}

/** A persisted MathRow, or null when any node is invalid. */
export function decodeMathRow(raw: unknown): MathRow | null {
  return decodeRow(raw, 0, { n: MAX_ROW_NODES });
}

function decodeContext(raw: unknown, mode: CalcMode, setup: CalcSetup): CalcContext {
  const base = createContext({ mode, setup });
  if (!isObj(raw)) return base;
  const vars = { ...base.vars };
  if (isObj(raw.vars)) {
    for (const n of VAR_NAMES) {
      const v = decodeValue(raw.vars[n]);
      if (v && v.t !== 'pair') vars[n] = v;
    }
  }
  const ansV = decodeValue(raw.ans);
  const mats = { ...base.mats };
  const vcts = { ...base.vcts };
  if (isObj(raw.mats)) for (const n of MEM_NAMES) mats[n] = decodeMat(raw.mats[n]);
  if (isObj(raw.vcts)) for (const n of MEM_NAMES) vcts[n] = decodeVct(raw.vcts[n]);
  const radix: Radix = raw.base === 2 || raw.base === 8 || raw.base === 16 ? raw.base : 10;
  const seed = isNum(raw.seed) && Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed <= 0xffffffff ? raw.seed >>> 0 : DEFAULT_SEED;
  return {
    mode,
    setup,
    vars,
    ans: ansV && ansV.t !== 'pair' ? ansV : ZERO,
    base: radix,
    mats,
    vcts,
    stat: decodeStat(raw.stat),
    seed,
  };
}

/** A fresh MachinePersist (what decodePersist gives for garbage). */
export function defaultPersist(): MachinePersist {
  const ctx = createContext();
  return { v: 1, mode: ctx.mode, setup: ctx.setup, ctx, history: [] };
}

/**
 * Validates persisted data (MachinePersistJson, usually from JSON.parse) and rebuilds it. Invalid
 * parts fall back to their defaults: a bad value becomes 0 (or an undefined matrix), a bad setup
 * field its default, a bad history entry is dropped. Never throws.
 */
export function decodePersist(raw: unknown): MachinePersist {
  try {
    if (!isObj(raw) || raw.v !== 1) return defaultPersist();
    const ctxRaw = isObj(raw.ctx) ? raw.ctx : null;
    const mode = oneOf(raw.mode, CALC_MODES) ?? oneOf(ctxRaw?.mode, CALC_MODES) ?? 'COMP';
    const setup = decodeSetup(raw.setup !== undefined ? raw.setup : ctxRaw?.setup);
    const ctx = decodeContext(ctxRaw, mode, setup);
    const history: HistoryEntry[] = [];
    if (Array.isArray(raw.history)) {
      for (const h of raw.history.slice(-HISTORY_MAX)) {
        if (!isObj(h) || typeof h.result !== 'string' || h.result.length > 400) continue;
        const input = decodeMathRow(h.input);
        if (input && input.length > 0) history.push({ input, result: h.result });
      }
    }
    return { v: 1, mode, setup, ctx, history };
  } catch {
    return defaultPersist();
  }
}
