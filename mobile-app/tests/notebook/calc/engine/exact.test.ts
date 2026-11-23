import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  displayableExact, exAdd, exDiv, exEq, exInv, exMul, exPi, exPowInt, exQ, exSqrt, exToNumber, exactInvTrig, exactTrig,
  recognize, toMixed,
} from '../../../../src/notebook/core/calc/exact.ts';
import {
  isqrt, q, qAdd, qApprox, qCmp, qDiv, qFromDecimal, qFromNumber, qMul, qPowInt, qToNumber, squareFree,
} from '../../../../src/notebook/core/calc/num/rational.ts';
import { evaluate, parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext, defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import type { CalcSetup, Exact } from '../../../../src/notebook/core/calc/types.ts';

function show(text: string, setup: Partial<CalcSetup> = {}, sd = false): string {
  const c = createContext({ setup: { ...defaultSetup(), ...setup } });
  const r = evaluate(parseLinear(text), c);
  if (!r.ok) return r.error;
  return formatValue(r.value, c.setup, { sd }).text;
}

const surd = (c: [bigint, bigint], r: bigint): Exact => ({ k: 'surd', terms: [{ c: q(c[0], c[1]), r }] });

describe('rational.ts', () => {
  test('normalization and arithmetic', () => {
    assert.deepEqual(q(6n, -4n), { n: -3n, d: 2n });
    assert.deepEqual(qAdd(q(1n, 3n), q(1n, 6n)), { n: 1n, d: 2n });
    assert.deepEqual(qMul(q(2n, 3n), q(9n, 4n)), { n: 3n, d: 2n });
    assert.equal(qDiv(q(1n), q(0n)), null);
    assert.equal(qCmp(q(1n, 3n), q(1n, 2n)), -1);
    assert.deepEqual(qPowInt(q(2n, 3n), -2), { n: 9n, d: 4n });
    assert.equal(qPowInt(q(10n), 200), null);
  });
  test('decimal literals are exact', () => {
    assert.deepEqual(qFromDecimal('0.125'), { n: 1n, d: 8n });
    assert.deepEqual(qFromDecimal('2.5', -2), { n: 1n, d: 40n });
    assert.deepEqual(qFromDecimal('.5'), { n: 1n, d: 2n });
    assert.equal(qFromDecimal('1.2.3'), null);
    assert.deepEqual(qFromNumber(0.1), { n: 1n, d: 10n });
  });
  test('float conversion of huge rationals', () => {
    const big = q(10n ** 60n + 1n, 3n * 10n ** 59n);
    assert.ok(Math.abs(qToNumber(big) - 10 / 3) < 1e-15);
    assert.equal(qToNumber(q(-1n, 4n)), -0.25);
  });
  test('square-free split, integer roots and approximations', () => {
    assert.deepEqual(squareFree(72n), { s: 6n, r: 2n });
    assert.deepEqual(squareFree(1n), { s: 1n, r: 1n });
    assert.equal(isqrt(10n ** 40n), 10n ** 20n);
    assert.equal(isqrt(99n), 9n);
    // Past the float range (Math.sqrt(Number(n)) would be Infinity).
    assert.equal(isqrt(10n ** 400n), 10n ** 200n);
    assert.equal(isqrt((10n ** 200n + 3n) ** 2n - 1n), 10n ** 200n + 2n);
    assert.equal(isqrt(2n ** 53n + 5n), 94906265n);
    assert.deepEqual(qApprox(0.75, 100, 1e-12), { n: 3n, d: 4n });
    assert.deepEqual(qApprox(-1 / 7, 100, 1e-12), { n: -1n, d: 7n });
    assert.equal(qApprox(Math.PI, 100, 1e-12), null);
  });
});

describe('exact algebra', () => {
  test('surd products and sums', () => {
    const r2 = surd([1n, 1n], 2n);
    const r3 = surd([1n, 1n], 3n);
    assert.ok(exEq(exMul(r2, r2) as Exact, exQ(q(2n))));
    assert.ok(exEq(exMul(r2, surd([1n, 1n], 6n)) as Exact, surd([2n, 1n], 3n)));
    const sum = exAdd(r2, r3) as Exact;
    assert.equal(sum.k, 'surd');
    assert.ok(Math.abs(exToNumber(sum) - (Math.SQRT2 + Math.sqrt(3))) < 1e-15);
    assert.ok(exEq(exAdd(r2, r2) as Exact, surd([2n, 1n], 2n)));
  });
  test('surd floats keep their digits when terms cancel', () => {
    // √(10¹⁶+1) − 10⁸ ≈ 5×10⁻⁹: a float sum gives 0 (Math.sqrt(1e16 + 1) is exactly 1e8).
    const near: Exact = { k: 'surd', terms: [{ c: q(-(10n ** 8n)), r: 1n }, { c: q(1n), r: 10n ** 16n + 1n }] };
    const want = 1 / (2e8 + 5e-9);
    assert.ok(Math.abs(exToNumber(near) - want) / want < 1e-15, String(exToNumber(near)));
    // 7√2 − 9.899494936611665 = 3.4161182106946788…×10⁻¹⁶ (the float sum has no correct digit).
    const r2: Exact = { k: 'surd', terms: [{ c: q(-9899494936611665n, 10n ** 15n), r: 1n }, { c: q(7n), r: 2n }] };
    assert.ok(Math.abs(exToNumber(r2) - 3.4161182106946788e-16) < 1e-30, String(exToNumber(r2)));
    // Same-sign sums stay on the fast float path.
    assert.equal(exToNumber({ k: 'surd', terms: [{ c: q(1n), r: 2n }, { c: q(1n), r: 3n }] }), Math.SQRT2 + Math.sqrt(3));
  });
  test('rationalizing with the conjugate', () => {
    const onePlus = exAdd(exQ(q(1n)), surd([1n, 1n], 2n)) as Exact;
    const inv = exInv(onePlus) as Exact;
    assert.ok(exEq(inv, exAdd(exQ(q(-1n)), surd([1n, 1n], 2n)) as Exact));
    assert.ok(exEq(exInv(surd([2n, 1n], 3n)) as Exact, surd([1n, 6n], 3n)));
  });
  test('π forms', () => {
    assert.ok(exEq(exAdd(exPi(q(1n, 2n)), exPi(q(1n, 3n))) as Exact, exPi(q(5n, 6n))));
    assert.ok(exEq(exDiv(exPi(q(1n)), exPi(q(1n, 2n))) as Exact, exQ(q(2n))));
    assert.equal(exMul(exPi(q(1n)), exPi(q(1n))), null);
    assert.equal(exAdd(exPi(q(1n)), exQ(q(1n))), null);
  });
  test('square roots and powers', () => {
    assert.ok(exEq(exSqrt(exQ(q(1n, 2n))) as Exact, surd([1n, 2n], 2n)));
    assert.ok(exEq(exSqrt(exQ(q(9n, 4n))) as Exact, exQ(q(3n, 2n))));
    assert.equal(exSqrt(exQ(q(-1n))), null);
    const p = exPowInt(exAdd(exQ(q(1n)), surd([1n, 1n], 2n)) as Exact, 3) as Exact; // (1+√2)³ = 7+5√2
    assert.ok(exEq(p, exAdd(exQ(q(7n)), surd([5n, 1n], 2n)) as Exact));
  });
});

describe('exact trigonometry table', () => {
  test('sin, cos and tan at multiples of 15°', () => {
    for (let k = -48; k <= 48; k++) {
      const turn = q(BigInt(k), 24n);
      const rad = (k / 24) * 2 * Math.PI;
      const s = exactTrig('sin', turn) as Exact;
      const c = exactTrig('cos', turn) as Exact;
      assert.ok(Math.abs(exToNumber(s) - Math.sin(rad)) < 1e-14, `sin ${k * 15}`);
      assert.ok(Math.abs(exToNumber(c) - Math.cos(rad)) < 1e-14, `cos ${k * 15}`);
      const t = exactTrig('tan', turn);
      if (((k % 12) + 12) % 12 === 6) assert.equal(t, 'undef');
      else assert.ok(Math.abs(exToNumber(t as Exact) - Math.tan(rad)) < 1e-12, `tan ${k * 15}`);
    }
    assert.equal(exactTrig('sin', q(1n, 7n)), null);
  });
  test('inverse table returns principal angles', () => {
    assert.deepEqual(exactInvTrig('sin', exQ(q(-1n, 2n))), q(-1n, 12n));
    assert.deepEqual(exactInvTrig('cos', exQ(q(-1n, 2n))), q(1n, 3n));
    assert.deepEqual(exactInvTrig('tan', surd([1n, 1n], 3n)), q(1n, 6n));
    assert.equal(exactInvTrig('sin', exQ(q(1n, 3n))), null);
  });
});

describe('recognize (display only)', () => {
  const cases: [number, string][] = [
    [0.5, '1/2'],
    [Math.SQRT2 / 2, '√2/2 surd'],
    [Math.PI / 6, 'π/6'],
    [2 * Math.sqrt(3) / 3, '2√3/3 surd'],
    [0.3333333333333333, '1/3'],
    [7, '7'],
  ];
  for (const [x, label] of cases) {
    test(`${x} -> ${label}`, () => {
      const e = recognize(x);
      assert.ok(e);
      assert.ok(Math.abs(exToNumber(e) - x) < 1e-14);
    });
  }
  test('transcendental values are left alone', () => {
    for (const x of [Math.E, Math.LN2, Math.log(5), Math.sin(1), Math.PI ** 2, 0.1234567891]) assert.equal(recognize(x), null, String(x));
  });
});

describe('display limits, S⇔D and a b/c', () => {
  test('fractions fit in 10 digits', () => {
    assert.equal(displayableExact(exQ(q(12345n, 67891n)), 'd/c'), true);
    assert.equal(displayableExact(exQ(q(123456n, 678917n)), 'd/c'), false);
    assert.equal(displayableExact(surd([1n, 1n], 1001n), 'd/c'), false);
    assert.deepEqual(toMixed(q(-7n, 2n)), { neg: true, whole: 3n, num: 1n, den: 2n });
  });
  const cases: [string, Partial<CalcSetup>, boolean, string][] = [
    ['frac{1}{3}', {}, false, '1/3'],
    ['frac{1}{3}', {}, true, '0.3333333333'],
    ['frac{7}{2}', { frac: 'ab/c' }, false, '3 1/2'],
    ['frac{7}{2}', { frac: 'ab/c', io: 'LineIO' }, true, '3⌟1⌟2'],
    ['frac{7}{2}', { io: 'LineIO' }, false, '3.5'],
    ['frac{7}{2}', { io: 'LineIO' }, true, '7⌟2'],
    ['~frac{7}{2}', { frac: 'ab/c' }, false, '−3 1/2'],
    ['sqrt{2}', { io: 'LineIO' }, false, '1.414213562'],
    ['sqrt{2}', { io: 'LineIO' }, true, '1.414213562'],
    ['sqrt{2}', {}, true, '1.414213562'],
    ['1÷123456×7', {}, false, '7/123456'],
    ['1÷1234567×1', {}, false, '1/1234567'],
    ['1÷12345678901', {}, false, '8.100000073×10⁻¹¹'],
    ['sqrt{1002}', {}, false, '31.65438358'],
    ['2÷4', {}, false, '1/2'],
    ['4÷2', {}, false, '2'],
  ];
  for (const [input, setup, sd, want] of cases) {
    test(`${input} ${JSON.stringify(setup)}${sd ? ' S⇔D' : ''} = ${want}`, () => assert.equal(show(input, setup, sd), want));
  }
});
