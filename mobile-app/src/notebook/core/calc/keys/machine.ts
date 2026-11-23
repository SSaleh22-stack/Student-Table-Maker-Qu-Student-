/**
 * The key machine (NB-47a): MachineState + key -> MachineState, like the reference calculator.
 *
 * press(s, k) resolves SHIFT and ALPHA through keymap.ts, then routes the key to (in this order) an
 * open message, an error, a pending RCL or STO, the top menu, a CALC or SOLVE prompt, the mode screen,
 * and finally the calculation editor. Everything is pure plain data; the only module state is the
 * mode hooks (setModeHooks) and the evaluation options (setEvalOptions, for an injected clock).
 *
 * The state returned is a KeyState: a MachineState plus `aux`, the small bits of machine state the
 * contract has no field for (history recall position, S⇔D a b/c override, ° ' " display, CALC/SOLVE
 * run, the CALC prompt entry, the result screen's editor). press accepts a plain MachineState too.
 *
 * Behaviour summary (reference calculator):
 * - After a result, an operator or postfix key continues from Ans ('+' gives Ans+); other input
 *   starts a new expression. ◀ ▶ DEL edit the last input. = repeats the input (Ans updates).
 * - ▲ ▼ recall earlier inputs and their results (history), unless the caret is in a fraction or ∫ Σ.
 * - S⇔D, ENG, ←ENG, a b/c ⇔ d/c and ° ' " change how the result is shown; with an unevaluated input
 *   they evaluate first.
 * - CALC prompts for each variable (in order of appearance) then evaluates; = repeats the prompts.
 *   SOLVE prompts for the other variables, then for the solve variable (X if present) as the guess.
 * - STO (SHIFT RCL) stores the result (evaluating first) in a variable; RCL shows a variable.
 *   M+ / M− add the result to M.
 * - MODE opens the mode list; entering EQN, STAT, MATRIX, VECTOR, INEQ or RATIO opens their type
 *   menu, TABLE opens the f(X) editor. Menus stack; AC closes them.
 */
import type {
  CalcContext, CalcError, CalcMode, CalcValue, CellEntry, DisplayValue, EvalOptions, KeyId, MachinePersist, MachineState, MathNode, MathRow,
  ModeScreen, VarName,
} from '../types.ts';
import { checkSyntax, evaluate, solve, varsIn } from '../eval.ts';
import { formatValue } from '../format.ts';
import { clearAll, clearMemory, clearSetup, createContext, emptyStat, memoryAdd, withMode, withSetup, withVar } from '../context.ts';
import { real } from '../num/value.ts';
import { resolveKey, type KeyAction, type KeyCommand } from './keymap.ts';
import {
  actionNodes, deleteAt, emptyEditor, emptyEntry, insertNodes, isEmpty, moveLeft, moveRight, moveVertical, toEnd, toStart, type EditorState,
} from './editor.ts';
import { entryMenu, menuAvailable, menuChoose, menuRequired } from './menus.ts';
import { matEdit, ratioEdit, screenKey, setCellEvalOptions, statEdit, tableEdit, vctEdit, eqnEdit, ineqEdit, type ScreenOutcome } from './modeScreens.ts';
import { pushHistory } from './history.ts';

export { setModeHooks, getModeHooks } from './menus.ts';
export { persist, encodePersist, decodePersist } from './history.ts';

// ===== state

/** A CALC or SOLVE run: the expression, the variables to prompt for, and the prompt reached. */
export interface CalcRun {
  kind: 'calc' | 'solve';
  row: MathRow;
  vars: VarName[];
  index: number;
  /** SOLVE: the variable solved for (prompted last, as the initial guess). */
  solveVar: VarName | null;
}

export interface KeyAux {
  /** The result shown belongs to the current input (just evaluated), not a history recall. */
  live: boolean;
  /** History entry shown (▲ ▼), or the entry of the live result. */
  histPos: number | null;
  /** ° ' " pressed on the result: shown in degrees, minutes, seconds. */
  dms: boolean;
  /** SHIFT S⇔D: show fractions in the other SETUP form (a b/c ⇔ d/c). */
  fracAlt: boolean;
  /** Text after the input once a result is stored ('→A', 'M+', 'M−'). */
  suffix: string | null;
  /** A message screen (CLR done, RCL value). consume: the next key only closes it. */
  message: { lines: string[]; consume: boolean } | null;
  /** The CALC or SOLVE run (prompting when MachineState.prompt is set, finished otherwise). */
  run: CalcRun | null;
  /** The value being typed at a CALC or SOLVE prompt. */
  entry: CellEntry | null;
  /** What MATRIX_SELECT / VECTOR_SELECT is choosing for. */
  select: 'dim' | 'data';
  /** The editor a result screen returns to (EQN, INEQ, RATIO, TABLE). */
  back: ModeScreen | null;
}

export type KeyState = MachineState & { aux: KeyAux };

export function defaultAux(): KeyAux {
  return { live: false, histPos: null, dms: false, fracAlt: false, suffix: null, message: null, run: null, entry: null, select: 'dim', back: null };
}

/** Adds aux to a plain MachineState (and fixes a mode/setup mirror that drifted from ctx). */
export function asKeyState(s: MachineState): KeyState {
  const aux = (s as Partial<KeyState>).aux;
  return { ...s, mode: s.ctx.mode, setup: s.ctx.setup, aux: aux ? aux : defaultAux() };
}

let evalOptions: EvalOptions = {};

/** Clock and time budget for evaluate and solve (tests inject a fake clock). */
export function setEvalOptions(o: EvalOptions): void {
  evalOptions = { ...o };
  setCellEvalOptions(o);
}

function baseState(ctx: CalcContext): KeyState {
  return {
    mode: ctx.mode, setup: ctx.setup, shift: false, alpha: false, pending: null, editor: emptyEditor(), result: null, error: null,
    menu: [], screen: null, ctx, history: [], prompt: null, aux: defaultAux(),
  };
}

/** A fresh machine, or one restored from persisted data (decodePersist output). */
export function initialMachine(saved?: MachinePersist | null): KeyState {
  if (!saved) return baseState(createContext());
  const ctx: CalcContext = { ...saved.ctx, mode: saved.mode, setup: saved.setup };
  return modeHome({ ...baseState(ctx), history: saved.history.slice() });
}

// ===== helpers

const withAux = (s: KeyState, patch: Partial<KeyAux>): KeyState => ({ ...s, aux: { ...s.aux, ...patch } });

/** Aux after the display is cleared or the input is edited (nothing shown is a result any more). */
function editAux(a: KeyAux): KeyAux {
  return { ...a, live: false, histPos: null, dms: false, fracAlt: false, suffix: null, run: null };
}

function fmt(s: KeyState, value: CalcValue, sd: boolean, eng: number): DisplayValue {
  const setup = s.ctx.setup;
  const other = setup.frac === 'ab/c' ? 'd/c' : 'ab/c';
  return formatValue(value, setup, {
    sd, eng, dms: s.aux.dms && value.t === 'real', base: s.ctx.base, ...(s.aux.fracAlt ? { frac: other } : {}),
  });
}

function reformat(s: KeyState): KeyState {
  if (!s.result) return s;
  const r = s.result;
  if (r.display.lines && r.value.t !== 'pair') return s; // SOLVE result
  return { ...s, result: { ...r, display: fmt(s, r.value, r.sd, r.eng) } };
}

function liveResult(s: KeyState): boolean {
  return s.result !== null && s.aux.live;
}

function errorState(s: KeyState, kind: CalcError, at?: number): KeyState {
  return { ...s, error: at === undefined ? { kind } : { kind, at } };
}

/** Shows value as the result of row. push: add it to the history. */
function showResult(s: KeyState, value: CalcValue, row: MathRow, push: boolean): KeyState {
  const aux: KeyAux = { ...s.aux, live: true, dms: false, fracAlt: false, suffix: null, run: null };
  const base: KeyState = { ...s, aux };
  const display = fmt(base, value, false, 0);
  const history = push ? pushHistory(s.history, { input: row, result: display.text }) : s.history;
  aux.histPos = push ? history.length - 1 : aux.histPos;
  let screen = s.screen;
  if (value.t === 'mat') screen = { kind: 'mat-result', value, row: 0, col: 0 };
  else if (value.t === 'vct') screen = { kind: 'vct-result', value, index: 0 };
  return {
    ...base, editor: { ...s.editor, row, cursor: [row.length] }, result: { value, display, sd: false, eng: 0 }, error: null, screen, history, aux,
  };
}

/** '=': evaluates row (default: the input). */
function equals(s: KeyState, row: MathRow = s.editor.row): KeyState {
  if (row.length === 0) return s;
  const r = evaluate(row, s.ctx, evalOptions);
  if (!r.ok) return errorState({ ...s, editor: { ...s.editor, row }, result: null, aux: editAux(s.aux) }, r.error, r.at);
  return showResult({ ...s, ctx: r.ctx }, r.value, row, true);
}

/** The state with a live result to act on (evaluating the input first), or null when there is nothing. */
function liveOrEval(s: KeyState): KeyState | null {
  if (liveResult(s)) return s;
  if (isEmpty(s.editor)) return null;
  return equals(s);
}

// ===== dispatch

/** Presses one key. */
export function press(s0: MachineState, k: KeyId): KeyState {
  const s = asKeyState(s0);
  if (k === 'SHIFT') return { ...s, shift: !s.shift, alpha: false };
  if (k === 'ALPHA') return { ...s, alpha: !s.alpha, shift: false };
  const act = resolveKey(k, { shift: s.shift, alpha: s.alpha || s.pending !== null, mode: s.ctx.mode });
  const out = dispatch({ ...s, shift: false, alpha: false }, act);
  return { ...out, mode: out.ctx.mode, setup: out.ctx.setup };
}

/** Presses keys in order. */
export function pressAll(s: MachineState, keys: readonly KeyId[]): KeyState {
  let st = asKeyState(s);
  for (const k of keys) st = press(st, k);
  return st;
}

function dispatch(s0: KeyState, act: KeyAction): KeyState {
  let s = s0;
  if (s.aux.message) {
    const consume = s.aux.message.consume;
    s = withAux(s, { message: null });
    if (consume) return s;
  }
  if (s.error) return errorKey(s, act);
  if (s.pending) return pendingKey(s, act);
  if (s.menu.length > 0) return menuKey(s, act);
  // A prompt whose run is gone is stale: drop it and let the key act normally (never swallow it).
  if (s.prompt && !s.aux.run) s = { ...s, prompt: null };
  if (s.prompt) {
    const r = promptKey(s, act);
    if (r) return r;
  }
  if (s.screen) {
    const out = screenKey(s.screen, act, s.ctx, s.aux.back);
    if (out.o === 'stay') return applyScreen(s, out);
    if (out.o === 'leave') s = { ...s, screen: null };
  }
  return general(s, act);
}

function applyScreen(s: KeyState, out: Extract<ScreenOutcome, { o: 'stay' }>): KeyState {
  let st: KeyState = { ...s, screen: out.screen, ctx: out.ctx };
  if (out.back !== undefined) st = withAux(st, { back: out.back });
  if (out.error) st = errorState(st, out.error);
  return st;
}

function errorKey(s: KeyState, act: KeyAction): KeyState {
  if (act.a !== 'cmd') return s;
  const nested = s.screen !== null || s.prompt !== null;
  switch (act.cmd) {
    case 'ac':
    case 'on':
    case 'off':
      if (nested) return { ...s, error: null };
      return { ...s, error: null, editor: { ...emptyEditor(), insert: s.editor.insert }, result: null, aux: editAux(s.aux) };
    case 'left':
    case 'right': {
      if (nested) return { ...s, error: null };
      const at = s.error?.at;
      const ed: EditorState = at === undefined ? toEnd(s.editor) : { ...s.editor, cursor: [Math.max(0, Math.min(at, s.editor.row.length))] };
      return { ...s, error: null, editor: ed, result: null, aux: editAux(s.aux) };
    }
    default:
      return s;
  }
}

function storableValue(v: CalcValue): CalcValue | null {
  if (v.t === 'real' || v.t === 'cplx' || v.t === 'base') return v;
  if (v.t === 'pair') return real(v.a);
  return null;
}

function pendingKey(s0: KeyState, act: KeyAction): KeyState {
  const kind = s0.pending;
  const s: KeyState = { ...s0, pending: null };
  if (act.a !== 'var') return s;
  const name = act.name;
  if (kind === 'rcl') {
    const text = formatValue(s.ctx.vars[name], s.ctx.setup, { base: s.ctx.base }).text;
    return withAux(s, { message: { lines: [`${name}=`, text], consume: false } });
  }
  let st = s;
  if (!liveResult(st)) {
    const row: MathRow = isEmpty(st.editor) ? [{ k: 'ans' }] : st.editor.row;
    st = equals(st, row);
    if (st.error || !st.result) return st;
  }
  const res = st.result;
  if (!res) return st;
  const v = storableValue(res.value);
  if (!v) return errorState(st, 'Math ERROR');
  return withAux({ ...st, ctx: withVar(st.ctx, name, v) }, { suffix: `→${name}` });
}

function memoryKey(s: KeyState, sign: 1 | -1): KeyState {
  const st = liveResult(s) ? s : equals(s, isEmpty(s.editor) ? [{ k: 'ans' }] : s.editor.row);
  if (st.error || !st.result) return st;
  const ctx = memoryAdd(st.ctx, st.result.value, sign);
  if (ctx === 'Math ERROR') return errorState(st, 'Math ERROR');
  return withAux({ ...st, ctx }, { suffix: sign === 1 ? 'M+' : 'M−' });
}

// ===== menus

/** Menus a key opens from inside any other menu (they replace it, like on the reference). */
const GLOBAL_MENUS: readonly string[] = ['MODE', 'SETUP', 'CLR'];

/** The menu stack once menus close: the mode's required type menu stays when there is no screen. */
function closedMenus(s: KeyState): KeyState['menu'] {
  const root = s.menu[0];
  return root && !s.screen && menuRequired(root.id, s.ctx.mode) ? [root] : [];
}

function menuKey(s: KeyState, act: KeyAction): KeyState {
  const top = s.menu[s.menu.length - 1];
  if (act.a === 'menu' && GLOBAL_MENUS.includes(act.id)) {
    // MODE, SETUP and CLR always open (else EQN, INEQ and RATIO could never be left).
    return { ...s, menu: [...closedMenus(s), { id: act.id, page: 0 }] };
  }
  const eff = menuChoose(top, act, s.ctx);
  const closed: KeyState = { ...s, menu: [] };
  switch (eff.e) {
    case 'none':
      return s;
    case 'close':
      return { ...s, menu: closedMenus(s) };
    case 'page':
      return { ...s, menu: [...s.menu.slice(0, -1), { ...top, page: eff.page }] };
    case 'open':
      return { ...s, menu: [...s.menu, eff.frame] };
    case 'insert': {
      let st = closed;
      const memMenu = top.id === 'MATRIX' || top.id === 'VECTOR';
      if (memMenu && st.screen && /^(mat|vct)-/.test(st.screen.kind)) st = { ...st, screen: null };
      for (const node of eff.nodes) st = dispatch(st, { a: 'insert', node });
      return st;
    }
    case 'mode':
      return enterMode(s, eff.mode);
    case 'setup': {
      const ctx = withSetup(s.ctx, eff.setup);
      const editor: EditorState = eff.clear ? emptyEditor() : { ...emptyEditor(), insert: s.editor.insert };
      let screen = s.screen;
      // Screens shaped by SETUP: TABLE f(x) / f(x),g(x) rebuilds the editor; STAT FREQ changes the columns.
      if (ctx.mode === 'TABLE' && eff.setup.table !== s.ctx.setup.table) screen = tableEdit(eff.setup.table === 'f(x),g(x)');
      else if (screen && screen.kind === 'stat-edit' && eff.setup.statFreq !== s.ctx.setup.statFreq) screen = { ...screen, col: 0, entry: null };
      // A CALC or SOLVE prompt is abandoned too (editAux drops its run).
      return { ...closed, menu: closedMenus(s), screen, ctx, editor, result: null, prompt: null, aux: { ...editAux(s.aux), entry: null } };
    }
    case 'contrast':
      return { ...s, ctx: withSetup(s.ctx, { ...s.ctx.setup, contrast: eff.value }) };
    case 'clr': {
      let ctx: CalcContext;
      let st: KeyState = { ...closed, editor: { ...emptyEditor(), insert: s.editor.insert }, result: null, prompt: null, aux: { ...editAux(s.aux), entry: null } };
      if (eff.target === 'Setup') ctx = clearSetup(s.ctx);
      else if (eff.target === 'Memory') ctx = clearMemory(s.ctx);
      else {
        ctx = clearAll(s.ctx);
        st = { ...st, history: [], screen: null, editor: emptyEditor(), aux: defaultAux() };
      }
      // Screens hold setup- and memory-dependent data: go back to the mode's home state.
      st = modeHome({ ...st, ctx, screen: null });
      return withAux(st, { message: { lines: [`Clear ${eff.target}`, 'Press [AC] Key'], consume: true } });
    }
    case 'statType': {
      const data = emptyStat(eff.kind);
      return { ...closed, ctx: { ...s.ctx, stat: data }, screen: statEdit(data) };
    }
    case 'statData':
      return { ...closed, screen: statEdit(s.ctx.stat) };
    case 'memMenu':
      return withAux({ ...s, menu: [...s.menu.slice(0, -1), { id: eff.kind === 'mat' ? 'MATRIX_SELECT' : 'VECTOR_SELECT', page: 0 }] }, { select: eff.purpose });
    case 'memSelect': {
      if (eff.kind === 'mat') {
        const m = s.ctx.mats[eff.name];
        if (s.aux.select === 'data' && m) return { ...closed, screen: matEdit(eff.name, m.m.length, m.m[0]?.length ?? 1, m.m) };
        return { ...s, menu: [...s.menu.slice(0, -1), { id: 'MATRIX_DIM', page: 0, target: eff.name }] };
      }
      const v = s.ctx.vcts[eff.name];
      if (s.aux.select === 'data' && v) return { ...closed, screen: vctEdit(eff.name, v.v.length, v.v) };
      return { ...s, menu: [...s.menu.slice(0, -1), { id: 'VECTOR_DIM', page: 0, target: eff.name }] };
    }
    case 'matDim': {
      const scr = matEdit(eff.name, eff.rows, eff.cols);
      const cells = scr.kind === 'mat-edit' ? scr.cells : [];
      return { ...closed, ctx: { ...s.ctx, mats: { ...s.ctx.mats, [eff.name]: { t: 'mat', m: cells.map((r) => r.slice()) } } }, screen: scr };
    }
    case 'vctDim': {
      const scr = vctEdit(eff.name, eff.dim);
      const cells = scr.kind === 'vct-edit' ? scr.cells : [];
      return { ...closed, ctx: { ...s.ctx, vcts: { ...s.ctx.vcts, [eff.name]: { t: 'vct', v: cells.slice() } } }, screen: scr };
    }
    case 'eqnType':
      return withAux({ ...closed, screen: eqnEdit(eff.kind) }, { back: null });
    case 'ineqType':
      return { ...s, menu: [...s.menu, { id: 'INEQ_REL', page: eff.deg }] };
    case 'ineqRel':
      return withAux({ ...closed, screen: ineqEdit(eff.deg, eff.rel) }, { back: null });
    case 'ratioType':
      return withAux({ ...closed, screen: ratioEdit(eff.kind) }, { back: null });
  }
}

/** The mode's home state when nothing is open: TABLE's f(X) editor, or the EQN, INEQ, RATIO type menu. */
function modeHome(s: KeyState): KeyState {
  const mode = s.ctx.mode;
  if (mode === 'TABLE') return { ...s, screen: tableEdit(s.ctx.setup.table === 'f(x),g(x)') };
  if (mode === 'EQN' || mode === 'INEQ' || mode === 'RATIO') {
    const m = entryMenu(mode);
    return m ? { ...s, menu: [m] } : s;
  }
  return s;
}

function enterMode(s: KeyState, mode: CalcMode): KeyState {
  let ctx = withMode(s.ctx, mode);
  if (mode === 'BASE-N') ctx = { ...ctx, base: 10 };
  const m = entryMenu(mode);
  const st: KeyState = {
    ...s, ctx, editor: emptyEditor(), result: null, error: null, prompt: null, pending: null, menu: m ? [m] : [],
    screen: mode === 'TABLE' ? tableEdit(ctx.setup.table === 'f(x),g(x)') : null,
    aux: { ...defaultAux(), select: 'dim' },
  };
  return st;
}

// ===== CALC and SOLVE

function startRun(s: KeyState, kind: 'calc' | 'solve', rowIn?: MathRow): KeyState {
  const row = rowIn ?? s.editor.row;
  if (row.length === 0) return s;
  const syn = checkSyntax(row, s.ctx, kind === 'solve');
  const editing: KeyState = { ...s, editor: { ...s.editor, row, cursor: [row.length] }, result: null, aux: editAux(s.aux) };
  if (syn) return errorState(editing, syn.error, syn.at);
  let vars: VarName[];
  let solveVar: VarName | null = null;
  if (kind === 'calc') {
    vars = varsIn(row, { skipAssigned: true });
    if (vars.length === 0) return equals(editing, row);
  } else {
    const all = varsIn(row);
    if (all.length === 0) return errorState(editing, 'Variable ERROR');
    solveVar = all.includes('X') ? 'X' : all[0];
    vars = [...all.filter((v) => v !== solveVar), solveVar];
  }
  const run: CalcRun = { kind, row, vars, index: 0, solveVar };
  return { ...editing, prompt: { kind, varName: vars[0] }, aux: { ...editing.aux, run, entry: null } };
}

function finishRun(s: KeyState, run: CalcRun): KeyState {
  const st: KeyState = { ...s, prompt: null, aux: { ...s.aux, entry: null } };
  if (run.kind === 'calc') {
    const out = equals(st, run.row);
    return out.error ? withAux(out, { run: null }) : withAux(out, { run: { ...run, index: 0 } });
  }
  const sv = run.solveVar ?? 'X';
  const g = st.ctx.vars[sv];
  const guess = g.t === 'real' ? g.x : g.t === 'cplx' ? g.re : 0;
  const r = solve(run.row, sv, guess, st.ctx, evalOptions);
  if (!r.ok) return errorState(withAux(st, { run: null, live: false }), r.error, r.at);
  const value = r.ctx.vars[sv];
  const setup = r.ctx.setup;
  const xText = formatValue(value, setup).text;
  const lrText = formatValue(real(r.lr), setup).text;
  const display: DisplayValue = { form: 'dec', text: xText, lines: [`${sv}=${xText}`, `L−R=${lrText}`], canSD: false };
  const history = pushHistory(st.history, { input: run.row, result: `${sv}=${xText}` });
  return {
    ...st, ctx: r.ctx, history, error: null, result: { value, display, sd: false, eng: 0 },
    aux: { ...editAux(st.aux), live: true, histPos: history.length - 1, run: { ...run, index: 0 } },
  };
}

/** Keys at a CALC or SOLVE prompt. null = let the machine handle it (menus). */
function promptKey(s: KeyState, act: KeyAction): KeyState | null {
  const run = s.aux.run;
  if (!run || !s.prompt) return { ...s, prompt: null };
  const entry = s.aux.entry;
  const nodes = actionNodes(act);
  if (nodes) {
    if (s.ctx.mode === 'BASE-N' && !baseNAllowed(nodes[0])) return s;
    return withAux(s, { entry: insertNodes(entry ?? emptyEntry(), nodes) });
  }
  if (act.a === 'menu') return act.id === 'MODE' || act.id === 'SETUP' ? null : menuAvailable(act.id, s.ctx.mode) ? { ...s, menu: [{ id: act.id, page: 0 }] } : s;
  if (act.a !== 'cmd') return s;
  switch (act.cmd) {
    case 'del': return entry ? withAux(s, { entry: deleteAt(entry) }) : s;
    case 'left': return entry ? withAux(s, { entry: moveLeft(entry) }) : s;
    case 'right': return entry ? withAux(s, { entry: moveRight(entry) }) : s;
    case 'ac':
    case 'on':
    case 'off':
      return { ...s, prompt: null, aux: { ...s.aux, run: null, entry: null } };
    case 'eq': {
      const name = run.vars[run.index];
      let ctx = s.ctx;
      if (entry && entry.row.length > 0) {
        const r = evaluate(entry.row, ctx, evalOptions);
        if (!r.ok) return errorState(s, r.error, r.at);
        const v = storableValue(r.value);
        if (!v) return errorState(s, 'Math ERROR');
        ctx = withVar({ ...ctx, seed: r.ctx.seed }, name, v);
      }
      const next = run.index + 1;
      const st: KeyState = { ...s, ctx, aux: { ...s.aux, entry: null } };
      if (next < run.vars.length) {
        return { ...st, prompt: { kind: run.kind, varName: run.vars[next] }, aux: { ...st.aux, run: { ...run, index: next } } };
      }
      return finishRun(st, run);
    }
    default:
      return s;
  }
}

// ===== the calculation editor

/** Keys allowed in BASE-N input. */
function baseNAllowed(n: MathNode): boolean {
  switch (n.k) {
    case 'digit': return n.d !== '.';
    case 'op': return n.op !== 'nPr' && n.op !== 'nCr' && n.op !== '∠' && n.op !== '·';
    case 'lpar': case 'rpar': case 'ans': case 'var': case 'baseprefix': case 'colon': case 'eq': case 'comma':
      return true;
    case 'fn': return n.name === 'Not' || n.name === 'Neg';
    default: return false;
  }
}

/** Input that continues from Ans after a result ('+' gives Ans+). */
function continuesAns(n: MathNode): boolean {
  switch (n.k) {
    case 'op': return n.op !== '∠';
    case 'post': return n.op !== 'E';
    case 'pow': case 'conv': return true;
    case 'statvar': return n.name === 'x̂' || n.name === 'x̂1' || n.name === 'x̂2' || n.name === 'ŷ';
    default: return false;
  }
}

function input(s: KeyState, nodes: MathNode[]): KeyState {
  const mode = s.ctx.mode;
  const first = nodes[0];
  if (mode === 'BASE-N' && !baseNAllowed(first)) return s;
  if (mode !== 'CMPLX' && ((first.k === 'sym' && first.name === 'i') || (first.k === 'op' && first.op === '∠'))) return s;
  let ed = s.editor;
  let st = s;
  if (s.result) {
    ed = continuesAns(first) ? { row: [{ k: 'ans' }], cursor: [1], insert: ed.insert } : { ...emptyEditor(), insert: ed.insert };
    st = { ...s, result: null, aux: editAux(s.aux) };
  }
  const overwrite = !ed.insert && s.ctx.setup.io === 'LineIO';
  return { ...st, editor: insertNodes(ed, nodes, overwrite) };
}

function toEditing(s: KeyState, at: 'end' | 'start'): KeyState {
  const ed = at === 'end' ? toEnd(s.editor) : toStart(s.editor);
  return { ...s, editor: ed, result: null, aux: editAux(s.aux) };
}

function recall(s: KeyState, idx: number): KeyState {
  const h = s.history[idx];
  if (!h) return s;
  const display: DisplayValue = { form: 'dec', text: h.result, canSD: false };
  return {
    ...s, editor: { ...s.editor, row: h.input, cursor: [h.input.length] }, result: { value: s.ctx.ans, display, sd: false, eng: 0 }, error: null,
    aux: { ...editAux(s.aux), histPos: idx },
  };
}

function historyStep(s: KeyState, dir: -1 | 1): KeyState {
  const n = s.history.length;
  if (n === 0) return s;
  const pos = s.aux.histPos;
  if (dir < 0) {
    const idx = pos === null ? n - 1 : pos - 1;
    return idx >= 0 ? recall(s, idx) : s;
  }
  if (pos === null || pos + 1 >= n) return s;
  return recall(s, pos + 1);
}

function command(s: KeyState, c: KeyCommand): KeyState {
  const io = s.ctx.setup.io;
  switch (c) {
    case 'up':
    case 'down': {
      if (!s.result) {
        const v = moveVertical(s.editor, c);
        if (v) return { ...s, editor: v };
        if (!isEmpty(s.editor)) return s;
      }
      return historyStep(s, c === 'up' ? -1 : 1);
    }
    case 'left':
      return s.result ? toEditing(s, 'end') : { ...s, editor: moveLeft(s.editor) };
    case 'right':
      return s.result ? toEditing(s, 'start') : { ...s, editor: moveRight(s.editor) };
    case 'eq': {
      const run = s.aux.run;
      if (run && liveResult(s)) return startRun(s, run.kind, run.row);
      return equals(s);
    }
    case 'del':
      if (s.result) return toEditing(s, 'end');
      return { ...s, editor: deleteAt(s.editor, !s.editor.insert && io === 'LineIO') };
    case 'ins':
      if (io !== 'LineIO') return s;
      {
        const base = s.result ? toEditing(s, 'end') : s;
        return { ...base, editor: { ...base.editor, insert: !base.editor.insert } };
      }
    case 'ac':
    case 'on':
    case 'off': {
      const screen = s.screen && (s.screen.kind === 'mat-result' || s.screen.kind === 'vct-result') ? null : s.screen;
      return { ...s, editor: { ...emptyEditor(), insert: s.editor.insert }, result: null, prompt: null, screen, aux: { ...editAux(s.aux), entry: null } };
    }
    case 'calc': {
      const run = s.aux.run;
      if (run && run.kind === 'calc' && liveResult(s)) return startRun(s, 'calc', run.row);
      if (s.ctx.mode === 'BASE-N') return s;
      return startRun(s, 'calc');
    }
    case 'solve': {
      const mode = s.ctx.mode;
      if (mode === 'BASE-N' || mode === 'CMPLX') return s;
      const run = s.aux.run;
      if (run && run.kind === 'solve' && liveResult(s)) return startRun(s, 'solve', run.row);
      return startRun(s, 'solve');
    }
    case 'sd': {
      if (liveResult(s) && s.result) {
        return s.result.display.canSD ? reformat({ ...s, result: { ...s.result, sd: !s.result.sd } }) : s;
      }
      const st = liveOrEval(s);
      if (!st || !st.result || st.error) return st ?? s;
      return st.result.display.canSD ? reformat({ ...st, result: { ...st.result, sd: !st.result.sd } }) : st;
    }
    case 'abc': {
      const st = liveOrEval(s);
      if (!st || !st.result || st.error || st.result.value.t !== 'real') return st ?? s;
      return reformat(withAux(st, { fracAlt: !st.aux.fracAlt }));
    }
    case 'eng':
    case 'engBack': {
      if (s.ctx.mode === 'BASE-N') return s;
      const st = liveOrEval(s);
      if (!st || !st.result || st.error) return st ?? s;
      if (st.result.value.t !== 'real') return st;
      const eng = st.result.eng + (c === 'eng' ? 1 : -1);
      return reformat({ ...st, result: { ...st.result, eng, sd: false } });
    }
    case 'dms': {
      if (liveResult(s) && s.result) {
        return s.result.value.t === 'real' ? reformat(withAux(s, { dms: true })) : s;
      }
      return input(s, [{ k: 'dms' }]);
    }
    case 'dmsBack':
      return liveResult(s) ? reformat(withAux(s, { dms: false })) : s;
    case 'mplus':
      return memoryKey(s, 1);
    case 'mminus':
      return memoryKey(s, -1);
    case 'rcl':
    case 'sto':
      return { ...s, pending: c };
  }
}

function general(s: KeyState, act: KeyAction): KeyState {
  switch (act.a) {
    case 'none':
      return s;
    case 'radix': {
      if (s.ctx.mode !== 'BASE-N') return s;
      return reformat({ ...s, ctx: { ...s.ctx, base: act.base } });
    }
    case 'menu':
      if (!menuAvailable(act.id, s.ctx.mode)) return s;
      return { ...s, menu: [...s.menu, { id: act.id, page: 0 }] };
    case 'cmd':
      return command(s, act.cmd);
    default: {
      const nodes = actionNodes(act);
      return nodes ? input(s, nodes) : s;
    }
  }
}
