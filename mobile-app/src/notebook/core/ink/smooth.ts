/**
 * Input smoothing on flat [x, y, p] points.
 * - streamlinePoints: the streamline filter freehand applies (each point moves a fraction t of the
 *   way from the previous smoothed point to the new raw point).
 * - straighten: the highlighter's hold-to-straighten (NB-41): the two endpoints with the average
 *   pressure.
 */

/** The interpolation factor for a streamline amount 0..1 (freehand: 0.15 + (1 - s) * 0.85). */
export function streamlineT(amount: number): number {
  'worklet';
  const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  return 0.15 + (1 - a) * 0.85;
}

/**
 * Streamline filter. Keeps every point (pressure as is), the first one unchanged. keepLast = true puts
 * the final point exactly on the last raw point, as freehand does for a finished stroke.
 */
export function streamlinePoints(pts: ArrayLike<number>, amount: number, keepLast: boolean = true): number[] {
  'worklet';
  const n = Math.floor(pts.length / 3);
  const out: number[] = [];
  if (n === 0) return out;
  const t = streamlineT(amount);
  let px = pts[0];
  let py = pts[1];
  out.push(px, py, pts[2]);
  for (let i = 1; i < n; i++) {
    const rx = pts[i * 3];
    const ry = pts[i * 3 + 1];
    if (keepLast && i === n - 1) {
      px = rx;
      py = ry;
    } else {
      px = px + (rx - px) * t;
      py = py + (ry - py) * t;
    }
    out.push(px, py, pts[i * 3 + 2]);
  }
  return out;
}

/** One streamline step from the previous smoothed point (px, py) toward the raw (rx, ry). */
export function streamlineStep(px: number, py: number, rx: number, ry: number, amount: number): number[] {
  'worklet';
  const t = streamlineT(amount);
  return [px + (rx - px) * t, py + (ry - py) * t];
}

/** Average pressure of flat [x, y, p] points (0.5 when empty). */
export function averagePressure(pts: ArrayLike<number>): number {
  'worklet';
  const n = Math.floor(pts.length / 3);
  if (n === 0) return 0.5;
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i * 3 + 2];
    if (p >= 0) {
      s += p;
      c++;
    }
  }
  return c > 0 ? s / c : 0.5;
}

/**
 * The straight version of a stroke: [x0, y0, pAvg, xN, yN, pAvg]. Fewer than 2 points are returned
 * as a copy.
 */
export function straighten(pts: ArrayLike<number>): number[] {
  'worklet';
  const n = Math.floor(pts.length / 3);
  if (n < 2) {
    const c: number[] = [];
    for (let k = 0; k < n * 3; k++) c.push(pts[k]);
    return c;
  }
  const p = averagePressure(pts);
  const o = (n - 1) * 3;
  return [pts[0], pts[1], p, pts[o], pts[o + 1], p];
}
