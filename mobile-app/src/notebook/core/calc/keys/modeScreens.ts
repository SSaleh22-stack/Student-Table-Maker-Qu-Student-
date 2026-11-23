/**
 * Mode screens: the EQN, MATRIX, VECTOR, STAT, TABLE, INEQ and RATIO editors and result screens that
 * replace the normal input and result lines. Each editable cell is typed into a CellEntry (a small
 * input row with its own cursor, edited like the main input) and committed with '='.
 *
 * screenKey handles the keys a screen owns (typing, DEL, AC, =, the replay pad) and returns 'pass'
 * for everything else (MODE, SETUP, SHIFT menus and so on), which the machine handles. Result screens
 * that have an editor behind them (EQN, INEQ, RATIO, TABLE) return to it through `back`.
 * Solvers are the mode hooks (setModeHooks); without hooks they give Math ERROR.
 */
import type {
  CalcContext, CalcError, CalcValue, CellEntry, EqnKind, EvalOptions, IneqRel, MathRow, ModeScreen, RatioKind, StatData, TableField,
} from '../types.ts';
import { evaluate } from '../eval.ts';
import { formatCell, formatValue } from '../format.ts';
import type { KeyAction } from './keymap.ts';
import { actionNodes, deleteAt, emptyEntry, insertNodes, moveLeft, moveRight } from './editor.ts';
import { getModeHooks } from './menus.ts';

export type ScreenOutcome =
  | { o: 'pass' }
  | { o: 'leave' }
  | { o: 'stay'; screen: ModeScreen | null; ctx: CalcContext; error?: CalcError; back?: ModeScreen | null };

/** Most STAT data rows (paired types, FREQ off). */
export const STAT_MAX_ROWS = 40;

/**
 * Rows the STAT editor holds, as on the reference: 1-VAR 80 (40 with the FREQ column), the paired
 * types 40 (26 with FREQ). Same numbers as P18 modes/stat.ts statMaxRows (keys/ imports only P07).
 */
export function statMaxRows(kind: StatData['kind'], freq: boolean): number {
  if (kind === '1-VAR') return freq ? 40 : 80;
  return freq ? 26 : STAT_MAX_ROWS;
}

// ===== constructors

const COEF_COUNT: Record<EqnKind, number> = { lin2: 6, lin3: 12, poly2: 3, poly3: 4 };
const COEF_COLS: Record<EqnKind, number> = { lin2: 3, lin3: 4, poly2: 3, poly3: 4 };

export function eqnEdit(eqn: EqnKind): ModeScreen {
  return { kind: 'eqn-edit', eqn, coef: new Array<number>(COEF_COUNT[eqn]).fill(0), index: 0, entry: null };
}

export function matEdit(name: 'A' | 'B' | 'C', rows: number, cols: number, cells?: number[][]): ModeScreen {
  const c = cells && cells.length === rows && cells.every((r) => r.length === cols)
    ? cells.map((r) => r.slice())
    : Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  return { kind: 'mat-edit', name, rows, cols, cells: c, row: 0, col: 0, entry: null };
}

export function vctEdit(name: 'A' | 'B' | 'C', dim: number, cells?: number[]): ModeScreen {
  const c = cells && cells.length === dim ? cells.slice() : new Array<number>(dim).fill(0);
  return { kind: 'vct-edit', name, dim, cells: c, index: 0, entry: null };
}

export function statEdit(data: StatData): ModeScreen {
  return { kind: 'stat-edit', data, row: 0, col: 0, entry: null };
}

const digits = (s: string): MathRow => s.split('').map((d) => ({ k: 'digit', d: d as '1' }));

export function tableEdit(withG: boolean): ModeScreen {
  return { kind: 'table-edit', field: 'f', f: [], g: withG ? [] : null, start: digits('1'), end: digits('5'), step: digits('1'), cursor: [0] };
}

export function ineqEdit(deg: 2 | 3, rel: IneqRel): ModeScreen {
  return { kind: 'ineq-edit', deg, rel, coef: new Array<number>(deg + 1).fill(0), index: 0, entry: null };
}

export function ratioEdit(ratio: RatioKind): ModeScreen {
  return { kind: 'ratio-edit', ratio, values: [0, 0, 0], index: 0, entry: null };
}

// ===== helpers

let cellOptions: EvalOptions = {};

/** Clock and time budget for cell evaluation (machine.setEvalOptions passes them on). */
export function setCellEvalOptions(o: EvalOptions): void {
  cellOptions = { ...o };
}

/** Evaluates a cell entry to a real number (the context is not kept: cells do not change Ans). */
function cellValue(entry: CellEntry, ctx: CalcContext): number | CalcError {
  if (entry.row.length === 0) return 'Syntax ERROR';
  const r = evaluate(entry.row, ctx, cellOptions);
  if (!r.ok) return r.error;
  const v = r.value;
  if (v.t === 'real') return v.x;
  if (v.t === 'cplx' && v.im === 0) return v.re;
  return 'Math ERROR';
}

type EntryResult = { entry: CellEntry | null } | null;

/** Typing, DEL and ◀ ▶ inside a cell entry. null = not an entry key. */
function entryKey(entry: CellEntry | null, act: KeyAction): EntryResult {
  const nodes = actionNodes(act);
  if (nodes) return { entry: insertNodes(entry ?? emptyEntry(), nodes) };
  if (act.a !== 'cmd' || !entry) return null;
  if (act.cmd === 'del') return { entry: deleteAt(entry) };
  if (act.cmd === 'left') return { entry: moveLeft(entry) };
  if (act.cmd === 'right') return { entry: moveRight(entry) };
  return null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function stay(screen: ModeScreen | null, ctx: CalcContext, extra: { error?: CalcError; back?: ModeScreen | null } = {}): ScreenOutcome {
  return { o: 'stay', screen, ctx, ...extra };
}

const isNav = (act: KeyAction, ...cmds: string[]) => act.a === 'cmd' && cmds.includes(act.cmd);

/**
 * A flat list of cells (EQN and INEQ coefficients, RATIO values) on a grid with `cols` columns:
 * typing, = commits and moves on, the replay pad moves, AC drops the entry.
 */
function listKey(
  s: { index: number; entry: CellEntry | null },
  values: number[],
  cols: number,
  act: KeyAction,
  ctx: CalcContext,
  rebuild: (values: number[], index: number, entry: CellEntry | null) => ModeScreen,
  solve: (values: number[]) => ScreenOutcome,
): ScreenOutcome {
  const er = entryKey(s.entry, act);
  if (er) return stay(rebuild(values, s.index, er.entry), ctx);
  if (act.a !== 'cmd') return { o: 'pass' };
  const commit = (): { values: number[] } | CalcError => {
    if (!s.entry) return { values };
    const v = cellValue(s.entry, ctx);
    if (typeof v === 'string') return v;
    const next = values.slice();
    next[s.index] = v;
    return { values: next };
  };
  const last = values.length - 1;
  switch (act.cmd) {
    case 'eq': {
      if (!s.entry) return solve(values);
      const c = commit();
      if (typeof c === 'string') return stay(rebuild(values, s.index, s.entry), ctx, { error: c });
      return stay(rebuild(c.values, Math.min(last, s.index + 1), null), ctx);
    }
    case 'up':
    case 'down':
    case 'left':
    case 'right': {
      const c = commit();
      if (typeof c === 'string') return stay(rebuild(values, s.index, s.entry), ctx, { error: c });
      const step = act.cmd === 'up' ? -cols : act.cmd === 'down' ? cols : act.cmd === 'left' ? -1 : 1;
      const next = s.index + step;
      return stay(rebuild(c.values, next < 0 || next > last ? s.index : next, null), ctx);
    }
    case 'ac':
      return stay(rebuild(values, s.index, null), ctx);
    case 'del':
      return stay(rebuild(values, s.index, null), ctx);
    default:
      return { o: 'pass' };
  }
}

function solveFail(e: CalcError, screen: ModeScreen, ctx: CalcContext): ScreenOutcome {
  return stay(screen, ctx, { error: e });
}

const TABLE_ORDER: TableField[] = ['f', 'g', 'start', 'end', 'step'];

function tableFields(s: Extract<ModeScreen, { kind: 'table-edit' }>): TableField[] {
  return TABLE_ORDER.filter((f) => f !== 'g' || s.g !== null);
}

function fieldRow(s: Extract<ModeScreen, { kind: 'table-edit' }>, f: TableField): MathRow {
  return f === 'g' ? s.g ?? [] : s[f];
}

/**
 * The TABLE editor at run time. fresh (Start?, End?, Step? just reached): the value shown is the old
 * one and the first key typed replaces it, as on the reference. The mark exists only while true.
 */
type TableEditScreen = Extract<ModeScreen, { kind: 'table-edit' }> & { fresh?: true };

/** The screen without the fresh mark (any edit of the shown value ends it). */
function settled(s: TableEditScreen): Extract<ModeScreen, { kind: 'table-edit' }> {
  if (!s.fresh) return s;
  const { fresh: _fresh, ...rest } = s;
  return rest;
}

function withField(s: TableEditScreen, f: TableField, row: MathRow, cursor: number[]): ModeScreen {
  return { ...settled(s), [f]: row, cursor };
}

function numberOf(row: MathRow, ctx: CalcContext): number | CalcError {
  return cellValue({ row, cursor: [row.length] }, ctx);
}

// ===== keys

/**
 * A key on a mode screen. back is the editor a result screen returns to (kept by the machine).
 */
export function screenKey(screen: ModeScreen, act: KeyAction, ctx: CalcContext, back: ModeScreen | null): ScreenOutcome {
  const hooks = getModeHooks();
  switch (screen.kind) {
    case 'eqn-edit': {
      const cols = COEF_COLS[screen.eqn];
      return listKey(screen, screen.coef, cols, act, ctx,
        (coef, index, entry) => ({ ...screen, coef, index, entry }),
        (coef) => {
          const r = hooks ? hooks.eqnSolve(screen.eqn, coef) : 'Math ERROR';
          const editor: ModeScreen = { ...screen, coef, entry: null };
          if (r === 'Infinite Sol' || r === 'No Solution') return stay({ kind: 'eqn-message', eqn: screen.eqn, message: r }, ctx, { back: editor });
          if (typeof r === 'string') return solveFail(r, editor, ctx);
          if (r.roots.length === 0) return stay({ kind: 'eqn-message', eqn: screen.eqn, message: 'No Solution' }, ctx, { back: editor });
          return stay({ kind: 'eqn-result', eqn: screen.eqn, roots: r.roots, index: 0 }, ctx, { back: editor });
        });
    }
    case 'eqn-result': {
      if (act.a !== 'cmd') return actionNodes(act) ? stay(screen, ctx) : { o: 'pass' };
      const last = screen.roots.length - 1;
      switch (act.cmd) {
        case 'down': return stay({ ...screen, index: Math.min(last, screen.index + 1) }, ctx);
        case 'up': return stay({ ...screen, index: Math.max(0, screen.index - 1) }, ctx);
        case 'eq': return screen.index < last ? stay({ ...screen, index: screen.index + 1 }, ctx) : stay(back ?? eqnEdit(screen.eqn), ctx);
        case 'ac': return stay(back ?? eqnEdit(screen.eqn), ctx);
        case 'left': case 'right': case 'del': return stay(screen, ctx);
        default: return { o: 'pass' };
      }
    }
    case 'eqn-message':
    case 'ineq-result':
    case 'ratio-result': {
      if (act.a !== 'cmd') return actionNodes(act) ? stay(screen, ctx) : { o: 'pass' };
      if (act.cmd === 'ac' || act.cmd === 'eq') {
        const fallback = screen.kind === 'eqn-message' ? eqnEdit(screen.eqn) : screen.kind === 'ineq-result' ? ineqEdit(screen.deg, screen.rel) : ratioEdit(screen.ratio);
        return stay(back ?? fallback, ctx);
      }
      if (isNav(act, 'up', 'down', 'left', 'right', 'del')) return stay(screen, ctx);
      return { o: 'pass' };
    }
    case 'ineq-edit':
      return listKey(screen, screen.coef, screen.deg + 1, act, ctx,
        (coef, index, entry) => ({ ...screen, coef, index, entry }),
        (coef) => {
          const r = hooks ? hooks.ineqSolve(screen.deg, coef, screen.rel) : 'Math ERROR';
          const editor: ModeScreen = { ...screen, coef, entry: null };
          if (typeof r === 'string') return solveFail(r, editor, ctx);
          return stay({ kind: 'ineq-result', deg: screen.deg, rel: screen.rel, text: r.text }, ctx, { back: editor });
        });
    case 'ratio-edit':
      return listKey(screen, screen.values, 3, act, ctx,
        (values, index, entry) => ({ ...screen, values, index, entry }),
        (values) => {
          const r = hooks ? hooks.ratioSolve(screen.ratio, values[0], values[1], values[2]) : 'Math ERROR';
          const editor: ModeScreen = { ...screen, values, entry: null };
          if (typeof r === 'string') return solveFail(r, editor, ctx);
          return stay({ kind: 'ratio-result', ratio: screen.ratio, value: r }, ctx, { back: editor });
        });
    case 'mat-edit': {
      const er = entryKey(screen.entry, act);
      if (er) return stay({ ...screen, entry: er.entry }, ctx);
      if (act.a !== 'cmd') return { o: 'pass' };
      const save = (cells: number[][]): CalcContext => ({ ...ctx, mats: { ...ctx.mats, [screen.name]: { t: 'mat', m: cells.map((r) => r.slice()) } } });
      let cells = screen.cells;
      if (screen.entry && isNav(act, 'eq', 'up', 'down', 'left', 'right')) {
        if (isNav(act, 'left', 'right')) return stay(screen, ctx);
        const v = cellValue(screen.entry, ctx);
        if (typeof v === 'string') return stay(screen, ctx, { error: v });
        cells = cells.map((r) => r.slice());
        cells[screen.row][screen.col] = v;
      }
      const nctx = cells === screen.cells ? ctx : save(cells);
      const base = { ...screen, cells, entry: null };
      switch (act.cmd) {
        case 'eq': {
          if (!screen.entry) return stay(screen, ctx);
          let { row, col } = screen;
          if (col + 1 < screen.cols) col++;
          else if (row + 1 < screen.rows) {
            row++;
            col = 0;
          }
          return stay({ ...base, row, col }, nctx);
        }
        case 'up': return stay({ ...base, row: clamp(screen.row - 1, 0, screen.rows - 1) }, nctx);
        case 'down': return stay({ ...base, row: clamp(screen.row + 1, 0, screen.rows - 1) }, nctx);
        case 'left': return stay({ ...base, col: clamp(screen.col - 1, 0, screen.cols - 1) }, nctx);
        case 'right': return stay({ ...base, col: clamp(screen.col + 1, 0, screen.cols - 1) }, nctx);
        case 'ac': return screen.entry ? stay(base, ctx) : stay(null, ctx);
        case 'del': return stay(screen, ctx);
        default: return { o: 'pass' };
      }
    }
    case 'vct-edit': {
      const er = entryKey(screen.entry, act);
      if (er) return stay({ ...screen, entry: er.entry }, ctx);
      if (act.a !== 'cmd') return { o: 'pass' };
      let cells = screen.cells;
      if (screen.entry && isNav(act, 'eq', 'up', 'down', 'left', 'right')) {
        if (isNav(act, 'left', 'right')) return stay(screen, ctx);
        const v = cellValue(screen.entry, ctx);
        if (typeof v === 'string') return stay(screen, ctx, { error: v });
        cells = cells.slice();
        cells[screen.index] = v;
      }
      const nctx = cells === screen.cells ? ctx : { ...ctx, vcts: { ...ctx.vcts, [screen.name]: { t: 'vct' as const, v: cells.slice() } } };
      const base = { ...screen, cells, entry: null };
      const last = screen.dim - 1;
      switch (act.cmd) {
        case 'eq': return screen.entry ? stay({ ...base, index: Math.min(last, screen.index + 1) }, nctx) : stay(screen, ctx);
        case 'left': case 'up': return stay({ ...base, index: Math.max(0, screen.index - 1) }, nctx);
        case 'right': case 'down': return stay({ ...base, index: Math.min(last, screen.index + 1) }, nctx);
        case 'ac': return screen.entry ? stay(base, ctx) : stay(null, ctx);
        case 'del': return stay(screen, ctx);
        default: return { o: 'pass' };
      }
    }
    case 'mat-result':
    case 'vct-result': {
      if (act.a !== 'cmd') return actionNodes(act) ? { o: 'leave' } : { o: 'pass' };
      if (screen.kind === 'mat-result') {
        const rows = screen.value.m.length;
        const cols = screen.value.m[0]?.length ?? 1;
        switch (act.cmd) {
          case 'up': return stay({ ...screen, row: clamp(screen.row - 1, 0, rows - 1) }, ctx);
          case 'down': return stay({ ...screen, row: clamp(screen.row + 1, 0, rows - 1) }, ctx);
          case 'left': return stay({ ...screen, col: clamp(screen.col - 1, 0, cols - 1) }, ctx);
          case 'right': return stay({ ...screen, col: clamp(screen.col + 1, 0, cols - 1) }, ctx);
          case 'ac': return stay(null, ctx);
          case 'eq': case 'del': return { o: 'leave' };
          default: return { o: 'pass' };
        }
      }
      const last = screen.value.v.length - 1;
      switch (act.cmd) {
        case 'left': case 'up': return stay({ ...screen, index: Math.max(0, screen.index - 1) }, ctx);
        case 'right': case 'down': return stay({ ...screen, index: Math.min(last, screen.index + 1) }, ctx);
        case 'ac': return stay(null, ctx);
        case 'eq': case 'del': return { o: 'leave' };
        default: return { o: 'pass' };
      }
    }
    case 'stat-edit':
      return statKey(screen, act, ctx);
    case 'table-edit': {
      const fields = tableFields(screen);
      const f = screen.field;
      const row = fieldRow(screen, f);
      const ed = { row, cursor: screen.cursor };
      const nodes = actionNodes(act);
      if (nodes) {
        const n = insertNodes((screen as TableEditScreen).fresh ? { row: [], cursor: [0] } : ed, nodes);
        return stay(withField(screen, f, n.row, n.cursor), ctx);
      }
      if (act.a !== 'cmd') return { o: 'pass' };
      const go = (to: TableField): ModeScreen => {
        const next: TableEditScreen = { ...settled(screen), field: to, cursor: [fieldRow(screen, to).length] };
        if (to === 'start' || to === 'end' || to === 'step') next.fresh = true;
        return next;
      };
      const at = fields.indexOf(f);
      switch (act.cmd) {
        case 'del': { const n = deleteAt(ed); return stay(withField(screen, f, n.row, n.cursor), ctx); }
        case 'left': { const n = moveLeft(ed); return stay({ ...settled(screen), cursor: n.cursor }, ctx); }
        case 'right': { const n = moveRight(ed); return stay({ ...settled(screen), cursor: n.cursor }, ctx); }
        case 'up': return stay(at > 0 ? go(fields[at - 1]) : screen, ctx);
        case 'down': return stay(at + 1 < fields.length ? go(fields[at + 1]) : screen, ctx);
        case 'ac': return stay(withField(screen, f, [], [0]), ctx);
        case 'eq': {
          if (at + 1 < fields.length) return stay(go(fields[at + 1]), ctx);
          if (screen.f.length === 0) return stay(go('f'), ctx, { error: 'Syntax ERROR' });
          const start = numberOf(screen.start, ctx);
          const end = numberOf(screen.end, ctx);
          const step = numberOf(screen.step, ctx);
          for (const v of [start, end, step]) if (typeof v === 'string') return stay(screen, ctx, { error: v });
          const r = hooks ? hooks.tableBuild(screen.f, screen.g, start as number, end as number, step as number, ctx) : 'Math ERROR';
          const editor: ModeScreen = go('f');
          if (typeof r === 'string') return stay(screen, ctx, { error: r });
          return stay({ kind: 'table-result', rows: r.rows, hasG: screen.g !== null, row: 0, col: 0 }, ctx, { back: editor });
        }
        default: return { o: 'pass' };
      }
    }
    case 'table-result': {
      if (act.a !== 'cmd') return actionNodes(act) ? stay(screen, ctx) : { o: 'pass' };
      const rows = screen.rows.length;
      const cols = screen.hasG ? 3 : 2;
      switch (act.cmd) {
        case 'up': return stay({ ...screen, row: clamp(screen.row - 1, 0, Math.max(0, rows - 1)) }, ctx);
        case 'down': return stay({ ...screen, row: clamp(screen.row + 1, 0, Math.max(0, rows - 1)) }, ctx);
        case 'left': return stay({ ...screen, col: clamp(screen.col - 1, 0, cols - 1) }, ctx);
        case 'right': return stay({ ...screen, col: clamp(screen.col + 1, 0, cols - 1) }, ctx);
        case 'ac': return stay(back ?? tableEdit(ctx.setup.table === 'f(x),g(x)'), ctx);
        case 'eq': case 'del': return stay(screen, ctx);
        default: return { o: 'pass' };
      }
    }
  }
}

/** STAT column names for a data kind. */
export function statColumns(kind: StatData['kind'], freq: boolean): ('X' | 'Y' | 'FREQ')[] {
  const cols: ('X' | 'Y' | 'FREQ')[] = kind === '1-VAR' ? ['X'] : ['X', 'Y'];
  if (freq) cols.push('FREQ');
  return cols;
}

function statKey(screen: Extract<ModeScreen, { kind: 'stat-edit' }>, act: KeyAction, ctx: CalcContext): ScreenOutcome {
  const cols = statColumns(screen.data.kind, ctx.setup.statFreq);
  const max = statMaxRows(screen.data.kind, ctx.setup.statFreq);
  const len = screen.data.x.length;
  const er = entryKey(screen.entry, act);
  if (er) return stay({ ...screen, entry: er.entry }, ctx);
  if (act.a !== 'cmd') return { o: 'pass' };
  const withData = (data: StatData, patch: Partial<Extract<ModeScreen, { kind: 'stat-edit' }>>): ScreenOutcome =>
    stay({ ...screen, data, entry: null, ...patch }, { ...ctx, stat: data });
  let data = screen.data;
  if (screen.entry && isNav(act, 'eq', 'up', 'down')) {
    const v = cellValue(screen.entry, ctx);
    if (typeof v === 'string') return stay(screen, ctx, { error: v });
    const x = data.x.slice();
    const y = data.y.slice();
    const freq = data.freq.slice();
    if (screen.row >= x.length) {
      if (x.length >= max) return stay(screen, ctx, { error: 'Insufficient MEM' });
      x.push(0);
      y.push(0);
      freq.push(1);
    }
    const col = cols[screen.col];
    if (col === 'X') x[screen.row] = v;
    else if (col === 'Y') y[screen.row] = v;
    else freq[screen.row] = v;
    data = { kind: data.kind, x, y, freq };
  }
  const newLen = data.x.length;
  const newMax = Math.min(newLen, max - 1);
  switch (act.cmd) {
    case 'eq':
      if (!screen.entry) return stay(screen, ctx);
      return withData(data, { row: Math.min(newMax, screen.row + 1) });
    case 'down': return withData(data, { row: Math.min(newMax, screen.row + 1) });
    case 'up': return withData(data, { row: Math.max(0, screen.row - 1) });
    case 'left': return screen.entry ? stay({ ...screen, entry: moveLeft(screen.entry) }, ctx) : stay({ ...screen, col: Math.max(0, screen.col - 1) }, ctx);
    case 'right': return screen.entry ? stay({ ...screen, entry: moveRight(screen.entry) }, ctx) : stay({ ...screen, col: Math.min(cols.length - 1, screen.col + 1) }, ctx);
    case 'del': {
      if (screen.row >= len) return stay(screen, ctx);
      const cut = <T>(a: T[]) => a.filter((_, i) => i !== screen.row);
      const d: StatData = { kind: data.kind, x: cut(data.x), y: cut(data.y), freq: cut(data.freq) };
      return withData(d, { row: Math.min(screen.row, Math.min(d.x.length, max - 1)) });
    }
    case 'ac': return screen.entry ? stay({ ...screen, entry: null }, ctx) : stay(null, ctx);
    default:
      return { o: 'pass' };
  }
}

// ===== views (for display.ts)

export interface ScreenView {
  title?: string;
  header?: string[];
  rowLabels?: string[];
  grid?: string[][];
  selected?: { row: number; col: number };
  /** The cell or field being typed (drawn with a cursor). */
  entry?: CellEntry | null;
  /** Full text of the selected cell. */
  value?: string;
  /** Result value text (EQN root, RATIO X). */
  result?: string;
  lines?: string[];
  more?: { up: boolean; down: boolean };
}

const EQN_TITLE: Record<EqnKind, string> = { lin2: 'anX+bnY=cn', lin3: 'anX+bnY+cnZ=dn', poly2: 'aX²+bX+c=0', poly3: 'aX³+bX²+cX+d=0' };
const COEF_HEADERS = ['a', 'b', 'c', 'd'];

/** Root label: X= Y= Z= for systems; X1= X2= X3= for polynomials, or X= for a single (double) root. */
function rootName(eqn: EqnKind, i: number, count: number): string {
  if (eqn === 'lin2' || eqn === 'lin3') return `${['X', 'Y', 'Z'][i] ?? 'X'}=`;
  return count === 1 ? 'X=' : `X${i + 1}=`;
}

export function screenView(screen: ModeScreen, ctx: CalcContext): ScreenView {
  const setup = ctx.setup;
  const cell = (x: number) => formatCell(x, setup);
  const val = (v: CalcValue) => formatValue(v, setup).text;
  const nums = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
  switch (screen.kind) {
    case 'eqn-edit': {
      const cols = COEF_COLS[screen.eqn];
      const rows = screen.coef.length / cols;
      const grid = Array.from({ length: rows }, (_, r) => screen.coef.slice(r * cols, r * cols + cols).map(cell));
      return {
        title: EQN_TITLE[screen.eqn], header: COEF_HEADERS.slice(0, cols), rowLabels: rows > 1 ? nums(rows) : undefined, grid,
        selected: { row: Math.floor(screen.index / cols), col: screen.index % cols }, entry: screen.entry, value: cell(screen.coef[screen.index] ?? 0),
      };
    }
    case 'eqn-result': {
      const r = screen.roots[screen.index];
      return {
        title: rootName(screen.eqn, screen.index, screen.roots.length), result: r ? val(r) : '',
        more: { up: screen.index > 0, down: screen.index < screen.roots.length - 1 },
      };
    }
    case 'eqn-message': return { lines: [screen.message] };
    case 'mat-edit': return {
      title: `Mat${screen.name}`, header: nums(screen.cols), rowLabels: nums(screen.rows), grid: screen.cells.map((r) => r.map(cell)),
      selected: { row: screen.row, col: screen.col }, entry: screen.entry, value: cell(screen.cells[screen.row]?.[screen.col] ?? 0),
    };
    case 'mat-result': return {
      title: 'MatAns', header: nums(screen.value.m[0]?.length ?? 0), rowLabels: nums(screen.value.m.length), grid: screen.value.m.map((r) => r.map(cell)),
      selected: { row: screen.row, col: screen.col }, value: cell(screen.value.m[screen.row]?.[screen.col] ?? 0),
    };
    case 'vct-edit': return {
      title: `Vct${screen.name}`, header: nums(screen.dim), grid: [screen.cells.map(cell)], selected: { row: 0, col: screen.index },
      entry: screen.entry, value: cell(screen.cells[screen.index] ?? 0),
    };
    case 'vct-result': return {
      title: 'VctAns', header: nums(screen.value.v.length), grid: [screen.value.v.map(cell)], selected: { row: 0, col: screen.index },
      value: cell(screen.value.v[screen.index] ?? 0),
    };
    case 'stat-edit': {
      const cols = statColumns(screen.data.kind, setup.statFreq);
      const n = screen.data.x.length;
      const grid = Array.from({ length: n }, (_, i) => cols.map((c) => cell(c === 'X' ? screen.data.x[i] : c === 'Y' ? screen.data.y[i] : screen.data.freq[i])));
      if (n < statMaxRows(screen.data.kind, setup.statFreq)) grid.push(cols.map(() => ''));
      const col = cols[screen.col];
      const selectedValue = screen.row < n ? cell(col === 'X' ? screen.data.x[screen.row] : col === 'Y' ? screen.data.y[screen.row] : screen.data.freq[screen.row]) : '';
      return { header: cols, rowLabels: nums(grid.length), grid, selected: { row: screen.row, col: screen.col }, entry: screen.entry, value: selectedValue };
    }
    case 'table-edit': {
      const titles: Record<TableField, string> = { f: 'f(X)=', g: 'g(X)=', start: 'Start?', end: 'End?', step: 'Step?' };
      return { title: titles[screen.field], entry: { row: fieldRow(screen, screen.field), cursor: screen.cursor } };
    }
    case 'table-result': {
      const header = screen.hasG ? ['X', 'F(X)', 'G(X)'] : ['X', 'F(X)'];
      // A cell whose value has an error is NaN in the hook's rows: the LCD shows ERROR there.
      const grid = screen.rows.map((r) => r.slice(0, header.length).map((x) => (Number.isFinite(x) ? cell(x) : 'ERROR')));
      return { header, rowLabels: nums(grid.length), grid, selected: { row: screen.row, col: screen.col }, value: grid[screen.row]?.[screen.col] ?? '' };
    }
    case 'ineq-edit': {
      const poly = screen.deg === 2 ? 'aX²+bX+c' : 'aX³+bX²+cX+d';
      return {
        title: `${poly}${screen.rel}0`, header: COEF_HEADERS.slice(0, screen.deg + 1), grid: [screen.coef.map(cell)],
        selected: { row: 0, col: screen.index }, entry: screen.entry, value: cell(screen.coef[screen.index] ?? 0),
      };
    }
    case 'ineq-result': return { lines: screen.text.slice() };
    case 'ratio-edit': return {
      title: screen.ratio, header: screen.ratio === 'A:B=X:D' ? ['A', 'B', 'D'] : ['A', 'B', 'C'], grid: [screen.values.map(cell)],
      selected: { row: 0, col: screen.index }, entry: screen.entry, value: cell(screen.values[screen.index] ?? 0),
    };
    case 'ratio-result': return { title: 'X=', result: cell(screen.value) };
  }
}
