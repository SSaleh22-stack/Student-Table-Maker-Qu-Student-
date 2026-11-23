import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { evaluate, parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext, withVar } from '../../../../src/notebook/core/calc/context.ts';
import { resetRegistry } from '../../../../src/notebook/core/calc/registry.ts';
import { real } from '../../../../src/notebook/core/calc/num/value.ts';
import type { CalcContext, CalcValue, Radix } from '../../../../src/notebook/core/calc/types.ts';
import { installModes } from '../../../../src/notebook/core/calc/modes/index.ts';
import { BASE_LOGIC_MENU, baseText, fitsRadix, parseBase, radixName } from '../../../../src/notebook/core/calc/modes/basen.ts';

before(() => installModes());
after(() => resetRegistry());

function baseCtx(base: Radix): CalcContext {
  return { ...createContext({ mode: 'BASE-N' }), base };
}

/** Evaluates in BASE-N with the given radix and shows the result in that radix. */
function run(text: string, base: Radix, ctx: CalcContext = baseCtx(base)): string {
  const r = evaluate(parseLinear(text, { baseN: true }), ctx);
  if (!r.ok) return r.error;
  return formatValue(r.value, ctx.setup, { base }).text;
}

describe('parseBase', () => {
  const cases: [string, Radix, number | string][] = [
    ['0', 10, 0],
    ['2147483647', 10, 2147483647],
    ['2147483648', 10, 'Math ERROR'],
    ['00000000012', 10, 12],
    ['FF', 16, 255],
    ['7FFFFFFF', 16, 2147483647],
    ['80000000', 16, -2147483648],
    ['FFFFFFFF', 16, -1],
    ['100000000', 16, 'Math ERROR'],
    ['G', 16, 'Syntax ERROR'],
    ['17', 8, 15],
    ['37777777777', 8, -1],
    ['40000000000', 8, 'Math ERROR'],
    ['8', 8, 'Syntax ERROR'],
    ['1010', 2, 10],
    ['0111111111111111', 2, 32767],
    ['1000000000000000', 2, -32768],
    ['1111111111111111', 2, -1],
    ['10000000000000000', 2, 'Math ERROR'],
    ['2', 2, 'Syntax ERROR'],
    ['A', 10, 'Syntax ERROR'],
    ['', 10, 'Syntax ERROR'],
  ];
  for (const [digits, base, want] of cases) {
    test(`${digits || '(empty)'} in ${radixName(base)}`, () => {
      const r = parseBase(digits, base);
      if (typeof want === 'string') assert.equal(r, want);
      else assert.deepEqual(r, { t: 'base', n: want });
    });
  }
});

describe('BASE-N expressions', () => {
  const cases: [string, Radix, string][] = [
    ['12+34', 10, '46'],
    ['7÷2', 10, '3'],
    ['0−7÷2', 10, '−3'],
    ['~7÷2', 10, '−3'],
    ['5÷0', 10, 'Math ERROR'],
    ['2147483647+1', 10, 'Math ERROR'],
    ['~2147483647−1', 10, '−2147483648'],
    ['65536×65536', 10, 'Math ERROR'],
    ['A+1', 16, '0000000B'],
    ['FFFFFFFF+1', 16, '00000000'],
    ['7FFFFFFF+1', 16, 'Math ERROR'],
    ['1F×2', 16, '0000003E'],
    ['1010and1100', 2, '0000000000001000'],
    ['1010or1100', 2, '0000000000001110'],
    ['1010xor1100', 2, '0000000000000110'],
    ['1010xnor1100', 2, '1111111111111001'],
    ['Not(1010)', 2, '1111111111110101'],
    ['Neg(1)', 2, '1111111111111111'],
    ['Neg(80000000)', 16, 'Math ERROR'],
    ['Not(0)', 16, 'FFFFFFFF'],
    ['0111111111111111+1', 2, 'Math ERROR'],
    ['#d40000+#d1', 2, 'Math ERROR'],
    ['#hFF+#b1', 10, '256'],
    ['#o17+1', 10, '16'],
    ['3and5or8', 10, '9'],
    ['1+2and3', 10, '3'],
    ['255▶Hex', 10, '255'],
    ['77777▶Bin', 10, 'Math ERROR'],
    ['2', 2, 'Syntax ERROR'],
    ['1.5', 10, 'Syntax ERROR'],
    ['sin(1)', 10, 'Math ERROR'],
  ];
  for (const [text, base, want] of cases) test(`${text} in ${radixName(base)}`, () => assert.equal(run(text, base), want));

  test('▶Hex keeps the value for display in hex', () => {
    const ctx = baseCtx(10);
    const r = evaluate(parseLinear('255▶Hex', { baseN: true }), ctx);
    assert.ok(r.ok);
    assert.equal(formatValue(r.value, ctx.setup, { base: 16 }).text, '000000FF');
  });

  test('a real variable counts as its integer part', () => {
    // In BASE-N the letters A to F are hex digits, so use X.
    const ctx = withVar(baseCtx(10), 'X', real(7.9));
    assert.equal(run('X+1', 10, ctx), '8');
    assert.equal(run('Not(X)', 10, ctx), '−8');
  });

  test('Ans keeps BASE-N values', () => {
    const ctx = baseCtx(16);
    const r = evaluate(parseLinear('F', { baseN: true }), ctx);
    assert.ok(r.ok);
    const next = evaluate([{ k: 'ans' }, { k: 'op', op: '+' }, { k: 'digit', d: '1' }], r.ctx);
    assert.ok(next.ok);
    assert.equal(formatValue(next.value, ctx.setup, { base: 16 }).text, '00000010');
  });
});

describe('outside BASE-N', () => {
  const comp = createContext();
  const cases: [string, string][] = [
    ['3and5', 'Syntax ERROR'],
    ['Not(5)', 'Syntax ERROR'],
    ['Neg(5)', 'Syntax ERROR'],
    ['5▶Hex', 'Syntax ERROR'],
  ];
  for (const [text, want] of cases) {
    test(text, () => {
      const r = evaluate(parseLinear(text), comp);
      assert.equal(r.ok ? 'ok' : r.error, want);
    });
  }
});

describe('helpers', () => {
  test('logic menu order (1 and, 2 or, 3 xor, 4 xnor, 5 Not(, 6 Neg()', () => {
    assert.deepEqual([...BASE_LOGIC_MENU], ['and', 'or', 'xor', 'xnor', 'Not', 'Neg']);
  });
  test('fitsRadix', () => {
    assert.equal(fitsRadix(32767, 2), true);
    assert.equal(fitsRadix(32768, 2), false);
    assert.equal(fitsRadix(-32768, 2), true);
    assert.equal(fitsRadix(40000, 16), true);
    assert.equal(fitsRadix(2 ** 31, 10), false);
    assert.equal(fitsRadix(1.5, 10), false);
  });
  test('baseText', () => {
    const cases: [number, Radix, string][] = [
      [-1, 16, 'FFFFFFFF'],
      [-1, 8, '37777777777'],
      [-1, 2, '1111111111111111'],
      [-5, 10, '−5'],
      [10, 2, '0000000000001010'],
    ];
    for (const [n, r, t] of cases) assert.equal(baseText(n, r), t);
    const v: CalcValue = { t: 'base', n: -1 };
    assert.equal(formatValue(v, createContext().setup, { base: 16 }).text, baseText(-1, 16));
  });
});
