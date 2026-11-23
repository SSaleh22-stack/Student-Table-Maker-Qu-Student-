/**
 * Deterministic hand-drawn stroke fixtures for the shape recognizer tests.
 *
 * Each fixture is one stroke in the stroke format (flat x, y, pressure) the canvas hands over at
 * hold time. The noise imitates a student drawing on a tablet:
 * - two low-frequency wobbles across the path (about 0.5 to 2 percent of the size)
 * - per-sample jitter of a few tenths of a point
 * - uneven sample spacing (pen speed), slightly rounded corners
 * - closed shapes start anywhere on the outline and stop a little short of, or past, the start
 * - a cluster of tiny samples at the end, where the pen is held still
 * A seeded PRNG keeps every run identical.
 */
import type { ShapeKind } from '../../../src/notebook/core/model/index.ts';
import type { ShapeVariant } from '../../../src/notebook/core/shapes/recognize.ts';

export type Rand = () => number;

/** mulberry32: small seeded PRNG. */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface P {
  x: number;
  y: number;
}

export interface Fixture {
  name: string;
  /** Flat x, y, pressure. */
  pts: number[];
  expect: { kind: ShapeKind | null; variant?: ShapeVariant; sides?: number; rotZero?: boolean };
  /** The ideal geometry the stroke was drawn from. */
  ideal?: { w?: number; h?: number; cx?: number; cy?: number; rot?: number; verts?: P[]; a?: P; b?: P };
}

const between = (r: Rand, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

function rot(p: P, c: P, a: number): P {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return { x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs };
}

/** Rounds each vertex with a quadratic curve cut at `frac` of the shorter neighbouring edge. */
function roundCorners(verts: P[], frac: number, closed: boolean): P[] {
  if (frac <= 0 || verts.length < 3) return verts.slice();
  const n = verts.length;
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const v = verts[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(v);
      continue;
    }
    const a = verts[(i - 1 + n) % n];
    const b = verts[(i + 1) % n];
    const la = Math.hypot(v.x - a.x, v.y - a.y);
    const lb = Math.hypot(b.x - v.x, b.y - v.y);
    const r = frac * Math.min(la, lb);
    const p0 = { x: v.x + ((a.x - v.x) * r) / la, y: v.y + ((a.y - v.y) * r) / la };
    const p2 = { x: v.x + ((b.x - v.x) * r) / lb, y: v.y + ((b.y - v.y) * r) / lb };
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * v.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * v.y + t * t * p2.y });
    }
  }
  return out;
}

/** Arc-length parametrization of a polyline (closed adds the closing edge). */
function param(outline: P[], closed: boolean) {
  const pts = closed ? outline.concat([outline[0]]) : outline;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  const at = (s0: number): P => {
    let s = s0;
    if (closed) s = ((s % total) + total) % total;
    else s = Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * t, y: pts[lo].y + (pts[hi].y - pts[lo].y) * t };
  };
  return { total, at };
}

interface DrawOpts {
  closed: boolean;
  /** Wobble amplitude as a fraction of `size`. */
  wobble: number;
  size: number;
  /** Closed: where on the outline the pen starts (0..1) and how far past the start it ends (fraction of perimeter, negative = gap). */
  start?: number;
  overshoot?: number;
  jitter?: number;
}

/** Noise multiplier for the fixtures being generated (fixturesOf sets it). */
let NOISE = 1;

/** Walks an ideal outline like a hand would and returns flat x, y, p. */
function draw(r: Rand, outline: P[], o: DrawOpts): number[] {
  const { total, at } = param(outline, o.closed);
  const s0 = o.closed ? (o.start ?? 0) * total : 0;
  const s1 = o.closed ? s0 + total * (1 + (o.overshoot ?? 0)) : total;
  const amp1 = NOISE * o.wobble * o.size * between(r, 0.5, 1);
  const amp2 = NOISE * o.wobble * o.size * between(r, 0.2, 0.5);
  const lam1 = total / between(r, 1.2, 3);
  const lam2 = between(r, 20, 60);
  const ph1 = between(r, 0, Math.PI * 2);
  const ph2 = between(r, 0, Math.PI * 2);
  const jitter = NOISE * (o.jitter ?? 0.3);
  const out: number[] = [];
  let s = s0;
  let last: P = at(s0);
  while (s <= s1) {
    const p = at(s);
    const q = at(s + 0.5);
    const pm = at(s - 0.5);
    let nx = -(q.y - pm.y);
    let ny = q.x - pm.x;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const w = amp1 * Math.sin((2 * Math.PI * (s - s0)) / lam1 + ph1) + amp2 * Math.sin((2 * Math.PI * (s - s0)) / lam2 + ph2);
    last = { x: p.x + nx * w + between(r, -jitter, jitter), y: p.y + ny * w + between(r, -jitter, jitter) };
    out.push(last.x, last.y, between(r, 0.35, 0.8));
    s += between(r, 0.8, 4);
  }
  // The hold: tiny samples around where the pen stopped.
  const holdN = 8 + Math.floor(r() * 20);
  for (let i = 0; i < holdN; i++) out.push(last.x + between(r, -0.4, 0.4), last.y + between(r, -0.4, 0.4), 0.6);
  return out;
}

function ellipseOutline(c: P, rx: number, ry: number, a: number, n = 160): P[] {
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(rot({ x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) }, c, a));
  }
  return out;
}

const ORIGIN = (r: Rand): P => ({ x: between(r, 300, 500), y: between(r, 300, 600) });
const flip = (r: Rand, verts: P[]): P[] => (r() < 0.5 ? verts.slice().reverse() : verts);

// ===== shape kinds

export function lineFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const length = between(r, 40, 480);
  const axis = i % 4 === 0;
  const ang = axis ? pick(r, [0, Math.PI / 2, Math.PI, -Math.PI / 2]) + between(r, -4, 4) * (Math.PI / 180) : between(r, -Math.PI, Math.PI);
  const a = rot({ x: c.x - length / 2, y: c.y }, c, ang);
  const b = rot({ x: c.x + length / 2, y: c.y }, c, ang);
  const bow = between(r, -0.015, 0.015) * length;
  const mid = rot({ x: c.x, y: c.y + bow }, c, ang);
  const outline: P[] = [];
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    const u = 1 - t;
    outline.push({ x: u * u * a.x + 2 * u * t * mid.x + t * t * b.x, y: u * u * a.y + 2 * u * t * mid.y + t * t * b.y });
  }
  return { name: `line ${i}`, pts: draw(r, outline, { closed: false, wobble: between(r, 0.003, 0.01), size: length }), expect: { kind: 'line', variant: 'line', rotZero: axis }, ideal: { a, b } };
}

export function arrowFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const length = between(r, 70, 420);
  const ang = i % 5 === 0 ? between(r, -3, 3) * (Math.PI / 180) : between(r, -Math.PI, Math.PI);
  const tail = rot({ x: c.x - length / 2, y: c.y }, c, ang);
  const tip = rot({ x: c.x + length / 2, y: c.y }, c, ang);
  const barbLen = length * between(r, 0.13, 0.28);
  const spread = between(r, 26, 50) * (Math.PI / 180);
  const back = Math.atan2(tail.y - tip.y, tail.x - tip.x);
  const b1 = { x: tip.x + barbLen * Math.cos(back + spread), y: tip.y + barbLen * Math.sin(back + spread) };
  const b2 = { x: tip.x + barbLen * Math.cos(back - spread), y: tip.y + barbLen * Math.sin(back - spread) };
  const form = i % 4;
  let verts: P[];
  if (form === 0) verts = [tail, tip, b1];
  else if (form === 1) verts = [tail, tip, b1, b2];
  else if (form === 2) verts = [tail, tip, b1, tip, b2];
  else verts = [b1, tip, tail]; // hook drawn first
  const outline = roundCorners(verts, between(r, 0, 0.06), false);
  return { name: `arrow ${i} form ${form}`, pts: draw(r, outline, { closed: false, wobble: between(r, 0.003, 0.008), size: length }), expect: { kind: 'arrow', variant: 'arrow' }, ideal: { a: tail, b: tip } };
}

export function rectFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const w = between(r, 50, 400);
  const square = i % 3 === 0;
  const h = square ? w * between(r, 0.94, 1.06) : w * pick(r, [between(r, 0.35, 0.8), between(r, 1.25, 2)]);
  const axis = i % 2 === 0;
  const a = axis ? between(r, -4, 4) * (Math.PI / 180) : between(r, -40, 40) * (Math.PI / 180);
  const verts = flip(r, [
    rot({ x: c.x - w / 2, y: c.y - h / 2 }, c, a),
    rot({ x: c.x + w / 2, y: c.y - h / 2 }, c, a),
    rot({ x: c.x + w / 2, y: c.y + h / 2 }, c, a),
    rot({ x: c.x - w / 2, y: c.y + h / 2 }, c, a),
  ]);
  const outline = roundCorners(verts, between(r, 0, 0.08), true);
  const size = Math.max(w, h);
  return {
    name: `rect ${i}${square ? ' square' : ''}`,
    pts: draw(r, outline, { closed: true, wobble: between(r, 0.004, 0.012), size, start: r(), overshoot: between(r, -0.03, 0.08) }),
    expect: { kind: 'rect', variant: square ? 'square' : 'rect', sides: 4, rotZero: axis },
    ideal: { w, h, cx: c.x, cy: c.y, rot: a },
  };
}

export function ellipseFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const rx = between(r, 25, 220);
  const circle = i % 3 === 0;
  const ry = circle ? rx * between(r, 0.95, 1.05) : rx * between(r, 0.35, 0.8);
  const axis = i % 2 === 0;
  const a = axis ? between(r, -4, 4) * (Math.PI / 180) : between(r, -80, 80) * (Math.PI / 180);
  const outline = ellipseOutline(c, rx, ry, a);
  if (r() < 0.5) outline.reverse();
  return {
    name: `ellipse ${i}${circle ? ' circle' : ''}`,
    pts: draw(r, outline, { closed: true, wobble: between(r, 0.004, 0.014), size: 2 * Math.max(rx, ry), start: r(), overshoot: between(r, -0.04, 0.12) }),
    expect: { kind: 'ellipse', variant: circle ? 'circle' : 'ellipse', rotZero: axis || circle },
    ideal: { w: 2 * rx, h: 2 * ry, cx: c.x, cy: c.y, rot: a },
  };
}

function angleAt(a: P, b: P, c: P): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  return Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)));
}

export function triangleFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  let verts: P[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const R = between(r, 40, 200);
    verts = [0, 1, 2].map((k) => {
      const t = (k / 3) * Math.PI * 2 + between(r, -0.45, 0.45);
      const rr = R * between(r, 0.8, 1.15);
      return { x: c.x + rr * Math.cos(t), y: c.y + rr * Math.sin(t) };
    });
    const angles = [angleAt(verts[2], verts[0], verts[1]), angleAt(verts[0], verts[1], verts[2]), angleAt(verts[1], verts[2], verts[0])];
    if (Math.min(...angles) > 30 * (Math.PI / 180)) break;
  }
  const size = Math.max(...verts.map((p) => p.x)) - Math.min(...verts.map((p) => p.x));
  const outline = roundCorners(flip(r, verts), between(r, 0, 0.07), true);
  return {
    name: `triangle ${i}`,
    pts: draw(r, outline, { closed: true, wobble: between(r, 0.004, 0.011), size, start: r(), overshoot: between(r, -0.03, 0.08) }),
    expect: { kind: 'triangle', variant: 'triangle', sides: 3 },
    ideal: { verts },
  };
}

export function polygonFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const sides = 4 + (i % 5); // 4..8
  const R = between(r, 60, 220);
  let verts: P[];
  if (sides === 4) {
    // A parallelogram or trapezoid, never a rectangle.
    const w = R * 1.6;
    const h = R * between(r, 0.6, 1.1);
    const skew = h * between(r, 0.25, 0.45) * (r() < 0.5 ? -1 : 1);
    const inset = Math.min(h * between(r, 0.45, 0.8), w * 0.3);
    const trapezoid = r() < 0.5;
    const raw = trapezoid
      ? [{ x: -w / 2 + inset, y: -h / 2 }, { x: w / 2 - inset, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }]
      : [{ x: -w / 2 + skew, y: -h / 2 }, { x: w / 2 + skew, y: -h / 2 }, { x: w / 2 - skew, y: h / 2 }, { x: -w / 2 - skew, y: h / 2 }];
    const a = between(r, -Math.PI, Math.PI);
    verts = raw.map((p) => rot({ x: c.x + p.x, y: c.y + p.y }, c, a));
  } else {
    const a0 = between(r, 0, Math.PI * 2);
    const step = (Math.PI * 2) / sides;
    verts = [];
    for (let k = 0; k < sides; k++) {
      const t = a0 + k * step + between(r, -0.1, 0.1) * step;
      const rr = R * between(r, 0.94, 1.06);
      verts.push({ x: c.x + rr * Math.cos(t), y: c.y + rr * Math.sin(t) });
    }
  }
  const outline = roundCorners(flip(r, verts), between(r, 0, 0.05), true);
  return {
    name: `polygon ${i} (${sides})`,
    pts: draw(r, outline, { closed: true, wobble: between(r, 0.002, 0.006), size: 2 * R, start: r(), overshoot: between(r, -0.02, 0.06) }),
    expect: { kind: 'polygon', variant: 'polygon', sides },
    ideal: { verts },
  };
}

// ===== scribbles (must not be shapes)

export function scribbleFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const S = between(r, 80, 300);
  const kind = i % 10;
  let outline: P[] = [];
  let closed = false;
  let label = '';
  if (kind === 0) {
    label = 'random walk';
    let p = { ...c };
    let ang = between(r, 0, Math.PI * 2);
    for (let k = 0; k < 14; k++) {
      outline.push(p);
      ang += between(r, -2.4, 2.4);
      const step = S * between(r, 0.15, 0.4);
      p = { x: p.x + step * Math.cos(ang), y: p.y + step * Math.sin(ang) };
    }
  } else if (kind === 1) {
    label = 'zigzag';
    for (let k = 0; k < 9; k++) outline.push({ x: c.x + (k * S) / 8, y: c.y + (k % 2 === 0 ? 0 : S * between(r, 0.25, 0.4)) });
  } else if (kind === 2) {
    label = 'spiral';
    const turns = between(r, 2, 3.5);
    for (let k = 0; k <= 200; k++) {
      const t = (k / 200) * turns * Math.PI * 2;
      const rr = (S / 2) * (0.15 + (0.85 * k) / 200);
      outline.push({ x: c.x + rr * Math.cos(t), y: c.y + rr * Math.sin(t) });
    }
  } else if (kind === 3) {
    label = 'figure eight';
    closed = true;
    for (let k = 0; k < 160; k++) {
      const t = (k / 160) * Math.PI * 2;
      outline.push({ x: c.x + (S / 2) * Math.sin(t), y: c.y + (S / 3) * Math.sin(t) * Math.cos(t) });
    }
  } else if (kind === 4) {
    label = 'S curve';
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      outline.push({ x: c.x + S * t, y: c.y + (S / 3) * Math.sin(t * Math.PI * 2) });
    }
  } else if (kind === 5) {
    label = 'half circle arc';
    for (let k = 0; k <= 60; k++) {
      const t = (k / 60) * Math.PI * between(r, 0.9, 1.25);
      outline.push({ x: c.x + (S / 2) * Math.cos(t), y: c.y + (S / 2) * Math.sin(t) });
    }
  } else if (kind === 6) {
    label = 'hatching';
    for (let k = 0; k < 8; k++) outline.push({ x: c.x + (k % 2 === 0 ? 0 : S), y: c.y + (k * S) / 14 });
  } else if (kind === 7) {
    label = 'cursive loops';
    for (let k = 0; k <= 240; k++) {
      const t = (k / 240) * Math.PI * 2 * 4;
      outline.push({ x: c.x + (S * k) / 240 + (S / 8) * Math.cos(t), y: c.y + (S / 5) * Math.sin(t) });
    }
  } else if (kind === 8) {
    label = 'check mark';
    outline = [{ x: c.x, y: c.y }, { x: c.x + S * 0.3, y: c.y + S * 0.3 }, { x: c.x + S, y: c.y - S * 0.5 }];
  } else {
    label = 'star';
    closed = true;
    for (let k = 0; k < 5; k++) {
      const t = (k * 2 * (Math.PI * 2)) / 5 - Math.PI / 2;
      outline.push({ x: c.x + (S / 2) * Math.cos(t), y: c.y + (S / 2) * Math.sin(t) });
    }
  }
  const pts = draw(r, outline, { closed, wobble: 0.006, size: S, start: closed ? r() : 0, overshoot: closed ? between(r, -0.02, 0.05) : 0 });
  return { name: `scribble ${i} ${label}`, pts, expect: { kind: null } };
}

/** A shape drawn at handwriting size (smaller than SHAPE_MIN_SIZE): never a shape. */
export function tinyFixture(r: Rand, i: number): Fixture {
  const c = ORIGIN(r);
  const rr = between(r, 3, 9);
  const outline = ellipseOutline(c, rr, rr * between(r, 0.7, 1), 0, 40);
  return { name: `tiny ${i}`, pts: draw(r, outline, { closed: true, wobble: 0.01, size: 2 * rr, start: r(), overshoot: 0.05, jitter: 0.1 }), expect: { kind: null } };
}

export const FIXTURE_KINDS = ['line', 'arrow', 'ellipse', 'rect', 'triangle', 'polygon'] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

const MAKERS: Record<FixtureKind, (r: Rand, i: number) => Fixture> = {
  line: lineFixture,
  arrow: arrowFixture,
  ellipse: ellipseFixture,
  rect: rectFixture,
  triangle: triangleFixture,
  polygon: polygonFixture,
};

const SEEDS: Record<FixtureKind | 'scribble' | 'tiny', number> = { line: 101, arrow: 202, ellipse: 303, rect: 404, triangle: 505, polygon: 606, scribble: 707, tiny: 808 };

/** `count` fixtures of one kind (deterministic). noise scales the wobble and jitter (1 = normal hand). */
export function fixturesOf(kind: FixtureKind | 'scribble' | 'tiny', count = 40, seed?: number, noise = 1): Fixture[] {
  const r = mulberry32(seed ?? SEEDS[kind]);
  NOISE = noise;
  const make = kind === 'scribble' ? scribbleFixture : kind === 'tiny' ? tinyFixture : MAKERS[kind];
  const out: Fixture[] = [];
  for (let i = 0; i < count; i++) out.push(make(r, i));
  NOISE = 1;
  return out;
}

/** Converts flat x, y, p to x, y pairs (stride 2 input). */
export function pairsOf(xyp: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < xyp.length; i += 3) out.push(xyp[i], xyp[i + 1]);
  return out;
}
