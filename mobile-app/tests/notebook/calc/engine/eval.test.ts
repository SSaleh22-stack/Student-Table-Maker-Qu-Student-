import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { checkSyntax, evaluate, parseLinear, varsIn } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext, defaultSetup, withVar } from '../../../../src/notebook/core/calc/context.ts';
import { resetRegistry, setConstTable, setModeOps } from '../../../../src/notebook/core/calc/registry.ts';
import { real } from '../../../../src/notebook/core/calc/num/value.ts';
import type { CalcContext, CalcMode, CalcValue, ModeOps } from '../../../../src/notebook/core/calc/types.ts';

function ctxFor(mode: CalcMode = 'COMP', angle: 'Deg' | 'Rad' | 'Gra' = 'Deg'): CalcContext {
  return createContext({ mode, setup: { ...defaultSetup(), angle }, seed: 7 });
}

/** Evaluates linear text and returns the LCD text (or the error message). */
function calc(text: string, ctx: CalcContext = ctxFor()): string {
  const r = evaluate(parseLinear(text, { baseN: ctx.mode === 'BASE-N' }), ctx);
  if (!r.ok) return r.error;
  return formatValue(r.value, ctx.setup, { base: ctx.base }).text;
}

/** A tiny ModeOps for tests: BASE-N on 32-bit integers, stat variables, CONV and CONST. */
const fakeOps: ModeOps = {
  binary(op, a, b) {
    if (a.t === 'base' && b.t === 'base') {
      const x = a.n;
      const y = b.n;
      const r =
        op === '+' ? x + y : op === '-' ? x - y : op === '×' ? x * y : op === '÷' ? (y === 0 ? NaN : Math.trunc(x / y))
          : op === 'and' ? x & y : op === 'or' ? x | y : op === 'xor' ? x ^ y : op === 'xnor' ? ~(x ^ y) : NaN;
      return Number.isNaN(r) ? 'Math ERROR' : { t: 'base', n: r | 0 };
    }
    if (op === '·' && a.t === 'vct' && b.t === 'vct') return real(a.v.reduce((s, x, i) => s + x * b.v[i], 0));
    if (op === '×' && a.t === 'real' && b.t === 'mat') return { t: 'mat', m: b.m.map((r) => r.map((x) => x * a.x)) };
    if (op === '+' && a.t === 'mat' && b.t === 'mat') return { t: 'mat', m: a.m.map((r, i) => r.map((x, j) => x + b.m[i][j])) };
    return null;
  },
  unary(name, a) {
    if (name === 'Not' && a.t === 'base') return { t: 'base', n: ~a.n };
    if (name === 'Neg' && a.t === 'base') return { t: 'base', n: -a.n | 0 };
    if (name === 'det' && a.t === 'mat') return real(a.m[0][0] * a.m[1][1] - a.m[0][1] * a.m[1][0]);
    return null;
  },
  statVar(name, ctx, arg) {
    const xs = ctx.stat.x;
    if (name === 'n') return real(xs.length);
    if (name === 'x̄') return real(xs.reduce((s, x) => s + x, 0) / xs.length);
    if (name === 'ŷ' && arg !== undefined) return real(2 * arg + 1);
    return 'Math ERROR';
  },
  conv(index, v) {
    return index === 1 ? v * 2.54 : 'Math ERROR';
  },
  constValue(index) {
    return index === 99 ? 42 : 'Math ERROR';
  },
  parseBase(digits, base) {
    const n = Number.parseInt(digits, base);
    return Number.isNaN(n) ? 'Syntax ERROR' : { t: 'base', n: n | 0 };
  },
};

afterEach(() => resetRegistry());

describe('precedence and parsing (reference order)', () => {
  const cases: [string, string][] = [
    ['1+2×3', '7'],
    ['(1+2)×3', '9'],
    ['10-4-3', '3'],
    ['2×3÷4', '3/2'],
    ['1÷2π', '0.1591549431'],
    ['1÷2×π', 'π/2'],
    ['2π', '2π'],
    ['3sin(30)', '3/2'],
    ['2(3+4)', '14'],
    ['(1+2)(3+4)', '21'],
    ['2A', '0'],
    ['-2²', '−4'],
    ['~2²', '−4'],
    ['(~2)²', '4'],
    ['~~3', '3'],
    ['2×~3', '−6'],
    ['2pow{3}pow{2}', '64'],
    ['2pow{10}', '1024'],
    ['3!', '6'],
    ['3!²', '36'],
    ['50%', '1/2'],
    ['200×15%', '30'],
    ['4⁻¹', '1/4'],
    ['2³', '8'],
    ['5nPr2', '20'],
    ['5nCr2', '10'],
    ['2+5nCr2', '12'],
    ['2×5nCr2', '20'],
    ['10nCr3÷2', '60'],
    ['1ᴇ3', '1000'],
    ['2.5ᴇ~2', '1/40'],
    ['ᴇ2', '100'],
    ['frac{1}{2}+frac{1}{3}', '5/6'],
    ['mixed{1}{1}{2}×2', '3'],
    ['frac{frac{1}{2}}{frac{3}{4}}', '2/3'],
    ['(2+3', '5'],
    ['sin(30', '1/2'],
    ['sin(30)+cos(60', '1'],
    ['root{3}{8}', '2'],
    ['logb{2}{8}', '3'],
    ['log(2,8)', '3'],
    ['0.1+0.2', '3/10'],
    ['.5+.5', '1'],
    ['2°30°', '5/2'],
    ['1°30°36°', '151/100'],
    ['~1°30°', '−3/2'],
  ];
  for (const [input, want] of cases) test(`${input} = ${want}`, () => assert.equal(calc(input), want));
});

describe('memory, Ans and multi-statements', () => {
  test('assignment and colon statements', () => {
    const r = evaluate(parseLinear('A=5:A+1'), ctxFor());
    assert.ok(r.ok);
    assert.equal(r.values.length, 2);
    assert.equal(formatValue(r.value, r.ctx.setup).text, '6');
    assert.equal((r.ctx.vars.A as { x: number }).x, 5);
    assert.equal((r.ctx.ans as { x: number }).x, 6);
  });
  test('Ans of the previous statement', () => {
    const r = evaluate(parseLinear('3:Ans×Ans'), ctxFor());
    assert.ok(r.ok);
    assert.equal(formatValue(r.value, r.ctx.setup).text, '9');
  });
  test('variables read from ctx', () => {
    const c = withVar(withVar(ctxFor(), 'X', real(3)), 'Y', real(4));
    assert.equal(calc('sqrt{X²+Y²}', c), '5');
    assert.equal(calc('XY', c), '12');
    assert.equal(calc('M+1', c), '1');
  });
  test('Pol and Rec store X and Y', () => {
    const r = evaluate(parseLinear('Pol(3,4)'), ctxFor());
    assert.ok(r.ok);
    assert.deepEqual([(r.ctx.vars.X as { x: number }).x, Math.round((r.ctx.vars.Y as { x: number }).x * 1e8) / 1e8], [5, 53.13010235]);
    const r2 = evaluate(parseLinear('Rec(2,60)'), ctxFor());
    assert.ok(r2.ok);
    assert.equal(formatValue(r2.ctx.vars.X, r2.ctx.setup).text, '1');
    assert.equal(formatValue(r2.ctx.vars.Y, r2.ctx.setup).text, '√3');
  });
  test('Ans after Pol/Rec is the first part, so Ans keeps working', () => {
    const r = evaluate(parseLinear('Pol(1,1)'), ctxFor());
    assert.ok(r.ok && r.value.t === 'pair');
    assert.equal(formatValue(r.ctx.ans, r.ctx.setup).text, '√2');
    assert.equal(calc('Ans+1', r.ctx), '1+√2');
    const r2 = evaluate(parseLinear('Rec(2,60)'), ctxFor());
    assert.ok(r2.ok);
    assert.equal(calc('Ans', r2.ctx), '1');
  });
  test('huge integer exponents and root indexes stay on floats', () => {
    assert.equal(calc('2pow{1ᴇ30}'), 'Math ERROR');
    assert.equal(calc('1pow{1ᴇ30}'), '1');
    assert.equal(calc('0.5pow{1ᴇ30}'), '0');
    assert.equal(calc('(~1)pow{1ᴇ30+1}'), '−1');
    assert.equal(calc('2pow{frac{1ᴇ30+1}{2}}'), 'Math ERROR');
    assert.equal(calc('root{1ᴇ15}{2}'), '1');
    assert.equal(calc('root{1ᴇ9}{8}'), '1.000000002');
  });
  test('an exception thrown by a ModeOps is Math ERROR, not a crash', () => {
    setModeOps({ ...fakeOps, binary() { throw new TypeError('bug'); } });
    assert.equal(calc('MatA+MatA', { ...ctxFor('MATRIX'), mats: { A: { t: 'mat', m: [[1]] }, B: null, C: null, Ans: null } }), 'Math ERROR');
  });
  test('Ran# is seeded and advances the seed', () => {
    const c = ctxFor();
    const a = evaluate(parseLinear('Ran#'), c);
    const b = evaluate(parseLinear('Ran#'), c);
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.value, b.value);
    assert.notEqual(a.ctx.seed, c.seed);
    const two = evaluate(parseLinear('Ran#:Ran#'), c);
    assert.ok(two.ok);
    const x = (two.values[0] as { x: number }).x;
    assert.ok(x >= 0 && x < 1 && Math.round(x * 1000) === x * 1000);
  });
  test('matrix and vector memories', () => {
    const c: CalcContext = { ...ctxFor('MATRIX'), mats: { A: { t: 'mat', m: [[1, 2], [3, 4]] }, B: null, C: null, Ans: null } };
    setModeOps(fakeOps);
    const r = evaluate(parseLinear('2MatA'), c);
    assert.ok(r.ok);
    assert.deepEqual(r.value, { t: 'mat', m: [[2, 4], [6, 8]] });
    assert.deepEqual(r.ctx.mats.Ans, r.value);
    assert.equal(calc('det(MatA)', c), '−2');
    assert.equal(calc('MatB', c), 'Dimension ERROR');
    const v: CalcContext = { ...ctxFor('VECTOR'), vcts: { A: { t: 'vct', v: [1, 2, 3] }, B: { t: 'vct', v: [4, 5, 6] }, C: null, Ans: null } };
    assert.equal(calc('VctA·VctB', v), '32');
    assert.equal(calc('Dot(VctA,VctB)', v), '32');
  });
});

describe('modes through ModeOps', () => {
  test('BASE-N arithmetic, prefixes and logic', () => {
    setModeOps(fakeOps);
    const hex: CalcContext = { ...ctxFor('BASE-N'), base: 16 };
    assert.equal(calc('1F+1', hex), '00000020');
    assert.equal(calc('#d10+#b11', hex), '0000000D');
    assert.equal(calc('F0andFF', hex), '000000F0');
    assert.equal(calc('F0or0F', hex), '000000FF');
    assert.equal(calc('Not(0)', hex), 'FFFFFFFF');
    const dec: CalcContext = { ...ctxFor('BASE-N'), base: 10 };
    assert.equal(calc('7÷2', dec), '3');
    assert.equal(calc('~5', dec), '−5');
    assert.equal(calc('12xor10', dec), '6');
  });
  test('a prefixed literal outside the current radix is Math ERROR', () => {
    setModeOps(fakeOps);
    const bin: CalcContext = { ...ctxFor('BASE-N'), base: 2 };
    assert.equal(calc('#d40000', bin), 'Math ERROR');
    assert.notEqual(calc('#d32767', bin), 'Math ERROR');
    assert.equal(calc('#h8000', bin), 'Math ERROR');
    const dec: CalcContext = { ...ctxFor('BASE-N'), base: 10 };
    assert.equal(calc('#d40000', dec), '40000');
  });
  test('logic outside BASE-N is a syntax error', () => {
    setModeOps(fakeOps);
    assert.equal(calc('1and1'), 'Syntax ERROR');
  });
  test('statistics variables, estimated values, CONV and CONST', () => {
    setModeOps(fakeOps);
    const c: CalcContext = { ...ctxFor('STAT'), stat: { kind: '1-VAR', x: [1, 2, 3, 6], y: [], freq: [1, 1, 1, 1] } };
    assert.equal(calc('$n', c), '4');
    assert.equal(calc('$x̄', c), '3');
    assert.equal(calc('2$x̄', c), '6');
    assert.equal(calc('5$ŷ', c), '11');
    assert.equal(calc('10conv1'), '127/5');
    assert.equal(calc('const99'), '42');
    setConstTable([{ code: 1, symbol: 'mp', ar: 'كتلة البروتون', en: 'proton mass', value: 1.67262192369e-27 }]);
    assert.equal(calc('const1'), '1.672621924×10⁻²⁷');
  });
  test('without ModeOps, mode values are Math ERROR', () => {
    assert.equal(calc('$n'), 'Math ERROR');
    assert.equal(calc('3conv1'), 'Math ERROR');
    assert.equal(calc('const5'), 'Math ERROR');
  });
});

describe('complex numbers (CMPLX)', () => {
  const cm = ctxFor('CMPLX');
  const cases: [string, string][] = [
    ['(1+2i)(3-i)', '5+5i'],
    ['(1+2i)÷(3-i)', '1/10+7/10i'],
    ['i²', '−1'],
    ['sqrt{~4}', '2i'],
    ['2∠30', '√3+i'],
    ['(1+i)▶r∠θ', '√2∠45'],
    ['Abs(3+4i)', '5'],
    ['arg(~1+i)', '135'],
    ['Conjg(2+3i)', '2−3i'],
    ['(1+i)²', '2i'],
    ['(1+i)⁻¹', '1/2−1/2i'],
    ['1-i', '1−i'],
  ];
  for (const [input, want] of cases) test(`${input} = ${want}`, () => assert.equal(calc(input, cm), want));
  test('i outside CMPLX is a syntax error', () => assert.equal(calc('2i'), 'Syntax ERROR'));
  test('√ of a negative outside CMPLX is a math error', () => assert.equal(calc('sqrt{~4}'), 'Math ERROR'));
});

describe('errors and positions', () => {
  const cases: [string, string, number | undefined][] = [
    ['1÷0', 'Math ERROR', 1],
    ['2++', 'Syntax ERROR', 3],
    [')', 'Syntax ERROR', 0],
    ['sin(', 'Syntax ERROR', 1],
    ['Pol(1)', 'Syntax ERROR', 0],
    ['1+frac{}{2}', 'Syntax ERROR', 2],
    ['2=3', 'Syntax ERROR', 1],
    ['1:', 'Syntax ERROR', 2],
    ['1..2', 'Syntax ERROR', 0],
    ['tan(90)', 'Math ERROR', 0],
    ['70!', 'Math ERROR', 2],
    ['ln(0)', 'Math ERROR', 0],
    ['10pow{100}', 'Math ERROR', 2],
    ['(~8)pow{0.5}', 'Math ERROR', 4],
  ];
  for (const [input, want, at] of cases) {
    test(`${input} -> ${want} at ${at}`, () => {
      const r = evaluate(parseLinear(input), ctxFor());
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.error, want);
        assert.equal(r.at, at);
      }
    });
  }
  test('deep nesting is a Stack ERROR', () => {
    const r = evaluate(parseLinear('('.repeat(80) + '1'), ctxFor());
    assert.deepEqual(r.ok ? null : r.error, 'Stack ERROR');
  });
  test('range: a literal from 10¹⁰⁰ is Math ERROR, one below 10⁻⁹⁹ reads as 0', () => {
    assert.equal(calc('1ᴇ100'), 'Math ERROR');
    assert.equal(calc('9.99ᴇ99'), '9.99×10⁹⁹');
    assert.equal(calc('2ᴇ~100'), '0');
    assert.equal(calc('1ᴇ~99'), '1×10⁻⁹⁹');
  });
  test('empty row is a syntax error', () => {
    const r = evaluate([], ctxFor());
    assert.equal(r.ok ? null : r.error, 'Syntax ERROR');
  });
  test('checkSyntax finds the error without evaluating', () => {
    assert.equal(checkSyntax(parseLinear('1+2'), ctxFor()), null);
    assert.deepEqual(checkSyntax(parseLinear('1+'), ctxFor()), { error: 'Syntax ERROR', at: 2 });
    assert.equal(checkSyntax(parseLinear('X²=2'), ctxFor(), true), null);
  });
});

describe('varsIn (CALC prompts)', () => {
  test('order of first appearance, template slots included', () => {
    assert.deepEqual(varsIn(parseLinear('B+Asin(C)+frac{D}{A}')), ['B', 'A', 'C', 'D']);
    assert.deepEqual(varsIn(parseLinear('Y=X+1')), ['Y', 'X']);
    assert.deepEqual(varsIn(parseLinear('Y=X+1'), { skipAssigned: true }), ['X']);
    assert.deepEqual(varsIn(parseLinear('1+2')), []);
  });
});

describe('values never contain functions (persistable)', () => {
  test('a result survives a bigint-aware JSON round trip', () => {
    const r = evaluate(parseLinear('frac{1}{3}+sqrt{2}'), ctxFor());
    assert.ok(r.ok);
    const json = JSON.stringify(r.ctx, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));
    const back = JSON.parse(json, (_k, v: unknown) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as CalcContext;
    assert.deepEqual(back, r.ctx);
    const v: CalcValue = back.ans;
    assert.equal(formatValue(v, back.setup).text, formatValue(r.value, r.ctx.setup).text);
  });
});
