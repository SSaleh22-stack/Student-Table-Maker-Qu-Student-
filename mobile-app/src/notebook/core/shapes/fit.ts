/**
 * Shape recognition, step 2: fitting clean geometry to a hand-drawn stroke (NB-44).
 *
 * Pure and worklet-annotated (see corners.ts). Inputs are resampled point lists from corners.ts.
 * Error measures are normalized by the stroke's bounding diagonal, so they do not depend on size.
 *
 * - line: total least squares, with a straightness ratio (chord / path)
 * - ellipse: algebraic conic fit on normalized coordinates (A u^2 + B uv + C v^2 + D u + E v = 1),
 *   checked with the Sampson distance of every point
 * - polygon: one total-least-squares line per run between ShortStraw corners; vertices are where
 *   neighbouring lines meet; nearly straight joints are merged and tiny rounded-corner runs dropped
 * - rect: a convex 4-gon with right-ish angles. Snaps to a square within 12 percent
 * - arrow: a long straight shaft with a 1- or 2-segment hook at 20 to 60 degrees at either end
 * Rotation snaps to 0 or 90 degrees within 6 degrees (rect, ellipse, line, arrow).
 */
import type { Box } from '../model/index.ts';
import {
  boundsOf,
  cross,
  cumulative,
  dist,
  distToSegment,
  dot,
  isLineRun,
  pathLength,
  rotateAbout,
  segmentsCross,
  sub,
  turnAngle,
} from './corners.ts';
import type { Corners, Pt } from './corners.ts';

const DEG = Math.PI / 180;

/** Rotation within this many degrees of 0 or 90 snaps to it. */
export const ROTATION_SNAP_DEG = 6;
/** A rectangle whose sides differ by at most this fraction of the longer side becomes a square. */
export const SQUARE_SNAP = 0.12;
/** An ellipse whose minor / major axis ratio is above this becomes a circle. */
export const CIRCLE_SNAP_RATIO = 0.9;

/** Line: chord / path at least this, and rms distance at most LINE_MAX_RMS of its length. */
export const LINE_MIN_STRAIGHTNESS = 0.9;
export const LINE_MAX_RMS = 0.03;

/** Ellipse: Sampson rms and max error, as fractions of the bounding diagonal. */
export const ELLIPSE_MAX_RMS = 0.024;
export const ELLIPSE_MAX_ERR = 0.075;
/** Thinner than this (minor / major) is not an ellipse (for example a line drawn there and back). */
export const ELLIPSE_MIN_RATIO = 0.12;

/** Polygon: rms and max distance to the nearest edge, as fractions of the bounding diagonal. */
export const POLY_MAX_RMS = 0.024;
export const POLY_MAX_ERR = 0.08;
/** Neighbouring runs turning less than this are one side. */
export const POLY_MERGE_DEG = 24;
/** A run shorter than this fraction of the perimeter between two real corners is a rounded corner. */
export const POLY_TINY_FRACTION = 0.06;
/** A run whose farthest point is this far from its chord (fraction of the chord, and of the diagonal) hides a corner. */
export const POLY_SPLIT_FRACTION = 0.1;
export const POLY_SPLIT_MIN = 0.02;
const MAX_FIT_RUNS = 12;
/** 4 pi area / perimeter^2 below this is too thin to be a shape. */
export const POLY_MIN_ROUNDNESS = 0.08;
/** A rectangle's corners turn 90 degrees, give or take this. */
export const RECT_ANGLE_TOL_DEG = 16;

/** Arrow hook angle from the shaft, in degrees, with ARROW_SLACK_DEG of slack for hand-drawn noise. */
export const ARROW_MIN_DEG = 20;
export const ARROW_MAX_DEG = 60;
export const ARROW_SLACK_DEG = 6;
/** The head reaches at least this and at most ARROW_MAX_HEAD of the shaft length from the tip. */
export const ARROW_MIN_HEAD = 0.05;
export const ARROW_MAX_HEAD = 0.6;

// ===== shared helpers

export interface LineFit {
  /** Centroid. */
  c: Pt;
  /** Unit direction, oriented from the first point towards the last. */
  d: Pt;
  /** Root mean square perpendicular distance. */
  rms: number;
}

/** Total least squares line through points (principal axis of their covariance). */
export function fitLineTls(pts: Pt[]): LineFit {
  'worklet';
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += pts[i].x;
    my += pts[i].y;
  }
  mx /= n || 1;
  my /= n || 1;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i].x - mx;
    const dy = pts[i].y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= n || 1;
  sxy /= n || 1;
  syy /= n || 1;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let d = { x: Math.cos(theta), y: Math.sin(theta) };
  if (n >= 2 && dot(d, sub(pts[n - 1], pts[0])) < 0) d = { x: -d.x, y: -d.y };
  const half = (sxx + syy) / 2;
  const lambdaMin = half - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  return { c: { x: mx, y: my }, d, rms: Math.sqrt(Math.max(0, lambdaMin)) };
}

/** Projects p onto a fitted line. */
export function projectOnLine(p: Pt, f: LineFit): Pt {
  'worklet';
  const t = (p.x - f.c.x) * f.d.x + (p.y - f.c.y) * f.d.y;
  return { x: f.c.x + t * f.d.x, y: f.c.y + t * f.d.y };
}

/** Where two fitted lines meet, or null when they are (nearly) parallel. */
export function intersectLines(a: LineFit, b: LineFit): Pt | null {
  'worklet';
  const den = cross(a.d, b.d);
  if (Math.abs(den) < 1e-6) return null;
  const t = cross(sub(b.c, a.c), b.d) / den;
  return { x: a.c.x + t * a.d.x, y: a.c.y + t * a.d.y };
}

/** Normalizes an angle to [-PI/2, PI/2). */
function halfTurn(a: number): number {
  'worklet';
  let r = a;
  while (r >= Math.PI / 2) r -= Math.PI;
  while (r < -Math.PI / 2) r += Math.PI;
  return r;
}

/** Turns a segment about its midpoint so it is exactly horizontal or vertical when within ROTATION_SNAP_DEG. */
export function snapSegment(a: Pt, b: Pt): [Pt, Pt] {
  'worklet';
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const quarter = Math.PI / 2;
  const k = Math.round(ang / quarter);
  const delta = ang - k * quarter;
  if (Math.abs(delta) > ROTATION_SNAP_DEG * DEG) return [a, b];
  // Exact axis (no trigonometry), so a snapped segment has exactly equal x or y.
  const kk = ((k % 4) + 4) % 4;
  const ux = kk === 0 ? 1 : kk === 2 ? -1 : 0;
  const uy = kk === 1 ? 1 : kk === 3 ? -1 : 0;
  const half = dist(a, b) / 2;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [
    { x: m.x - ux * half, y: m.y - uy * half },
    { x: m.x + ux * half, y: m.y + uy * half },
  ];
}

/**
 * Normalizes a box angle to [-45, 45) degrees (swapping width and height as needed) and snaps it
 * to 0 within ROTATION_SNAP_DEG. Returns [w, h, rot].
 */
export function normalizeBoxRotation(w: number, h: number, rot: number): [number, number, number] {
  'worklet';
  let r = rot;
  let bw = w;
  let bh = h;
  for (let guard = 0; guard < 8 && (r >= Math.PI / 4 || r < -Math.PI / 4); guard++) {
    if (r >= Math.PI / 4) r -= Math.PI / 2;
    else r += Math.PI / 2;
    const t = bw;
    bw = bh;
    bh = t;
  }
  if (Math.abs(r) <= ROTATION_SNAP_DEG * DEG) r = 0;
  return [bw, bh, r];
}

/** A box of size w x h centered on c. */
export function boxAround(c: Pt, w: number, h: number, rot: number): Box {
  'worklet';
  return { x: c.x - w / 2, y: c.y - h / 2, w, h, rot };
}

// ===== line

export interface LineShape {
  a: Pt;
  b: Pt;
  /** rms distance / length. */
  error: number;
  /** chord / path. */
  straightness: number;
}

/** A straight line through an open resampled stroke, or null when it is not straight enough. */
export function fitLine(rs: Pt[]): LineShape | null {
  'worklet';
  const n = rs.length;
  if (n < 2) return null;
  const chord = dist(rs[0], rs[n - 1]);
  const path = pathLength(rs, false);
  if (!(chord > 0) || !(path > 0)) return null;
  const straightness = chord / path;
  if (straightness < LINE_MIN_STRAIGHTNESS) return null;
  const f = fitLineTls(rs);
  const error = f.rms / chord;
  if (error > LINE_MAX_RMS) return null;
  const [a, b] = snapSegment(projectOnLine(rs[0], f), projectOnLine(rs[n - 1], f));
  return { a, b, error, straightness };
}

// ===== ellipse

export interface EllipseFit {
  c: Pt;
  /** Semi-axis along rot. */
  rx: number;
  /** Semi-axis across rot. */
  ry: number;
  rot: number;
  /** Sampson rms and max error / bounding diagonal. */
  rms: number;
  max: number;
}

/** Solves the n x n system m x = r in place (Gaussian elimination, partial pivoting). */
function solveLinear(m: number[][], r: number[]): number[] | null {
  'worklet';
  const n = r.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[piv][col])) piv = row;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    if (piv !== col) {
      const tm = m[piv];
      m[piv] = m[col];
      m[col] = tm;
      const tr = r[piv];
      r[piv] = r[col];
      r[col] = tr;
    }
    for (let row = col + 1; row < n; row++) {
      const f = m[row][col] / m[col][col];
      if (f === 0) continue;
      for (let k = col; k < n; k++) m[row][k] -= f * m[col][k];
      r[row] -= f * r[col];
    }
  }
  const x = new Array<number>(n);
  for (let row = n - 1; row >= 0; row--) {
    let s = r[row];
    for (let k = row + 1; k < n; k++) s -= m[row][k] * x[k];
    x[row] = s / m[row][row];
  }
  return x;
}

/** Fits an ellipse to a closed resampled loop. Null when the best conic is not an ellipse. */
export function fitEllipse(loop: Pt[]): EllipseFit | null {
  'worklet';
  const n = loop.length;
  if (n < 6) return null;
  const b = boundsOf(loop);
  if (!(b.diag > 0)) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += loop[i].x;
    my += loop[i].y;
  }
  mx /= n;
  my /= n;
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += (loop[i].x - mx) ** 2 + (loop[i].y - my) ** 2;
  const s = Math.sqrt(s2 / n);
  if (!(s > 0)) return null;

  // Normal equations for A u^2 + B uv + C v^2 + D u + E v = 1.
  const m: number[][] = [];
  for (let i = 0; i < 5; i++) m.push([0, 0, 0, 0, 0]);
  const rhs = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const u = (loop[i].x - mx) / s;
    const v = (loop[i].y - my) / s;
    const row = [u * u, u * v, v * v, u, v];
    for (let r = 0; r < 5; r++) {
      rhs[r] += row[r];
      for (let k = 0; k < 5; k++) m[r][k] += row[r] * row[k];
    }
  }
  const sol = solveLinear(m, rhs);
  if (!sol) return null;
  const A = sol[0];
  const B = sol[1];
  const C = sol[2];
  const D = sol[3];
  const E = sol[4];
  const det = 4 * A * C - B * B;
  if (!(det > 1e-12)) return null;
  const u0 = (B * E - 2 * C * D) / det;
  const v0 = (B * D - 2 * A * E) / det;
  const k = -(A * u0 * u0 + B * u0 * v0 + C * v0 * v0 + D * u0 + E * v0 - 1);
  const theta = 0.5 * Math.atan2(B, A - C);
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  const l1 = A * cs * cs + B * cs * sn + C * sn * sn;
  const l2 = A * sn * sn - B * cs * sn + C * cs * cs;
  const a2 = k / l1;
  const b2 = k / l2;
  if (!(a2 > 0) || !(b2 > 0)) return null;
  const rx = Math.sqrt(a2) * s;
  const ry = Math.sqrt(b2) * s;
  const c = { x: mx + u0 * s, y: my + v0 * s };
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  if (Math.min(rx, ry) / Math.max(rx, ry) < ELLIPSE_MIN_RATIO) return null;

  // Sampson distance of every point to x^2/rx^2 + y^2/ry^2 = 1 in the ellipse frame.
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const dx = loop[i].x - c.x;
    const dy = loop[i].y - c.y;
    const x = dx * cs + dy * sn;
    const y = -dx * sn + dy * cs;
    const f = (x * x) / (rx * rx) + (y * y) / (ry * ry) - 1;
    const gx = (2 * x) / (rx * rx);
    const gy = (2 * y) / (ry * ry);
    const g = Math.sqrt(gx * gx + gy * gy);
    const e = g > 1e-12 ? Math.abs(f) / g : Math.max(rx, ry);
    sum += e * e;
    if (e > max) max = e;
  }
  return { c, rx, ry, rot: theta, rms: Math.sqrt(sum / n) / b.diag, max: max / b.diag };
}

/** True when the ellipse fit is good enough to snap. */
export function ellipseOk(f: EllipseFit): boolean {
  'worklet';
  return f.rms <= ELLIPSE_MAX_RMS && f.max <= ELLIPSE_MAX_ERR;
}

/** The ellipse's box after the circle and rotation snaps. */
export function ellipseBox(f: EllipseFit): { box: Box; circle: boolean } {
  'worklet';
  const ratio = Math.min(f.rx, f.ry) / Math.max(f.rx, f.ry);
  if (ratio > CIRCLE_SNAP_RATIO) {
    const d = f.rx + f.ry;
    return { box: boxAround(f.c, d, d, 0), circle: true };
  }
  const [w, h, rot] = normalizeBoxRotation(2 * f.rx, 2 * f.ry, halfTurn(f.rot));
  return { box: boxAround(f.c, w, h, rot), circle: false };
}

// ===== polygon

export interface PolyFit {
  /** Vertices in drawing order. */
  verts: Pt[];
  /** Signed turn at each vertex (radians). */
  turns: number[];
  convex: boolean;
  /** rms and max distance of the stroke to the nearest edge / bounding diagonal. */
  rms: number;
  max: number;
}

interface Run {
  from: number;
  to: number;
}

function gatherRun(cyc: Pt[], r: Run): Pt[] {
  'worklet';
  const n = cyc.length;
  const out: Pt[] = [];
  let i = r.from;
  for (let guard = 0; guard <= n; guard++) {
    out.push(cyc[i]);
    if (i === r.to) break;
    i = (i + 1) % n;
  }
  return out;
}

/**
 * Fits a closed polygon to ShortStraw output for a loop. Null when the result is not a simple
 * polygon with 3 or more sides that follows the stroke.
 */
export function fitPolygon(cs: Corners): PolyFit | null {
  'worklet';
  if (!cs.closed || cs.pts.length < 7 || cs.corners.length < 4) return null;
  // The loop without its repeated end point; corners as cyclic indices.
  const cyc = cs.pts.slice(0, cs.pts.length - 1);
  const n = cyc.length;
  const bounds = boundsOf(cyc);
  const diag = bounds.diag;
  if (!(diag > 0)) return null;
  const perimeter = pathLength(cyc, true);
  const idx: number[] = [];
  for (let k = 0; k < cs.corners.length - 1; k++) idx.push(cs.corners[k] % n);
  let runs: Run[] = [];
  for (let k = 0; k < idx.length; k++) runs.push({ from: idx[k], to: idx[(k + 1) % idx.length] });

  let fits: LineFit[] = [];
  for (let guard = 0; guard < 64; guard++) {
    const m = runs.length;
    if (m < 3) return null;
    fits = [];
    for (let k = 0; k < m; k++) fits.push(fitLineTls(gatherRun(cyc, runs[k])));

    // Merge the straightest joint.
    let best = -1;
    let bestTurn = Infinity;
    for (let k = 0; k < m; k++) {
      const t = Math.abs(turnAngle(fits[k].d, fits[(k + 1) % m].d));
      if (t < bestTurn) {
        bestTurn = t;
        best = k;
      }
    }
    if (best >= 0 && bestTurn < POLY_MERGE_DEG * DEG && m > 3) {
      const next = (best + 1) % m;
      const merged: Run = { from: runs[best].from, to: runs[next].to };
      const out: Run[] = [];
      if (next === 0) {
        out.push(merged);
        for (let k = 1; k < m - 1; k++) out.push(runs[k]);
      } else {
        for (let k = 0; k < m; k++) {
          if (k === best) out.push(merged);
          else if (k !== next) out.push(runs[k]);
        }
      }
      runs = out;
      continue;
    }

    // Drop the shortest run when it is a rounded corner between two real sides.
    let tiny = -1;
    let tinyLen = Infinity;
    for (let k = 0; k < m; k++) {
      const l = dist(cyc[runs[k].from], cyc[runs[k].to]);
      if (l < tinyLen) {
        tinyLen = l;
        tiny = k;
      }
    }
    if (m > 3 && tiny >= 0 && tinyLen < POLY_TINY_FRACTION * perimeter) {
      const prev = fits[(tiny - 1 + m) % m];
      const next = fits[(tiny + 1) % m];
      const x = intersectLines(prev, next);
      const a = cyc[runs[tiny].from];
      const b = cyc[runs[tiny].to];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (x && dist(x, mid) <= 1.5 * Math.max(tinyLen, 1e-6)) {
        // The previous run now ends where the dropped one ended.
        const p = (tiny - 1 + m) % m;
        const out: Run[] = [];
        for (let k = 0; k < m; k++) {
          if (k === tiny) continue;
          out.push(k === p ? { from: runs[p].from, to: runs[tiny].to } : runs[k]);
        }
        runs = out;
        continue;
      }
    }

    // Split the run that bends most where ShortStraw missed a corner (Douglas-Peucker style).
    let split = -1;
    let splitAt = -1;
    let splitDev = 0;
    for (let k = 0; k < m; k++) {
      const a = cyc[runs[k].from];
      const b = cyc[runs[k].to];
      const chord = dist(a, b);
      let far = -1;
      let farD = 0;
      let i = (runs[k].from + 1) % n;
      for (let guard2 = 0; guard2 < n && i !== runs[k].to; guard2++) {
        const d = distToSegment(cyc[i], a, b);
        if (d > farD) {
          farD = d;
          far = i;
        }
        i = (i + 1) % n;
      }
      if (far < 0 || farD < POLY_SPLIT_MIN * diag || farD < POLY_SPLIT_FRACTION * chord) continue;
      const left = fitLineTls(gatherRun(cyc, { from: runs[k].from, to: far }));
      const right = fitLineTls(gatherRun(cyc, { from: far, to: runs[k].to }));
      if (Math.abs(turnAngle(left.d, right.d)) < POLY_MERGE_DEG * DEG) continue;
      if (farD / Math.max(chord, 1e-6) > splitDev) {
        splitDev = farD / Math.max(chord, 1e-6);
        split = k;
        splitAt = far;
      }
    }
    if (split >= 0 && m < MAX_FIT_RUNS) {
      const out: Run[] = [];
      for (let k = 0; k < m; k++) {
        if (k === split) {
          out.push({ from: runs[k].from, to: splitAt });
          out.push({ from: splitAt, to: runs[k].to });
        } else {
          out.push(runs[k]);
        }
      }
      runs = out;
      continue;
    }
    break;
  }

  const m = runs.length;
  if (m < 3 || m > MAX_FIT_RUNS) return null;
  // Refit: the loop may have stopped right after changing the runs.
  fits = [];
  for (let k = 0; k < m; k++) fits.push(fitLineTls(gatherRun(cyc, runs[k])));
  const verts: Pt[] = [];
  for (let k = 0; k < m; k++) {
    const x = intersectLines(fits[(k - 1 + m) % m], fits[k]);
    if (!x || dist(x, cyc[runs[k].from]) > 0.25 * diag) return null;
    verts.push(x);
  }
  const turns: number[] = [];
  let pos = 0;
  let neg = 0;
  for (let k = 0; k < m; k++) {
    const a = sub(verts[k], verts[(k - 1 + m) % m]);
    const b = sub(verts[(k + 1) % m], verts[k]);
    const t = turnAngle(a, b);
    turns.push(t);
    if (t > 0) pos++;
    else if (t < 0) neg++;
  }
  // Simple polygon: no two non-neighbouring edges cross.
  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      if (segmentsCross(verts[i], verts[(i + 1) % m], verts[j], verts[(j + 1) % m])) return null;
    }
  }
  let area = 0;
  let per = 0;
  for (let k = 0; k < m; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % m];
    area += a.x * b.y - b.x * a.y;
    per += dist(a, b);
  }
  area = Math.abs(area) / 2;
  if (!(per > 0) || (4 * Math.PI * area) / (per * per) < POLY_MIN_ROUNDNESS) return null;

  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let k = 0; k < m; k++) {
      const d = distToSegment(cyc[i], verts[k], verts[(k + 1) % m]);
      if (d < best) best = d;
    }
    sum += best * best;
    if (best > max) max = best;
  }
  return { verts, turns, convex: pos === 0 || neg === 0, rms: Math.sqrt(sum / n) / diag, max: max / diag };
}

/** True when the polygon fit is good enough to snap. */
export function polygonOk(f: PolyFit): boolean {
  'worklet';
  return f.rms <= POLY_MAX_RMS && f.max <= POLY_MAX_ERR;
}

/** True when a 4-gon has right-ish corners all turning the same way. */
export function isRectangular(f: PolyFit): boolean {
  'worklet';
  if (f.verts.length !== 4 || !f.convex) return false;
  for (let k = 0; k < 4; k++) {
    const t = Math.abs(f.turns[k]);
    if (Math.abs(t - Math.PI / 2) > RECT_ANGLE_TOL_DEG * DEG) return false;
  }
  return true;
}

/** The rectangle's box for 4 vertices, after the square and rotation snaps. */
export function rectBox(verts: Pt[]): { box: Box; square: boolean } {
  'worklet';
  // Average edge direction modulo 90 degrees (4x angle trick), weighted by edge length.
  let sc = 0;
  let ss = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < 4; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % 4];
    const l = dist(a, b);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    sc += l * Math.cos(4 * ang);
    ss += l * Math.sin(4 * ang);
    cx += a.x / 4;
    cy += a.y / 4;
  }
  const theta = Math.atan2(ss, sc) / 4;
  const c = { x: cx, y: cy };
  const us: number[] = [];
  const vs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const p = rotateAbout(verts[k], c, -theta);
    us.push(p.x);
    vs.push(p.y);
  }
  us.sort((a, b) => a - b);
  vs.sort((a, b) => a - b);
  const left = (us[0] + us[1]) / 2;
  const right = (us[2] + us[3]) / 2;
  const top = (vs[0] + vs[1]) / 2;
  const bottom = (vs[2] + vs[3]) / 2;
  const center = rotateAbout({ x: (left + right) / 2, y: (top + bottom) / 2 }, c, theta);
  let w = right - left;
  let h = bottom - top;
  const square = Math.abs(w - h) <= SQUARE_SNAP * Math.max(w, h);
  if (square) {
    w = (w + h) / 2;
    h = w;
  }
  const [bw, bh, rot] = normalizeBoxRotation(w, h, theta);
  return { box: boxAround(center, bw, bh, rot), square };
}

// ===== arrow

export interface ArrowFit {
  tail: Pt;
  tip: Pt;
  /** Hook ends (1 or 2). */
  barbs: Pt[];
  /** Shaft rms / shaft length. */
  error: number;
}

function arrowFrom(pts: Pt[], corners: number[], total: number): ArrowFit | null {
  'worklet';
  if (corners.length < 3 || corners.length > 6) return null;
  const cum = cumulative(pts);
  const c0 = corners[0];
  const c1 = corners[1];
  const shaftPts = pts.slice(c0, c1 + 1);
  if (shaftPts.length < 3) return null;
  const shaftLen = dist(pts[c0], pts[c1]);
  const shaftPath = cum[c1] - cum[c0];
  if (!(shaftLen > 0) || shaftLen / shaftPath < 0.93 || shaftPath < 0.5 * total) return null;
  const f = fitLineTls(shaftPts);
  const error = f.rms / shaftLen;
  if (error > 0.035) return null;
  const tail = projectOnLine(pts[c0], f);
  // The tip is the shaft's farthest point near the corner (the corner sample may sit just before it).
  let reach = -Infinity;
  for (let i = Math.max(c0, c1 - 3); i <= Math.min(pts.length - 1, c1 + 3); i++) {
    const r = (pts[i].x - tail.x) * f.d.x + (pts[i].y - tail.y) * f.d.y;
    if (r > reach) reach = r;
  }
  const tip = { x: tail.x + reach * f.d.x, y: tail.y + reach * f.d.y };
  if (!(reach > 0)) return null;
  const back = { x: -f.d.x, y: -f.d.y };

  let maxD = 0;
  for (let k = 2; k < corners.length; k++) maxD = Math.max(maxD, dist(pts[corners[k]], tip));
  if (maxD < ARROW_MIN_HEAD * shaftLen || maxD > ARROW_MAX_HEAD * shaftLen) return null;

  // Clean the hook: drop corners that sit on a straight run or right next to their neighbour.
  const hook: Pt[] = [tip];
  const hookIdx: number[] = [c1];
  for (let k = 2; k < corners.length; k++) {
    hook.push(pts[corners[k]]);
    hookIdx.push(corners[k]);
  }
  for (let guard = 0; guard < 8; guard++) {
    let removed = false;
    for (let k = 1; k < hook.length - 1; k++) {
      const a = sub(hook[k], hook[k - 1]);
      const b = sub(hook[k + 1], hook[k]);
      const la = Math.sqrt(dot(a, a));
      const lb = Math.sqrt(dot(b, b));
      let drop = -1;
      if (la < 0.3 * maxD) drop = k;
      else if (lb < 0.3 * maxD) drop = k + 1 < hook.length - 1 ? k + 1 : k;
      else if (Math.abs(turnAngle(a, b)) < 30 * DEG) drop = k;
      if (drop > 0) {
        hook.splice(drop, 1);
        hookIdx.splice(drop, 1);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  if (hook.length < 2 || hook.length > 4) return null;
  // The first hook segment leaves the tip in a straight line.
  if (!isLineRun(pts, cum, c1, hookIdx[1], 0.85)) return null;

  const barbs: Pt[] = [];
  let nearTip = 0;
  let lastWasNear = false;
  for (let k = 1; k < hook.length; k++) {
    const v = hook[k];
    const d = dist(v, tip);
    if (d >= 0.45 * maxD) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(sub(v, tip), back) / d)));
      if (ang < (ARROW_MIN_DEG - ARROW_SLACK_DEG) * DEG || ang > (ARROW_MAX_DEG + ARROW_SLACK_DEG) * DEG) return null;
      barbs.push(v);
      lastWasNear = false;
    } else if (d <= 0.3 * maxD) {
      if (barbs.length === 0 || lastWasNear) return null;
      nearTip++;
      lastWasNear = true;
    } else {
      return null;
    }
  }
  if (barbs.length < 1 || barbs.length > 2 || nearTip > 1) return null;
  if (barbs.length === 2 && cross(back, sub(barbs[0], tip)) * cross(back, sub(barbs[1], tip)) >= 0) return null;
  const [t0, t1] = snapSegment(tail, tip);
  return { tail: t0, tip: t1, barbs, error };
}

/** An arrow in an open stroke's corners (hook at the end, or drawn first at the start). */
export function fitArrow(cs: Corners): ArrowFit | null {
  'worklet';
  if (cs.closed) return null;
  const total = pathLength(cs.pts, false);
  if (!(total > 0)) return null;
  const fwd = arrowFrom(cs.pts, cs.corners, total);
  if (fwd) return fwd;
  const last = cs.pts.length - 1;
  const rev = cs.pts.slice().reverse();
  const rc: number[] = [];
  for (let k = cs.corners.length - 1; k >= 0; k--) rc.push(last - cs.corners[k]);
  return arrowFrom(rev, rc, total);
}
