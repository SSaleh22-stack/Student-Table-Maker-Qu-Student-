/**
 * TABLE (MODE 7): f(x) (and g(x) with SETUP TABLE f(x),g(x)) for X = Start, Start+Step, … ≤ End.
 *
 * - At most 30 rows with f(x) only, 20 with f(x) and g(x); more is Insufficient MEM.
 * - Step 0, a step that walks away from End, or values out of range are Math ERROR.
 * - Each row is [x, f(x)] or [x, f(x), g(x)]. A cell whose value has an error (or is not a real
 *   number) is NaN: the LCD shows 'ERROR' there.
 * f and g read X; other variables keep their values from ctx.
 * The whole table shares one time budget (TABLE_TIME_LIMIT_MS, or EvalOptions.timeLimitMs), so 30
 * slow cells (∫ in f(x)) cannot hold the app for 30 × 3 s; when it runs out the table is Time Out.
 */
import type { CalcContext, CalcError, EvalOptions, MathRow } from '../types.ts';
import { evaluate } from '../eval.ts';
import { withMode, withVar } from '../context.ts';
import { real } from '../num/value.ts';

export const TABLE_MAX_ROWS_F = 30;
export const TABLE_MAX_ROWS_FG = 20;

/** Time budget in ms for building a whole table. */
export const TABLE_TIME_LIMIT_MS = 10000;

/** The cell text the LCD shows for an error cell. */
export const TABLE_ERROR_CELL = 'ERROR';

/** Most rows a table holds with or without g(x). */
export function tableMaxRows(hasG: boolean): number {
  return hasG ? TABLE_MAX_ROWS_FG : TABLE_MAX_ROWS_F;
}

/** Number of rows for start, end and step, or an error. */
export function tableRowCount(start: number, end: number, step: number, hasG: boolean): number | CalcError {
  if (![start, end, step].every(Number.isFinite)) return 'Math ERROR';
  if (step === 0) return 'Math ERROR';
  const span = (end - start) / step;
  if (span < 0) return 'Math ERROR';
  // A tiny tolerance so 0, 0.1, … 1 gives 11 rows despite float steps.
  const count = Math.floor(span + 1e-10) + 1;
  return count > tableMaxRows(hasG) ? 'Insufficient MEM' : count;
}

/** The X value of row i, rounded to 15 significant digits so 0.1 + 0.2 reads as 0.3. */
export function tableX(start: number, step: number, i: number): number {
  const x = start + i * step;
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;
  return Number(x.toPrecision(15));
}

function cell(row: MathRow, x: number, ctx: CalcContext, o: EvalOptions): number {
  const r = evaluate(row, withVar(ctx, 'X', real(x)), o);
  if (!r.ok) return Number.NaN;
  const v = r.value;
  if (v.t === 'real') return v.x;
  if (v.t === 'cplx' && v.im === 0) return v.re;
  return Number.NaN;
}

/** tableBuild with evaluation options (clock and time budget). */
export function tableBuildWith(
  f: MathRow,
  g: MathRow | null,
  start: number,
  end: number,
  step: number,
  ctx: CalcContext,
  o: EvalOptions = {},
): { rows: number[][] } | CalcError {
  const hasG = g !== null && g.length > 0;
  const count = tableRowCount(start, end, step, hasG);
  if (typeof count === 'string') return count;
  if (f.length === 0) return 'Syntax ERROR';
  const ectx = withMode(ctx, 'TABLE');
  const now = o.now ?? (() => Date.now());
  const until = now() + (o.timeLimitMs ?? TABLE_TIME_LIMIT_MS);
  // Each cell gets what is left of the table's budget; null once it is used up.
  const cellOpts = (): EvalOptions | null => {
    const left = until - now();
    return left > 0 ? { ...o, now, timeLimitMs: left } : null;
  };
  const rows: number[][] = [];
  for (let i = 0; i < count; i++) {
    const x = tableX(start, step, i);
    if (Math.abs(x) >= 1e100) return 'Math ERROR';
    const fo = cellOpts();
    if (!fo) return 'Time Out';
    const row = [x, cell(f, x, ectx, fo)];
    if (hasG && g) {
      const go = cellOpts();
      if (!go) return 'Time Out';
      row.push(cell(g, x, ectx, go));
    }
    rows.push(row);
  }
  if (now() > until) return 'Time Out';
  return { rows };
}

/** ModeHooks.tableBuild. */
export function tableBuild(f: MathRow, g: MathRow | null, start: number, end: number, step: number, ctx: CalcContext): { rows: number[][] } | CalcError {
  return tableBuildWith(f, g, start, end, step, ctx);
}
