/**
 * Ruler hit geometry (NB-45), in SCREEN space (the ruler overlay and canvas gestures work in screen
 * px). The ruler is a rectangle centred on (cx, cy), `length` long along its axis and `width` across
 * it, turned by `angle` radians (y down, so positive turns clockwise on screen).
 *
 * Users: src/notebook/canvas/ruler.ts RulerApi.hitTest (P04), the canvas nav/taps arbitration (P22)
 * and the ruler gesture (P28). All functions are worklets.
 */

/** The point (sx, sy) in the ruler's own frame: [along the axis, across it], from the centre. */
export function rulerLocal(sx: number, sy: number, cx: number, cy: number, angle: number): [number, number] {
  'worklet';
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const dx = sx - cx;
  const dy = sy - cy;
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
}

/**
 * true when (sx, sy) lies on the ruler (edges included). `slop` widens the rectangle on every side
 * (default 0). Bad numbers (NaN, a negative size) give false.
 */
export function rulerContains(sx: number, sy: number, cx: number, cy: number, angle: number, length: number, width: number, slop: number = 0): boolean {
  'worklet';
  if (!(length >= 0) || !(width >= 0)) return false;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const dx = sx - cx;
  const dy = sy - cy;
  const along = dx * ux + dy * uy;
  const across = -dx * uy + dy * ux;
  const eps = 1e-9;
  return Math.abs(along) <= length / 2 + slop + eps && Math.abs(across) <= width / 2 + slop + eps;
}

/** The four corners as a flat [x0, y0, x1, y1, x2, y2, x3, y3] (start-top, end-top, end-bottom, start-bottom). */
export function rulerCorners(cx: number, cy: number, angle: number, length: number, width: number): number[] {
  'worklet';
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const hl = length / 2;
  const hw = width / 2;
  const out: number[] = [];
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [a, b] of signs) {
    out.push(cx + a * hl * ux - b * hw * uy, cy + a * hl * uy + b * hw * ux);
  }
  return out;
}
