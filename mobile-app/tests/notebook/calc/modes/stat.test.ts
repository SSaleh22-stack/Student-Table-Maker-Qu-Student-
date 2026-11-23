import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { evaluate, parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { createContext } from '../../../../src/notebook/core/calc/context.ts';
import { resetRegistry } from '../../../../src/notebook/core/calc/registry.ts';
import type { CalcContext, StatData, StatKind, StatVar } from '../../../../src/notebook/core/calc/types.ts';
import { STAT_KINDS, STAT_VARS } from '../../../../src/notebook/core/calc/types.ts';
import { installModes } from '../../../../src/notebook/core/calc/modes/index.ts';
import { quartiles, statCompute, statMaxRows, statMenus, statVarValue } from '../../../../src/notebook/core/calc/modes/stat.ts';
import { estimateX, estimateX12, estimateY, fitRegression } from '../../../../src/notebook/core/calc/modes/regression.ts';
import { distP, distQ, distR, normalizedVariate } from '../../../../src/notebook/core/calc/modes/distr.ts';

before(() => installModes());
after(() => resetRegistry());

function data(kind: StatKind, x: number[], y: number[] = [], freq?: number[]): StatData {
  return { kind, x, y: y.length ? y : x.map(() => 0), freq: freq ?? x.map(() => 1) };
}

function close(a: number | null, b: number, tol = 1e-9): boolean {
  return a !== null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

function statCtx(d: StatData): CalcContext {
  return { ...createContext({ mode: 'STAT' }), stat: d };
}

function run(text: string, ctx: CalcContext): number | string {
  const r = evaluate(parseLinear(text), ctx);
  if (!r.ok) return r.error;
  return r.value.t === 'real' ? r.value.x : `not real: ${r.value.t}`;
}

const ONE = data('1-VAR', [1, 2, 3, 4, 5]);

describe('1-VAR', () => {
  const s = statCompute(ONE);
  const cases: [StatVar, number | null][] = [
    ['n', 5], ['x̄', 3], ['σx', Math.SQRT2], ['sx', Math.sqrt(2.5)], ['Σx', 15], ['Σx²', 55],
    ['minX', 1], ['maxX', 5], ['Q1', 1.5], ['med', 3], ['Q3', 4.5],
    ['ȳ', null], ['Σxy', null], ['A', null], ['r', null], ['Σx³', null], ['ŷ', null],
  ];
  for (const [name, want] of cases) {
    test(`${name} = ${String(want)}`, () => {
      if (want === null) assert.equal(s[name], null);
      else assert.ok(close(s[name], want), `${name}: ${String(s[name])}`);
    });
  }

  test('every StatVar has a key', () => {
    assert.deepEqual(Object.keys(s).sort(), [...STAT_VARS].sort());
  });

  test('frequencies', () => {
    const f = statCompute(data('1-VAR', [1, 2, 3], [], [2, 1, 1]));
    assert.equal(f.n, 4);
    assert.ok(close(f['x̄'], 7 / 4));
    assert.equal(f.med, 1.5);
    assert.equal(f.Q1, 1);
    assert.equal(f.Q3, 2.5);
  });

  test('frequency 0 rows are left out; a negative one makes everything undefined', () => {
    assert.equal(statCompute(data('1-VAR', [1, 100], [], [1, 0])).maxX, 1);
    const bad = statCompute(data('1-VAR', [1, 2], [], [1, -1]));
    assert.ok(STAT_VARS.every((v) => bad[v] === null));
  });

  test('non-integer frequencies keep the sums but not the quartiles', () => {
    const f = statCompute(data('1-VAR', [2, 4], [], [0.5, 1.5]));
    assert.equal(f.n, 2);
    assert.ok(close(f['x̄'], 3.5));
    assert.equal(f.med, null);
  });

  const quart: [number[], number, number, number][] = [
    [[1, 2, 3, 4, 5, 6, 7], 2, 4, 6],
    [[1, 2, 3, 4, 5, 6, 7, 8], 2.5, 4.5, 6.5],
    [[7], 7, 7, 7],
    [[3, 1], 1, 2, 3],
    [[5, 1, 3], 1, 3, 5],
  ];
  for (const [xs, q1, med, q3] of quart) {
    test(`quartiles of ${xs.join(',')}`, () => {
      assert.deepEqual(quartiles(xs.map((x) => ({ x, f: 1 }))), { q1, med, q3 });
    });
  }

  test('empty data: n = 0, the rest undefined', () => {
    const e = statCompute(data('1-VAR', []));
    assert.equal(e.n, 0);
    assert.equal(e['Σx'], 0);
    assert.equal(e['x̄'], null);
    assert.equal(e.med, null);
  });

  test('sx needs two values', () => {
    assert.equal(statCompute(data('1-VAR', [4])).sx, null);
  });
});

describe('regressions', () => {
  const xs = [1, 2, 3, 4, 5];
  const make = (kind: StatKind, f: (x: number) => number, x = xs) => data(kind, x, x.map(f));
  const cases: [StatKind, (x: number) => number, number, number, number | null, number[]][] = [
    ['A+BX', (x) => 2 * x + 1, 1, 2, null, [1]],
    ['ln X', (x) => 1 + 2 * Math.log(x), 1, 2, null, [1]],
    ['e^X', (x) => 2 * Math.exp(0.5 * x), 2, 0.5, null, [1]],
    ['A•B^X', (x) => 3 * Math.pow(2, x), 3, 2, null, [1]],
    ['A•X^B', (x) => 2 * Math.pow(x, 3), 2, 3, null, [1]],
    ['1/X', (x) => 1 + 2 / x, 1, 2, null, [1]],
    ['_+CX²', (x) => 1 - 2 * x + 3 * x * x, 1, -2, 3, []],
  ];
  for (const [kind, f, A, B, C, r] of cases) {
    test(kind, () => {
      const s = statCompute(make(kind, f));
      assert.ok(close(s.A, A), `A = ${String(s.A)}`);
      assert.ok(close(s.B, B), `B = ${String(s.B)}`);
      if (C === null) assert.equal(s.C, null);
      else assert.ok(close(s.C, C), `C = ${String(s.C)}`);
      if (r.length) assert.ok(close(s.r, r[0]), `r = ${String(s.r)}`);
      else assert.equal(s.r, null);
      // ŷ at x = 6 and x̂ back.
      const fit = fitRegression(kind === '1-VAR' ? 'A+BX' : kind, make(kind, f).x.map((x) => ({ x, y: f(x), f: 1 })));
      assert.ok(fit);
      assert.ok(close(estimateY(fit, 6), f(6)));
      if (kind === '_+CX²') {
        const both = estimateX12(fit, f(6));
        assert.ok(both);
        assert.ok(close(both.x1, 6) || close(both.x2, 6));
        assert.equal(estimateX(fit, 1), null);
      } else assert.ok(close(estimateX(fit, f(6)), 6));
    });
  }

  test('paired sums and y statistics', () => {
    const s = statCompute(data('A+BX', [1, 2, 3], [2, 4, 7]));
    assert.equal(s['Σy'], 13);
    assert.equal(s['Σy²'], 69);
    assert.equal(s['Σxy'], 31);
    assert.ok(close(s['ȳ'], 13 / 3));
    assert.equal(s.minY, 2);
    assert.equal(s.maxY, 7);
    // The reference Sum menu lists Σx³, Σx²y and Σx⁴ for every paired type, A+BX included.
    assert.equal(s['Σx³'], 36);
    assert.equal(s['Σx²y'], 2 + 16 + 63);
    assert.equal(s['Σx⁴'], 98);
    assert.equal(s.Q1, null);
    const q = statCompute(data('_+CX²', [1, 2, 3], [2, 4, 7]));
    assert.equal(q['Σx³'], 36);
    assert.equal(q['Σx²y'], 2 + 16 + 63);
    assert.equal(q['Σx⁴'], 98);
  });

  test('undefined fits', () => {
    assert.equal(statCompute(data('A+BX', [2, 2, 2], [1, 2, 3])).A, null);
    assert.equal(statCompute(data('ln X', [0, 1, 2], [1, 2, 3])).A, null);
    assert.equal(statCompute(data('e^X', [1, 2, 3], [1, -2, 3])).B, null);
    assert.equal(statCompute(data('_+CX²', [1, 2], [1, 2])).C, null);
    // All y equal: A and B exist, r does not.
    const flat = statCompute(data('A+BX', [1, 2, 3], [5, 5, 5]));
    assert.equal(flat.B, 0);
    assert.equal(flat.r, null);
  });
});

describe('statistics variables through the engine', () => {
  const lin = statCtx(data('A+BX', [1, 2, 3, 4], [3, 5, 7, 9]));
  const quad = statCtx(data('_+CX²', [0, 1, 2, 3], [0, 1, 4, 9]));
  const one = statCtx(ONE);
  const cases: [string, CalcContext, number | string][] = [
    ['$n', one, 5],
    ['$x̄', one, 3],
    ['$x̄+$n', one, 8],
    ['2$σx²', one, 4],
    ['$med', one, 3],
    ['$A', lin, 1],
    ['$B', lin, 2],
    ['$r', lin, 1],
    ['5$ŷ', lin, 11],
    ['11$x̂', lin, 5],
    ['(2+3)$ŷ', lin, 11],
    ['$C', quad, 1],
    ['4$x̂1', quad, 2],
    ['4$x̂2', quad, -2],
    ['3$ŷ', quad, 9],
    ['4$x̂', quad, 'Math ERROR'],
    ['$C', lin, 'Math ERROR'],
    ['$sy', one, 'Math ERROR'],
    ['5$ŷ', one, 'Math ERROR'],
    ['4▶t', one, 1 / Math.SQRT2],
    ['P(0)', one, 0.5],
  ];
  for (const [text, ctx, want] of cases) {
    test(text, () => {
      const got = run(text, ctx);
      if (typeof want === 'string') assert.equal(got, want);
      else assert.ok(typeof got === 'number' && close(got, want), `${text}: ${String(got)}`);
    });
  }

  test('postfix variables need their argument', () => {
    assert.equal(statVarValue('ŷ', lin.stat), 'Syntax ERROR');
  });
});

describe('distributions', () => {
  test('P, Q, R and ▶t', () => {
    assert.ok(close(distP(0), 0.5));
    assert.ok(close(distP(1.96), 0.9750021048517795));
    assert.ok(close(distQ(1), 0.3413447460685429));
    assert.ok(close(distQ(-1), -0.3413447460685429));
    assert.ok(close(distR(1), 0.15865525393145707));
    assert.ok(close(normalizedVariate(5, ONE), 2 / Math.SQRT2));
    assert.equal(normalizedVariate(1, data('1-VAR', [2, 2])), null);
    assert.equal(normalizedVariate(1, data('1-VAR', [])), null);
  });
});

describe('editor limits and menus', () => {
  test('rows', () => {
    assert.equal(statMaxRows(false), 40);
    assert.equal(statMaxRows(true), 26);
    assert.equal(statMaxRows(false, 'A+BX'), 40);
    assert.equal(statMaxRows(true, '_+CX²'), 26);
    assert.equal(statMaxRows(false, '1-VAR'), 80);
    assert.equal(statMaxRows(true, '1-VAR'), 40);
  });
  test('menus per type', () => {
    for (const k of STAT_KINDS) {
      const m = statMenus(k);
      assert.equal(m.distr, k === '1-VAR');
      if (k === '1-VAR') assert.deepEqual(m.reg, []);
      else assert.ok(m.reg.includes('ŷ'));
    }
    assert.deepEqual(statMenus('_+CX²').reg, ['A', 'B', 'C', 'x̂1', 'x̂2', 'ŷ']);
    assert.deepEqual(statMenus('A+BX').minmax, ['minX', 'maxX', 'minY', 'maxY']);
    assert.deepEqual(statMenus('A+BX').sum, ['Σx²', 'Σx', 'Σy²', 'Σy', 'Σxy', 'Σx³', 'Σx²y', 'Σx⁴']);
    assert.deepEqual(statMenus('1-VAR').sum, ['Σx²', 'Σx']);
  });
});
