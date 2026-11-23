/**
 * Freehand parity: the vendored flat-array perfect-freehand (src/notebook/core/ink/freehand.ts)
 * against (1) committed golden outlines and (2) a direct transcription of upstream 1.2.x kept in this
 * file, over thousands of generated strokes and option sets. The vendored code must match exactly.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  getStroke,
  getStrokeOutlinePoints,
  getStrokePoints,
  maxOutlineRadius,
  SP_STRIDE,
  strokeOptions,
} from '../../../src/notebook/core/ink/freehand.ts';
import type { FreehandOptions } from '../../../src/notebook/core/ink/freehand.ts';

/** Golden outlines (rounded to 0.001) from the upstream-transcription reference below. Committed; do not regenerate from the vendored code. */
const GOLDEN: { name: string; pts: number[]; o: FreehandOptions; outline: number[] }[] = [
  {
    name: "pen pressure curve",
    pts: [10,10,0.3,14,11,0.4,19,13,0.5,25,16,0.6,31,20,0.7,36,25,0.7,40,31,0.6,42,38,0.5,43,45,0.4,42,52,0.35],
    o: {size: 4,thinning: 0.5,simulatePressure: false,last: true},
    outline: [
      10.506, 8.482, 15.808, 9.828, 21.703, 12.166, 27.87, 15.447, 33.543, 19.956, 38.287, 25.674, 41.507, 32.488, 43.337, 39.579,
      43.699, 51.943, 43.628, 52.489, 43.387, 52.983, 43, 53.375, 42.509, 53.622, 41.964, 53.7, 41.424, 53.599, 40.943, 53.331,
      40.573, 52.924, 40.353, 52.42, 40.305, 51.872, 40.434, 51.338, 40.728, 50.872, 41.154, 50.525, 41.67, 50.332, 42.219, 50.314,
      42.746, 50.472, 43.195, 50.791, 43.518, 51.236, 43.683, 51.76, 43.671, 52.31, 43.485, 52.828, 43.143, 53.259, 42.681, 53.558,
      42.148, 53.694, 41.6, 53.652, 41.093, 53.438, 40.681, 53.073, 40.408, 52.596, 40.301, 52.056, 40.301, 52.057, 39.868, 40.533,
      37.916, 34.248, 34.944, 28.527, 30.531, 23.692, 25.481, 19.609, 19.945, 16.2, 14.542, 13.622, 9.494, 11.518, 9.145, 11.353,
      8.847, 11.109, 8.615, 10.801, 8.463, 10.446, 8.401, 10.065, 8.432, 9.681, 8.554, 9.315, 8.76, 8.989, 9.038, 8.721,
      9.372, 8.528, 9.743, 8.421, 10.128, 8.405, 10.506, 8.482,
    ],
  },
  {
    name: "simulated default",
    pts: [0,0,0.5,8,2,0.5,18,6,0.5,30,12,0.5,44,20,0.5,60,30,0.5,70,44,0.5,74,60,0.5],
    o: {},
    outline: [
      2.195, -5.487, 19.251, 1.901, 34.832, 9.939, 50.733, 19.295, 63.974, 32.019, 72.26, 47.415, 72.716, 48.758, 72.719, 50.176,
      72.269, 51.521, 71.413, 52.652, 70.241, 53.45, 68.875, 53.832, 67.459, 53.758, 66.141, 53.236, 65.058, 52.32, 64.325, 51.106,
      64.017, 49.722, 64.168, 48.312, 64.761, 47.024, 65.734, 45.992, 66.986, 45.326, 68.384, 45.094, 69.784, 45.321, 71.038, 45.982,
      72.015, 47.01, 72.613, 48.296, 72.769, 49.705, 72.467, 51.091, 71.738, 52.307, 70.659, 53.227, 69.343, 53.754, 67.927, 53.834,
      66.56, 53.457, 65.385, 52.663, 64.524, 51.536, 64.525, 51.537, 57.639, 38.457, 46.003, 27.473, 30.43, 18.926, 15.249, 11.899,
      -2.195, 5.487, -3.444, 4.802, -4.493, 3.838, -5.281, 2.651, -5.762, 1.31, -5.908, -0.107, -5.711, -1.518, -5.182, -2.84,
      -4.352, -3.998, -3.268, -4.923, -1.995, -5.562, -0.606, -5.878, 0.818, -5.852, 2.195, -5.486,
    ],
  },
  {
    name: "sharp corner tapered",
    pts: [0,0,0.5,10,0,0.5,20,0,0.5,30,0,0.5,40,0,0.5,30,1,0.5,20,2,0.5,10,3,0.5,0,4,0.5],
    o: {size: 6,taperStart: 10,taperEnd: 10,streamline: 0.2,last: true},
    outline: [
      0, -0.01, 8.3, -1.78, 18.011, -1.741, 27.962, -1.675, 37.954, -1.627, 38.343, -1.58, 38.71, -1.441, 39.032, -1.218,
      39.292, -0.924, 39.475, -0.577, 39.569, -0.196, 39.569, 0.196, 39.475, 0.577, 39.292, 0.924, 39.032, 1.218, 38.709, 1.441,
      38.343, 1.58, 37.953, 1.627, 31.555, 2.444, 22.093, 3.385, 12.185, 4.355, 0.001, 4.01, 0, 4, -0.001, 3.99,
      11.871, 1.237, 21.767, 0.217, 31.149, -0.784, 37.953, -1.627, 38.343, -1.58, 38.709, -1.441, 39.032, -1.218, 39.292, -0.924,
      39.475, -0.577, 39.569, -0.196, 39.569, 0.196, 39.475, 0.577, 39.292, 0.924, 39.032, 1.218, 38.71, 1.441, 38.343, 1.58,
      37.954, 1.627, 27.962, 1.675, 18.011, 1.741, 8.3, 1.78, 0, 0.01,
    ],
  },
  {
    name: "flat caps, two points",
    pts: [5,5,0.8,45,25,0.2],
    o: {size: 10,thinning: 0,capStart: false,capEnd: false,last: true},
    outline: [
      7.236, 0.528, 18.736, 6.278, 29.374, 11.597, 47.236, 20.528, 47.236, 20.528, 47.214, 20.573, 42.786, 29.427, 42.764, 29.472,
      42.764, 29.472, 24.901, 20.541, 14.264, 15.222, 2.764, 9.472, 2.764, 9.472, 2.719, 9.562, 7.281, 0.438, 7.236, 0.528,
    ],
  },
  {
    name: "single point dot",
    pts: [50,60,0.5],
    o: {size: 6,last: true},
    outline: [
      53.175, 58.825, 53.755, 59.634, 54.047, 60.585, 54.02, 61.58, 53.677, 62.514, 53.054, 63.289, 52.215, 63.825, 51.249, 64.065,
      50.258, 63.984, 49.343, 63.591, 48.603, 62.927, 48.113, 62.06, 47.926, 61.083, 48.06, 60.097, 48.502, 59.205, 49.206, 58.502,
      50.098, 58.06, 51.084, 57.926, 52.061, 58.113, 52.927, 58.603, 53.592, 59.344, 53.985, 60.258, 54.065, 61.25, 53.825, 62.216,
      53.289, 63.054, 52.513, 63.678, 51.579, 64.02, 50.584, 64.047, 49.633, 63.755, 48.825, 63.174, 48.825, 63.175, 48.1, 62.801,
      47.485, 62.265, 47.016, 61.597, 46.72, 60.837, 46.615, 60.027, 46.707, 59.216, 46.99, 58.451, 47.448, 57.776, 48.055, 57.23,
      48.774, 56.845, 49.565, 56.643, 50.381, 56.637, 51.175, 56.825,
    ],
  },
];

// ---- reference: a direct transcription of upstream perfect-freehand 1.2.x (array-of-arrays form)
type V = number[];
const neg = (A: V): V => [-A[0], -A[1]];
const add = (A: V, B: V): V => [A[0] + B[0], A[1] + B[1]];
const sub = (A: V, B: V): V => [A[0] - B[0], A[1] - B[1]];
const mul = (A: V, n: number): V => [A[0] * n, A[1] * n];
const div = (A: V, n: number): V => [A[0] / n, A[1] / n];
const per = (A: V): V => [A[1], -A[0]];
const dpr = (A: V, B: V): number => A[0] * B[0] + A[1] * B[1];
const isEqual = (A: V, B: V): boolean => A[0] === B[0] && A[1] === B[1];
const len = (A: V): number => Math.hypot(A[0], A[1]);
const len2 = (A: V): number => A[0] * A[0] + A[1] * A[1];
const dist2 = (A: V, B: V): number => len2(sub(A, B));
const uni = (A: V): V => div(A, len(A));
const dist = (A: V, B: V): number => Math.hypot(A[1] - B[1], A[0] - B[0]);
const rotAround = (A: V, C: V, r: number): V => {
  const s = Math.sin(r);
  const c = Math.cos(r);
  const px = A[0] - C[0];
  const py = A[1] - C[1];
  const nx = px * c - py * s;
  const ny = px * s + py * c;
  return [nx + C[0], ny + C[1]];
};
const lrp = (A: V, B: V, t: number): V => add(A, mul(sub(B, A), t));
const prj = (A: V, B: V, c: number): V => add(A, mul(B, c));

interface RefOpts {
  size?: number; thinning?: number; smoothing?: number; streamline?: number; simulatePressure?: boolean;
  start?: { taper?: number | boolean; cap?: boolean }; end?: { taper?: number | boolean; cap?: boolean }; last?: boolean;
}
interface SP { point: V; pressure: number; vector: V; distance: number; runningLength: number }

function refStrokePoints(points: number[][], options: RefOpts = {}): SP[] {
  const { streamline = 0.5, size = 16, last: isComplete = false } = options;
  if (points.length === 0) return [];
  const t = 0.15 + (1 - streamline) * 0.85;
  let pts = points;
  if (pts.length === 2) {
    const last = pts[1];
    pts = pts.slice(0, -1);
    for (let i = 1; i < 5; i++) pts.push(lrp(pts[0], last, i / 4));
  }
  if (pts.length === 1) pts = [...pts, [...add(pts[0], [1, 1]), ...pts[0].slice(2)]];
  const strokePoints: SP[] = [{ point: [pts[0][0], pts[0][1]], pressure: pts[0][2] >= 0 ? pts[0][2] : 0.25, vector: [1, 1], distance: 0, runningLength: 0 }];
  let hasReachedMinimumLength = false;
  let runningLength = 0;
  let prev = strokePoints[0];
  const max = pts.length - 1;
  for (let i = 1; i < pts.length; i++) {
    const point = isComplete && i === max ? pts[i].slice(0, 2) : lrp(prev.point, pts[i], t);
    if (isEqual(prev.point, point)) continue;
    const distance = dist(point, prev.point);
    runningLength += distance;
    if (i < max && !hasReachedMinimumLength) {
      if (runningLength < size) continue;
      hasReachedMinimumLength = true;
    }
    prev = { point, pressure: pts[i][2] >= 0 ? pts[i][2] : 0.5, vector: uni(sub(prev.point, point)), distance, runningLength };
    strokePoints.push(prev);
  }
  strokePoints[0].vector = strokePoints[1]?.vector || [0, 0];
  return strokePoints;
}

function refOutline(points: SP[], options: RefOpts = {}): number[][] {
  const { size = 16, smoothing = 0.5, thinning = 0.5, simulatePressure = true, start = {}, end = {}, last: isComplete = false } = options;
  const easing = (t: number) => t;
  const { cap: capStart = true } = start;
  const taperStartEase = (t: number) => t * (2 - t);
  const { cap: capEnd = true } = end;
  const taperEndEase = (t: number) => --t * t * t + 1;
  if (points.length === 0 || size <= 0) return [];
  const totalLength = points[points.length - 1].runningLength;
  const taperStart = start.taper === false ? 0 : start.taper === true ? Math.max(size, totalLength) : (start.taper as number);
  const taperEnd = end.taper === false ? 0 : end.taper === true ? Math.max(size, totalLength) : (end.taper as number);
  const minDistance = Math.pow(size * smoothing, 2);
  const leftPts: number[][] = [];
  const rightPts: number[][] = [];
  const RATE = 0.275;
  const FIXED_PI = Math.PI + 0.0001;
  const getStrokeRadius = (sz: number, th: number, pr: number) => sz * easing(0.5 - th * (0.5 - pr));
  let prevPressure = points.slice(0, 10).reduce((acc, curr) => {
    let pressure = curr.pressure;
    if (simulatePressure) {
      const sp = Math.min(1, curr.distance / size);
      const rp = Math.min(1, 1 - sp);
      pressure = Math.min(1, acc + (rp - acc) * (sp * RATE));
    }
    return (acc + pressure) / 2;
  }, points[0].pressure);
  let radius = getStrokeRadius(size, thinning, points[points.length - 1].pressure);
  let firstRadius: number | undefined = undefined;
  let prevVector = points[0].vector;
  let pl = points[0].point;
  let pr = pl;
  let tl = pl;
  let tr = pr;
  let isPrevPointSharpCorner = false;
  for (let i = 0; i < points.length; i++) {
    let { pressure } = points[i];
    const { point, vector, distance, runningLength } = points[i];
    if (i < points.length - 1 && totalLength - runningLength < 3) continue;
    if (thinning) {
      if (simulatePressure) {
        const sp = Math.min(1, distance / size);
        const rp = Math.min(1, 1 - sp);
        pressure = Math.min(1, prevPressure + (rp - prevPressure) * (sp * RATE));
      }
      radius = getStrokeRadius(size, thinning, pressure);
    } else {
      radius = size / 2;
    }
    if (firstRadius === undefined) firstRadius = radius;
    const ts = runningLength < taperStart ? taperStartEase(runningLength / taperStart) : 1;
    const te = totalLength - runningLength < taperEnd ? taperEndEase((totalLength - runningLength) / taperEnd) : 1;
    radius = Math.max(0.01, radius * Math.min(ts, te));
    const nextVector = (i < points.length - 1 ? points[i + 1] : points[i]).vector;
    const nextDpr = i < points.length - 1 ? dpr(vector, nextVector) : 1.0;
    const prevDpr = dpr(vector, prevVector);
    const isPointSharpCorner = prevDpr < 0 && !isPrevPointSharpCorner;
    const isNextPointSharpCorner = nextDpr !== null && nextDpr < 0;
    if (isPointSharpCorner || isNextPointSharpCorner) {
      const offset = mul(per(prevVector), radius);
      for (let step = 1 / 13, t = 0; t <= 1; t += step) {
        tl = rotAround(sub(point, offset), point, FIXED_PI * t);
        leftPts.push(tl);
        tr = rotAround(add(point, offset), point, FIXED_PI * -t);
        rightPts.push(tr);
      }
      pl = tl;
      pr = tr;
      if (isNextPointSharpCorner) isPrevPointSharpCorner = true;
      continue;
    }
    isPrevPointSharpCorner = false;
    if (i === points.length - 1) {
      const offset = mul(per(vector), radius);
      leftPts.push(sub(point, offset));
      rightPts.push(add(point, offset));
      continue;
    }
    const offset = mul(per(lrp(nextVector, vector, nextDpr)), radius);
    tl = sub(point, offset);
    if (i <= 1 || dist2(pl, tl) > minDistance) {
      leftPts.push(tl);
      pl = tl;
    }
    tr = add(point, offset);
    if (i <= 1 || dist2(pr, tr) > minDistance) {
      rightPts.push(tr);
      pr = tr;
    }
    prevPressure = pressure;
    prevVector = vector;
  }
  const firstPoint = points[0].point.slice(0, 2);
  const lastPoint = points.length > 1 ? points[points.length - 1].point.slice(0, 2) : add(points[0].point, [1, 1]);
  const startCap: number[][] = [];
  const endCap: number[][] = [];
  if (points.length === 1) {
    if (!(taperStart || taperEnd) || isComplete) {
      const st = prj(firstPoint, uni(per(sub(firstPoint, lastPoint))), -(firstRadius || radius));
      const dotPts: number[][] = [];
      for (let step = 1 / 13, t = step; t <= 1; t += step) dotPts.push(rotAround(st, firstPoint, FIXED_PI * 2 * t));
      return dotPts;
    }
  } else {
    if (taperStart || (taperEnd && points.length === 1)) {
      // noop
    } else if (capStart) {
      for (let step = 1 / 13, t = step; t <= 1; t += step) startCap.push(rotAround(rightPts[0], firstPoint, FIXED_PI * t));
    } else {
      const cornersVector = sub(leftPts[0], rightPts[0]);
      const offsetA = mul(cornersVector, 0.5);
      const offsetB = mul(cornersVector, 0.51);
      startCap.push(sub(firstPoint, offsetA), sub(firstPoint, offsetB), add(firstPoint, offsetB), add(firstPoint, offsetA));
    }
    const direction = per(neg(points[points.length - 1].vector));
    if (taperEnd || (taperStart && points.length === 1)) {
      endCap.push(lastPoint);
    } else if (capEnd) {
      const st = prj(lastPoint, direction, radius);
      for (let step = 1 / 29, t = step; t < 1; t += step) endCap.push(rotAround(st, lastPoint, FIXED_PI * 3 * t));
    } else {
      endCap.push(add(lastPoint, mul(direction, radius)), add(lastPoint, mul(direction, radius * 0.99)), sub(lastPoint, mul(direction, radius * 0.99)), sub(lastPoint, mul(direction, radius)));
    }
  }
  return leftPts.concat(endCap, rightPts.reverse(), startCap);
}

/** Reference getStroke on flat [x, y, p] input and flat options; returns flat [x, y]. */
function refGetStroke(flat: number[], o: { size?: number; thinning?: number; smoothing?: number; streamline?: number; simulatePressure?: boolean; taperStart?: number | boolean; taperEnd?: number | boolean; capStart?: boolean; capEnd?: boolean; last?: boolean } = {}): number[] {
  const pts: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
  const ro: RefOpts = {
    size: o.size, thinning: o.thinning, smoothing: o.smoothing, streamline: o.streamline, simulatePressure: o.simulatePressure, last: o.last,
    start: { taper: o.taperStart, cap: o.capStart }, end: { taper: o.taperEnd, cap: o.capEnd },
  };
  const out = refOutline(refStrokePoints(pts, ro), ro);
  const f: number[] = [];
  for (const p of out) f.push(p[0], p[1]);
  return f;
}
// ---- end of reference

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A wandering stroke: flat x, y, p. turn > 2 gives sharp corners. */
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

const OPTION_SETS: FreehandOptions[] = [
  {},
  { size: 3, thinning: 0.5, simulatePressure: false, last: true },
  { size: 8, thinning: 0 },
  { size: 6, taperStart: 20, taperEnd: 15 },
  { size: 5, taperStart: true, taperEnd: true, last: true },
  { size: 4, capStart: false, capEnd: false },
  { size: 12, smoothing: 0.2, streamline: 0.1 },
  { size: 2, thinning: -0.4, streamline: 0.9, last: true },
  { size: 0 },
  { size: 7, taperEnd: 5, last: false },
];

describe('freehand golden vectors', () => {
  for (const g of GOLDEN) {
    test(g.name, () => {
      const out = getStroke(g.pts, g.o);
      assert.equal(out.length, g.outline.length);
      for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i] - g.outline[i]) <= 0.0006, `${g.name} [${i}] ${out[i]} vs ${g.outline[i]}`);
    });
  }
  test('the reference transcription reproduces the golden vectors', () => {
    for (const g of GOLDEN) {
      const out = refGetStroke(g.pts.slice(), g.o);
      assert.equal(out.length, g.outline.length);
      for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i] - g.outline[i]) <= 0.0006);
    }
  });
});

describe('freehand parity with upstream', () => {
  test('identical outlines over generated strokes and option sets', () => {
    let cases = 0;
    for (let seed = 1; seed < 80; seed++) {
      for (const o of OPTION_SETS) {
        for (const n of [1, 2, 3, 5, 12, 40]) {
          const pts = genStroke(seed, n, 1 + (seed % 7), seed % 3 === 0 ? 2.5 : 0.35);
          const want = refGetStroke(pts.slice(), o);
          const got = getStroke(pts, o);
          assert.equal(got.length, want.length, `seed ${seed} n ${n} ${JSON.stringify(o)}`);
          for (let i = 0; i < got.length; i++) {
            if (Number.isNaN(want[i])) assert.ok(Number.isNaN(got[i]));
            else assert.equal(got[i], want[i]);
          }
          cases++;
        }
      }
    }
    assert.ok(cases > 4000);
  });

  test('stroke points match upstream field by field', () => {
    const pts = genStroke(7, 30, 3, 0.4);
    const sp = getStrokePoints(pts, { size: 4, last: true });
    const tri: number[][] = [];
    for (let i = 0; i < pts.length; i += 3) tri.push([pts[i], pts[i + 1], pts[i + 2]]);
    const ref = refStrokePoints(tri, { size: 4, last: true });
    assert.equal(sp.length, ref.length * SP_STRIDE);
    ref.forEach((r, i) => {
      const o = i * SP_STRIDE;
      assert.deepEqual(sp.slice(o, o + SP_STRIDE), [r.point[0], r.point[1], r.pressure, r.vector[0], r.vector[1], r.distance, r.runningLength]);
    });
    assert.deepEqual(getStrokeOutlinePoints(sp, { size: 4, last: true }), getStroke(pts, { size: 4, last: true }));
  });

  test('duplicate points, missing pressure and empty input', () => {
    assert.deepEqual(getStroke([]), []);
    const dup = [5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5, 9, 9, -1, 9, 9, NaN, 20, 4, 0.5];
    assert.deepEqual(getStroke(dup, { size: 5 }), refGetStroke(dup.slice(), { size: 5 }));
    const out = getStroke([1, 2, 0.5], { size: 6, last: true });
    // one point becomes two stroke points 1 pt apart (upstream), so this is a short capsule
    assert.deepEqual(out, refGetStroke([[1, 2, 0.5]].flat(), { size: 6, last: true }));
    assert.ok(out.length > 20);
    for (let i = 0; i < out.length; i += 2) assert.ok(Math.hypot(out[i] - 1, out[i + 1] - 2) < 6);
  });
});

describe('app stroke styles', () => {
  test('pen with pressure thins, finger pen and highlighter keep a constant width', () => {
    assert.equal(strokeOptions({ tool: 'pen', width: 3, pressure: true }, false).thinning, 0.5);
    assert.equal(strokeOptions({ tool: 'pen', width: 3, pressure: false }, true).thinning, 0);
    const hl = strokeOptions({ tool: 'highlighter', width: 18, pressure: true }, true);
    assert.equal(hl.thinning, 0);
    assert.equal(hl.size, 18);
    assert.equal(hl.last, true);
    assert.equal(maxOutlineRadius(strokeOptions({ tool: 'pen', width: 4, pressure: true }, true)), 3);
    assert.equal(maxOutlineRadius(hl), 9);
  });

  test('a constant-width stroke stays within its radius of the centerline', () => {
    const pts = genStroke(3, 60, 4, 0.3);
    const o = strokeOptions({ tool: 'highlighter', width: 10, pressure: false }, true);
    const out = getStroke(pts, o);
    for (let i = 0; i < out.length; i += 2) {
      let best = Infinity;
      for (let k = 0; k < pts.length; k += 3) best = Math.min(best, Math.hypot(out[i] - pts[k], out[i + 1] - pts[k + 1]));
      assert.ok(best <= 5 + 4 + 1e-9, `outline point ${i / 2} is ${best} from the input`);
    }
  });
});
