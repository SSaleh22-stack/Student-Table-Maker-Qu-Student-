import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatValue } from '../../../../src/notebook/core/calc/format.ts';
import { defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import type { CalcSetup, CalcValue, EqnKind } from '../../../../src/notebook/core/calc/types.ts';
import { EQN_KINDS } from '../../../../src/notebook/core/calc/types.ts';
import {
  EQN_COEF_COUNT, EQN_TYPE_MENU, eqnRootNames, eqnSolve, polyRealRoots, solveCubic, solveLinear,
} from '../../../../src/notebook/core/calc/modes/eqn.ts';

const MTH: CalcSetup = defaultSetup();
const LINE: CalcSetup = { ...defaultSetup(), io: 'LineIO' };

/** The LCD texts of the roots, or the message / error. */
function texts(kind: EqnKind, coef: number[], setup: CalcSetup = MTH): string[] | string {
  const r = eqnSolve(kind, coef);
  if (typeof r === 'string') return r;
  return r.roots.map((v) => formatValue(v, setup).text);
}

describe('EQN results (natural display)', () => {
  const cases: [string, EqnKind, number[], string[] | string][] = [
    // Simultaneous equations.
    ['2x+3y=8, x−y=−1', 'lin2', [2, 3, 8, 1, -1, -1], ['1', '2']],
    ['x+y=1, x−y=0', 'lin2', [1, 1, 1, 1, -1, 0], ['1/2', '1/2']],
    ['0.1x+0.2y=0.3, x+y=2', 'lin2', [0.1, 0.2, 0.3, 1, 1, 2], ['1', '1']],
    ['infinite', 'lin2', [1, 1, 1, 2, 2, 2], 'Infinite Sol'],
    ['no solution', 'lin2', [1, 1, 1, 1, 1, 2], 'No Solution'],
    ['all zero', 'lin2', [0, 0, 0, 0, 0, 0], 'Infinite Sol'],
    ['zero row with a constant', 'lin2', [0, 0, 1, 1, 1, 1], 'No Solution'],
    ['3 unknowns', 'lin3', [1, 1, 1, 6, 2, -1, 1, 3, 1, 2, -1, 2], ['1', '2', '3']],
    ['3 unknowns, fractions', 'lin3', [2, 0, 0, 1, 0, 3, 0, 1, 0, 0, 4, 1], ['1/2', '1/3', '1/4']],
    ['3 unknowns, dependent', 'lin3', [1, 1, 1, 1, 2, 2, 2, 2, 1, 0, 1, 0], 'Infinite Sol'],
    ['3 unknowns, inconsistent', 'lin3', [1, 1, 1, 1, 1, 1, 1, 2, 1, 0, 1, 0], 'No Solution'],
    // Quadratics.
    ['x²−3x+2', 'poly2', [1, -3, 2], ['2', '1']],
    ['−x²+3x−2', 'poly2', [-1, 3, -2], ['2', '1']],
    ['x²−2', 'poly2', [1, 0, -2], ['√2', '−√2']],
    ['x²−2x−1', 'poly2', [1, -2, -1], ['1+√2', '1−√2']],
    ['2x²−x−1', 'poly2', [2, -1, -1], ['1', '−1/2']],
    ['double root', 'poly2', [1, -2, 1], ['1']],
    ['x²+2x+5', 'poly2', [1, 2, 5], ['−1+2i', '−1−2i']],
    ['x²+1', 'poly2', [1, 0, 1], ['i', '−i']],
    ['4x²+1', 'poly2', [4, 0, 1], ['1/2i', '−1/2i']],
    ['a = 0', 'poly2', [0, 2, 1], 'Math ERROR'],
    // Cubics.
    ['x³−6x²+11x−6', 'poly3', [1, -6, 11, -6], ['3', '2', '1']],
    ['2x³−3x²−3x+2', 'poly3', [2, -3, -3, 2], ['2', '1/2', '−1']],
    ['x³−3x+2', 'poly3', [1, 0, -3, 2], ['1', '−2']],
    ['(x−1)³', 'poly3', [1, -3, 3, -1], ['1']],
    ['x³', 'poly3', [1, 0, 0, 0], ['0']],
    ['x³−2x', 'poly3', [1, 0, -2, 0], ['√2', '0', '−√2']],
    ['x³+x', 'poly3', [1, 0, 1, 0], ['0', 'i', '−i']],
    ['x³−x²+x−1', 'poly3', [1, -1, 1, -1], ['1', 'i', '−i']],
    ['a = 0 (cubic)', 'poly3', [0, 1, 2, 3], 'Math ERROR'],
    ['wrong count', 'poly3', [1, 2, 3], 'Math ERROR'],
  ];
  for (const [name, kind, coef, want] of cases) {
    test(name, () => assert.deepEqual(texts(kind, coef), want));
  }
});

function rootValues(r: ReturnType<typeof eqnSolve>): CalcValue[] {
  assert.equal(typeof r, 'object');
  return (r as { roots: CalcValue[] }).roots;
}

describe('EQN numeric roots', () => {
  test('x³ − 2x − 5 (one real root, a complex pair)', () => {
    const roots = rootValues(eqnSolve('poly3', [1, 0, -2, -5]));
    assert.equal(roots.length, 3);
    assert.equal(roots[0].t, 'real');
    const x = roots[0].t === 'real' ? roots[0].x : NaN;
    assert.ok(Math.abs(x - 2.0945514815423265) < 1e-13);
    assert.equal(roots[1].t, 'cplx');
    assert.equal(roots[2].t, 'cplx');
    if (roots[1].t === 'cplx' && roots[2].t === 'cplx') {
      assert.ok(roots[1].im > 0 && roots[2].im < 0);
      assert.ok(Math.abs(roots[1].re + 1.0472757407711633) < 1e-12);
    }
  });

  test('x³ − 1 shows −1/2 ± √3/2 i', () => {
    const t = texts('poly3', [1, 0, 0, -1]);
    assert.ok(Array.isArray(t));
    assert.equal(t[0], '1');
    assert.equal(t.length, 3);
    assert.match(t[1], /^−1\/2\+/);
  });

  test('a large root does not swallow the small ones (X³ − 10⁶X² + 1)', () => {
    const roots = rootValues(eqnSolve('poly3', [1, -1e6, 0, 1]));
    assert.equal(roots.length, 3);
    assert.ok(roots.every((r) => r.t === 'real'));
    const xs = roots.map((r) => (r.t === 'real' ? r.x : NaN));
    assert.ok(Math.abs(xs[0] - 1e6) < 1e-6);
    assert.ok(Math.abs(xs[1] - 0.001) < 1e-12);
    assert.ok(Math.abs(xs[2] + 0.001) < 1e-12);
  });

  test('random cubics with known real roots (float coefficients)', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 2000; k++) {
      const pick = () => (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 8) - 3) * Math.SQRT2;
      const r = [pick(), pick(), pick()];
      const a = 1.7;
      const coef = [a, -a * (r[0] + r[1] + r[2]), a * (r[0] * r[1] + r[0] * r[2] + r[1] * r[2]), -a * r[0] * r[1] * r[2]];
      const xs = rootValues(eqnSolve('poly3', coef)).flatMap((v) => (v.t === 'real' ? [v.x] : []));
      const scale = Math.max(...r.map((x) => Math.abs(x)));
      for (const t of r) {
        assert.ok(xs.some((x) => Math.abs(x - t) <= 1e-6 * Math.max(Math.abs(t), 1e-6 * scale)), `root ${t} of ${coef.join(', ')}`);
      }
    }
  });

  test('irrational coefficients take the float path', () => {
    const roots = rootValues(eqnSolve('poly2', [1, -Math.SQRT2 * 2, 2]));
    assert.equal(roots.length, 1);
    assert.ok(roots[0].t === 'real' && Math.abs(roots[0].x - Math.SQRT2) < 1e-9);
    const r = solveCubic(Math.PI, 0, 0, -Math.PI);
    assert.ok(Array.isArray(r) && r[0].t === 'real' && Math.abs(r[0].x - 1) < 1e-12);
  });

  test('three close real roots', () => {
    const r = polyRealRoots([1, -3.3, 3.62, -1.32]);
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 3);
    [1, 1.1, 1.2].forEach((x, i) => assert.ok(Math.abs(r[i] - x) < 1e-9, `${r[i]}`));
  });

  test('LineIO shows decimals', () => {
    assert.deepEqual(texts('poly2', [1, 0, -2], LINE), ['1.414213562', '−1.414213562']);
    assert.deepEqual(texts('lin2', [1, 1, 1, 1, -1, 0], LINE), ['0.5', '0.5']);
  });

  test('a float linear system', () => {
    const r = solveLinear([[Math.SQRT2, 1], [1, -1]], [Math.SQRT2 + 1, 0]);
    assert.equal(typeof r, 'object');
    if (typeof r === 'object') {
      assert.equal(r.exact, null);
      assert.ok(Math.abs(r.x[0] - 1) < 1e-12 && Math.abs(r.x[1] - 1) < 1e-12);
    }
    assert.equal(solveLinear([[Math.SQRT2, 1], [2 * Math.SQRT2, 2]], [1, 2]), 'Infinite Sol');
    assert.equal(solveLinear([[Math.SQRT2, 1], [2 * Math.SQRT2, 2]], [1, 3]), 'No Solution');
  });
});

describe('EQN tables', () => {
  test('coefficient counts and menu', () => {
    assert.deepEqual(EQN_TYPE_MENU.map((m) => m.kind), [...EQN_KINDS]);
    assert.deepEqual(EQN_KINDS.map((k) => EQN_COEF_COUNT[k]), [6, 12, 3, 4]);
  });
  test('root names', () => {
    assert.deepEqual(eqnRootNames('lin3', 3), ['X', 'Y', 'Z']);
    assert.deepEqual(eqnRootNames('poly2', 2), ['X1', 'X2']);
    assert.deepEqual(eqnRootNames('poly2', 1), ['X']);
  });
});

describe('EQN surd roots keep a cancellation-free float', () => {
  const realRoots = (kind: EqnKind, coef: number[]): number[] => {
    const r = eqnSolve(kind, coef);
    assert.equal(typeof r, 'object');
    if (typeof r === 'string') return [];
    return r.roots.map((v) => (v.t === 'real' ? v.x : Number.NaN));
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.abs(b);
  const cases: [string, EqnKind, number[], number[]][] = [
    ['x²+10¹⁰x+1', 'poly2', [1, 1e10, 1], [-1e-10, -1e10]],
    ['10⁻¹⁰x²+x+1', 'poly2', [1e-10, 1, 1], [-1.0000000001, -9999999999]],
    ['x³+10¹⁰x²+x', 'poly3', [1, 1e10, 1, 0], [0, -1e-10, -1e10]],
  ];
  for (const [name, kind, coef, want] of cases) {
    test(name, () => {
      const got = realRoots(kind, coef);
      assert.equal(got.length, want.length);
      got.forEach((x, i) => assert.ok(x === want[i] || near(x, want[i]), `${name}: root ${i} = ${x}, want ${want[i]}`));
    });
  }
  test('a well-conditioned surd root keeps its exact form', () => {
    assert.deepEqual(texts('poly2', [1, -2, -1]), ['1+√2', '1−√2']);
  });
});
