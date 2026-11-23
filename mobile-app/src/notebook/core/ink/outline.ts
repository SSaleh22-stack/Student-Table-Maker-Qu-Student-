/**
 * Outline polygon (flat x, y) -> drawable path. Both forms trace the same smooth curve: quadratic
 * segments with the outline points as control points and the midpoints between them as anchors
 * (the curve perfect-freehand's getSvgPathFromStroke draws), closed around the whole loop.
 */

/** Skia PathVerb codes (Move 0, Line 1, Quad 2, Close 5), as Skia.Path.MakeFromCmds expects. */
export const VERB_MOVE = 0;
export const VERB_LINE = 1;
export const VERB_QUAD = 2;
export const VERB_CLOSE = 5;

function fmt(v: number, precision: number): string {
  'worklet';
  const k = Math.pow(10, precision);
  const r = Math.round(v * k) / k;
  return r === 0 ? '0' : String(r);
}

/**
 * Path commands for Skia.Path.MakeFromCmds: [[0, x, y], [2, cx, cy, x, y], ..., [5]].
 * closed = true (outlines) wraps the curve around; false draws an open curve ending at the last point.
 */
export function outlineToCommands(outline: ArrayLike<number>, closed: boolean = true): number[][] {
  'worklet';
  const n = Math.floor(outline.length / 2);
  const cmds: number[][] = [];
  if (n === 0) return cmds;
  if (n < 3) {
    cmds.push([0, outline[0], outline[1]]);
    if (n === 2) cmds.push([1, outline[2], outline[3]]);
    if (closed) cmds.push([5]);
    return cmds;
  }
  if (closed) {
    const lx = outline[(n - 1) * 2];
    const ly = outline[(n - 1) * 2 + 1];
    cmds.push([0, (lx + outline[0]) / 2, (ly + outline[1]) / 2]);
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const x = outline[i * 2];
      const y = outline[i * 2 + 1];
      cmds.push([2, x, y, (x + outline[j * 2]) / 2, (y + outline[j * 2 + 1]) / 2]);
    }
    cmds.push([5]);
    return cmds;
  }
  cmds.push([0, outline[0], outline[1]]);
  for (let i = 1; i < n - 1; i++) {
    const x = outline[i * 2];
    const y = outline[i * 2 + 1];
    cmds.push([2, x, y, (x + outline[i * 2 + 2]) / 2, (y + outline[i * 2 + 3]) / 2]);
  }
  cmds.push([1, outline[(n - 1) * 2], outline[(n - 1) * 2 + 1]]);
  return cmds;
}

/** The same curve as an SVG path string (for PDF/SVG export). precision = decimals kept (default 2). */
export function outlineToSvgPath(outline: ArrayLike<number>, closed: boolean = true, precision: number = 2): string {
  'worklet';
  const cmds = outlineToCommands(outline, closed);
  let s = '';
  for (let k = 0; k < cmds.length; k++) {
    const c = cmds[k];
    if (s.length > 0) s += ' ';
    if (c[0] === 0) s += 'M' + fmt(c[1], precision) + ',' + fmt(c[2], precision);
    else if (c[0] === 1) s += 'L' + fmt(c[1], precision) + ',' + fmt(c[2], precision);
    else if (c[0] === 2) s += 'Q' + fmt(c[1], precision) + ',' + fmt(c[2], precision) + ' ' + fmt(c[3], precision) + ',' + fmt(c[4], precision);
    else s += 'Z';
  }
  return s;
}

/** Straight-segment polygon commands (no smoothing), for hit masks or debugging. */
export function polygonToCommands(poly: ArrayLike<number>, closed: boolean = true): number[][] {
  'worklet';
  const n = Math.floor(poly.length / 2);
  const cmds: number[][] = [];
  for (let i = 0; i < n; i++) cmds.push([i === 0 ? 0 : 1, poly[i * 2], poly[i * 2 + 1]]);
  if (closed && n > 0) cmds.push([5]);
  return cmds;
}
