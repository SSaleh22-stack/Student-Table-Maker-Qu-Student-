import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatCell, formatNumber, formatValue, roundForDisplay } from '../../../../src/notebook/core/calc/format.ts';
import { formatDms, toDms } from '../../../../src/notebook/core/calc/dms.ts';
import { defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import { complex, real, realQ } from '../../../../src/notebook/core/calc/num/value.ts';
import { q } from '../../../../src/notebook/core/calc/num/rational.ts';
import { errorHint, isCalcError } from '../../../../src/notebook/core/calc/errors.ts';
import type { CalcSetup, DispFormat } from '../../../../src/notebook/core/calc/types.ts';

const setup = (disp: DispFormat = { mode: 'Norm', n: 1 }, more: Partial<CalcSetup> = {}): CalcSetup => ({ ...defaultSetup(), disp, ...more });
const NORM1 = setup();
const NORM2 = setup({ mode: 'Norm', n: 2 });

describe('Norm 1 and Norm 2 (10-digit mantissa)', () => {
  const cases: [number, string, string][] = [
    [0, '0', '0'],
    [1, '1', '1'],
    [-0.5, '−0.5', '−0.5'],
    [0.01, '0.01', '0.01'],
    [0.009, '9×10⁻³', '0.009'],
    [1e-9, '1×10⁻⁹', '0.000000001'],
    [1.5e-10, '1.5×10⁻¹⁰', '1.5×10⁻¹⁰'],
    [1 / 3, '0.3333333333', '0.3333333333'],
    [2 / 3, '0.6666666667', '0.6666666667'],
    [1234567890, '1234567890', '1234567890'],
    [9999999999.4, '9999999999', '9999999999'],
    [9999999999.6, '1×10¹⁰', '1×10¹⁰'],
    [12345678901, '1.23456789×10¹⁰', '1.23456789×10¹⁰'],
    [123456789012345, '1.23456789×10¹⁴', '1.23456789×10¹⁴'],
    [-6.02214076e23, '−6.02214076×10²³', '−6.02214076×10²³'],
    [1e99, '1×10⁹⁹', '1×10⁹⁹'],
    [Math.PI, '3.141592654', '3.141592654'],
  ];
  for (const [x, n1, n2] of cases) {
    test(`${x}: Norm1 ${n1}, Norm2 ${n2}`, () => {
      assert.equal(formatNumber(x, NORM1).text, n1);
      assert.equal(formatNumber(x, NORM2).text, n2);
    });
  }
  test('×10ⁿ results split mantissa and exponent', () => {
    assert.deepEqual(formatNumber(1.5e-10, NORM1).sci, { mantissa: '1.5', exp: -10 });
  });
});

describe('Fix and Sci', () => {
  const cases: [number, DispFormat, string][] = [
    [Math.PI, { mode: 'Fix', n: 2 }, '3.14'],
    [Math.PI, { mode: 'Fix', n: 0 }, '3'],
    [2.5, { mode: 'Fix', n: 0 }, '3'],
    [1.005, { mode: 'Fix', n: 2 }, '1.01'],
    [1e-5, { mode: 'Fix', n: 3 }, '0.000'],
    [-1e-5, { mode: 'Fix', n: 3 }, '0.000'],
    [0, { mode: 'Fix', n: 4 }, '0.0000'],
    [1234567890, { mode: 'Fix', n: 3 }, '1234567890'],
    [123456.789, { mode: 'Fix', n: 9 }, '123456.7890'],
    [12345678901, { mode: 'Fix', n: 2 }, '1.23456789×10¹⁰'],
    [1 / 3, { mode: 'Sci', n: 4 }, '3.333×10⁻¹'],
    [123456, { mode: 'Sci', n: 2 }, '1.2×10⁵'],
    [123456, { mode: 'Sci', n: 0 }, '1.234560000×10⁵'],
    [-0.00042, { mode: 'Sci', n: 3 }, '−4.20×10⁻⁴'],
    [0, { mode: 'Sci', n: 3 }, '0.00×10⁰'],
  ];
  for (const [x, disp, want] of cases) test(`${x} ${disp.mode} ${disp.n} = ${want}`, () => assert.equal(formatNumber(x, setup(disp)).text, want));
  test('Rnd rounds to what is shown', () => {
    assert.equal(roundForDisplay(Math.PI, setup({ mode: 'Fix', n: 3 })), 3.142);
    assert.equal(roundForDisplay(123456, setup({ mode: 'Sci', n: 2 })), 120000);
    assert.equal(roundForDisplay(1 / 3, NORM1), 0.3333333333);
  });
});

describe('ENG and ←ENG', () => {
  const cases: [number, number, string][] = [
    [1234, 1, '1.234×10³'],
    [1234, 2, '1234×10⁰'],
    [1234, 3, '1234000×10⁻³'],
    [123, -1, '0.123×10³'],
    [123, -2, '0.000123×10⁶'],
    [0.01, 1, '10×10⁻³'],
    [56088, 1, '56.088×10³'],
    [-0.5, 1, '−500×10⁻³'],
    [0, 1, '0'],
    [1e99, -1, '1×10⁹⁹'],
  ];
  for (const [x, eng, want] of cases) test(`${x} eng ${eng} = ${want}`, () => assert.equal(formatNumber(x, NORM1, eng).text, want));
  test('ENG on an exact value shows the decimal', () => {
    const d = formatValue(realQ(q(1n, 4n)), NORM1, { eng: 1 });
    assert.equal(d.text, '250×10⁻³');
    assert.deepEqual(d.sci, { mantissa: '250', exp: -3 });
  });
});

describe('decimal mark, DMS', () => {
  test('comma decimal mark', () => {
    const c = setup(undefined, { decimal: 'Comma' });
    assert.equal(formatNumber(1.5, c).text, '1,5');
    assert.equal(formatNumber(1.5e-12, c).text, '1,5×10⁻¹²');
    assert.equal(formatValue(real(2.5), { ...c, io: 'LineIO' }).text, '2,5');
  });
  const dms: [number, string][] = [
    [1.5, `1°30'0"`],
    [2.5083333333333333, `2°30'30"`],
    [-1.75, `−1°45'0"`],
    [0.999999999999, `1°0'0"`],
    [12.3456, `12°20'44.16"`],
    [0, `0°0'0"`],
  ];
  for (const [x, want] of dms) test(`DMS ${x} = ${want}`, () => assert.equal(formatDms(x), want));
  test('DMS parts and comma', () => {
    assert.deepEqual(toDms(10.2), { neg: false, d: 10, m: 12, s: 0 });
    assert.equal(formatDms(1.0001, 'Comma'), `1°0'0,36"`);
    assert.equal(formatValue(real(1.5), NORM1, { dms: true }).text, `1°30'0"`);
  });
});

describe('formatValue forms', () => {
  test('fraction, mixed and math rows', () => {
    const d = formatValue(realQ(q(-2n, 3n)), NORM1);
    assert.equal(d.form, 'frac');
    assert.equal(d.text, '−2/3');
    assert.deepEqual(d.math, [{ k: 'neg' }, { k: 'frac', num: [{ k: 'digit', d: '2' }], den: [{ k: 'digit', d: '3' }] }]);
    assert.equal(d.canSD, true);
    const m = formatValue(realQ(q(5n, 2n)), NORM1, { frac: 'ab/c' });
    assert.equal(m.form, 'mixed');
    assert.equal(m.text, '2 1/2');
  });
  test('surd and π math rows', () => {
    const s = formatValue({ t: 'real', x: Math.sqrt(3) * 2 / 3, exact: { k: 'surd', terms: [{ c: q(2n, 3n), r: 3n }] } }, NORM1);
    assert.equal(s.text, '2√3/3');
    assert.deepEqual(s.math, [{ k: 'frac', num: [{ k: 'digit', d: '2' }, { k: 'fn', name: '√', args: [[{ k: 'digit', d: '3' }]] }], den: [{ k: 'digit', d: '3' }] }]);
    const p = formatValue({ t: 'real', x: (2 * Math.PI) / 3, exact: { k: 'pi', q: q(2n, 3n) } }, NORM1);
    assert.equal(p.text, '2π/3');
    assert.equal(p.form, 'pi');
  });
  test('integers and plain decimals cannot S⇔D', () => {
    assert.equal(formatValue(realQ(q(4n)), NORM1).canSD, false);
    assert.equal(formatValue(real(Math.E), NORM1).canSD, false);
    assert.equal(formatValue(real(Math.E), NORM1).form, 'dec');
  });
  test('complex rectangular and polar', () => {
    assert.equal(formatValue(complex(3, -4), NORM1).text, '3−4i');
    assert.equal(formatValue(complex(0, -1), NORM1).text, '−i');
    assert.equal(formatValue(complex(1.5, 2), NORM1).text, '3/2+2i');
    assert.equal(formatValue(complex(1, 1), setup(undefined, { cmplx: 'r∠θ' })).text, '√2∠45');
    assert.equal(formatValue(complex(1, 1, null, true), NORM1).text, '√2∠45');
    assert.equal(formatValue(complex(0, 2), setup(undefined, { cmplx: 'r∠θ', angle: 'Rad' })).text, '2∠π/2');
    assert.equal(formatValue(complex(1.5, 2), NORM1, { sd: true }).text, '1.5+2i');
  });
  test('BASE-N values in each radix', () => {
    assert.equal(formatValue({ t: 'base', n: 255 }, NORM1, { base: 16 }).text, '000000FF');
    assert.equal(formatValue({ t: 'base', n: -1 }, NORM1, { base: 16 }).text, 'FFFFFFFF');
    assert.equal(formatValue({ t: 'base', n: 5 }, NORM1, { base: 2 }).text, '0000000000000101');
    assert.equal(formatValue({ t: 'base', n: 8 }, NORM1, { base: 8 }).text, '00000000010');
    assert.equal(formatValue({ t: 'base', n: -12 }, NORM1, { base: 10 }).text, '−12');
  });
  test('matrix, vector and Pol/Rec pair', () => {
    const m = formatValue({ t: 'mat', m: [[1, 0.5], [-2, 1 / 3]] }, NORM1);
    assert.deepEqual(m.grid, [['1', '1/2'], ['−2', '1/3']]);
    assert.equal(m.form, 'mat');
    assert.deepEqual(formatValue({ t: 'vct', v: [1, 2, 3] }, NORM1).grid, [['1', '2', '3']]);
    const p = formatValue({ t: 'pair', kind: 'pol', a: Math.SQRT2, b: 45 }, NORM1);
    assert.deepEqual(p.lines, ['r=√2', 'θ=45']);
    assert.deepEqual(formatValue({ t: 'pair', kind: 'rec', a: 1, b: -1 }, NORM1).lines, ['X=1', 'Y=−1']);
    assert.equal(formatCell(0.25, setup(undefined, { io: 'LineIO' })), '0.25');
  });
});

describe('errors.ts', () => {
  test('error checks and hints', () => {
    assert.equal(isCalcError('Math ERROR'), true);
    assert.equal(isCalcError('nope'), false);
    assert.equal(isCalcError(real(1)), false);
    assert.deepEqual(errorHint('Syntax ERROR'), ['[AC] :Cancel', '[◀][▶]:Goto']);
    assert.deepEqual(errorHint("Can't Solve"), ['[AC] :Cancel']);
  });
});
