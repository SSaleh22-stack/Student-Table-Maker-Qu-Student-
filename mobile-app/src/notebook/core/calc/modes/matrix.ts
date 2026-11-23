/**
 * MATRIX (MODE 6): MatA, MatB, MatC and MatAns, 1 to 3 rows and columns.
 *
 * - + and −: same dimensions (else Dimension ERROR).
 * - ×: scalar × matrix, matrix × scalar, and matrix × matrix (columns of the left = rows of the right).
 * - ÷: matrix ÷ scalar only.
 * - x², x³ and x⁻¹ on square matrices (x⁻¹ of a singular matrix is Math ERROR), det (square only),
 *   Trn (transpose) and Abs (each element).
 * - A real scalar only; a complex number with a matrix is Math ERROR; any other mix is Syntax ERROR.
 * Work is exact (rationals) whenever every element has a short decimal form, so 1/3 and 0.1 behave.
 */
import type { CalcError, CalcValue, FnName, MatValue, ModeBinOp, PostOp, Rational } from '../types.ts';
import { real } from '../num/value.ts';
import { exQ, recognize } from '../exact.ts';
import { ONE_Q, ZERO_Q, qAdd, qDiv, qFromNumber, qIsZero, qMul, qSub, qToNumber } from '../num/rational.ts';

export const MAT_DIMS = { min: 1, max: 3 } as const;

/** A matrix value (a copy, with −0 cleaned up). */
export function makeMat(m: number[][]): MatValue {
  return { t: 'mat', m: m.map((row) => row.map((x) => (x === 0 ? 0 : x))) };
}

/** An m × n zero matrix (the matrix editor's starting cells). */
export function zeroMat(rows: number, cols: number): MatValue {
  return makeMat(Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)));
}

export function isValidDims(rows: number, cols: number): boolean {
  const ok = (n: number) => Number.isInteger(n) && n >= MAT_DIMS.min && n <= MAT_DIMS.max;
  return ok(rows) && ok(cols);
}

export function dims(a: MatValue): { rows: number; cols: number } {
  return { rows: a.m.length, cols: a.m[0]?.length ?? 0 };
}

type QMat = Rational[][];

/**
 * The exact rational a float stands for, when it has one: a number with at most 12 significant
 * digits (anything typed on the keypad), or a float within rounding of a short fraction (1/3).
 * null for other floats (√2), so they stay on the float path.
 */
export function exactQ(x: number): Rational | null {
  if (!Number.isFinite(x)) return null;
  if (Number(x.toPrecision(12)) === x) return qFromNumber(x);
  const r = recognize(x);
  return r && r.k === 'q' ? r.q : null;
}

/** Exact form of a matrix when every element has a short decimal form, else null. */
export function toQMat(m: number[][]): QMat | null {
  const out: QMat = [];
  for (const row of m) {
    const r: Rational[] = [];
    for (const x of row) {
      const v = exactQ(x);
      if (!v) return null;
      r.push(v);
    }
    out.push(r);
  }
  return out;
}

function fromQMat(m: QMat): number[][] {
  return m.map((row) => row.map((x) => qToNumber(x)));
}

function sameDims(a: MatValue, b: MatValue): boolean {
  const da = dims(a);
  const db = dims(b);
  return da.rows === db.rows && da.cols === db.cols;
}

export function matAddSub(op: '+' | '-', a: MatValue, b: MatValue): MatValue | CalcError {
  if (!sameDims(a, b)) return 'Dimension ERROR';
  const qa = toQMat(a.m);
  const qb = toQMat(b.m);
  if (qa && qb) return makeMat(fromQMat(qa.map((row, i) => row.map((x, j) => (op === '+' ? qAdd(x, qb[i][j]) : qSub(x, qb[i][j]))))));
  return makeMat(a.m.map((row, i) => row.map((x, j) => (op === '+' ? x + b.m[i][j] : x - b.m[i][j]))));
}

export function matScale(a: MatValue, k: number): MatValue {
  const qa = toQMat(a.m);
  const qk = exactQ(k);
  if (qa && qk) return makeMat(fromQMat(qa.map((row) => row.map((x) => qMul(x, qk)))));
  return makeMat(a.m.map((row) => row.map((x) => x * k)));
}

export function matDivScalar(a: MatValue, k: number): MatValue | CalcError {
  if (k === 0) return 'Math ERROR';
  const qa = toQMat(a.m);
  const qk = exactQ(k);
  if (qa && qk) return makeMat(fromQMat(qa.map((row) => row.map((x) => qDiv(x, qk) ?? ZERO_Q))));
  return makeMat(a.m.map((row) => row.map((x) => x / k)));
}

function qMatMul(a: QMat, b: QMat): QMat {
  const n = b[0].length;
  return a.map((row) => Array.from({ length: n }, (_, j) => row.reduce((s, x, k) => qAdd(s, qMul(x, b[k][j])), ZERO_Q)));
}

export function matMul(a: MatValue, b: MatValue): MatValue | CalcError {
  const da = dims(a);
  const db = dims(b);
  if (da.cols !== db.rows) return 'Dimension ERROR';
  const qa = toQMat(a.m);
  const qb = toQMat(b.m);
  if (qa && qb) return makeMat(fromQMat(qMatMul(qa, qb)));
  return makeMat(a.m.map((row) => Array.from({ length: db.cols }, (_, j) => row.reduce((s, x, k) => s + x * b.m[k][j], 0))));
}

export function matTranspose(a: MatValue): MatValue {
  const { rows, cols } = dims(a);
  return makeMat(Array.from({ length: cols }, (_, j) => Array.from({ length: rows }, (_, i) => a.m[i][j])));
}

export function matAbs(a: MatValue): MatValue {
  return makeMat(a.m.map((row) => row.map((x) => Math.abs(x))));
}

function isSquare(a: MatValue): boolean {
  const d = dims(a);
  return d.rows === d.cols;
}

function qDet(m: QMat): Rational {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return qSub(qMul(m[0][0], m[1][1]), qMul(m[0][1], m[1][0]));
  let s = ZERO_Q;
  for (let j = 0; j < n; j++) {
    const minor = m.slice(1).map((row) => row.filter((_, k) => k !== j));
    const term = qMul(m[0][j], qDet(minor));
    s = j % 2 === 0 ? qAdd(s, term) : qSub(s, term);
  }
  return s;
}

function fDet(m: number[][]): number {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let s = 0;
  for (let j = 0; j < n; j++) {
    const minor = m.slice(1).map((row) => row.filter((_, k) => k !== j));
    s += (j % 2 === 0 ? 1 : -1) * m[0][j] * fDet(minor);
  }
  return s;
}

/** det of a square matrix, as a real value (exact when the elements are). */
export function matDet(a: MatValue): CalcValue | CalcError {
  if (!isSquare(a)) return 'Dimension ERROR';
  const qa = toQMat(a.m);
  if (qa) {
    const d = qDet(qa);
    return real(qToNumber(d), exQ(d));
  }
  return real(fDet(a.m));
}

function qInverse(m: QMat): QMat | null {
  const n = m.length;
  const aug: QMat = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? ONE_Q : ZERO_Q))]);
  for (let c = 0; c < n; c++) {
    const p = aug.findIndex((row, r) => r >= c && !qIsZero(row[c]));
    if (p < 0) return null;
    [aug[c], aug[p]] = [aug[p], aug[c]];
    const pivot = aug[c][c];
    aug[c] = aug[c].map((x) => qDiv(x, pivot) ?? ZERO_Q);
    for (let r = 0; r < n; r++) {
      if (r === c || qIsZero(aug[r][c])) continue;
      const f = aug[r][c];
      aug[r] = aug[r].map((x, k) => qSub(x, qMul(f, aug[c][k])));
    }
  }
  return aug.map((row) => row.slice(n));
}

function fInverse(m: number[][]): number[][] | null {
  const n = m.length;
  const scale = Math.max(...m.flat().map((x) => Math.abs(x)), 0);
  if (scale === 0) return null;
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(aug[r][c]) > Math.abs(aug[p][c])) p = r;
    if (Math.abs(aug[p][c]) <= scale * 1e-13) return null;
    [aug[c], aug[p]] = [aug[p], aug[c]];
    const pivot = aug[c][c];
    aug[c] = aug[c].map((x) => x / pivot);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = aug[r][c];
      if (f !== 0) aug[r] = aug[r].map((x, k) => x - f * aug[c][k]);
    }
  }
  return aug.map((row) => row.slice(n));
}

export function matInverse(a: MatValue): MatValue | CalcError {
  if (!isSquare(a)) return 'Dimension ERROR';
  const qa = toQMat(a.m);
  if (qa) {
    const inv = qInverse(qa);
    return inv ? makeMat(fromQMat(inv)) : 'Math ERROR';
  }
  const inv = fInverse(a.m);
  return inv ? makeMat(inv) : 'Math ERROR';
}

export function matPow(a: MatValue, k: 2 | 3): MatValue | CalcError {
  if (!isSquare(a)) return 'Dimension ERROR';
  const sq = matMul(a, a);
  if (typeof sq === 'string' || k === 2) return sq;
  return matMul(sq, a);
}

function scalarOf(v: CalcValue): number | CalcError | null {
  if (v.t === 'real') return v.x;
  if (v.t === 'cplx') return v.im === 0 ? v.re : 'Math ERROR';
  return null;
}

/** Binary operators with at least one matrix operand. null when neither operand is a matrix. */
export function matBinary(op: ModeBinOp, a: CalcValue, b: CalcValue): CalcValue | CalcError | null {
  if (a.t !== 'mat' && b.t !== 'mat') return null;
  if (a.t === 'mat' && b.t === 'mat') {
    if (op === '+' || op === '-') return matAddSub(op, a, b);
    if (op === '×') return matMul(a, b);
    return 'Syntax ERROR';
  }
  const mat = a.t === 'mat' ? a : b.t === 'mat' ? b : null;
  if (!mat) return null;
  const k = scalarOf(a.t === 'mat' ? b : a);
  if (k === null) return 'Syntax ERROR';
  if (typeof k === 'string') return k;
  if (op === '×') return matScale(mat, k);
  if (op === '÷' && a.t === 'mat') return matDivScalar(mat, k);
  return 'Syntax ERROR';
}

/** Functions and postfix operators on a matrix. null when a is not a matrix. */
export function matUnary(name: FnName | PostOp, a: CalcValue): CalcValue | CalcError | null {
  if (a.t !== 'mat') {
    // det and Trn need a matrix.
    return name === 'det' || name === 'Trn' ? 'Math ERROR' : null;
  }
  switch (name) {
    case 'det':
      return matDet(a);
    case 'Trn':
      return matTranspose(a);
    case 'Abs':
      return matAbs(a);
    case '²':
      return matPow(a, 2);
    case '³':
      return matPow(a, 3);
    case '⁻¹':
      return matInverse(a);
    case 'Neg':
      return matScale(a, -1);
    default:
      return 'Math ERROR';
  }
}

