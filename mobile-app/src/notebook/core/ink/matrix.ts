/**
 * 2D affine matrices as flat [a, b, c, d, e, f] (the canvas/SVG convention):
 *   x' = a * x + c * y + e
 *   y' = b * x + d * y + f
 * matMultiply(m, n) applies n first, then m. Angles are radians; page space is y-down, so a positive
 * angle turns clockwise on screen.
 */

export type Mat = number[];

export function matIdentity(): Mat {
  'worklet';
  return [1, 0, 0, 1, 0, 0];
}

export function matTranslate(tx: number, ty: number): Mat {
  'worklet';
  return [1, 0, 0, 1, tx, ty];
}

export function matScale(sx: number, sy: number = sx): Mat {
  'worklet';
  return [sx, 0, 0, sy, 0, 0];
}

export function matRotate(angle: number): Mat {
  'worklet';
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, 0, 0];
}

/** m x n: the result applies n, then m. */
export function matMultiply(m: ArrayLike<number>, n: ArrayLike<number>): Mat {
  'worklet';
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Scale about the point (cx, cy). */
export function matScaleAt(cx: number, cy: number, sx: number, sy: number = sx): Mat {
  'worklet';
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

/** Rotation about the point (cx, cy). */
export function matRotateAt(cx: number, cy: number, angle: number): Mat {
  'worklet';
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

export function matDeterminant(m: ArrayLike<number>): number {
  'worklet';
  return m[0] * m[3] - m[1] * m[2];
}

/** The inverse, or null when the matrix is singular. */
export function matInvert(m: ArrayLike<number>): Mat | null {
  'worklet';
  const det = m[0] * m[3] - m[1] * m[2];
  if (!(Math.abs(det) > 1e-12)) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** The transformed point [x', y']. */
export function matApply(m: ArrayLike<number>, x: number, y: number): number[] {
  'worklet';
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Transforms the x, y of every stride-sized record (other components copied). */
export function matApplyFlat(m: ArrayLike<number>, pts: ArrayLike<number>, stride: number = 2): number[] {
  'worklet';
  const out: number[] = new Array(pts.length);
  const n = Math.floor(pts.length / stride);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    const x = pts[o];
    const y = pts[o + 1];
    out[o] = m[0] * x + m[2] * y + m[4];
    out[o + 1] = m[1] * x + m[3] * y + m[5];
    for (let k = 2; k < stride; k++) out[o + k] = pts[o + k];
  }
  for (let k = n * stride; k < pts.length; k++) out[k] = pts[k];
  return out;
}

/** The uniform scale factor sqrt(|det|) (1 for moves and rotations). */
export function matUniformScale(m: ArrayLike<number>): number {
  'worklet';
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** The rotation angle of the x axis under m. */
export function matRotation(m: ArrayLike<number>): number {
  'worklet';
  return Math.atan2(m[1], m[0]);
}

export function matIsIdentity(m: ArrayLike<number>, eps: number = 1e-9): boolean {
  'worklet';
  return (
    Math.abs(m[0] - 1) <= eps &&
    Math.abs(m[1]) <= eps &&
    Math.abs(m[2]) <= eps &&
    Math.abs(m[3] - 1) <= eps &&
    Math.abs(m[4]) <= eps &&
    Math.abs(m[5]) <= eps
  );
}
