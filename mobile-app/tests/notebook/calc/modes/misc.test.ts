import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { evaluate, parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext, defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import { getModeOps, getConstTable, resetRegistry } from '../../../../src/notebook/core/calc/registry.ts';
import type { AngleUnit, CalcContext, CalcMode, IneqRel, ModeHooks } from '../../../../src/notebook/core/calc/types.ts';
import { installModes, modeHooks, modeOps } from '../../../../src/notebook/core/calc/modes/index.ts';
import { CONST_TABLE, constValue } from '../../../../src/notebook/core/calc/modes/const.ts';
import { CONV_TABLE, conv, convLabel } from '../../../../src/notebook/core/calc/modes/conv.ts';
import { ratioSolve } from '../../../../src/notebook/core/calc/modes/ratio.ts';
import { ineqSolve, ineqSolveWith } from '../../../../src/notebook/core/calc/modes/ineq.ts';
import { tableBuild, tableBuildWith, tableRowCount } from '../../../../src/notebook/core/calc/modes/table.ts';
import { DRG_MENU, drgConvert } from '../../../../src/notebook/core/calc/modes/drg.ts';
import { CMPLX_MENU } from '../../../../src/notebook/core/calc/modes/cmplx.ts';

before(() => installModes());
after(() => resetRegistry());

function close(a: number, b: number, tol = 1e-12): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

function calc(text: string, mode: CalcMode = 'COMP', angle: AngleUnit = 'Deg'): string {
  const ctx: CalcContext = createContext({ mode, setup: { ...defaultSetup(), angle } });
  const r = evaluate(parseLinear(text), ctx);
  if (!r.ok) return r.error;
  return formatValue(r.value, ctx.setup).text;
}

describe('installModes and modeHooks', () => {
  test('registers the ops and the CONST table', () => {
    assert.equal(getModeOps(), modeOps);
    assert.equal(getConstTable().length, 40);
  });

  test('modeHooks has every member', () => {
    const h: ModeHooks = modeHooks;
    assert.equal(typeof h.eqnSolve, 'function');
    assert.equal(typeof h.ineqSolve, 'function');
    assert.equal(typeof h.tableBuild, 'function');
    assert.equal(typeof h.ratioSolve, 'function');
    assert.equal(typeof h.statCompute, 'function');
    assert.deepEqual(h.matDims, { min: 1, max: 3 });
    assert.deepEqual(h.vctDims, { min: 2, max: 3 });
    assert.equal(h.constTable.length, 40);
    assert.equal(h.convTable.length, 40);
  });
});

describe('CONST', () => {
  test('40 entries in order', () => {
    assert.deepEqual(CONST_TABLE.map((c) => c.code), Array.from({ length: 40 }, (_, i) => i + 1));
    assert.ok(CONST_TABLE.every((c) => c.ar.length > 0 && c.en.length > 0 && c.symbol.length > 0));
  });
  const cases: [number, string, number][] = [
    [1, 'mp', 1.67262192369e-27],
    [6, 'h', 6.62607015e-34],
    [16, 'R∞', 10973731.56816],
    [23, 'e', 1.602176634e-19],
    [24, 'NA', 6.02214076e23],
    [26, 'Vm', 22.71095464e-3],
    [34, 'Φ0', 2.067833848e-15],
    [28, 'C0', 299792458],
    [35, 'g', 9.80665],
    [38, 't', 273.15],
    [39, 'G', 6.6743e-11],
    [40, 'atm', 101325],
  ];
  for (const [code, symbol, value] of cases) {
    test(`${code} ${symbol}`, () => {
      const e = CONST_TABLE[code - 1];
      assert.equal(e.symbol, symbol);
      assert.equal(e.value, value);
      assert.equal(constValue(code), value);
    });
  }
  test('through the engine', () => {
    assert.equal(calc('const28'), '299792458');
    assert.equal(calc('2const35'), '19.6133');
    assert.equal(constValue(41), 'Math ERROR');
  });
});

describe('CONV', () => {
  test('40 entries as forward/back pairs', () => {
    assert.equal(CONV_TABLE.length, 40);
    for (let i = 0; i < 40; i += 2) {
      assert.equal(CONV_TABLE[i].from, CONV_TABLE[i + 1].to);
      assert.equal(CONV_TABLE[i].to, CONV_TABLE[i + 1].from);
    }
    assert.equal(convLabel(1), 'in▶cm');
    assert.equal(convLabel(37), '°F▶°C');
    assert.equal(convLabel(99), '');
  });
  const cases: [number, number, number][] = [
    [1, 1, 2.54],
    [2, 2.54, 1],
    [3, 1, 0.3048],
    [7, 1, 1.609344],
    [10, 1852, 1],
    [19, 36, 10],
    [20, 10, 36],
    [23, 1, 0.45359237],
    [25, 1, 101325],
    [37, 212, 100],
    [38, 100, 212],
    [38, -40, -40],
    [39, 4.1858, 1],
    [40, 1, 4.1858],
  ];
  for (const [code, v, want] of cases) test(`${convLabel(code)} ${v}`, () => assert.ok(close(conv(code, v) as number, want)));
  test('round trips and errors', () => {
    for (let code = 1; code <= 40; code += 2) {
      const there = conv(code, 12.5) as number;
      assert.ok(close(conv(code + 1, there) as number, 12.5), convLabel(code));
    }
    assert.equal(conv(0, 1), 'Math ERROR');
    assert.equal(conv(41, 1), 'Math ERROR');
    // MthIO shows terminating decimals as fractions (P07 engine rule).
    assert.equal(calc('5conv1'), '127/10');
    assert.equal(calc('1+1conv1'), '177/50');
  });
});

describe('RATIO', () => {
  const cases: [Parameters<typeof ratioSolve>, number | string][] = [
    [['A:B=X:D', 2, 3, 4], 8 / 3],
    [['A:B=X:D', 1, 2, 10], 5],
    [['A:B=X:D', 2, 0, 4], 'Math ERROR'],
    [['A:B=X:D', 0, 5, 4], 0],
    [['A:B=C:X', 2, 3, 4], 6],
    [['A:B=C:X', 0.1, 0.3, 0.2], 0.6],
    [['A:B=C:X', 0, 3, 4], 'Math ERROR'],
    [['A:B=C:X', 1e-60, 1e60, 1e60], 'Math ERROR'],
  ];
  for (const [args, want] of cases) {
    test(args.join(' '), () => {
      const r = ratioSolve(...args);
      if (typeof want === 'string') assert.equal(r, want);
      else assert.ok(typeof r === 'number' && close(r, want), String(r));
    });
  }
});

describe('INEQ', () => {
  const cases: [2 | 3, number[], IneqRel, string[] | string][] = [
    [2, [1, -3, 2], '>', ['x<1', '2<x']],
    [2, [1, -3, 2], '<', ['1<x<2']],
    [2, [1, -3, 2], '≥', ['x≤1', '2≤x']],
    [2, [1, -3, 2], '≤', ['1≤x≤2']],
    [2, [-1, 0, 1], '>', ['−1<x<1']],
    [2, [1, 0, 1], '>', ['All Real Numbers']],
    [2, [1, 0, 1], '<', ['No Solution']],
    [2, [1, -2, 1], '>', ['x≠1']],
    [2, [1, -2, 1], '≥', ['All Real Numbers']],
    [2, [1, -2, 1], '<', ['No Solution']],
    [2, [1, -2, 1], '≤', ['x=1']],
    [2, [1, 0, -2], '<', ['−√2<x<√2']],
    [2, [2, -1, 0], '>', ['x<0', '1/2<x']],
    [3, [1, 0, -1, 0], '>', ['−1<x<0', '1<x']],
    [3, [1, 0, -1, 0], '≤', ['x≤−1', '0≤x≤1']],
    [3, [1, -1, 0, 0], '<', ['x<0', '0<x<1']],
    [3, [1, -1, 0, 0], '≥', ['x=0', '1≤x']],
    [3, [-1, 0, 0, 1], '>', ['x<1']],
    [3, [1, -3, 3, -1], '≥', ['1≤x']],
    [2, [0, 1, 1], '>', 'Math ERROR'],
    [3, [1, 2], '>', 'Math ERROR'],
  ];
  for (const [deg, coef, rel, want] of cases) {
    test(`${coef.join(',')} ${rel} 0`, () => {
      const r = ineqSolve(deg, coef, rel);
      if (typeof want === 'string') assert.equal(r, want);
      else assert.deepEqual(r, { text: want });
    });
  }
  test('setup-aware formatting', () => {
    assert.deepEqual(ineqSolveWith(2, [1, 0, -2], '<', { ...defaultSetup(), io: 'LineIO' }), { text: ['−1.414213562<x<1.414213562'] });
    assert.deepEqual(ineqSolveWith(2, [2, -3, 1], '<', { ...defaultSetup(), io: 'LineIO', decimal: 'Comma' }), { text: ['0,5<x<1'] });
  });
});

describe('TABLE', () => {
  const ctx = createContext({ mode: 'TABLE' });
  const f = parseLinear('X²');
  const g = parseLinear('2X+1');
  test('f(x) only', () => {
    assert.deepEqual(tableBuild(f, null, 1, 5, 1, ctx), { rows: [[1, 1], [2, 4], [3, 9], [4, 16], [5, 25]] });
  });
  test('f(x) and g(x)', () => {
    assert.deepEqual(tableBuild(f, g, -1, 1, 1, ctx), { rows: [[-1, 1, -1], [0, 0, 1], [1, 1, 3]] });
  });
  test('decimal steps land on End', () => {
    const r = tableBuild(f, null, 0, 1, 0.1, ctx);
    assert.ok(typeof r === 'object');
    assert.equal(r.rows.length, 11);
    assert.equal(r.rows[3][0], 0.3);
    assert.equal(r.rows[10][0], 1);
  });
  test('a negative step counts down', () => {
    const r = tableBuild(f, null, 3, 1, -1, ctx);
    assert.deepEqual(r, { rows: [[3, 9], [2, 4], [1, 1]] });
  });
  test('error cells are NaN', () => {
    const r = tableBuild(parseLinear('1÷X'), null, -1, 1, 1, ctx);
    assert.ok(typeof r === 'object');
    assert.equal(r.rows[0][1], -1);
    assert.ok(Number.isNaN(r.rows[1][1]));
    assert.equal(r.rows[2][1], 1);
  });
  test('limits and errors', () => {
    assert.equal(tableRowCount(1, 30, 1, false), 30);
    assert.equal(tableRowCount(1, 31, 1, false), 'Insufficient MEM');
    assert.equal(tableRowCount(1, 20, 1, true), 20);
    assert.equal(tableRowCount(1, 21, 1, true), 'Insufficient MEM');
    assert.equal(tableBuild(f, null, 1, 5, 0, ctx), 'Math ERROR');
    assert.equal(tableBuild(f, null, 5, 1, 1, ctx), 'Math ERROR');
    assert.equal(tableBuild([], null, 1, 5, 1, ctx), 'Syntax ERROR');
    assert.equal(tableBuild(f, g, 1, 25, 1, ctx), 'Insufficient MEM');
  });
  test('the whole table shares one time budget', () => {
    // A fake clock that moves 400 ms per reading: the 1000 ms budget runs out after a few cells.
    let t = 0;
    const now = () => (t += 400);
    assert.equal(tableBuildWith(f, null, 1, 10, 1, ctx, { now, timeLimitMs: 1000 }), 'Time Out');
    // A clock that stands still never runs out.
    const r = tableBuildWith(f, g, 1, 20, 1, ctx, { now: () => 0, timeLimitMs: 1 });
    assert.ok(typeof r === 'object' && r.rows.length === 20 && r.rows[19][2] === 41);
  });
  test('other variables keep their values; the angle unit applies', () => {
    const r = tableBuildWith(parseLinear('sin(X)'), null, 0, 90, 30, { ...ctx, setup: { ...ctx.setup, angle: 'Deg' } });
    assert.ok(typeof r === 'object');
    assert.ok(close(r.rows[1][1], 0.5) && close(r.rows[3][1], 1));
  });
});

describe('DRG and CMPLX', () => {
  test('DRG menu and conversions', () => {
    assert.deepEqual(DRG_MENU.map((d) => d.op), ['°', 'ʳ', 'ᵍ']);
    assert.ok(close(drgConvert(180, 'Deg', 'Rad'), Math.PI));
    assert.ok(close(drgConvert(100, 'Gra', 'Deg'), 90));
    assert.equal(calc('πʳ', 'COMP', 'Deg'), '180');
    assert.equal(calc('90@°', 'COMP', 'Rad'), 'π/2');
    assert.equal(calc('200ᵍ', 'COMP', 'Deg'), '180');
  });
  test('CMPLX menu and errors', () => {
    assert.deepEqual([...CMPLX_MENU], ['arg', 'Conjg', '▶r∠θ', '▶a+bi']);
    assert.equal(calc('sin(i)', 'CMPLX'), 'Math ERROR');
    assert.equal(calc('ln(1+i)', 'CMPLX'), 'Math ERROR');
    assert.equal(calc('(1+i)!', 'CMPLX'), 'Math ERROR');
    assert.equal(calc('(1+2i)(3−i)', 'CMPLX'), '5+5i');
    assert.equal(calc('Abs(3+4i)', 'CMPLX'), '5');
  });
  test('Rnd rounds both parts', () => {
    const ctx = createContext({ mode: 'CMPLX', setup: { ...defaultSetup(), io: 'LineIO', disp: { mode: 'Fix', n: 2 } } });
    const r = evaluate(parseLinear('Rnd(1.23456+2.34567i)'), ctx);
    assert.ok(r.ok);
    assert.ok(r.value.t === 'cplx' && r.value.re === 1.23 && r.value.im === 2.35);
  });
});
