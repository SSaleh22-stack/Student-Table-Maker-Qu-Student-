import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getStroke, strokeOptions } from '../../../src/notebook/core/ink/freehand.ts';
import type { FreehandOptions } from '../../../src/notebook/core/ink/freehand.ts';
import {
  STREAMLINE_WINDOW,
  WET_FORCE_WINDOW,
  WET_HEADER,
  WET_MAX_POINTS,
  wetCarry,
  wetCreate,
  wetReset,
  wetShouldSplit,
  wetStep,
} from '../../../src/notebook/core/ink/wetOutline.ts';
import type { WetStepResult } from '../../../src/notebook/core/ink/wetOutline.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function genStroke(seed: number, n: number, step: number, turn: number): number[] {
  const r = rng(seed);
  const pts: number[] = [];
  let x = 100;
  let y = 100;
  let a = r() * 6.28;
  for (let i = 0; i < n; i++) {
    pts.push(x, y, 0.2 + 0.7 * r());
    a += (r() - 0.5) * turn * 2;
    const s = step * (0.3 + r());
    x += Math.cos(a) * s;
    y += Math.sin(a) * s;
  }
  return pts;
}

/** Collects the frozen parts and rebuilds the full outline from them and the tail. */
function collector() {
  const left: number[] = [];
  const right: number[] = [];
  let cap: number[] = [];
  return {
    add(r: WetStepResult) {
      left.push(...r.frozenLeft);
      right.push(...r.frozenRight);
      if (r.startCap.length) cap = r.startCap;
    },
    full(r: WetStepResult): number[] {
      if (left.length === 0 && right.length === 0) return r.tail;
      const out = left.concat(r.tail.slice(2, -2));
      for (let k = right.length - 2; k >= 0; k -= 2) out.push(right[k], right[k + 1]);
      return out.concat(cap);
    },
  };
}

function maxDiff(a: number[], b: number[]): number {
  assert.equal(a.length, b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Largest distance from a point of poly a to the nearest edge of the closed polygon b. */
function directedHausdorff(a: number[], b: number[]): number {
  let worst = 0;
  const n = b.length / 2;
  for (let i = 0; i < a.length; i += 2) {
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      const ax = b[k * 2];
      const ay = b[k * 2 + 1];
      const bx = b[((k + 1) % n) * 2];
      const by = b[((k + 1) % n) * 2 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((a[i] - ax) * dx + (a[i + 1] - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(ax + dx * t - a[i], ay + dy * t - a[i + 1]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

const OPTION_SETS: FreehandOptions[] = [
  strokeOptions({ tool: 'pen', width: 3, pressure: true }, false),
  strokeOptions({ tool: 'highlighter', width: 18, pressure: false }, false),
  {},
  { size: 8, thinning: 0 },
  { size: 6, taperStart: 20, taperEnd: 15 },
  { size: 4, capStart: false, capEnd: false },
];

describe('wetStep equivalence', () => {
  test('frozen patches + tail equal the full getStroke at every step (within 0.5 pt; exact in practice)', () => {
    let worst = 0;
    let steps = 0;
    for (let seed = 1; seed < 13; seed++) {
      for (const base of OPTION_SETS) {
        const n = 220;
        const all = genStroke(seed, n, 1 + (seed % 6), seed % 3 === 0 ? 2.5 : 0.35);
        const st = wetCreate();
        const c = collector();
        for (let k = 1; k <= n; k++) {
          const o = { ...base, last: k === n };
          const pts = all.slice(0, k * 3);
          const r = wetStep(st, pts, o);
          c.add(r);
          worst = Math.max(worst, maxDiff(c.full(r), getStroke(pts, o)));
          steps++;
        }
      }
    }
    assert.ok(worst <= 0.5, `worst ${worst}`);
    assert.equal(worst, 0);
    assert.ok(steps > 15000);
  });

  test('short strokes (1 and 2 points) are the plain getStroke', () => {
    const st = wetCreate();
    const pts = [10, 10, 0.5, 20, 12, 0.5];
    assert.deepEqual(wetStep(st, pts.slice(0, 3)).tail, getStroke(pts.slice(0, 3)));
    const r = wetStep(st, pts);
    assert.deepEqual(r.tail, getStroke(pts));
    assert.deepEqual(r.frozenOutlineAppend, []);
  });

  test('patches are closed polygons that chain onto each other', () => {
    const all = genStroke(11, 200, 3, 0.3);
    const o = strokeOptions({ tool: 'pen', width: 4, pressure: true }, false);
    const st = wetCreate();
    let first = true;
    let lastL: number[] = [];
    let lastR: number[] = [];
    let patches = 0;
    for (let k = 1; k <= 200; k++) {
      const r = wetStep(st, all.slice(0, k * 3), o);
      if (r.frozenOutlineAppend.length === 0) continue;
      patches++;
      const p = r.frozenOutlineAppend;
      if (first) {
        assert.ok(r.startCap.length > 0);
        assert.deepEqual(p.slice(p.length - r.startCap.length), r.startCap);
        first = false;
      } else {
        assert.deepEqual(r.startCap, []);
        assert.deepEqual(p.slice(0, 2), lastL);
        assert.deepEqual(p.slice(-2), lastR);
      }
      if (r.frozenLeft.length) lastL = r.frozenLeft.slice(-2);
      if (r.frozenRight.length) lastR = r.frozenRight.slice(-2);
      // the tail starts at the last frozen left point and ends at the last frozen right point
      assert.deepEqual(r.tail.slice(0, 2), lastL);
      assert.deepEqual(r.tail.slice(-2), lastR);
    }
    assert.ok(patches > 100);
  });
});

describe('wetStep work per event (instrumented)', () => {
  test('a long moving stroke does O(STREAMLINE_WINDOW) work per step, independent of its length', () => {
    const n = WET_MAX_POINTS;
    const all = genStroke(5, n, 2.5, 0.3);
    const o = strokeOptions({ tool: 'pen', width: 3, pressure: true }, false);
    const st = wetCreate();
    let maxWork = 0;
    let lateMax = 0;
    for (let k = 1; k <= n; k++) {
      const r = wetStep(st, all.slice(0, k * 3), o);
      assert.equal(st[21], r.work);
      if (k > 3) maxWork = Math.max(maxWork, r.work);
      if (k > n - 500) lateMax = Math.max(lateMax, r.work);
      if (k === n) assert.ok(r.tail.length / 2 < 200, 'the tail stays short');
    }
    assert.ok(maxWork <= STREAMLINE_WINDOW + 8, `max work ${maxWork}`);
    assert.ok(lateMax <= STREAMLINE_WINDOW + 8);
    // the state holds only the permanent stroke points
    assert.ok(st.length <= WET_HEADER + n * 7);
  });

  test('a resting pen is bounded by the forced freeze and stays close to getStroke', () => {
    const r0 = rng(9);
    const pts: number[] = [];
    // a short line, then 200 jittering samples at the tip
    for (let i = 0; i < 30; i++) pts.push(50 + i * 2, 80, 0.5);
    for (let i = 0; i < 200; i++) pts.push(108 + (r0() - 0.5) * 0.1, 80 + (r0() - 0.5) * 0.1, 0.5);
    const o = strokeOptions({ tool: 'pen', width: 3, pressure: false }, false);
    const st = wetCreate();
    const c = collector();
    let maxWork = 0;
    let r: WetStepResult | null = null;
    const n = pts.length / 3;
    for (let k = 1; k <= n; k++) {
      r = wetStep(st, pts.slice(0, k * 3), o);
      c.add(r);
      if (k > 3) maxWork = Math.max(maxWork, r.work);
    }
    assert.ok(maxWork <= WET_FORCE_WINDOW + 8, `max work ${maxWork}`);
    assert.ok(r);
    const wet = c.full(r);
    const full = getStroke(pts, o);
    assert.ok(directedHausdorff(wet, full) <= 0.5);
    assert.ok(directedHausdorff(full, wet) <= 0.5);
  });

  test('after a forced freeze the wet outline is exact again once the pen moves on (tapered end too)', () => {
    const r0 = rng(21);
    const pts: number[] = [];
    for (let i = 0; i < 30; i++) pts.push(50 + i * 2, 80, 0.5);
    for (let i = 0; i < 150; i++) pts.push(108 + (r0() - 0.5) * 0.1, 80 + (r0() - 0.5) * 0.1, 0.5);
    for (let i = 0; i < 60; i++) pts.push(108 + i * 2, 80 + i * 0.5, 0.5);
    for (const o of [strokeOptions({ tool: 'pen', width: 3, pressure: true }, false), { size: 6, taperEnd: 12 } as FreehandOptions]) {
      const st = wetCreate();
      const c = collector();
      let r: WetStepResult | null = null;
      const n = pts.length / 3;
      for (let k = 1; k <= n; k++) {
        r = wetStep(st, pts.slice(0, k * 3), o);
        c.add(r);
      }
      assert.ok(r);
      assert.equal(maxDiff(c.full(r), getStroke(pts, o)), 0);
    }
  });

  test('whole-stroke tapers freeze nothing but stay correct', () => {
    const all = genStroke(4, 80, 3, 0.3);
    const o: FreehandOptions = { size: 5, taperStart: true, taperEnd: true };
    const st = wetCreate();
    for (let k = 1; k <= 80; k++) {
      const pts = all.slice(0, k * 3);
      const r = wetStep(st, pts, o);
      assert.deepEqual(r.frozenOutlineAppend, []);
      assert.deepEqual(r.tail, getStroke(pts, o));
    }
  });
});

describe('wet state lifecycle', () => {
  test('a shorter point list resets the state (a new stroke)', () => {
    const a = genStroke(1, 60, 3, 0.3);
    const b = genStroke(2, 40, 3, 0.3);
    const st = wetCreate();
    for (let k = 1; k <= 60; k++) wetStep(st, a.slice(0, k * 3));
    const c = collector();
    let r: WetStepResult | null = null;
    for (let k = 1; k <= 40; k++) {
      r = wetStep(st, b.slice(0, k * 3));
      c.add(r);
    }
    assert.ok(r);
    assert.deepEqual(c.full(r), getStroke(b));
    wetReset(st);
    assert.equal(st.length, WET_HEADER);
    assert.equal(st[0], 0);
  });

  test('WET_MAX_POINTS split and carry', () => {
    assert.equal(WET_MAX_POINTS, 4000);
    assert.equal(STREAMLINE_WINDOW, 16);
    const pts = genStroke(3, WET_MAX_POINTS, 1, 0.2);
    assert.equal(wetShouldSplit(pts.slice(0, (WET_MAX_POINTS - 1) * 3)), false);
    assert.equal(wetShouldSplit(pts), true);
    assert.deepEqual(wetCarry(pts), pts.slice(-3));
    assert.deepEqual(wetCarry([]), []);
    // the committed stroke ends exactly at the carried point (last: true uses the raw point)
    const done = getStroke(pts, { size: 3, thinning: 0, last: true });
    const carry = wetCarry(pts);
    let near = Infinity;
    for (let i = 0; i < done.length; i += 2) near = Math.min(near, Math.hypot(done[i] - carry[0], done[i + 1] - carry[1]));
    assert.ok(Math.abs(near - 1.5) <= 1e-6, String(near));
  });
});
