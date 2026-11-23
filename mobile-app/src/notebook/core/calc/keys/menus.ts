/**
 * Calculator menus: MODE (1 to 10), SETUP over 2 pages with its sub-menus, CLR, CONST, CONV, DRG, hyp,
 * and the mode menus (STAT, MATRIX, VECTOR, CMPLX, BASE, EQN, INEQ, RATIO). LCD texts are the
 * reference calculator's own symbols (not translated). CONST and CONV entries also carry ar/en names.
 *
 * menuView builds the option lines of a frame; menuChoose turns a key into a MenuEffect that the
 * machine applies. The mode hooks (P18's modeHooks, through setModeHooks) live here because the
 * CONST and CONV lists come from them.
 */
import type {
  CalcContext, CalcMode, CalcSetup, EqnKind, IneqRel, MathNode, MemName, MenuFrame, MenuId, ModeHooks, RatioKind, StatKind, StatVar,
} from '../types.ts';
import { CALC_MODES, STAT_KINDS } from '../types.ts';
import type { KeyAction } from './keymap.ts';

// ===== mode hooks

let hooks: ModeHooks | null = null;

/** Registers the mode solvers and tables (P24 installCalc: setModeHooks(modeHooks), once). */
export function setModeHooks(h: ModeHooks | null): void {
  hooks = h;
}

export function getModeHooks(): ModeHooks | null {
  return hooks;
}

// ===== views

export interface MenuItem {
  /** The key that picks it ('1'..'9', '0'). */
  key: string;
  label: string;
  /** Long names (CONST and CONV entries). */
  hint?: { ar: string; en: string };
}

export interface MenuView {
  id: MenuId;
  /** Question line above the items ('Fix 0~9?', 'Matrix?'), if any. */
  title?: string;
  /** Items of the current page. */
  items: MenuItem[];
  /** Items per LCD line (2 for the short MODE and SETUP style lists). */
  columns: 1 | 2;
  page: number;
  pages: number;
  /** Line under the items ('[=] :Yes  [AC] :Cancel', '[◀] [▶]'). */
  prompt?: string;
}

/** Lines per menu page. Digit keys 1..8 pick on the current page. */
export const PAGE_SIZE = 8;

const MODE_LABELS: Record<CalcMode, string> = {
  COMP: 'COMP', CMPLX: 'CMPLX', STAT: 'STAT', 'BASE-N': 'BASE-N', EQN: 'EQN', MATRIX: 'MATRIX', TABLE: 'TABLE',
  VECTOR: 'VECTOR', INEQ: 'INEQ', RATIO: 'RATIO',
};

const items = (labels: string[], start = 1): MenuItem[] => labels.map((label, i) => ({ key: String((start + i) % 10), label }));

function paged(all: MenuItem[], page: number, size: number = PAGE_SIZE): { items: MenuItem[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = Math.max(0, Math.min(page, pages - 1));
  return { items: all.slice(p * size, (p + 1) * size), page: p, pages };
}

/** Paged lists whose entries are numbered again from 1 on every page (CONST, CONV). */
function renumbered(all: { label: string; hint?: { ar: string; en: string } }[], page: number): { items: MenuItem[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.max(0, Math.min(page, pages - 1));
  const slice = all.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  return { items: slice.map((e, i) => ({ key: String(i + 1), label: e.label, ...(e.hint ? { hint: e.hint } : {}) })), page: p, pages };
}

const SETUP_PAGES: string[][] = [
  ['MthIO', 'LineIO', 'Deg', 'Rad', 'Gra', 'Fix', 'Sci', 'Norm'],
  ['ab/c', 'd/c', 'CMPLX', 'STAT', 'TABLE', 'Disp', '◀CONT▶'],
];

const EQN_LABELS = ['anX+bnY=cn', 'anX+bnY+cnZ=dn', 'aX²+bX+c=0', 'aX³+bX²+cX+d=0'];
const EQN_ORDER: EqnKind[] = ['lin2', 'lin3', 'poly2', 'poly3'];
const INEQ_POLY: Record<2 | 3, string> = { 2: 'aX²+bX+c', 3: 'aX³+bX²+cX+d' };
const INEQ_RELS: IneqRel[] = ['>', '<', '≥', '≤'];
const RATIO_ORDER: RatioKind[] = ['A:B=X:D', 'A:B=C:X'];
const MAT_DIMS: [number, number][] = [[3, 3], [3, 2], [3, 1], [2, 3], [2, 2], [2, 1], [1, 3], [1, 2], [1, 1]];

const paired = (k: StatKind) => k !== '1-VAR';
const quad = (k: StatKind) => k === '_+CX²';

function statSum(kind: StatKind): StatVar[] {
  if (!paired(kind)) return ['Σx²', 'Σx'];
  const base: StatVar[] = ['Σx²', 'Σx', 'Σy²', 'Σy', 'Σxy'];
  return quad(kind) ? [...base, 'Σx³', 'Σx²y', 'Σx⁴'] : base;
}
function statVarList(kind: StatKind): StatVar[] {
  return paired(kind) ? ['n', 'x̄', 'σx', 'sx', 'ȳ', 'σy', 'sy'] : ['n', 'x̄', 'σx', 'sx'];
}
function statReg(kind: StatKind): StatVar[] {
  return quad(kind) ? ['A', 'B', 'C', 'x̂1', 'x̂2', 'ŷ'] : ['A', 'B', 'r', 'x̂', 'ŷ'];
}
function statMinMax(kind: StatKind): StatVar[] {
  return paired(kind) ? ['minX', 'maxX', 'minY', 'maxY'] : ['minX', 'maxX', 'Q1', 'med', 'Q3'];
}
const DISTR = ['P(', 'Q(', 'R(', '▶t'] as const;

const CLR_TITLE: Record<'Setup' | 'Memory' | 'All', string> = { Setup: 'Clear Setup?', Memory: 'Clear Memory?', All: 'Clear All?' };

/** Option lines of a menu frame. */
export function menuView(f: MenuFrame, ctx: CalcContext): MenuView {
  const one = (title: string | undefined, labels: string[], columns: 1 | 2 = 1, prompt?: string): MenuView => {
    const p = paged(items(labels), f.page);
    return { id: f.id, ...(title ? { title } : {}), items: p.items, columns, page: p.page, pages: p.pages, ...(prompt ? { prompt } : {}) };
  };
  const kind = ctx.stat.kind;
  switch (f.id) {
    case 'MODE': {
      const all = CALC_MODES.map((m, i) => ({ key: String((i + 1) % 10), label: MODE_LABELS[m] }));
      const p = paged(all, f.page);
      return { id: f.id, items: p.items, columns: 2, page: p.page, pages: p.pages };
    }
    case 'SETUP': {
      const page = Math.max(0, Math.min(f.page, 1));
      return { id: f.id, items: items(SETUP_PAGES[page]), columns: 2, page, pages: 2 };
    }
    case 'SETUP_FIX': return { id: f.id, title: 'Fix 0~9?', items: [], columns: 1, page: 0, pages: 1 };
    case 'SETUP_SCI': return { id: f.id, title: 'Sci 0~9?', items: [], columns: 1, page: 0, pages: 1 };
    case 'SETUP_NORM': return { id: f.id, title: 'Norm 1~2?', items: [], columns: 1, page: 0, pages: 1 };
    case 'SETUP_FRAC': return one(undefined, ['ab/c', 'd/c'], 2);
    case 'SETUP_CMPLX': return one(undefined, ['a+bi', 'r∠θ'], 2);
    case 'SETUP_STAT': return one('Frequency?', ['ON', 'OFF'], 2);
    case 'SETUP_TABLE': return one(undefined, ['f(x)', 'f(x),g(x)']);
    case 'SETUP_DISP': return one(undefined, ['Dot', 'Comma'], 2);
    case 'SETUP_CONT': return { id: f.id, title: 'CONTRAST', items: [], columns: 1, page: 0, pages: 1, prompt: '[◀] [▶]' };
    case 'CLR': return one(undefined, ['Setup', 'Memory', 'All']);
    case 'CLR_CONFIRM': {
      const t = f.target === 'Setup' || f.target === 'Memory' || f.target === 'All' ? f.target : 'All';
      return { id: f.id, title: CLR_TITLE[t], items: [], columns: 1, page: 0, pages: 1, prompt: '[=] :Yes  [AC] :Cancel' };
    }
    case 'CONST': {
      const table = hooks?.constTable ?? [];
      const p = renumbered(table.map((c) => ({ label: c.symbol, hint: { ar: c.ar, en: c.en } })), f.page);
      return { id: f.id, title: 'CONST', items: p.items, columns: 1, page: p.page, pages: p.pages };
    }
    case 'CONV': {
      const table = hooks?.convTable ?? [];
      const p = renumbered(table.map((c) => ({ label: `${c.from}▶${c.to}`, hint: { ar: c.ar, en: c.en } })), f.page);
      return { id: f.id, title: 'CONV', items: p.items, columns: 1, page: p.page, pages: p.pages };
    }
    case 'DRG': return one(undefined, ['°', 'ʳ', 'ᵍ'], 2);
    case 'HYP': return one(undefined, ['sinh', 'cosh', 'tanh', 'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹'], 2);
    case 'STAT_TYPE': return one(undefined, [...STAT_KINDS], 2);
    case 'STAT': return one(undefined, ['Type', 'Data', 'Sum', 'Var', paired(kind) ? 'Reg' : 'Distr', 'MinMax'], 2);
    case 'STAT_SUM': return one(undefined, statSum(kind), 2);
    case 'STAT_VAR': return one(undefined, statVarList(kind), 2);
    case 'STAT_REG': return one(undefined, statReg(kind), 2);
    case 'STAT_MINMAX': return one(undefined, statMinMax(kind), 2);
    case 'STAT_DISTR': return one(undefined, [...DISTR], 2);
    case 'MATRIX': return one(undefined, ['Dim', 'Data', 'MatA', 'MatB', 'MatC', 'MatAns', 'det', 'Trn'], 2);
    case 'MATRIX_SELECT': return one('Matrix?', ['MatA', 'MatB', 'MatC']);
    case 'MATRIX_DIM': {
      const name = f.target === 'A' || f.target === 'B' || f.target === 'C' ? f.target : 'A';
      const all = MAT_DIMS.map(([r, c], i) => ({ key: String((i % 6) + 1), label: `${r}×${c}` }));
      const page = Math.max(0, Math.min(f.page, 1));
      return { id: f.id, title: `Mat${name}(m×n) m×n?`, items: all.slice(page * 6, page * 6 + 6), columns: 2, page, pages: 2 };
    }
    case 'VECTOR': return one(undefined, ['Dim', 'Data', 'VctA', 'VctB', 'VctC', 'VctAns', 'Dot'], 2);
    case 'VECTOR_SELECT': return one('Vector?', ['VctA', 'VctB', 'VctC']);
    case 'VECTOR_DIM': {
      const name = f.target === 'A' || f.target === 'B' || f.target === 'C' ? f.target : 'A';
      return one(`Vct${name}(m) m?`, ['3', '2'], 2);
    }
    case 'CMPLX': return one(undefined, ['arg', 'Conjg', '▶r∠θ', '▶a+bi'], 2);
    case 'BASE':
    case 'BASE_LOGIC':
    case 'BASE_PREFIX': {
      const page = f.id === 'BASE_LOGIC' ? 0 : f.id === 'BASE_PREFIX' ? 1 : Math.max(0, Math.min(f.page, 1));
      const labels = page === 0 ? ['and', 'or', 'xnor', 'xor', 'Not', 'Neg'] : ['d', 'h', 'b', 'o'];
      return { id: f.id, items: items(labels), columns: 2, page, pages: f.id === 'BASE' ? 2 : 1 };
    }
    case 'EQN_TYPE': return one(undefined, EQN_LABELS);
    case 'INEQ_TYPE': return one(undefined, [INEQ_POLY[2], INEQ_POLY[3]]);
    case 'INEQ_REL': {
      // This frame's page field carries the chosen degree (2 or 3); the list itself has one page.
      const deg: 2 | 3 = f.page === 3 ? 3 : 2;
      return { id: f.id, items: items(INEQ_RELS.map((r) => `${INEQ_POLY[deg]}${r}0`)), columns: 1, page: 0, pages: 1 };
    }
    case 'RATIO_TYPE': return one(undefined, [...RATIO_ORDER]);
  }
}

// ===== choosing

export type ClrTarget = 'Setup' | 'Memory' | 'All';

/** What a key does in the top menu. The machine applies it. */
export type MenuEffect =
  | { e: 'none' }
  | { e: 'close' }
  | { e: 'page'; page: number }
  | { e: 'open'; frame: MenuFrame }
  | { e: 'insert'; nodes: MathNode[] }
  | { e: 'mode'; mode: CalcMode }
  | { e: 'setup'; setup: CalcSetup; clear: boolean }
  | { e: 'contrast'; value: number }
  | { e: 'clr'; target: ClrTarget }
  | { e: 'statType'; kind: StatKind }
  | { e: 'statData' }
  | { e: 'memMenu'; kind: 'mat' | 'vct'; purpose: 'dim' | 'data' }
  | { e: 'memSelect'; kind: 'mat' | 'vct'; name: 'A' | 'B' | 'C' }
  | { e: 'matDim'; name: 'A' | 'B' | 'C'; rows: number; cols: number }
  | { e: 'vctDim'; name: 'A' | 'B' | 'C'; dim: number }
  | { e: 'eqnType'; kind: EqnKind }
  | { e: 'ineqType'; deg: 2 | 3 }
  | { e: 'ineqRel'; deg: 2 | 3; rel: IneqRel }
  | { e: 'ratioType'; kind: RatioKind };

const fnTok = (name: Extract<MathNode, { k: 'fn' }>['name']): MathNode => ({ k: 'fn', name, args: [] });
const statNode = (name: StatVar): MathNode => ({ k: 'statvar', name });
const open = (id: MenuId, page = 0, target?: MenuFrame['target']): MenuEffect => ({ e: 'open', frame: target ? { id, page, target } : { id, page } });

/** The 1-based item number a key picks on the current page (digit keys only), or null. */
function picked(act: KeyAction): number | null {
  if (act.a !== 'digit') return null;
  if (act.d < '0' || act.d > '9') return null;
  return Number(act.d);
}

/**
 * The effect of a key in menu f. Digits pick an item of the current page (MODE: 1..9 and 0 for the
 * 10th mode on any page); ▲ ▼ change page; AC closes every menu; = confirms CLR; ◀ ▶ set contrast.
 */
export function menuChoose(f: MenuFrame, act: KeyAction, ctx: CalcContext): MenuEffect {
  const view = menuView(f, ctx);
  if (act.a === 'cmd') {
    if (act.cmd === 'ac' || act.cmd === 'on' || act.cmd === 'off') return { e: 'close' };
    if (act.cmd === 'down') return view.page + 1 < view.pages ? { e: 'page', page: view.page + 1 } : { e: 'none' };
    if (act.cmd === 'up') return view.page > 0 ? { e: 'page', page: view.page - 1 } : { e: 'none' };
    if (f.id === 'SETUP_CONT' && (act.cmd === 'left' || act.cmd === 'right')) {
      const c = Math.max(1, Math.min(9, ctx.setup.contrast + (act.cmd === 'right' ? 1 : -1)));
      return { e: 'contrast', value: c };
    }
    if (f.id === 'SETUP_CONT' && act.cmd === 'eq') return { e: 'close' };
    if (f.id === 'CLR_CONFIRM' && act.cmd === 'eq') {
      const t = f.target === 'Setup' || f.target === 'Memory' || f.target === 'All' ? f.target : 'All';
      return { e: 'clr', target: t };
    }
    return { e: 'none' };
  }
  const n = picked(act);
  if (n === null) return { e: 'none' };
  const setup = ctx.setup;
  const set = (patch: Partial<CalcSetup>, clear = false): MenuEffect => ({ e: 'setup', setup: { ...setup, ...patch }, clear });
  const kind = ctx.stat.kind;
  const choose = <T>(list: readonly T[], k: number): T | null => (k >= 1 && k <= list.length ? list[k - 1] : null);
  const ins = (nodes: MathNode[] | null): MenuEffect => (nodes ? { e: 'insert', nodes } : { e: 'none' });

  switch (f.id) {
    case 'MODE': {
      const idx = n === 0 ? 10 : n;
      const m = CALC_MODES[idx - 1];
      return m ? { e: 'mode', mode: m } : { e: 'none' };
    }
    case 'SETUP': {
      if (view.page === 0) {
        switch (n) {
          case 1: return set({ io: 'MthIO' }, true);
          case 2: return set({ io: 'LineIO' }, true);
          case 3: return set({ angle: 'Deg' });
          case 4: return set({ angle: 'Rad' });
          case 5: return set({ angle: 'Gra' });
          case 6: return open('SETUP_FIX');
          case 7: return open('SETUP_SCI');
          case 8: return open('SETUP_NORM');
          default: return { e: 'none' };
        }
      }
      switch (n) {
        case 1: return set({ frac: 'ab/c' });
        case 2: return set({ frac: 'd/c' });
        case 3: return open('SETUP_CMPLX');
        case 4: return open('SETUP_STAT');
        case 5: return open('SETUP_TABLE');
        case 6: return open('SETUP_DISP');
        case 7: return open('SETUP_CONT');
        default: return { e: 'none' };
      }
    }
    case 'SETUP_FIX': return set({ disp: { mode: 'Fix', n } });
    case 'SETUP_SCI': return set({ disp: { mode: 'Sci', n } });
    case 'SETUP_NORM': return n === 1 || n === 2 ? set({ disp: { mode: 'Norm', n } }) : { e: 'none' };
    case 'SETUP_FRAC': return n === 1 ? set({ frac: 'ab/c' }) : n === 2 ? set({ frac: 'd/c' }) : { e: 'none' };
    case 'SETUP_CMPLX': return n === 1 ? set({ cmplx: 'a+bi' }) : n === 2 ? set({ cmplx: 'r∠θ' }) : { e: 'none' };
    case 'SETUP_STAT': return n === 1 ? set({ statFreq: true }) : n === 2 ? set({ statFreq: false }) : { e: 'none' };
    case 'SETUP_TABLE': return n === 1 ? set({ table: 'f(x)' }) : n === 2 ? set({ table: 'f(x),g(x)' }) : { e: 'none' };
    case 'SETUP_DISP': return n === 1 ? set({ decimal: 'Dot' }) : n === 2 ? set({ decimal: 'Comma' }) : { e: 'none' };
    case 'SETUP_CONT': return { e: 'none' };
    case 'CLR': {
      const t = choose(['Setup', 'Memory', 'All'] as const, n);
      return t ? open('CLR_CONFIRM', 0, t) : { e: 'none' };
    }
    case 'CLR_CONFIRM': return { e: 'none' };
    case 'CONST': {
      const e = n >= 1 && n <= view.items.length ? hooks?.constTable[view.page * PAGE_SIZE + n - 1] : undefined;
      return e ? { e: 'insert', nodes: [{ k: 'const', index: e.code }] } : { e: 'none' };
    }
    case 'CONV': {
      const e = n >= 1 && n <= view.items.length ? hooks?.convTable[view.page * PAGE_SIZE + n - 1] : undefined;
      return e ? { e: 'insert', nodes: [{ k: 'conv', index: e.code }] } : { e: 'none' };
    }
    case 'DRG': {
      const op = choose(['°', 'ʳ', 'ᵍ'] as const, n);
      return ins(op ? [{ k: 'post', op }] : null);
    }
    case 'HYP': {
      const name = choose(['sinh', 'cosh', 'tanh', 'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹'] as const, n);
      return ins(name ? [fnTok(name)] : null);
    }
    case 'STAT_TYPE': {
      const k = choose(STAT_KINDS, n);
      return k ? { e: 'statType', kind: k } : { e: 'none' };
    }
    case 'STAT':
      switch (n) {
        case 1: return open('STAT_TYPE');
        case 2: return { e: 'statData' };
        case 3: return open('STAT_SUM');
        case 4: return open('STAT_VAR');
        case 5: return open(paired(kind) ? 'STAT_REG' : 'STAT_DISTR');
        case 6: return open('STAT_MINMAX');
        default: return { e: 'none' };
      }
    case 'STAT_SUM': { const v = choose(statSum(kind), n); return ins(v ? [statNode(v)] : null); }
    case 'STAT_VAR': { const v = choose(statVarList(kind), n); return ins(v ? [statNode(v)] : null); }
    case 'STAT_REG': { const v = choose(statReg(kind), n); return ins(v ? [statNode(v)] : null); }
    case 'STAT_MINMAX': { const v = choose(statMinMax(kind), n); return ins(v ? [statNode(v)] : null); }
    case 'STAT_DISTR': {
      const d = choose(DISTR, n);
      if (!d) return { e: 'none' };
      return ins([d === '▶t' ? { k: 'post', op: '▶t' } : fnTok(d)]);
    }
    case 'MATRIX':
    case 'VECTOR': {
      const mk: 'mat' | 'vct' = f.id === 'MATRIX' ? 'mat' : 'vct';
      if (n === 1) return { e: 'memMenu', kind: mk, purpose: 'dim' };
      if (n === 2) return { e: 'memMenu', kind: mk, purpose: 'data' };
      const mem = choose(['A', 'B', 'C', 'Ans'] as const, n - 2);
      if (mem) return ins([{ k: mk, name: mem as MemName }]);
      if (mk === 'mat' && n === 7) return ins([fnTok('det')]);
      if (mk === 'mat' && n === 8) return ins([fnTok('Trn')]);
      if (mk === 'vct' && n === 7) return ins([{ k: 'op', op: '·' }]);
      return { e: 'none' };
    }
    case 'MATRIX_SELECT':
    case 'VECTOR_SELECT': {
      const name = choose(['A', 'B', 'C'] as const, n);
      return name ? { e: 'memSelect', kind: f.id === 'MATRIX_SELECT' ? 'mat' : 'vct', name } : { e: 'none' };
    }
    case 'MATRIX_DIM': {
      const name = f.target === 'A' || f.target === 'B' || f.target === 'C' ? f.target : 'A';
      const d = n >= 1 && n <= 6 ? MAT_DIMS[view.page * 6 + n - 1] : undefined;
      return d ? { e: 'matDim', name, rows: d[0], cols: d[1] } : { e: 'none' };
    }
    case 'VECTOR_DIM': {
      const name = f.target === 'A' || f.target === 'B' || f.target === 'C' ? f.target : 'A';
      return n === 1 ? { e: 'vctDim', name, dim: 3 } : n === 2 ? { e: 'vctDim', name, dim: 2 } : { e: 'none' };
    }
    case 'CMPLX':
      switch (n) {
        case 1: return ins([fnTok('arg')]);
        case 2: return ins([fnTok('Conjg')]);
        case 3: return ins([{ k: 'post', op: '▶r∠θ' }]);
        case 4: return ins([{ k: 'post', op: '▶a+bi' }]);
        default: return { e: 'none' };
      }
    case 'BASE':
    case 'BASE_LOGIC':
    case 'BASE_PREFIX': {
      if (view.page === 0) {
        const o = choose(['and', 'or', 'xnor', 'xor'] as const, n);
        if (o) return ins([{ k: 'op', op: o }]);
        if (n === 5) return ins([fnTok('Not')]);
        if (n === 6) return ins([fnTok('Neg')]);
        return { e: 'none' };
      }
      const b = choose(['d', 'h', 'b', 'o'] as const, n);
      return ins(b ? [{ k: 'baseprefix', base: b }] : null);
    }
    case 'EQN_TYPE': {
      const k = choose(EQN_ORDER, n);
      return k ? { e: 'eqnType', kind: k } : { e: 'none' };
    }
    case 'INEQ_TYPE': return n === 1 ? { e: 'ineqType', deg: 2 } : n === 2 ? { e: 'ineqType', deg: 3 } : { e: 'none' };
    case 'INEQ_REL': {
      const rel = choose(INEQ_RELS, n);
      return rel ? { e: 'ineqRel', deg: f.page === 3 ? 3 : 2, rel } : { e: 'none' };
    }
    case 'RATIO_TYPE': {
      const k = choose(RATIO_ORDER, n);
      return k ? { e: 'ratioType', kind: k } : { e: 'none' };
    }
  }
}

/** Menus a mode may open from the keys (SHIFT 1 STAT only in STAT, and so on). */
export function menuAvailable(id: MenuId, mode: CalcMode): boolean {
  switch (id) {
    case 'STAT': return mode === 'STAT';
    case 'MATRIX': return mode === 'MATRIX';
    case 'VECTOR': return mode === 'VECTOR';
    case 'CMPLX': return mode === 'CMPLX';
    case 'BASE': return mode === 'BASE-N';
    case 'CONST':
    case 'CONV':
    case 'DRG':
    case 'HYP': return mode !== 'BASE-N';
    default: return true;
  }
}

/** The mode menu shown when a mode is entered, or null (P19 also uses it on restore). */
export function entryMenu(mode: CalcMode): MenuFrame | null {
  switch (mode) {
    case 'STAT': return { id: 'STAT_TYPE', page: 0 };
    case 'EQN': return { id: 'EQN_TYPE', page: 0 };
    case 'MATRIX': return { id: 'MATRIX_SELECT', page: 0 };
    case 'VECTOR': return { id: 'VECTOR_SELECT', page: 0 };
    case 'INEQ': return { id: 'INEQ_TYPE', page: 0 };
    case 'RATIO': return { id: 'RATIO_TYPE', page: 0 };
    default: return null;
  }
}

/** Menus that cannot be closed with AC while no mode screen exists (the mode has no calculation screen). */
export function menuRequired(id: MenuId, mode: CalcMode): boolean {
  return (id === 'EQN_TYPE' && mode === 'EQN') || (id === 'INEQ_TYPE' && mode === 'INEQ') || (id === 'INEQ_REL' && mode === 'INEQ') || (id === 'RATIO_TYPE' && mode === 'RATIO');
}
