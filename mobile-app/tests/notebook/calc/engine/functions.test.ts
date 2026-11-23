import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext, defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import { applyFn, applyPost, convertAngle, normalCdf } from '../../../../src/notebook/core/calc/functions.ts';
import { real } from '../../../../src/notebook/core/calc/num/value.ts';
import { nextRandom, ranHash, ranInt, seedFrom } from '../../../../src/notebook/core/calc/random.ts';
import { FN_NAMES, POST_OPS, type AngleUnit, type CalcContext, type CalcSetup } from '../../../../src/notebook/core/calc/types.ts';

function ctx(angle: AngleUnit = 'Deg', setup: Partial<CalcSetup> = {}, mode: 'COMP' | 'CMPLX' = 'COMP'): CalcContext {
  return createContext({ mode, setup: { ...defaultSetup(), angle, ...setup }, seed: 11 });
}

function calc(text: string, c: CalcContext = ctx()): string {
  const r = evaluate(parseLinear(text), c);
  if (!r.ok) return r.error;
  return formatValue(r.value, c.setup).text;
}

function num(text: string, c: CalcContext = ctx()): number {
  const r = evaluate(parseLinear(text), c);
  if (!r.ok) throw new Error(r.error);
  if (r.value.t !== 'real') throw new Error('not real');
  return r.value.x;
}

describe('trigonometry in Deg, Rad and Gra', () => {
  const cases: [AngleUnit, string, string][] = [
    ['Deg', 'sin(30)', '1/2'],
    ['Deg', 'cos(60)', '1/2'],
    ['Deg', 'tan(45)', '1'],
    ['Deg', 'sin(45)', '√2/2'],
    ['Deg', 'cos(30)', '√3/2'],
    ['Deg', 'tan(30)', '√3/3'],
    ['Deg', 'tan(60)', '√3'],
    ['Deg', 'sin(15)', '√6/4−√2/4'],
    ['Deg', 'tan(15)', '2−√3'],
    ['Deg', 'sin(180)', '0'],
    ['Deg', 'cos(270)', '0'],
    ['Deg', 'sin(~30)', '−1/2'],
    ['Deg', 'sin(390)', '1/2'],
    ['Deg', 'sin(1)', '0.01745240644'],
    ['Deg', 'tan(270)', 'Math ERROR'],
    ['Deg', 'sin(9ᴇ9)', 'Math ERROR'],
    ['Rad', 'sin(π÷6)', '1/2'],
    ['Rad', 'cos(π)', '−1'],
    ['Rad', 'tan(π÷4)', '1'],
    ['Rad', 'sin(π)', '0'],
    ['Rad', 'sin(1)', '0.8414709848'],
    ['Rad', 'tan(π÷2)', 'Math ERROR'],
    ['Gra', 'sin(100)', '1'],
    ['Gra', 'cos(50)', '√2/2'],
    ['Deg', 'sin⁻¹(0.5)', '30'],
    ['Deg', 'cos⁻¹(~0.5)', '120'],
    ['Deg', 'tan⁻¹(1)', '45'],
    ['Deg', 'sin⁻¹(sqrt{3}÷2)', '60'],
    ['Deg', 'sin⁻¹(2)', 'Math ERROR'],
    ['Rad', 'sin⁻¹(0.5)', 'π/6'],
    ['Rad', 'cos⁻¹(0)', 'π/2'],
    ['Rad', 'tan⁻¹(sqrt{3})', 'π/3'],
    ['Gra', 'sin⁻¹(1)', '100'],
    ['Deg', 'tan⁻¹(2)', '63.43494882'],
  ];
  for (const [unit, input, want] of cases) test(`${unit} ${input} = ${want}`, () => assert.equal(calc(input, ctx(unit)), want));
});

describe('hyperbolic, logarithms, powers and roots', () => {
  const cases: [string, string][] = [
    ['sinh(0)', '0'],
    ['cosh(0)', '1'],
    ['tanh(1)', '0.761594156'],
    ['sinh(1)', '1.175201194'],
    ['sinh⁻¹(1)', '0.881373587'],
    ['cosh⁻¹(1)', '0'],
    ['cosh⁻¹(0.5)', 'Math ERROR'],
    ['tanh⁻¹(1)', 'Math ERROR'],
    ['log(100)', '2'],
    ['log(0.001)', '−3'],
    ['log(2)', '0.3010299957'],
    ['logb{3}{81}', '4'],
    ['logb{1}{5}', 'Math ERROR'],
    ['ln(1)', '0'],
    ['ln(e)', '1'],
    ['ln(~1)', 'Math ERROR'],
    ['tenpow{3}', '1000'],
    ['tenpow{~2}', '1/100'],
    ['epow{0}', '1'],
    ['epow{1}', '2.718281828'],
    ['sqrt{16}', '4'],
    ['sqrt{12}', '2√3'],
    ['sqrt{frac{1}{2}}', '√2/2'],
    ['sqrt{0.25}', '1/2'],
    ['cbrt{27}', '3'],
    ['cbrt{~8}', '−2'],
    ['cbrt{frac{8}{27}}', '2/3'],
    ['root{4}{81}', '3'],
    ['root{3}{~27}', '−3'],
    ['root{2}{~4}', 'Math ERROR'],
    ['2pow{~1}', '1/2'],
    ['(~2)pow{3}', '−8'],
    ['(~8)pow{frac{1}{3}}', '−2'],
    ['4pow{1.5}', '8'],
    ['0pow{0}', 'Math ERROR'],
    ['0pow{2}', '0'],
    ['sqrt{2}pow{2}', '2'],
    ['(1+sqrt{2})²', '3+2√2'],
  ];
  for (const [input, want] of cases) test(`${input} = ${want}`, () => assert.equal(calc(input), want));
});

describe('other functions', () => {
  test('Abs keeps exactness', () => {
    assert.equal(calc('Abs(~frac{2}{3})'), '2/3');
    assert.equal(calc('abs{~sqrt{2}}'), '√2');
  });
  test('Int and Intg', () => {
    assert.equal(calc('Int(~2.5)'), '−2');
    assert.equal(calc('Intg(~2.5)'), '−3');
    assert.equal(calc('Int(7÷2)'), '3');
    assert.equal(calc('Intg(7÷2)'), '3');
  });
  test('Rnd follows the display format', () => {
    // MthIO shows the rounded decimal as a fraction (as typed decimals are); LineIO shows the decimal.
    assert.equal(calc('Rnd(frac{1}{3})', ctx('Deg', { disp: { mode: 'Fix', n: 2 } })), '33/100');
    assert.equal(calc('Rnd(frac{1}{3})', ctx('Deg', { disp: { mode: 'Fix', n: 2 }, io: 'LineIO' })), '0.33');
    const r = evaluate(parseLinear('Rnd(frac{2}{3})×3'), ctx('Deg', { disp: { mode: 'Fix', n: 3 } }));
    assert.ok(r.ok && r.value.t === 'real');
    assert.equal(r.value.x, 2.001);
    assert.equal(num('Rnd(frac{1}{3})×3'), 0.9999999999);
  });
  test('x! for 0 to 69, exact', () => {
    assert.equal(calc('0!'), '1');
    assert.equal(calc('10!'), '3628800');
    assert.equal(calc('69!'), '1.711224524×10⁹⁸');
    assert.equal(calc('2.5!'), 'Math ERROR');
    assert.equal(calc('~1!'), '−1');
    assert.equal(calc('(~1)!'), 'Math ERROR');
  });
  test('nPr and nCr limits', () => {
    assert.equal(calc('52nCr5'), '2598960');
    assert.equal(calc('10nPr0'), '1');
    assert.equal(calc('3nCr5'), 'Math ERROR');
    assert.equal(calc('2.5nCr1'), 'Math ERROR');
  });
  test('normal distribution P( Q( R(', () => {
    assert.ok(Math.abs(num('P(0)') - 0.5) < 1e-15);
    assert.ok(Math.abs(num('P(1)') - 0.841344746068543) < 1e-13);
    assert.ok(Math.abs(num('Q(1.96)') - 0.4750021048517795) < 1e-13);
    assert.ok(Math.abs(num('R(3)') - 0.00134989803163) < 1e-14);
    assert.ok(Math.abs(normalCdf(-5) - 2.866515718791939e-7) < 1e-19);
  });
  test('RanInt# is seeded and in range', () => {
    const c = ctx();
    for (let k = 0; k < 20; k++) {
      const r = evaluate(parseLinear('RanInt#(1,6)'), { ...c, seed: k });
      assert.ok(r.ok && r.value.t === 'real');
      assert.ok(Number.isInteger(r.value.x) && r.value.x >= 1 && r.value.x <= 6);
    }
    assert.equal(calc('RanInt#(5,1)'), 'Math ERROR');
    assert.equal(calc('RanInt#(1.5,3)'), 'Math ERROR');
  });
  test('DRG suffixes convert to the current unit', () => {
    assert.equal(calc('180@°', ctx('Rad')), 'π');
    assert.equal(calc('πʳ', ctx('Deg')), '180');
    assert.equal(calc('100ᵍ', ctx('Deg')), '90');
    assert.equal(calc('sin(πʳ÷2)', ctx('Deg')), '1');
    assert.equal(calc('90@°', ctx('Gra')), '100');
    const v = convertAngle(real(1), 'Rad', 'Deg');
    assert.ok(Math.abs(v.x - 57.29577951308232) < 1e-12);
  });
  test('Pol θ is in (−180, 180]', () => {
    const r = evaluate(parseLinear('Pol(~1,0)'), ctx());
    assert.ok(r.ok && r.value.t === 'pair');
    assert.equal(r.value.b, 180);
    const r2 = evaluate(parseLinear('Pol(0,~2)'), ctx());
    assert.ok(r2.ok && r2.value.t === 'pair');
    assert.equal(r2.value.b, -90);
  });
});

describe('core coverage of FN_NAMES and POST_OPS', () => {
  const modeOnly = new Set(['det', 'Trn', 'Dot', 'Not', 'Neg']);
  test('every non-mode function answers on a real value', () => {
    const c = ctx('Rad');
    for (const name of FN_NAMES) {
      const args = name === 'Pol' || name === 'Rec' || name === 'RanInt#' || name === 'Dot' ? [real(1), real(2)] : [real(0.5)];
      const r = applyFn(name, args, c, true);
      if (modeOnly.has(name)) assert.equal(r, null, name);
      else assert.notEqual(r, null, name);
    }
  });
  test('postfix operators: core ones answer, mode ones return null', () => {
    const c = ctx();
    const modePost = new Set(['▶t', '▶Dec', '▶Hex', '▶Bin', '▶Oct']);
    for (const op of POST_OPS) {
      const r = applyPost(op, real(3), c, true);
      if (modePost.has(op)) assert.equal(r, null, op);
      else assert.notEqual(r, null, op);
    }
    assert.equal(applyPost('²', { t: 'mat', m: [[1]] }, c, true), null);
  });
});

describe('random.ts', () => {
  test('mulberry32 is deterministic and in [0, 1)', () => {
    let s = 1;
    const seen = new Set<number>();
    for (let k = 0; k < 1000; k++) {
      const r = nextRandom(s);
      assert.ok(r.value >= 0 && r.value < 1);
      seen.add(r.value);
      s = r.seed;
    }
    assert.ok(seen.size > 990);
    assert.deepEqual(nextRandom(42), nextRandom(42));
  });
  test('Ran# has three decimals and RanInt# is inclusive', () => {
    const h = ranHash(5);
    assert.equal(h.value, h.thousandths / 1000);
    const hits = new Set<number>();
    let s = 3;
    for (let k = 0; k < 500; k++) {
      const r = ranInt(1, 3, s);
      hits.add(r.value);
      s = r.seed;
    }
    assert.deepEqual([...hits].sort(), [1, 2, 3]);
    assert.equal(seedFrom(() => 0.5), 2147483648);
  });
});
