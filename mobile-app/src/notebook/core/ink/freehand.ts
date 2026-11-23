/**
 * Vendored perfect-freehand 1.2.x (getStroke, getStrokePoints, getStrokeOutlinePoints), rewritten for
 * flat arrays so it runs as a Reanimated worklet on the UI runtime and in plain Node for the tests.
 *
 * Changes from upstream (the output is the same, number for number):
 * - Input points are flat [x, y, p, x, y, p, ...] triples. Output outlines are flat [x, y, x, y, ...].
 * - Stroke points are flat records of SP_STRIDE (7) numbers: x, y, pressure, vx, vy, distance,
 *   runningLength.
 * - No custom easing functions (worklets cannot take closures): the pressure easing is the identity
 *   and the taper easings are upstream's defaults (t * (2 - t) at the start, (t - 1)^3 + 1 at the end).
 * - start/end options are flattened to taperStart, taperEnd, capStart and capEnd.
 * - The per-point outline step (outlineStep) is exported, so wetOutline.ts can run the same code
 *   incrementally.
 *
 * ---------------------------------------------------------------------------------------------
 * perfect-freehand
 * MIT License
 *
 * Copyright (c) 2021 Stephen Ruiz Ltd
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
 * OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 * ---------------------------------------------------------------------------------------------
 */
import type { StrokeItem } from '../model/index.ts';

export interface FreehandOptions {
  /** Diameter of the stroke at pressure 0.5 (default 16). */
  size?: number;
  /** How much pressure changes the width, -1..1 (default 0.5). 0 = constant width. */
  thinning?: number;
  /** Minimum spacing of outline points as a fraction of size (default 0.5). */
  smoothing?: number;
  /** Input smoothing, 0..1 (default 0.5). */
  streamline?: number;
  /** Derive pressure from speed instead of the input pressure (default true). */
  simulatePressure?: boolean;
  /** Taper distance in pt; true = the whole stroke; false/0 = none (default 0). */
  taperStart?: number | boolean;
  taperEnd?: number | boolean;
  /** Round cap when true, flat when false (default true). Ignored on a tapered end. */
  capStart?: boolean;
  capEnd?: boolean;
  /** The stroke is complete: the last input point is used as is (default false). */
  last?: boolean;
}

export interface ResolvedFreehand {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
  taperStart: number | boolean;
  taperEnd: number | boolean;
  capStart: boolean;
  capEnd: boolean;
  last: boolean;
}

/** Numbers per stroke point: x, y, pressure, vx, vy, distance, runningLength. */
export const SP_STRIDE = 7;
/** Numbers in an outline state (see outlineInit). */
export const OUTLINE_STATE_SIZE = 10;

export function resolveFreehand(o?: FreehandOptions): ResolvedFreehand {
  'worklet';
  return {
    size: o && o.size !== undefined ? o.size : 16,
    thinning: o && o.thinning !== undefined ? o.thinning : 0.5,
    smoothing: o && o.smoothing !== undefined ? o.smoothing : 0.5,
    streamline: o && o.streamline !== undefined ? o.streamline : 0.5,
    simulatePressure: o && o.simulatePressure !== undefined ? o.simulatePressure : true,
    taperStart: o && o.taperStart !== undefined ? o.taperStart : 0,
    taperEnd: o && o.taperEnd !== undefined ? o.taperEnd : 0,
    capStart: o && o.capStart !== undefined ? o.capStart : true,
    capEnd: o && o.capEnd !== undefined ? o.capEnd : true,
    last: o && o.last !== undefined ? o.last : false,
  };
}

/** Upstream: taper === false ? 0 : taper === true ? max(size, totalLength) : taper. */
export function taperLength(taper: number | boolean, size: number, totalLength: number): number {
  'worklet';
  if (taper === false) return 0;
  if (taper === true) return Math.max(size, totalLength);
  return taper;
}

/** Upstream getStrokeRadius with the identity easing. */
export function strokeRadius(size: number, thinning: number, pressure: number): number {
  'worklet';
  return size * (0.5 - thinning * (0.5 - pressure));
}

/**
 * One iteration of getStrokePoints for the raw point (rx, ry, rp). The previous stroke point is the
 * record at base + (count - 1) * SP_STRIDE. rs = [runningLength, hasReachedMinimumLength (0|1)] is
 * updated. Returns true when a record was appended at base + count * SP_STRIDE.
 */
export function strokePointStep(
  sp: number[],
  base: number,
  count: number,
  rx: number,
  ry: number,
  rp: number,
  useRaw: boolean,
  isMax: boolean,
  t: number,
  size: number,
  rs: number[],
): boolean {
  'worklet';
  const po = base + (count - 1) * 7;
  const prx = sp[po];
  const pry = sp[po + 1];
  let x: number;
  let y: number;
  if (useRaw) {
    x = rx;
    y = ry;
  } else {
    // lrp(prev.point, pts[i], t)
    x = prx + (rx - prx) * t;
    y = pry + (ry - pry) * t;
  }
  if (prx === x && pry === y) return false;
  const distance = Math.hypot(y - pry, x - prx);
  rs[0] += distance;
  if (!isMax && !rs[1]) {
    if (rs[0] < size) return false;
    rs[1] = 1;
  }
  // uni(sub(prev.point, point))
  const dx = prx - x;
  const dy = pry - y;
  const l = Math.hypot(dx, dy);
  const o = base + count * 7;
  sp[o] = x;
  sp[o + 1] = y;
  sp[o + 2] = rp >= 0 ? rp : 0.5;
  sp[o + 3] = dx / l;
  sp[o + 4] = dy / l;
  sp[o + 5] = distance;
  sp[o + 6] = rs[0];
  return true;
}

/**
 * Flat stroke points (SP_STRIDE per point) for flat [x, y, p] input. Same as upstream getStrokePoints.
 */
export function getStrokePoints(pts: ArrayLike<number>, o?: FreehandOptions): number[] {
  'worklet';
  const R = resolveFreehand(o);
  let n = Math.floor(pts.length / 3);
  if (n === 0) return [];
  const t = 0.15 + (1 - R.streamline) * 0.85;
  let src: ArrayLike<number> = pts;
  const x0 = pts[0];
  const y0 = pts[1];
  const p0 = pts[2];
  if (n === 2) {
    // Upstream interpolates 4 points between the two. lrp keeps only x and y, so the added points
    // carry no pressure and read as the default 0.5.
    const x1 = pts[3];
    const y1 = pts[4];
    const s: number[] = [x0, y0, p0];
    for (let i = 1; i < 5; i++) s.push(x0 + (x1 - x0) * (i / 4), y0 + (y1 - y0) * (i / 4), NaN);
    src = s;
    n = 5;
  } else if (n === 1) {
    src = [x0, y0, p0, x0 + 1, y0 + 1, p0];
    n = 2;
  }
  const out: number[] = [x0, y0, p0 >= 0 ? p0 : 0.25, 1, 1, 0, 0];
  const rs = [0, 0];
  let count = 1;
  const max = n - 1;
  for (let i = 1; i < n; i++) {
    if (strokePointStep(out, 0, count, src[i * 3], src[i * 3 + 1], src[i * 3 + 2], R.last && i === max, i === max, t, R.size, rs)) {
      count++;
    }
  }
  if (count > 1) {
    out[3] = out[10];
    out[4] = out[11];
  } else {
    out[3] = 0;
    out[4] = 0;
  }
  return out;
}

/**
 * Initialises an outline state at os[oo .. oo + 9] for the first n stroke points at sp[base..]:
 * 0 prevPressure, 1-2 prevVector, 3-4 prev left point, 5-6 prev right point, 7 isPrevPointSharpCorner,
 * 8 firstRadius (NaN = not set yet), 9 radius.
 * prevPressure averages the first 10 points, as upstream does, so n must cover them when available.
 */
export function outlineInit(sp: ArrayLike<number>, base: number, n: number, R: ResolvedFreehand, os: number[], oo: number): void {
  'worklet';
  let acc = sp[base + 2];
  const m = Math.min(10, n);
  for (let k = 0; k < m; k++) {
    const r = base + k * 7;
    let pressure = sp[r + 2];
    if (R.simulatePressure) {
      const s = Math.min(1, sp[r + 5] / R.size);
      const rp = Math.min(1, 1 - s);
      pressure = Math.min(1, acc + (rp - acc) * (s * 0.275));
    }
    acc = (acc + pressure) / 2;
  }
  os[oo] = acc;
  os[oo + 1] = sp[base + 3];
  os[oo + 2] = sp[base + 4];
  os[oo + 3] = sp[base];
  os[oo + 4] = sp[base + 1];
  os[oo + 5] = sp[base];
  os[oo + 6] = sp[base + 1];
  os[oo + 7] = 0;
  os[oo + 8] = NaN;
  os[oo + 9] = strokeRadius(R.size, R.thinning, sp[base + (n - 1) * 7 + 2]);
}

/**
 * One iteration of upstream's outline loop for stroke point i of n. New left and right points are
 * pushed (flat x, y) onto left and right. taperS and taperE are resolved taper lengths, minDistance is
 * (size * smoothing)^2. force = true skips the end-noise rule (used only by wetOutline's forced freeze).
 */
export function outlineStep(
  sp: ArrayLike<number>,
  base: number,
  i: number,
  n: number,
  totalLength: number,
  R: ResolvedFreehand,
  taperS: number,
  taperE: number,
  minDistance: number,
  os: number[],
  oo: number,
  left: number[],
  right: number[],
  force: boolean,
): void {
  'worklet';
  const o = base + i * 7;
  const isLast = i === n - 1;
  const runningLength = sp[o + 6];
  // Removes noise from the end of the line
  if (!isLast && !force && totalLength - runningLength < 3) return;
  const size = R.size;
  const px = sp[o];
  const py = sp[o + 1];
  let pressure = sp[o + 2];
  const vx = sp[o + 3];
  const vy = sp[o + 4];
  const distance = sp[o + 5];
  let radius: number;
  if (R.thinning) {
    if (R.simulatePressure) {
      const s = Math.min(1, distance / size);
      const rp = Math.min(1, 1 - s);
      pressure = Math.min(1, os[oo] + (rp - os[oo]) * (s * 0.275));
    }
    radius = strokeRadius(size, R.thinning, pressure);
  } else {
    radius = size / 2;
  }
  if (os[oo + 8] !== os[oo + 8]) os[oo + 8] = radius;

  let ts = 1;
  if (runningLength < taperS) {
    const k = runningLength / taperS;
    ts = k * (2 - k);
  }
  let te = 1;
  if (totalLength - runningLength < taperE) {
    const k = (totalLength - runningLength) / taperE - 1;
    te = k * k * k + 1;
  }
  radius = Math.max(0.01, radius * Math.min(ts, te));
  os[oo + 9] = radius;

  const no = isLast ? o : o + 7;
  const nvx = sp[no + 3];
  const nvy = sp[no + 4];
  const nextDpr = isLast ? 1.0 : vx * nvx + vy * nvy;
  const prevDpr = vx * os[oo + 1] + vy * os[oo + 2];
  const isPointSharpCorner = prevDpr < 0 && !os[oo + 7];
  const isNextPointSharpCorner = nextDpr < 0;

  if (isPointSharpCorner || isNextPointSharpCorner) {
    // offset = mul(per(prevVector), radius); per(A) = [A[1], -A[0]]
    const ox = os[oo + 2] * radius;
    const oy = -os[oo + 1] * radius;
    let tlx = px;
    let tly = py;
    let trx = px;
    let try_ = py;
    const ax = px - ox;
    const ay = py - oy;
    const bx = px + ox;
    const by = py + oy;
    for (let step = 1 / 13, t = 0; t <= 1; t += step) {
      // rotAround(sub(point, offset), point, FIXED_PI * t)
      let r = (Math.PI + 0.0001) * t;
      let s = Math.sin(r);
      let c = Math.cos(r);
      let dx = ax - px;
      let dy = ay - py;
      tlx = dx * c - dy * s + px;
      tly = dx * s + dy * c + py;
      left.push(tlx, tly);
      // rotAround(add(point, offset), point, FIXED_PI * -t)
      r = (Math.PI + 0.0001) * -t;
      s = Math.sin(r);
      c = Math.cos(r);
      dx = bx - px;
      dy = by - py;
      trx = dx * c - dy * s + px;
      try_ = dx * s + dy * c + py;
      right.push(trx, try_);
    }
    os[oo + 3] = tlx;
    os[oo + 4] = tly;
    os[oo + 5] = trx;
    os[oo + 6] = try_;
    if (isNextPointSharpCorner) os[oo + 7] = 1;
    return;
  }

  os[oo + 7] = 0;

  if (isLast) {
    const ox = vy * radius;
    const oy = -vx * radius;
    left.push(px - ox, py - oy);
    right.push(px + ox, py + oy);
    return;
  }

  // offset = mul(per(lrp(nextVector, vector, nextDpr)), radius)
  const lx = nvx + (vx - nvx) * nextDpr;
  const ly = nvy + (vy - nvy) * nextDpr;
  const ox = ly * radius;
  const oy = -lx * radius;

  const tlx = px - ox;
  const tly = py - oy;
  let dx = os[oo + 3] - tlx;
  let dy = os[oo + 4] - tly;
  if (i <= 1 || dx * dx + dy * dy > minDistance) {
    left.push(tlx, tly);
    os[oo + 3] = tlx;
    os[oo + 4] = tly;
  }
  const trx = px + ox;
  const try_ = py + oy;
  dx = os[oo + 5] - trx;
  dy = os[oo + 6] - try_;
  if (i <= 1 || dx * dx + dy * dy > minDistance) {
    right.push(trx, try_);
    os[oo + 5] = trx;
    os[oo + 6] = try_;
  }
  os[oo] = pressure;
  os[oo + 1] = vx;
  os[oo + 2] = vy;
}

/** rotAround(A, C, r) appended to out. */
function pushRotAround(out: number[], ax: number, ay: number, cx: number, cy: number, r: number): void {
  'worklet';
  const s = Math.sin(r);
  const c = Math.cos(r);
  const px = ax - cx;
  const py = ay - cy;
  out.push(px * c - py * s + cx, px * s + py * c + cy);
}

/**
 * The start cap for a stroke of n points (n > 1): empty for a tapered start, 13 round points, or the
 * 4 points of a flat cap. (l0x, l0y) and (r0x, r0y) are the first left and right outline points.
 */
export function startCapPoints(
  R: ResolvedFreehand,
  n: number,
  fx: number,
  fy: number,
  l0x: number,
  l0y: number,
  r0x: number,
  r0y: number,
  taperS: number,
  taperE: number,
): number[] {
  'worklet';
  const out: number[] = [];
  if (taperS || (taperE && n === 1)) return out;
  if (R.capStart) {
    for (let step = 1 / 13, t = step; t <= 1; t += step) pushRotAround(out, r0x, r0y, fx, fy, (Math.PI + 0.0001) * t);
    return out;
  }
  const cx = l0x - r0x;
  const cy = l0y - r0y;
  const ax = cx * 0.5;
  const ay = cy * 0.5;
  const bx = cx * 0.51;
  const by = cy * 0.51;
  out.push(fx - ax, fy - ay, fx - bx, fy - by, fx + bx, fy + by, fx + ax, fy + ay);
  return out;
}

/** The end cap for a stroke of n points (n > 1) ending at (lx, ly) with last vector (vx, vy). */
export function endCapPoints(
  R: ResolvedFreehand,
  n: number,
  lx: number,
  ly: number,
  vx: number,
  vy: number,
  radius: number,
  taperS: number,
  taperE: number,
): number[] {
  'worklet';
  const out: number[] = [];
  // direction = per(neg(vector))
  const dx = -vy;
  const dy = vx;
  if (taperE || (taperS && n === 1)) {
    out.push(lx, ly);
    return out;
  }
  if (R.capEnd) {
    const sx = lx + dx * radius;
    const sy = ly + dy * radius;
    for (let step = 1 / 29, t = step; t < 1; t += step) pushRotAround(out, sx, sy, lx, ly, (Math.PI + 0.0001) * 3 * t);
    return out;
  }
  const r99 = radius * 0.99;
  out.push(lx + dx * radius, ly + dy * radius, lx + dx * r99, ly + dy * r99, lx - dx * r99, ly - dy * r99, lx - dx * radius, ly - dy * radius);
  return out;
}

/** Appends b to a reversed as points (pairs). */
export function pushReversedPairs(a: number[], b: ArrayLike<number>): void {
  'worklet';
  for (let k = b.length - 2; k >= 0; k -= 2) a.push(b[k], b[k + 1]);
}

/** Outline of the n stroke points at sp[base..]. Same as upstream getStrokeOutlinePoints. */
export function outlineRange(sp: ArrayLike<number>, base: number, n: number, R: ResolvedFreehand): number[] {
  'worklet';
  if (n === 0 || R.size <= 0) return [];
  const lo = base + (n - 1) * 7;
  const totalLength = sp[lo + 6];
  const taperS = taperLength(R.taperStart, R.size, totalLength);
  const taperE = taperLength(R.taperEnd, R.size, totalLength);
  const minDistance = Math.pow(R.size * R.smoothing, 2);
  const os: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  outlineInit(sp, base, n, R, os, 0);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) outlineStep(sp, base, i, n, totalLength, R, taperS, taperE, minDistance, os, 0, left, right, false);
  const radius = os[9];
  const firstRadius = os[8];
  const fx = sp[base];
  const fy = sp[base + 1];

  if (n === 1) {
    if (!(taperS || taperE) || R.last) {
      // lastPoint = add(firstPoint, [1, 1]); start = prj(firstPoint, uni(per(sub(first, last))), -r)
      const r = firstRadius === firstRadius && firstRadius ? firstRadius : radius;
      const ax = fx - (fx + 1);
      const ay = fy - (fy + 1);
      // per(A) = [A[1], -A[0]], then uni
      const l = Math.hypot(ay, -ax);
      const ux = ay / l;
      const uy = -ax / l;
      const sx = fx + ux * -r;
      const sy = fy + uy * -r;
      const dot: number[] = [];
      for (let step = 1 / 13, t = step; t <= 1; t += step) pushRotAround(dot, sx, sy, fx, fy, (Math.PI + 0.0001) * 2 * t);
      return dot;
    }
    const out1 = left.slice();
    pushReversedPairs(out1, right);
    return out1;
  }

  const startCap = startCapPoints(R, n, fx, fy, left[0], left[1], right[0], right[1], taperS, taperE);
  const endCap = endCapPoints(R, n, sp[lo], sp[lo + 1], sp[lo + 3], sp[lo + 4], radius, taperS, taperE);
  const out = left;
  for (let k = 0; k < endCap.length; k++) out.push(endCap[k]);
  pushReversedPairs(out, right);
  for (let k = 0; k < startCap.length; k++) out.push(startCap[k]);
  return out;
}

/** Outline points (flat x, y) for flat stroke points. Same as upstream getStrokeOutlinePoints. */
export function getStrokeOutlinePoints(sp: ArrayLike<number>, o?: FreehandOptions): number[] {
  'worklet';
  return outlineRange(sp, 0, Math.floor(sp.length / 7), resolveFreehand(o));
}

/** The outline polygon (flat x, y) of flat [x, y, p] input. Same as upstream getStroke. */
export function getStroke(pts: ArrayLike<number>, o?: FreehandOptions): number[] {
  'worklet';
  return getStrokeOutlinePoints(getStrokePoints(pts, o), o);
}

// ===== the app's stroke styles (one source for wet ink, the painter, thumbnails and export)

/** Thinning of pressure pen strokes: the width runs from 0.5x (no pressure) to 1.5x (full pressure). */
export const PEN_THINNING = 0.5;

/**
 * Freehand options for a stroke item. Wet ink passes last=false while the pen is down; everything
 * that draws a committed stroke passes last=true.
 */
export function strokeOptions(s: Pick<StrokeItem, 'tool' | 'width' | 'pressure'>, last: boolean): FreehandOptions {
  'worklet';
  const pressure = s.tool === 'pen' && s.pressure;
  return {
    size: s.width,
    thinning: pressure ? PEN_THINNING : 0,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    taperStart: 0,
    taperEnd: 0,
    capStart: true,
    capEnd: true,
    last,
  };
}

/** The largest outline radius options can produce (for bounds and hit padding). */
export function maxOutlineRadius(o: FreehandOptions): number {
  'worklet';
  const R = resolveFreehand(o);
  return R.size * (0.5 + 0.5 * Math.abs(R.thinning));
}
