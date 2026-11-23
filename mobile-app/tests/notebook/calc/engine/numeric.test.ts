import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { derivative, findRoot, integrate, makeDeadline, sumSeries, SOLVE_MAX_ITER } from '../../../../src/notebook/core/calc/numeric.ts';
import { evaluate, parseLinear, solve } from '../../../../src/notebook/core/calc/eval.ts';
import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { createContext, defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import type { AngleUnit, CalcContext } from '../../../../src/notebook/core/calc/types.ts';

const ctx = (angle: AngleUnit = 'Rad'): CalcContext => createContext({ setup: { ...defaultSetup(), angle } });
/** A clock that never moves (no Time Out). */
const frozen = () => makeDeadline(() => 0, 1000);

function calc(text: string, c: CalcContext = ctx()): string {
  const r = evaluate(parseLinear(text), c);
  if (!r.ok) return r.error;
  return formatValue(r.value, c.setup).text;
}

describe('∫ (Gauss-Kronrod 7-15)', () => {
  const cases: [string, string][] = [
    ['int{X²}{0}{1}', '1/3'],
    ['int{sin(X)}{0}{π}', '2'],
    ['int{cos(X)}{0}{frac{π}{2}}', '1'],
    ['int{frac{1}{X}}{1}{e}', '1'],
    ['int{epow{X}}{0}{1}', '1.718281828'],
    ['int{sqrt{X}}{0}{1}', '2/3'],
    ['int{frac{1}{1+X²}}{0}{1}', 'π/4'],
    ['int{X}{2}{0}', '−2'],
    ['int{X}{1}{1}', '0'],
    ['int{Abs(X)}{~1}{1}', '1'],
    ['int{epow{~X²}}{~5}{5}', '1.772453851'],
  ];
  for (const [input, want] of cases) test(`${input} = ${want}`, () => assert.equal(calc(input), want));
  test('Deg mode integrates trig in degrees', () => assert.equal(calc('int{sin(X)}{0}{180}', ctx('Deg')), '114.591559'));
  test('X is restored after ∫', () => {
    const r = evaluate(parseLinear('X=5:int{X}{0}{1}:X'), ctx());
    assert.ok(r.ok);
    assert.equal(formatValue(r.value, r.ctx.setup).text, '5');
  });
  test('Time Out when the injected clock passes the deadline', () => {
    let t = 0;
    const r = evaluate(parseLinear('int{sin(1÷X)}{0.0001}{1}'), ctx(), { now: () => (t += 500), timeLimitMs: 1000 });
    assert.deepEqual(r, { ok: false, error: 'Time Out', at: 0 });
  });
  test('Time Out when it does not converge', () => {
    const r = integrate((x) => Math.sin(1 / x) / x, 1e-9, 1, frozen(), 50);
    assert.equal(r, 'Time Out');
  });
  test('a domain error inside f is a Math ERROR', () => {
    assert.equal(calc('int{ln(X)}{~1}{1}'), 'Math ERROR');
    assert.equal(integrate(() => 'Math ERROR', 0, 1, frozen()), 'Math ERROR');
  });
});

describe('d/dx (Richardson)', () => {
  const cases: [string, string][] = [
    ['deriv{X³}{2}', '12'],
    ['deriv{sin(X)}{0}', '1'],
    ['deriv{epow{X}}{1}', '2.718281828'],
    ['deriv{ln(X)}{2}', '1/2'],
    ['deriv{sqrt{X}}{4}', '1/4'],
    ['deriv{X²}{~3}', '−6'],
  ];
  for (const [input, want] of cases) test(`${input} = ${want}`, () => assert.equal(calc(input), want));
  test('near a domain edge it shrinks the step', () => {
    const d = derivative((x) => (x < 0 ? 'Math ERROR' : Math.sqrt(x)), 0.001, frozen());
    assert.ok(typeof d === 'number' && Math.abs(d - 0.5 / Math.sqrt(0.001)) < 1e-6);
  });
  test('Time Out with a fast clock', () => {
    let t = 0;
    assert.equal(derivative((x) => x * x, 1, makeDeadline(() => (t += 10), 5)), 'Time Out');
  });
});

describe('Σ', () => {
  const cases: [string, string][] = [
    ['sum{X}{1}{100}', '5050'],
    ['sum{X²}{1}{10}', '385'],
    ['sum{frac{1}{X}}{1}{10}', '7381/2520'],
    ['sum{frac{1}{X²}}{1}{100000}', '1.644924067'],
    ['sum{2}{1}{1000000}', '2000000'],
    ['sum{X}{1}{1000001}', 'Math ERROR'],
    ['sum{X}{1.5}{3}', 'Math ERROR'],
    ['sum{X}{3}{1}', 'Math ERROR'],
  ];
  for (const [input, want] of cases) test(`${input} = ${want}`, () => assert.equal(calc(input), want));
  test('sumSeries with a fast clock times out', () => {
    let t = 0;
    assert.equal(sumSeries((x) => x, 1, 1e6, makeDeadline(() => (t += 1), 100)), 'Time Out');
  });
});

describe('SOLVE (Newton, secant, bisection)', () => {
  const cases: [string, number, number][] = [
    ['X²=2', 1, Math.SQRT2],
    ['X²=2', -1, -Math.SQRT2],
    ['X³-X-1', 1, 1.324717957244746],
    ['cos(X)=X', 0, 0.7390851332151607],
    ['epow{X}=10', 0, Math.log(10)],
    ['2X+3=0', 0, -1.5],
    ['frac{1}{X}=4', 1, 0.25],
    ['Abs(X-3)=0', 0, 3],
    ['X=cos(X)', 1, 0.7390851332151607],
    // A guess outside the domain (the default X = 0) starts from the nearest defined point.
    ['ln(X)=1', 0, Math.E],
    ['sqrt{X}=3', -5, 9],
  ];
  for (const [eq, guess, want] of cases) {
    test(`${eq} from ${guess} -> ${want}`, () => {
      const r = solve(parseLinear(eq), 'X', guess, ctx());
      assert.ok(r.ok, r.ok ? '' : r.error);
      if (r.ok) {
        assert.ok(Math.abs(r.x - want) < 1e-9 * Math.max(1, Math.abs(want)), `${r.x}`);
        assert.ok(Math.abs(r.lr) < 1e-9);
        assert.equal((r.ctx.vars.X as { x: number }).x, r.x);
      }
    });
  }
  test('solves for another variable, using the others', () => {
    const base = createContext();
    const c = { ...base, vars: { ...base.vars, B: { t: 'real' as const, x: 3 } } };
    const r = solve(parseLinear('A×B=12'), 'A', 0, c);
    assert.ok(r.ok && Math.abs(r.x - 4) < 1e-12);
  });
  test("Can't Solve: no real root, a pole, or a run-away to infinity", () => {
    assert.deepEqual(solve(parseLinear('X²+1=0'), 'X', 1, ctx()), { ok: false, error: "Can't Solve" });
    assert.deepEqual(solve(parseLinear('frac{1}{X-1}'), 'X', 0, ctx()), { ok: false, error: "Can't Solve" });
    assert.deepEqual(solve(parseLinear('frac{1}{X}'), 'X', 1, ctx()), { ok: false, error: "Can't Solve" });
  });
  test('findRoot stops after 200 iterations', () => {
    let calls = 0;
    const r = findRoot((x) => {
      calls++;
      return x * x + 1;
    }, 3, frozen());
    assert.equal(r, "Can't Solve");
    assert.ok(calls < SOLVE_MAX_ITER * 4, String(calls));
  });
  test('Time Out with an injected clock', () => {
    let t = 0;
    const r = solve(parseLinear('X²+1=0'), 'X', 1, ctx(), { now: () => (t += 100), timeLimitMs: 1000 });
    assert.deepEqual(r, { ok: false, error: 'Time Out' });
  });
  test('Variable ERROR when the solution variable is not in the equation', () => {
    assert.deepEqual(solve(parseLinear('2+3=5'), 'X', 0, ctx()), { ok: false, error: 'Variable ERROR' });
    assert.deepEqual(solve(parseLinear('A²=4'), 'X', 0, ctx()), { ok: false, error: 'Variable ERROR' });
    assert.equal(solve(parseLinear('A²=4'), 'A', 1, ctx()).ok, true);
  });
  test('syntax errors surface before solving', () => {
    const r = solve(parseLinear('X+=2'), 'X', 0, ctx());
    assert.equal(r.ok ? null : r.error, 'Syntax ERROR');
    const two = solve(parseLinear('X=1:X=2'), 'X', 0, ctx());
    assert.equal(two.ok ? null : two.error, 'Syntax ERROR');
  });
});
