/**
 * Numeric methods on plain float functions f(x) -> number | CalcError (eval.ts builds them from rows).
 * - integrate: adaptive Gauss-Kronrod 7-15. Time Out when the deadline passes or it does not converge.
 * - derivative: central differences with Richardson extrapolation (Ridders).
 * - sumSeries: Σ over integers a..b, at most 10^6 terms.
 * - findRoot: Newton, then secant, then bracketing and bisection; Can't Solve after 200 iterations.
 * The clock is injected (Deadline), so Time Out is testable.
 */
import type { CalcError } from './types.ts';

export type RealFn = (x: number) => number | CalcError;

export interface Deadline {
  now: () => number;
  /** Absolute time (same clock) after which work stops with Time Out. */
  until: number;
}

export function makeDeadline(now: () => number, budgetMs: number): Deadline {
  return { now, until: now() + budgetMs };
}

function expired(d: Deadline): boolean {
  return d.now() > d.until;
}

// ===== integration

// Gauss-Kronrod 7-15 nodes and weights on [-1, 1].
const XGK = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
  0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0.0,
];
const WGK = [
  0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
  0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
];
// Gauss 7-point weights for the nodes XGK[1], XGK[3], XGK[5], XGK[7].
const WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

class Fail {
  readonly e: CalcError;
  constructor(e: CalcError) {
    this.e = e;
  }
}

function call(f: RealFn, x: number): number {
  const y = f(x);
  if (typeof y === 'string') throw new Fail(y);
  if (!Number.isFinite(y)) throw new Fail('Math ERROR');
  return y;
}

function gk15(f: RealFn, a: number, b: number): { value: number; err: number } {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  const fc = call(f, c);
  let resK = fc * WGK[7];
  let resG = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const f1 = call(f, c - dx);
    const f2 = call(f, c + dx);
    resK += WGK[j] * (f1 + f2);
    if (j % 2 === 1) resG += WG[(j - 1) / 2] * (f1 + f2);
  }
  return { value: resK * h, err: Math.abs((resK - resG) * h) };
}

/** ∫ₐᵇ f(x) dx. b < a gives the negative. */
export function integrate(f: RealFn, a: number, b: number, deadline: Deadline, maxIntervals: number = 2000): number | CalcError {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'Math ERROR';
  if (a === b) return 0;
  try {
    type Seg = { a: number; b: number; value: number; err: number };
    const first = gk15(f, a, b);
    const segs: Seg[] = [{ a, b, ...first }];
    let total = first.value;
    let errSum = first.err;
    while (segs.length < maxIntervals) {
      const tol = Math.max(1e-12 * Math.abs(total), 1e-14);
      if (errSum <= tol) return total;
      if (expired(deadline)) return 'Time Out';
      // Split the segment with the largest error.
      let worst = 0;
      for (let i = 1; i < segs.length; i++) if (segs[i].err > segs[worst].err) worst = i;
      const s = segs[worst];
      const mid = (s.a + s.b) / 2;
      if (mid === s.a || mid === s.b) return 'Time Out';
      const l = gk15(f, s.a, mid);
      const r = gk15(f, mid, s.b);
      segs[worst] = { a: s.a, b: mid, ...l };
      segs.push({ a: mid, b: s.b, ...r });
      total += l.value + r.value - s.value;
      errSum += l.err + r.err - s.err;
      // Recompute now and then to stop drift.
      if (segs.length % 64 === 0) {
        total = segs.reduce((t, x) => t + x.value, 0);
        errSum = segs.reduce((t, x) => t + x.err, 0);
      }
    }
    return 'Time Out';
  } catch (e) {
    if (e instanceof Fail) return e.e;
    throw e;
  }
}

// ===== differentiation

/** f'(x) by Ridders' method. A failing sample shrinks the step (up to 20 times). */
export function derivative(f: RealFn, x: number, deadline: Deadline): number | CalcError {
  if (!Number.isFinite(x)) return 'Math ERROR';
  let h0 = 0.05 * Math.max(1, Math.abs(x));
  for (let attempt = 0; attempt < 20; attempt++, h0 /= 8) {
    try {
      const NTAB = 10;
      const CON = 1.4;
      const CON2 = CON * CON;
      const a: number[][] = Array.from({ length: NTAB }, () => new Array<number>(NTAB).fill(0));
      let hh = h0;
      a[0][0] = (call(f, x + hh) - call(f, x - hh)) / (2 * hh);
      let err = Infinity;
      let ans = a[0][0];
      for (let i = 1; i < NTAB; i++) {
        if (expired(deadline)) return 'Time Out';
        hh /= CON;
        a[0][i] = (call(f, x + hh) - call(f, x - hh)) / (2 * hh);
        let fac = CON2;
        for (let j = 1; j <= i; j++) {
          a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
          fac *= CON2;
          const errt = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
          if (errt <= err) {
            err = errt;
            ans = a[j][i];
          }
        }
        if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= 2 * err) break;
      }
      return ans;
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      if (e.e !== 'Math ERROR') return e.e;
      // A sample left the domain: try a smaller step.
    }
  }
  return 'Math ERROR';
}

// ===== Σ

export const SUM_MAX_TERMS = 1e6;

/** Σ_{x=a}^{b} f(x) on floats. a and b must be integers with a <= b. */
export function sumSeries(f: RealFn, a: number, b: number, deadline: Deadline): number | CalcError {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) return 'Math ERROR';
  if (b - a + 1 > SUM_MAX_TERMS) return 'Math ERROR';
  let s = 0;
  let c = 0; // Kahan compensation
  try {
    for (let x = a, i = 0; x <= b; x++, i++) {
      if (i % 1024 === 1023 && expired(deadline)) return 'Time Out';
      const y = call(f, x) - c;
      const t = s + y;
      c = t - s - y;
      s = t;
    }
  } catch (e) {
    if (e instanceof Fail) return e.e;
    throw e;
  }
  return s;
}

// ===== SOLVE

export const SOLVE_MAX_ITER = 200;

export type RootResult = { x: number; lr: number } | CalcError;

/**
 * A root of f near x0 (f = left side − right side). Uses at most 200 iterations in all, shared by
 * Newton, secant and the bracketing search; then Can't Solve. Poles (sign changes where |f| is
 * large) are not roots.
 */
export function findRoot(f: RealFn, guess: number, deadline: Deadline): RootResult {
  if (!Number.isFinite(guess)) return 'Math ERROR';
  let iter = 0;
  const tick = (): boolean => {
    iter++;
    return iter <= SOLVE_MAX_ITER && !expired(deadline);
  };
  const safe = (x: number): number | null => {
    if (!Number.isFinite(x)) return null;
    const y = f(x);
    return typeof y === 'string' || !Number.isFinite(y) ? null : y;
  };
  let x0 = guess;
  let f0 = safe(x0);
  // A guess outside the domain (ln(X)=1 from the default X = 0): start from the nearest point
  // where f is defined instead.
  for (let d = 1e-3 * Math.max(1, Math.abs(guess)); f0 === null && d < 1e99 && tick(); d *= 2) {
    for (const c of [guess + d, guess - d]) {
      const y = safe(c);
      if (y !== null) {
        x0 = c;
        f0 = y;
        break;
      }
    }
  }
  const scale = Math.max(1, f0 === null ? 1 : Math.abs(f0));
  const tolF = 1e-9 * scale;
  const accept = (x: number): RootResult | null => {
    const y = safe(x);
    if (y === null) return null;
    if (Math.abs(y) <= tolF) return { x: x === 0 ? 0 : x, lr: y === 0 ? 0 : y };
    return null;
  };
  if (f0 !== null && f0 === 0) return { x: x0, lr: 0 };

  // 1. Newton with a numeric derivative.
  let x = x0;
  if (f0 !== null) {
    let fx = f0;
    for (let k = 0; k < 60 && tick(); k++) {
      const h = 1e-6 * Math.max(1, Math.abs(x));
      const fp = safe(x + h);
      const fm = safe(x - h);
      if (fp === null || fm === null) break;
      const d = (fp - fm) / (2 * h);
      if (d === 0 || !Number.isFinite(d)) break;
      const nx = x - fx / d;
      const fn = safe(nx);
      if (fn === null) break;
      const step = Math.abs(nx - x);
      x = nx;
      fx = fn;
      // Accept only once the steps have settled (a run-away toward infinity where f -> 0 is no root).
      const rel = step / Math.max(1, Math.abs(x));
      if (rel <= 1e-12 || (fx === 0 && rel <= 1e-6)) {
        const r = accept(x);
        if (r) return r;
        break;
      }
    }
  }

  // 2. Secant from x0 and a nearby point.
  {
    let a = x0;
    let b = x0 + 1e-3 * Math.max(1, Math.abs(x0));
    let fa = safe(a);
    let fb = safe(b);
    for (let k = 0; k < 60 && fa !== null && fb !== null && tick(); k++) {
      if (fb === fa) break;
      const c = b - (fb * (b - a)) / (fb - fa);
      const fc = safe(c);
      if (fc === null) break;
      a = b;
      fa = fb;
      b = c;
      fb = fc;
      if (fb === 0 || Math.abs(b - a) <= 1e-15 * Math.max(1, Math.abs(b))) break;
    }
    if (fb !== null && Math.abs(b - a) <= 1e-9 * Math.max(1, Math.abs(b))) {
      const r = accept(b);
      if (r) return r;
    }
  }

  // 3. Search outward for a sign change, then bisect.
  if (f0 !== null) {
    let bracket: [number, number, number] | null = null; // a, b, f(a)
    let pr = x0; // previous point on the right
    let fpr = f0;
    let pl = x0; // previous point on the left
    let fpl = f0;
    let d = 0.1 * Math.max(1, Math.abs(x0));
    while (!bracket && d < 1e99 && tick()) {
      const h = x0 + d;
      const fh = safe(h);
      if (fh !== null) {
        if (Math.sign(fh) !== Math.sign(fpr)) bracket = [pr, h, fpr];
        pr = h;
        fpr = fh;
      }
      if (bracket) break;
      const l = x0 - d;
      const fl = safe(l);
      if (fl !== null) {
        if (Math.sign(fl) !== Math.sign(fpl)) bracket = [l, pl, fl];
        pl = l;
        fpl = fl;
      }
      d *= 2;
    }
    if (bracket) {
      let [a, b, fa] = bracket;
      while (tick()) {
        const m = (a + b) / 2;
        if (m === a || m === b) break;
        const fm = safe(m);
        if (fm === null) break;
        if (fm === 0) return { x: m, lr: 0 };
        if (Math.sign(fm) === Math.sign(fa)) {
          a = m;
          fa = fm;
        } else {
          b = m;
        }
      }
      const r = accept((a + b) / 2) ?? accept(a) ?? accept(b);
      if (r) return r;
    }
  }
  if (expired(deadline)) return 'Time Out';
  return "Can't Solve";
}
