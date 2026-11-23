/**
 * Test doubles for the key machine (wave 3): a minimal ModeHooks with fixed or tiny computed results,
 * a minimal ModeOps (BASE-N integers, 2×2 matrix and vector arithmetic, n and x̄, CONV, CONST), and
 * key-sequence helpers. Real modes are tested by P24 against P18's modeHooks.
 */
import { evaluate } from '../../../../src/notebook/core/calc/eval.ts';
import { withVar } from '../../../../src/notebook/core/calc/context.ts';
import { real } from '../../../../src/notebook/core/calc/num/value.ts';
import { resetRegistry, setConstTable, setModeOps } from '../../../../src/notebook/core/calc/registry.ts';
import type { CalcValue, ConstEntry, ConvEntry, KeyId, MachineState, ModeHooks, ModeOps, StatVar } from '../../../../src/notebook/core/calc/types.ts';
import { KEY_IDS, STAT_VARS } from '../../../../src/notebook/core/calc/types.ts';
import { initialMachine, pressAll, setModeHooks, type KeyState } from '../../../../src/notebook/core/calc/keys/machine.ts';

export const stubConst: ConstEntry[] = Array.from({ length: 40 }, (_, i) => ({
  code: i + 1, symbol: `k${i + 1}`, ar: `ثابت ${i + 1}`, en: `constant ${i + 1}`, value: (i + 1) * 10,
}));

export const stubConv: ConvEntry[] = Array.from({ length: 40 }, (_, i) => ({
  code: i + 1, from: `u${i + 1}`, to: `v${i + 1}`, ar: `تحويل ${i + 1}`, en: `conversion ${i + 1}`,
}));

export const stubHooks: ModeHooks = {
  eqnSolve(kind, coef) {
    if (coef.every((c) => c === 0)) return 'Infinite Sol';
    if (kind === 'lin2') {
      const [a1, b1, c1, a2, b2, c2] = coef;
      const det = a1 * b2 - a2 * b1;
      if (det === 0) return 'No Solution';
      return { roots: [real((c1 * b2 - c2 * b1) / det), real((a1 * c2 - a2 * c1) / det)] };
    }
    if (kind === 'poly2') {
      const [a, b, c] = coef;
      if (a === 0) return 'Math ERROR';
      const d = b * b - 4 * a * c;
      if (d < 0) return { roots: [{ t: 'cplx', re: -b / (2 * a), im: Math.sqrt(-d) / (2 * a) }, { t: 'cplx', re: -b / (2 * a), im: -Math.sqrt(-d) / (2 * a) }] };
      return { roots: [real((-b + Math.sqrt(d)) / (2 * a)), real((-b - Math.sqrt(d)) / (2 * a))] };
    }
    return { roots: kind === 'lin3' ? [real(1), real(2), real(3)] : [real(1), real(2), real(3)] };
  },
  ineqSolve() {
    return { text: ['X<1', '3<X'] };
  },
  tableBuild(f, g, start, end, step, ctx) {
    if (step <= 0) return 'Math ERROR';
    const rows: number[][] = [];
    for (let x = start; x <= end + 1e-9; x += step) {
      if (rows.length >= 30) return 'Insufficient MEM';
      const at = (row: typeof f): number | 'Math ERROR' => {
        const r = evaluate(row, withVar(ctx, 'X', real(x)));
        return r.ok && r.value.t === 'real' ? r.value.x : 'Math ERROR';
      };
      const fx = at(f);
      if (typeof fx === 'string') return fx;
      const row = [x, fx];
      if (g) {
        const gx = at(g);
        if (typeof gx === 'string') return gx;
        row.push(gx);
      }
      rows.push(row);
    }
    return { rows };
  },
  ratioSolve(kind, a, b, c) {
    if (kind === 'A:B=X:D') return b === 0 ? 'Math ERROR' : (a * c) / b;
    return a === 0 ? 'Math ERROR' : (b * c) / a;
  },
  statCompute(data) {
    const out = {} as Record<StatVar, number | null>;
    for (const v of STAT_VARS) out[v] = null;
    out.n = data.x.length;
    return out;
  },
  constTable: stubConst,
  convTable: stubConv,
  matDims: { min: 1, max: 3 },
  vctDims: { min: 2, max: 3 },
};

const mat = (m: number[][]): CalcValue => ({ t: 'mat', m });

export const stubOps: ModeOps = {
  binary(op, a, b) {
    if (a.t === 'base' && b.t === 'base') {
      const x = a.n;
      const y = b.n;
      const r = op === '+' ? x + y : op === '-' ? x - y : op === '×' ? x * y : op === '÷' ? (y === 0 ? NaN : Math.trunc(x / y))
        : op === 'and' ? x & y : op === 'or' ? x | y : op === 'xor' ? x ^ y : op === 'xnor' ? ~(x ^ y) : NaN;
      return Number.isNaN(r) ? 'Math ERROR' : { t: 'base', n: r | 0 };
    }
    if (a.t === 'mat' && b.t === 'mat' && (op === '+' || op === '-')) {
      if (a.m.length !== b.m.length || a.m[0].length !== b.m[0].length) return 'Dimension ERROR';
      return mat(a.m.map((r, i) => r.map((x, j) => (op === '+' ? x + b.m[i][j] : x - b.m[i][j]))));
    }
    if (op === '×' && a.t === 'real' && b.t === 'mat') return mat(b.m.map((r) => r.map((x) => x * a.x)));
    if (op === '·' && a.t === 'vct' && b.t === 'vct') return a.v.length === b.v.length ? real(a.v.reduce((s, x, i) => s + x * b.v[i], 0)) : 'Dimension ERROR';
    if (op === '+' && a.t === 'vct' && b.t === 'vct') return { t: 'vct', v: a.v.map((x, i) => x + b.v[i]) };
    return null;
  },
  unary(name, a) {
    if (name === 'Not' && a.t === 'base') return { t: 'base', n: ~a.n };
    if (name === 'Neg' && a.t === 'base') return { t: 'base', n: -a.n | 0 };
    if (name === 'det' && a.t === 'mat' && a.m.length === 2) return real(a.m[0][0] * a.m[1][1] - a.m[0][1] * a.m[1][0]);
    if (name === 'Trn' && a.t === 'mat') return mat(a.m[0].map((_, j) => a.m.map((r) => r[j])));
    return null;
  },
  statVar(name, ctx) {
    const x = ctx.stat.x;
    if (name === 'n') return real(x.length);
    if (name === 'Σx') return real(x.reduce((s, v) => s + v, 0));
    if (name === 'x̄') return x.length ? real(x.reduce((s, v) => s + v, 0) / x.length) : 'Math ERROR';
    return 'Math ERROR';
  },
  conv(index, v) {
    return v * index;
  },
  constValue(index) {
    return index * 10;
  },
  parseBase(digits, base) {
    const n = parseInt(digits, base);
    if (!Number.isFinite(n) || !new RegExp(`^[0-${base === 16 ? '9A-F' : String(base - 1)}]+$`).test(digits)) return 'Syntax ERROR';
    return { t: 'base', n: n | 0 };
  },
};

export function installStubs(): void {
  setModeHooks(stubHooks);
  setModeOps(stubOps);
  setConstTable(stubConst);
}

export function resetStubs(): void {
  setModeHooks(null);
  resetRegistry();
}

const KEYS = new Set<string>(KEY_IDS);

/**
 * Key sequence from text: space-separated key ids, where a number token ('12', '2.5') stands for
 * its digit keys and A..F tokens are not special. Example: '12 ADD 3.5 EQ'.
 */
export function seq(text: string): KeyId[] {
  const out: KeyId[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (tok === '') continue;
    if (KEYS.has(tok)) {
      out.push(tok as KeyId);
      continue;
    }
    if (/^[0-9.]+$/.test(tok)) {
      for (const c of tok) out.push(c === '.' ? 'DOT' : (`D${c}` as KeyId));
      continue;
    }
    throw new Error(`seq: unknown key '${tok}' in "${text}"`);
  }
  return out;
}

/** Runs a key sequence from s (default: a fresh machine). */
export function run(text: string, s: MachineState = initialMachine()): KeyState {
  return pressAll(s, seq(text));
}

/** The LCD answer: the error message, else the result text, else ''. */
export function answer(s: MachineState): string {
  if (s.error) return s.error.kind;
  return s.result ? s.result.display.text : '';
}
