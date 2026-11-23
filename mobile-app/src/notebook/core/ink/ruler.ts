/**
 * Ruler snapping (NB-45). The ruler is given in PAGE space: center (cx, cy), angle (radians, y-down,
 * so positive turns clockwise on screen), length along its axis and width across it. Its two long
 * edges are the lines at +-width/2 from the center line.
 *
 * A stroke whose FIRST point is within threshold of an edge (and alongside the ruler) is drawn
 * straight along that edge: every point is projected onto the edge line, clamped to the ruler's
 * length; pressure is kept. Strokes that start elsewhere are untouched. For an incremental wet
 * stroke, call rulerEdgeAt once on the first point and projectToRuler on every new point.
 */

export interface RulerPage {
  cx: number;
  cy: number;
  angle: number;
  length: number;
  width: number;
}

/** The edge the point (x, y) starts on: 1 (the +normal side), -1, or 0 (not near an edge). */
export function rulerEdgeAt(x: number, y: number, ruler: RulerPage, threshold: number): number {
  'worklet';
  const ux = Math.cos(ruler.angle);
  const uy = Math.sin(ruler.angle);
  const dx = x - ruler.cx;
  const dy = y - ruler.cy;
  const along = dx * ux + dy * uy;
  const across = -dx * uy + dy * ux;
  if (Math.abs(along) > ruler.length / 2 + threshold) return 0;
  const half = ruler.width / 2;
  const dPlus = Math.abs(across - half);
  const dMinus = Math.abs(across + half);
  if (dPlus <= threshold && dPlus <= dMinus) return 1;
  if (dMinus <= threshold) return -1;
  return 0;
}

/** (x, y) projected onto the given edge line (1 or -1), clamped to the ruler's length. */
export function projectToRuler(x: number, y: number, ruler: RulerPage, edge: number): number[] {
  'worklet';
  const ux = Math.cos(ruler.angle);
  const uy = Math.sin(ruler.angle);
  const half = ruler.length / 2;
  let along = (x - ruler.cx) * ux + (y - ruler.cy) * uy;
  if (along < -half) along = -half;
  if (along > half) along = half;
  const off = (edge * ruler.width) / 2;
  // normal = (-uy, ux)
  return [ruler.cx + along * ux - off * uy, ruler.cy + along * uy + off * ux];
}

export interface RulerSnap {
  /** The (possibly projected) flat x, y, p points. The input array itself when edge is 0. */
  pts: number[];
  /** The edge used: 1, -1, or 0 when the stroke was not snapped. */
  edge: number;
}

/** Snaps a whole stroke (flat x, y, p) to the ruler when its first point starts on an edge. */
export function snapToRuler(pts: number[], ruler: RulerPage, threshold: number): RulerSnap {
  'worklet';
  const n = Math.floor(pts.length / 3);
  if (n === 0) return { pts, edge: 0 };
  const edge = rulerEdgeAt(pts[0], pts[1], ruler, threshold);
  if (edge === 0) return { pts, edge: 0 };
  const out: number[] = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    const q = projectToRuler(pts[i * 3], pts[i * 3 + 1], ruler, edge);
    out[i * 3] = q[0];
    out[i * 3 + 1] = q[1];
    out[i * 3 + 2] = pts[i * 3 + 2];
  }
  return { pts: out, edge };
}

/** The ruler's angle as shown on it: whole degrees of its tilt, 0..90 (a line has no direction). */
export function rulerDegrees(angle: number): number {
  'worklet';
  let d = Math.round((angle * 180) / Math.PI) % 180;
  if (d < 0) d += 180;
  // + 0 turns -0 into 0
  return (d > 90 ? 180 - d : d) + 0;
}

/** The angle label shown on the ruler, e.g. '8°' (Latin digits, as in Figma 09). */
export function angleLabel(angle: number): string {
  'worklet';
  return String(rulerDegrees(angle)) + '°';
}

/**
 * Snaps a ruler angle to the nearest multiple of 45° when it is within tolerance (radians), so the
 * ruler settles exactly horizontal, vertical or diagonal while being rotated.
 */
export function snapRulerAngle(angle: number, tolerance: number = (1.5 * Math.PI) / 180): number {
  'worklet';
  const step = Math.PI / 4;
  const k = Math.round(angle / step);
  const target = k * step;
  return Math.abs(angle - target) <= tolerance ? target : angle;
}
