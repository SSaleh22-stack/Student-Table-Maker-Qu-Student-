/**
 * Resampling and simplification of flat polylines.
 * stride 3 = [x, y, p] stroke points (pressure interpolated / kept), stride 2 = [x, y].
 *
 * Note: freehand's streamline works per sample, so simplifying the points of a stroke that is drawn
 * with streamline slightly changes how it looks. Use simplify for export, shapes and storage of
 * geometry that is drawn without streamline.
 */

/** Douglas-Peucker tolerance in pt. */
export const SIMPLIFY_EPSILON = 0.15;
/** Pressure tolerance of simplify (a point whose pressure departs this much from the chord stays). */
export const SIMPLIFY_PRESSURE_EPSILON = 0.05;

/** Length of a polyline. */
export function polylineLength(pts: ArrayLike<number>, stride: number = 3, closed: boolean = false): number {
  'worklet';
  const n = Math.floor(pts.length / stride);
  let len = 0;
  for (let i = 1; i < n; i++) {
    len += Math.hypot(pts[i * stride] - pts[(i - 1) * stride], pts[i * stride + 1] - pts[(i - 1) * stride + 1]);
  }
  if (closed && n > 2) len += Math.hypot(pts[0] - pts[(n - 1) * stride], pts[1] - pts[(n - 1) * stride + 1]);
  return len;
}

/**
 * Points every `spacing` pt along the polyline (values interpolated linearly per stride component),
 * keeping the first and the last point. spacing <= 0 returns a copy.
 */
export function resample(pts: ArrayLike<number>, spacing: number, stride: number = 3): number[] {
  'worklet';
  const n = Math.floor(pts.length / stride);
  const out: number[] = [];
  if (n === 0) return out;
  for (let k = 0; k < stride; k++) out.push(pts[k]);
  if (n === 1 || !(spacing > 0)) {
    for (let k = stride; k < n * stride; k++) out.push(pts[k]);
    return out;
  }
  let carry = 0; // distance since the last emitted point
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * stride;
    const b = i * stride;
    const seg = Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]);
    if (seg === 0) continue;
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      for (let k = 0; k < stride; k++) out.push(pts[a + k] + (pts[b + k] - pts[a + k]) * t);
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  const l = (n - 1) * stride;
  const ol = out.length - stride;
  const lastX = out[ol];
  const lastY = out[ol + 1];
  if (Math.hypot(pts[l] - lastX, pts[l + 1] - lastY) > spacing * 1e-6 || out.length === stride) {
    for (let k = 0; k < stride; k++) out.push(pts[l + k]);
  } else {
    for (let k = 0; k < stride; k++) out[ol + k] = pts[l + k];
  }
  return out;
}

/** Squared distance from (px, py) to segment a-b. */
function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  'worklet';
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

/**
 * Douglas-Peucker (iterative). With stride 3 a point also stays when its pressure differs from the
 * chord's interpolated pressure by more than pressureEpsilon. Endpoints always stay.
 */
export function simplify(
  pts: ArrayLike<number>,
  epsilon: number = SIMPLIFY_EPSILON,
  stride: number = 3,
  pressureEpsilon: number = SIMPLIFY_PRESSURE_EPSILON,
): number[] {
  'worklet';
  const n = Math.floor(pts.length / stride);
  const out: number[] = [];
  if (n <= 2) {
    for (let k = 0; k < n * stride; k++) out.push(pts[k]);
    return out;
  }
  const keep: number[] = new Array(n).fill(0);
  keep[0] = 1;
  keep[n - 1] = 1;
  const eps2 = epsilon * epsilon;
  const usePressure = stride >= 3 && pressureEpsilon > 0;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    if (b - a < 2) continue;
    const ax = pts[a * stride];
    const ay = pts[a * stride + 1];
    const bx = pts[b * stride];
    const by = pts[b * stride + 1];
    let worst = -1;
    let worstErr = 1;
    for (let i = a + 1; i < b; i++) {
      const d2 = segDistSq(pts[i * stride], pts[i * stride + 1], ax, ay, bx, by);
      let err = eps2 > 0 ? d2 / eps2 : d2 > 0 ? Infinity : 0;
      if (usePressure) {
        const pa = pts[a * stride + 2];
        const pb = pts[b * stride + 2];
        const pi = pa + ((pb - pa) * (i - a)) / (b - a);
        const dp = Math.abs(pts[i * stride + 2] - pi) / pressureEpsilon;
        const e2 = dp * dp;
        if (e2 > err) err = e2;
      }
      if (err > worstErr) {
        worstErr = err;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    for (let k = 0; k < stride; k++) out.push(pts[i * stride + k]);
  }
  return out;
}
