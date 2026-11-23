/**
 * Shape recognition, step 1: points, resampling, the closedness test and ShortStraw corners.
 *
 * Pure and worklet-annotated, so the canvas can run it on the UI runtime while the pen is held
 * still (NB-44). Every function here starts with 'worklet' and only calls other worklets.
 * It has its own small vector helpers so it depends on nothing outside this folder.
 *
 * ShortStraw: A. Wolin, B. Eoff, T. Hammond, "ShortStraw: A Simple and Effective Corner Finder for
 * Polylines" (SBIM 2008). The stroke is resampled at diag/40, the "straw" at point i is the chord
 * between points i-3 and i+3, and corners are local minima below 0.95 x the median straw, followed
 * by the paper's two clean-up passes (add a corner where a run is not a line; drop corners whose
 * neighbours form a line). For closed strokes the straws wrap around the loop and the polyline is
 * rotated to start at its sharpest point, so the place where the pen started never counts as a
 * corner by itself.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  diag: number;
}

/** Straw window (points on each side). */
export const STRAW_W = 3;
/** Corners are straws below this fraction of the median straw. */
export const STRAW_MEDIAN_FRACTION = 0.95;
/** A run between two corners is a line when chord / path >= this. */
export const STRAW_LINE_RATIO = 0.95;
/** A stroke is closed when it comes back within this fraction of its bounding diagonal of where it started. */
export const CLOSE_GAP_FRACTION = 0.2;
/** ...and its path is at least this many diagonals long (a closed shape goes around, a line does not). */
export const CLOSE_MIN_PATH_DIAGS = 1.6;

// ===== vector helpers

export function dist(a: Pt, b: Pt): number {
  'worklet';
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function sub(a: Pt, b: Pt): Pt {
  'worklet';
  return { x: a.x - b.x, y: a.y - b.y };
}

export function dot(a: Pt, b: Pt): number {
  'worklet';
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Pt, b: Pt): number {
  'worklet';
  return a.x * b.y - a.y * b.x;
}

export function len(a: Pt): number {
  'worklet';
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

/** Rotates p by angle (radians) about c. */
export function rotateAbout(p: Pt, c: Pt, angle: number): Pt {
  'worklet';
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

/** Distance from p to the segment a-b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  'worklet';
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = a.x + t * abx - p.x;
  const qy = a.y + t * aby - p.y;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Signed turn from direction a to direction b, in radians (-PI..PI). */
export function turnAngle(a: Pt, b: Pt): number {
  'worklet';
  return Math.atan2(cross(a, b), dot(a, b));
}

/** True when the segments p1-p2 and p3-p4 properly cross (touching ends do not count). */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  'worklet';
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ===== points

/**
 * Reads flat coordinates into points. stride 3 is the stroke format (x, y, pressure); stride 2 is
 * plain x, y pairs. Non-finite values and exact repeats of the previous point are dropped.
 */
export function pointsOf(flat: ArrayLike<number>, stride: number): Pt[] {
  'worklet';
  const step = stride >= 2 ? Math.floor(stride) : 2;
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += step) {
    const x = flat[i];
    const y = flat[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out.length > 0 ? out[out.length - 1] : null;
    if (last && last.x === x && last.y === y) continue;
    out.push({ x, y });
  }
  return out;
}

export function boundsOf(pts: Pt[]): Bounds {
  'worklet';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0, diag: 0 };
  const w = maxX - minX;
  const h = maxY - minY;
  return { minX, minY, maxX, maxY, w, h, diag: Math.sqrt(w * w + h * h) };
}

/** Path length; closed adds the segment from the last point back to the first. */
export function pathLength(pts: Pt[], closed: boolean): number {
  'worklet';
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) total += dist(pts[pts.length - 1], pts[0]);
  return total;
}

/** Cumulative path length: out[i] is the length from pts[0] to pts[i]. */
export function cumulative(pts: Pt[]): number[] {
  'worklet';
  const out = new Array<number>(pts.length);
  if (pts.length === 0) return out;
  out[0] = 0;
  for (let i = 1; i < pts.length; i++) out[i] = out[i - 1] + dist(pts[i - 1], pts[i]);
  return out;
}

/**
 * Resamples to points spaced `spacing` apart along the path. Open paths keep their last point.
 * Closed paths include the closing segment and do not repeat the first point at the end.
 */
export function resample(pts: Pt[], spacing: number, closed: boolean): Pt[] {
  'worklet';
  if (pts.length < 2 || !(spacing > 0)) return pts.slice();
  const src = closed ? pts.concat([pts[0]]) : pts;
  const out: Pt[] = [{ x: src[0].x, y: src[0].y }];
  let acc = 0;
  let prev = src[0];
  for (let i = 1; i < src.length; i++) {
    const cur = src[i];
    let d = dist(prev, cur);
    while (d > 0 && acc + d >= spacing) {
      const t = (spacing - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  if (closed) {
    while (out.length > 2 && dist(out[out.length - 1], out[0]) < spacing * 0.5) out.pop();
  } else {
    const end = src[src.length - 1];
    const last = out[out.length - 1];
    if (dist(last, end) > spacing * 0.25) out.push({ x: end.x, y: end.y });
    else out[out.length - 1] = { x: end.x, y: end.y };
  }
  return out;
}

export interface Closedness {
  closed: boolean;
  /** The stroke with any overshoot past its start trimmed off (the input itself when open). */
  pts: Pt[];
  /** Gap left between the trimmed end and the start, as a fraction of the bounding diagonal. */
  gap: number;
}

/**
 * Closedness test. The stroke is closed when, somewhere in the last 45 percent of its path, it
 * comes back within CLOSE_GAP_FRACTION of its diagonal of its first point, and the path is long
 * enough to go around something. The closest return is where the loop ends, so an overshoot
 * (drawing past the start) is trimmed off.
 */
export function closedness(pts: Pt[]): Closedness {
  'worklet';
  const n = pts.length;
  if (n < 4) return { closed: false, pts, gap: 1 };
  const b = boundsOf(pts);
  if (!(b.diag > 0)) return { closed: false, pts, gap: 1 };
  const cum = cumulative(pts);
  const total = cum[n - 1];
  if (total < CLOSE_MIN_PATH_DIAGS * b.diag) return { closed: false, pts, gap: dist(pts[0], pts[n - 1]) / b.diag };
  let best = n - 1;
  let bestD = dist(pts[0], pts[n - 1]);
  for (let i = n - 2; i > 0 && cum[i] >= total * 0.55; i--) {
    const d = dist(pts[0], pts[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const gap = bestD / b.diag;
  if (gap > CLOSE_GAP_FRACTION) return { closed: false, pts, gap };
  return { closed: true, pts: best === n - 1 ? pts : pts.slice(0, best + 1), gap };
}

// ===== ShortStraw

export interface Corners {
  /** The polyline the corner indices refer to. For closed strokes it is rotated and repeats its first point at the end. */
  pts: Pt[];
  /** Corner indices into pts, ascending; always starts with 0 and ends with pts.length - 1. */
  corners: number[];
  closed: boolean;
}

function median(values: number[]): number {
  'worklet';
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i]);
  if (finite.length === 0) return 0;
  finite.sort((a, b) => a - b);
  const mid = finite.length >> 1;
  return finite.length % 2 === 1 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

/** ShortStraw's line test between two indices of a polyline (with its cumulative lengths). */
export function isLineRun(pts: Pt[], cum: number[], a: number, b: number, ratio: number): boolean {
  'worklet';
  const path = cum[b] - cum[a];
  if (!(path > 0)) return true;
  return dist(pts[a], pts[b]) / path >= ratio;
}

function halfwayCorner(straws: number[], a: number, b: number): number {
  'worklet';
  const quarter = Math.floor((b - a) / 4);
  let best = -1;
  let bestStraw = Infinity;
  for (let i = a + quarter; i <= b - quarter; i++) {
    if (i <= a || i >= b) continue;
    if (straws[i] < bestStraw) {
      bestStraw = straws[i];
      best = i;
    }
  }
  return best;
}

/** Corner detection on a resampled polyline (equal spacing). closed: the polyline is a loop with no repeated end point. */
export function shortStraw(rs: Pt[], closed: boolean): Corners {
  'worklet';
  const n = rs.length;
  if (n < 2) return { pts: rs.slice(), corners: n === 1 ? [0] : [], closed };
  const W = STRAW_W;

  // Straws (cyclic for loops; the first and last W points of an open stroke have none).
  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (closed) raw[i] = n > 2 * W ? dist(rs[(i - W + n) % n], rs[(i + W) % n]) : Infinity;
    else raw[i] = i >= W && i < n - W ? dist(rs[i - W], rs[i + W]) : Infinity;
  }

  let pts: Pt[];
  let straws: number[];
  if (closed) {
    // Start the loop at its sharpest point and repeat it at the end.
    let start = 0;
    for (let i = 1; i < n; i++) if (raw[i] < raw[start]) start = i;
    pts = new Array<Pt>(n + 1);
    straws = new Array<number>(n + 1);
    for (let k = 0; k < n; k++) {
      pts[k] = rs[(start + k) % n];
      straws[k] = raw[(start + k) % n];
    }
    pts[n] = pts[0];
    straws[n] = straws[0];
  } else {
    pts = rs.slice();
    straws = raw;
  }
  const last = pts.length - 1;
  const t = median(straws) * STRAW_MEDIAN_FRACTION;

  const corners: number[] = [0];
  let i = 1;
  let end = last - 1;
  if (closed) {
    // Skip the run around the start point on both sides of the seam: it is corner 0 (and last).
    while (i < last && straws[i] < t) i++;
    while (end > i && straws[end] < t) end--;
  }
  while (i <= end) {
    if (straws[i] < t) {
      let localMin = i;
      while (i <= end && straws[i] < t) {
        if (straws[i] < straws[localMin]) localMin = i;
        i++;
      }
      if (localMin > 0 && localMin < last) corners.push(localMin);
    } else {
      i++;
    }
  }
  corners.push(last);

  const cum = cumulative(pts);
  // Pass 1: where the run between two corners is not a line, a corner was missed.
  for (let guard = 0; guard < 64; guard++) {
    let added = false;
    for (let k = 1; k < corners.length; k++) {
      const a = corners[k - 1];
      const b = corners[k];
      if (b - a > 2 && !isLineRun(pts, cum, a, b, STRAW_LINE_RATIO)) {
        const c = halfwayCorner(straws, a, b);
        if (c > a && c < b) {
          corners.splice(k, 0, c);
          added = true;
        }
      }
    }
    if (!added) break;
  }
  // Pass 2: drop corners whose neighbours make a line.
  for (let k = 1; k < corners.length - 1; k++) {
    if (isLineRun(pts, cum, corners[k - 1], corners[k + 1], STRAW_LINE_RATIO)) {
      corners.splice(k, 1);
      k--;
    }
  }
  return { pts, corners, closed };
}
