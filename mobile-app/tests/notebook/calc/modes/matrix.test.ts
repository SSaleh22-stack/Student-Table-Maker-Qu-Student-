import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { evaluate, parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext } from '../../../../src/notebook/core/calc/context.ts';
import { resetRegistry } from '../../../../src/notebook/core/calc/registry.ts';
import type { CalcContext, CalcValue, MatValue, VctValue } from '../../../../src/notebook/core/calc/types.ts';
import { installModes } from '../../../../src/notebook/core/calc/modes/index.ts';
import {
  isValidDims, makeMat, matAddSub, matDet, matInverse, matMul, matPow, matTranspose, zeroMat,
} from '../../../../src/notebook/core/calc/modes/matrix.ts';
import { isValidDim, makeVct, vctAbs, vctCross, vctDot } from '../../../../src/notebook/core/calc/modes/vector.ts';

before(() => installModes());
after(() => resetRegistry());

const A = makeMat([[1, 2], [3, 4]]);
const B = makeMat([[5, 6], [7, 8]]);
const C3 = makeMat([[2, 0, 1], [1, 3, 2], [1, 1, 2]]);
const R23 = makeMat([[1, 2, 3], [4, 5, 6]]);

function matCtx(): CalcContext {
  const ctx = createContext({ mode: 'MATRIX' });
  return { ...ctx, mats: { A, B, C: R23, Ans: null } };
}

function vctCtx(): CalcContext {
  const ctx = createContext({ mode: 'VECTOR' });
  return { ...ctx, vcts: { A: makeVct([1, 2, 3]), B: makeVct([4, 5, 6]), C: makeVct([3, 4]), Ans: null } };
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}

function assertMat(v: CalcValue | string, m: number[][]): void {
  assert.equal(typeof v, 'object', `expected a matrix, got ${String(v)}`);
  const mv = v as MatValue;
  assert.equal(mv.t, 'mat');
  assert.equal(mv.m.length, m.length);
  mv.m.forEach((row, i) => {
    assert.equal(row.length, m[i].length);
    row.forEach((x, j) => assert.ok(close(x, m[i][j]), `cell ${i},${j}: ${x} vs ${m[i][j]}`));
  });
}

function assertVct(v: CalcValue | string, e: number[]): void {
  assert.equal(typeof v, 'object', `expected a vector, got ${String(v)}`);
  const vv = v as VctValue;
  assert.equal(vv.t, 'vct');
  assert.equal(vv.v.length, e.length);
  vv.v.forEach((x, i) => assert.ok(close(x, e[i]), `element ${i}: ${x} vs ${e[i]}`));
}

function assertReal(v: CalcValue | string, x: number): void {
  assert.equal(typeof v, 'object', `expected a number, got ${String(v)}`);
  const rv = v as CalcValue;
  assert.equal(rv.t, 'real');
  assert.ok(rv.t === 'real' && close(rv.x, x), JSON.stringify(rv, (_k, val) => (typeof val === 'bigint' ? String(val) : val)));
}

function check(got: CalcValue | string, want: number[][] | number | string): void {
  if (typeof want === 'string') assert.equal(got, want);
  else if (typeof want === 'number') assertReal(got, want);
  else assertMat(got, want);
}

function run(text: string, ctx: CalcContext): CalcValue | string {
  const r = evaluate(parseLinear(text), ctx);
  return r.ok ? r.value : r.error;
}

describe('matrix functions', () => {
  const cases: [string, () => CalcValue | string, number[][] | number | string][] = [
    ['A+B', () => matAddSub('+', A, B), [[6, 8], [10, 12]]],
    ['A−B', () => matAddSub('-', A, B), [[-4, -4], [-4, -4]]],
    ['A+R23 dims', () => matAddSub('+', A, R23), 'Dimension ERROR'],
    ['A×B', () => matMul(A, B), [[19, 22], [43, 50]]],
    ['A×R23', () => matMul(A, R23), [[9, 12, 15], [19, 26, 33]]],
    ['R23×A dims', () => matMul(R23, A), 'Dimension ERROR'],
    ['Trn R23', () => matTranspose(R23), [[1, 4], [2, 5], [3, 6]]],
    ['det A', () => matDet(A), -2],
    ['det C3', () => matDet(C3), 6],
    ['det 1×1', () => matDet(makeMat([[7]])), 7],
    ['det R23', () => matDet(R23), 'Dimension ERROR'],
    ['A⁻¹', () => matInverse(A), [[-2, 1], [1.5, -0.5]]],
    ['1×1 inverse', () => matInverse(makeMat([[4]])), [[0.25]]],
    ['singular inverse', () => matInverse(makeMat([[1, 2], [2, 4]])), 'Math ERROR'],
    ['non-square inverse', () => matInverse(R23), 'Dimension ERROR'],
    ['A²', () => matPow(A, 2), [[7, 10], [15, 22]]],
    ['A³', () => matPow(A, 3), [[37, 54], [81, 118]]],
    ['R23²', () => matPow(R23, 2), 'Dimension ERROR'],
    ['0.1 + 0.2 elements', () => matAddSub('+', makeMat([[0.1]]), makeMat([[0.2]])), [[0.3]]],
    ['float inverse', () => matInverse(makeMat([[Math.SQRT2, 0], [0, Math.SQRT2]])), [[Math.SQRT1_2, 0], [0, Math.SQRT1_2]]],
  ];
  for (const [name, f, want] of cases) test(name, () => check(f(), want));

  test('C3 × C3⁻¹ is the identity', () => {
    const inv = matInverse(C3);
    assert.equal(typeof inv, 'object');
    assertMat(matMul(C3, inv as MatValue), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });

  test('dims and zero matrices', () => {
    assert.equal(isValidDims(1, 3), true);
    assert.equal(isValidDims(0, 2), false);
    assert.equal(isValidDims(4, 1), false);
    assertMat(zeroMat(2, 3), [[0, 0, 0], [0, 0, 0]]);
  });
});

describe('matrix expressions through the engine', () => {
  const cases: [string, number[][] | number | string][] = [
    ['MatA+MatB', [[6, 8], [10, 12]]],
    ['MatA×MatB', [[19, 22], [43, 50]]],
    ['MatAMatB', [[19, 22], [43, 50]]],
    ['2MatA', [[2, 4], [6, 8]]],
    ['MatA×3', [[3, 6], [9, 12]]],
    ['MatA÷2', [[0.5, 1], [1.5, 2]]],
    ['MatA÷0', 'Math ERROR'],
    ['2÷MatA', 'Syntax ERROR'],
    ['MatA÷MatB', 'Syntax ERROR'],
    ['~MatA', [[-1, -2], [-3, -4]]],
    ['MatA−MatB', [[-4, -4], [-4, -4]]],
    ['MatA²', [[7, 10], [15, 22]]],
    ['MatA³', [[37, 54], [81, 118]]],
    ['MatA⁻¹', [[-2, 1], [1.5, -0.5]]],
    ['MatApow{2}', [[7, 10], [15, 22]]],
    ['det(MatA)', -2],
    ['det(MatA×MatB)', 4],
    ['det(MatC)', 'Dimension ERROR'],
    ['det(5)', 'Math ERROR'],
    ['Trn(MatC)', [[1, 4], [2, 5], [3, 6]]],
    ['Trn(7)', 'Math ERROR'],
    ['Abs(~MatA)', [[1, 2], [3, 4]]],
    ['MatA+MatC', 'Dimension ERROR'],
    ['MatA+1', 'Syntax ERROR'],
    ['MatAns', 'Dimension ERROR'],
    ['MatA!', 'Math ERROR'],
    ['sin(MatA)', 'Math ERROR'],
  ];
  for (const [text, want] of cases) test(text, () => check(run(text, matCtx()), want));

  test('a matrix result goes to MatAns', () => {
    const r = evaluate(parseLinear('MatA×2'), matCtx());
    assert.ok(r.ok);
    assertMat(r.ctx.mats.Ans as MatValue, [[2, 4], [6, 8]]);
    assertMat(run('MatAns+MatA', r.ctx), [[3, 6], [9, 12]]);
  });

  test('inverse cells format as fractions', () => {
    const r = evaluate(parseLinear('MatA⁻¹'), matCtx());
    assert.ok(r.ok);
    assert.deepEqual(formatValue(r.value, r.ctx.setup).grid, [['−2', '1'], ['3/2', '−1/2']]);
  });
});

describe('vectors', () => {
  const a = makeVct([1, 2, 3]);
  const b = makeVct([4, 5, 6]);
  test('dot, cross, length', () => {
    assertReal(vctDot(a, b), 32);
    assertVct(vctCross(a, b), [-3, 6, -3]);
    assertVct(vctCross(makeVct([1, 0]), makeVct([0, 1])), [0, 0, 1]);
    assertReal(vctAbs(makeVct([3, 4])), 5);
    assert.equal(vctDot(a, makeVct([1, 2])), 'Dimension ERROR');
    assert.equal(vctCross(a, makeVct([1, 2])), 'Dimension ERROR');
    assert.equal(isValidDim(2), true);
    assert.equal(isValidDim(4), false);
  });

  const cases: [string, number[] | number | string][] = [
    ['VctA+VctB', [5, 7, 9]],
    ['VctB−VctA', [3, 3, 3]],
    ['VctA×VctB', [-3, 6, -3]],
    ['VctA·VctB', 32],
    ['Dot(VctA,VctB)', 32],
    ['2VctA', [2, 4, 6]],
    ['VctB÷2', [2, 2.5, 3]],
    ['VctB÷0', 'Math ERROR'],
    ['~VctA', [-1, -2, -3]],
    ['Abs(VctC)', 5],
    ['VctA+VctC', 'Dimension ERROR'],
    ['VctA·VctC', 'Dimension ERROR'],
    ['VctA+1', 'Syntax ERROR'],
    ['2·3', 'Syntax ERROR'],
    ['VctA²', 'Math ERROR'],
  ];
  for (const [text, want] of cases) {
    test(text, () => {
      const got = run(text, vctCtx());
      if (Array.isArray(want)) assertVct(got, want);
      else if (typeof want === 'number') assertReal(got, want);
      else assert.equal(got, want);
    });
  }

  test('|[1,1]| is exactly √2', () => {
    assert.equal(formatValue(vctAbs(makeVct([1, 1])), createContext().setup).text, '√2');
  });
});
