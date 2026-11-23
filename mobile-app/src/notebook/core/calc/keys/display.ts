/**
 * LCD layout (NB-47a): layoutDisplay(s) turns a machine state into a KeyDisplayModel that P24's
 * Lcd/LcdMath draws. Natural display (MthIO) stacks fractions, raises powers, draws √ ∛ ʸ√x, |x|,
 * log with a base, ∫ with limits, d/dx and Σ; LineIO writes everything on one line (2⌟3, √(2), ^(3),
 * ∫(f,a,b)). Units are LCD units (LCD_METRICS); the caller scales them.
 *
 * Boxes: x and y are relative to the parent box; baseline is measured from the box top. Each box that
 * draws an input node carries its editor path (odd length); slot rows carry their row prefix (even
 * length, [] for the top row). pathAt(box, x, y) turns a tap into a cursor path.
 */
import type { CalcContext, CalcSetup, DisplayModel, LcdBox, LcdBoxKind, MachineState, MathNode, MathRow } from '../types.ts';
import { errorHint } from '../errors.ts';
import { formatValue } from '../format.ts';
import { slotsOf } from './editor.ts';
import { getModeHooks, menuView } from './menus.ts';
import { screenView } from './modeScreens.ts';
import { asKeyState, type KeyState } from './machine.ts';

// ===== metrics

export interface FontMetrics {
  charW: number;
  ascent: number;
  descent: number;
}

export const LCD_METRICS = {
  normal: { charW: 10, ascent: 13, descent: 4 } as FontMetrics,
  small: { charW: 7, ascent: 9, descent: 3 } as FontMetrics,
  /** Width of the LCD text area: 16 normal characters. */
  width: 160,
};

const metrics = (small: boolean): FontMetrics => (small ? LCD_METRICS.small : LCD_METRICS.normal);

/** Characters a text occupies (combining marks such as the bar of x̄ take no room). */
export function textWidth(text: string, small: boolean): number {
  const n = [...text.replace(/[̀-ͯ]/g, '')].length;
  return n * metrics(small).charW;
}

function box(kind: LcdBoxKind, o: Partial<LcdBox> & { w: number; h: number; baseline: number }): LcdBox {
  return { kind, children: [], x: 0, y: 0, ...o };
}

function textBox(text: string, small: boolean, path?: number[]): LcdBox {
  const m = metrics(small);
  const b = box('text', { text, w: textWidth(text, small), h: m.ascent + m.descent, baseline: m.ascent });
  if (small) b.small = true;
  if (path) b.path = path;
  return b;
}

/** Lays out children left to right on a shared baseline. */
function hbox(kind: LcdBoxKind, children: LcdBox[], small: boolean, path?: number[]): LcdBox {
  const m = metrics(small);
  let baseline = children.length ? 0 : m.ascent;
  for (const c of children) baseline = Math.max(baseline, c.baseline);
  let x = 0;
  let h = children.length ? 0 : m.ascent + m.descent;
  const kids = children.map((c) => {
    const k = { ...c, x, y: baseline - c.baseline };
    x += c.w;
    h = Math.max(h, k.y + c.h);
    return k;
  });
  const b = box(kind, { children: kids, w: x, h, baseline });
  if (small) b.small = true;
  if (path) b.path = path;
  return b;
}

// ===== node texts

const OP_TEXT: Record<string, string> = {
  '+': '+', '-': '−', '×': '×', '÷': '÷', nPr: 'P', nCr: 'C', '∠': '∠', '·': '·', and: ' and ', or: ' or ', xor: ' xor ', xnor: ' xnor ',
};

function nodeText(n: MathNode, setup: CalcSetup): string {
  const hooks = getModeHooks();
  switch (n.k) {
    case 'digit': return n.d === '.' && setup.decimal === 'Comma' ? ',' : n.d;
    case 'op': return OP_TEXT[n.op] ?? n.op;
    case 'neg': return '−';
    case 'lpar': return '(';
    case 'rpar': return ')';
    case 'comma': return ',';
    case 'colon': return ':';
    case 'eq': return '=';
    case 'var': return n.name;
    case 'ans': return 'Ans';
    case 'sym': return n.name;
    case 'const': return hooks?.constTable.find((c) => c.code === n.index)?.symbol ?? `C${n.index}`;
    case 'statvar': return n.name;
    case 'conv': {
      const c = hooks?.convTable.find((e) => e.code === n.index);
      return c ? `${c.from}▶${c.to}` : `▶${n.index}`;
    }
    case 'baseprefix': return n.base;
    case 'mat': return `Mat${n.name}`;
    case 'vct': return `Vct${n.name}`;
    case 'fn': return n.name.endsWith('(') ? n.name : `${n.name}(`;
    case 'post': return n.op === 'E' ? (setup.io === 'MthIO' ? '×10' : 'ᴇ') : n.op;
    case 'dms': return '°';
    default: return '';
  }
}

// ===== layout

interface Lay {
  setup: CalcSetup;
  /** Caret path to draw, or null. */
  cursor: number[] | null;
  overwrite: boolean;
  /** Attach editor paths (input rows); false for result forms. */
  paths: boolean;
}

function samePrefix(a: readonly number[], prefix: readonly number[]): boolean {
  if (a.length !== prefix.length + 1) return false;
  for (let i = 0; i < prefix.length; i++) if (a[i] !== prefix[i]) return false;
  return true;
}

function cursorBox(small: boolean, overwrite: boolean): LcdBox {
  const m = metrics(small);
  const b = box('cursor', { text: overwrite ? '_' : '|', w: 0, h: m.ascent + m.descent, baseline: m.ascent });
  if (small) b.small = true;
  return b;
}

/** A row (a slot, or the whole input). Empty slots draw a placeholder box in MthIO. */
function layRow(row: MathRow, prefix: number[], small: boolean, c: Lay, slot: boolean): LcdBox {
  const hasCursor = c.cursor !== null && samePrefix(c.cursor, prefix);
  const ci = hasCursor && c.cursor ? c.cursor[c.cursor.length - 1] : -1;
  const path = c.paths ? prefix : undefined;
  if (row.length === 0 && slot && c.setup.io === 'MthIO') {
    const m = metrics(small);
    const b = box('slot', { w: m.charW, h: m.ascent + m.descent, baseline: m.ascent, children: hasCursor ? [cursorBox(small, false)] : [] });
    if (small) b.small = true;
    if (path) b.path = path;
    return b;
  }
  const kids: LcdBox[] = [];
  let skipCaret = -1;
  let i = 0;
  while (i <= row.length) {
    if (i === ci && i !== skipCaret) kids.push(cursorBox(small, c.overwrite));
    if (i === row.length) break;
    const n = row[i];
    // ×10ˣ in MthIO: the exponent (sign and digits) is raised as one group.
    if (n.k === 'post' && n.op === 'E' && c.setup.io === 'MthIO') {
      kids.push(textBox('×10', small, c.paths ? [...prefix, i] : undefined));
      let j = i + 1;
      const sign = row[j];
      if (sign && (sign.k === 'neg' || (sign.k === 'op' && (sign.op === '-' || sign.op === '+')))) j++;
      while (j < row.length && row[j].k === 'digit') j++;
      if (j > i + 1) {
        if (ci === i + 1) kids.push(cursorBox(small, c.overwrite));
        const group: LcdBox[] = [];
        for (let g = i + 1; g < j; g++) {
          if (g === ci && g > i + 1) group.push(cursorBox(true, c.overwrite));
          group.push(textBox(nodeText(row[g], c.setup), true, c.paths ? [...prefix, g] : undefined));
        }
        if (ci === j) {
          group.push(cursorBox(true, c.overwrite));
          skipCaret = j;
        }
        kids.push(raise(hbox('row', group, true), small));
        i = j;
        continue;
      }
      i++;
      continue;
    }
    kids.push(layNode(n, c.paths ? [...prefix, i] : [], small, c));
    i++;
  }
  return hbox('row', kids, small, path);
}

/** A superscript: content raised by about half the normal ascent. */
function raise(content: LcdBox, small: boolean): LcdBox {
  const lift = Math.round(metrics(small).ascent * 0.55);
  const b = box('sup', { children: [{ ...content, x: 0, y: 0 }], w: content.w, h: content.h + lift, baseline: content.baseline + lift });
  return b;
}

/** A subscript: content lowered below the baseline. */
function lower(content: LcdBox, small: boolean): LcdBox {
  const drop = Math.round(metrics(small).ascent * 0.4);
  const cy = Math.max(0, drop - content.baseline);
  return box('sub', { children: [{ ...content, x: 0, y: cy }], w: content.w, h: cy + content.h, baseline: cy + content.baseline - drop });
}

function paren(content: LcdBox, small: boolean): LcdBox {
  const pw = metrics(small).charW;
  const open = textBox('(', small);
  const close = textBox(')', small);
  const h = Math.max(content.h, open.h);
  const baseline = Math.max(content.baseline, open.baseline);
  return box('paren', {
    children: [
      { ...open, x: 0, y: baseline - open.baseline, h },
      { ...content, x: pw, y: baseline - content.baseline },
      { ...close, x: pw + content.w, y: baseline - close.baseline, h },
    ],
    w: content.w + 2 * pw, h: Math.max(h, baseline - content.baseline + content.h), baseline,
  });
}

function sqrtBox(content: LcdBox, small: boolean, path?: number[]): LcdBox {
  const sign = Math.round(metrics(small).charW * 0.9);
  const top = 3;
  const b = box('sqrt', { children: [{ ...content, x: sign, y: top }], w: sign + content.w + 2, h: content.h + top, baseline: content.baseline + top });
  if (path) b.path = path;
  return b;
}

function fracBox(num: LcdBox, den: LcdBox, small: boolean, path?: number[]): LcdBox {
  const w = Math.max(num.w, den.w) + 4;
  const barY = num.h + 1;
  const bar = box('bar', { x: 0, y: barY, w, h: 1, baseline: 0 });
  const mid = Math.round(metrics(small).ascent * 0.35);
  const b = box('frac', {
    children: [{ ...num, x: (w - num.w) / 2, y: 0 }, bar, { ...den, x: (w - den.w) / 2, y: barY + 2 }],
    w, h: barY + 2 + den.h, baseline: barY + mid,
  });
  if (path) b.path = path;
  return b;
}

/** Linear form: text pieces and slot rows, e.g. ['∫(', f, ',', a, ',', b, ')']. */
function linear(parts: (string | LcdBox)[], small: boolean, path?: number[]): LcdBox {
  return hbox('row', parts.map((p) => (typeof p === 'string' ? textBox(p, small) : p)), small, path);
}

function layNode(n: MathNode, path: number[], small: boolean, c: Lay): LcdBox {
  const p = c.paths ? path : undefined;
  const slots = slotsOf(n);
  if (!slots) return textBox(nodeText(n, c.setup), small, p);
  const slot = (i: number, sm: boolean = small) => layRow(slots[i], c.paths ? [...path, i] : [], sm, c, true);
  const sm = true;
  const mth = c.setup.io === 'MthIO';
  switch (n.k) {
    case 'frac':
      return mth ? fracBox(slot(0), slot(1), small, p) : linear([slot(0), '⌟', slot(1)], small, p);
    case 'mixed':
      return mth ? hbox('row', [slot(0), fracBox(slot(1), slot(2), small)], small, p) : linear([slot(0), '⌟', slot(1), '⌟', slot(2)], small, p);
    case 'pow':
      return mth ? withPath(raise(slot(0, sm), small), p) : linear(['^(', slot(0), ')'], small, p);
    case 'root': {
      if (!mth) return linear([slot(0), 'ˣ√(', slot(1), ')'], small, p);
      return rootBox(slot(0, sm), sqrtBox(slot(1), small), p);
    }
    case 'logb':
      if (!mth) return linear(['log(', slot(0), ',', slot(1), ')'], small, p);
      return hbox('logb', [textBox('log', small), lower(slot(0, sm), small), paren(slot(1), small)], small, p);
    case 'integral': {
      if (!mth) return linear(['∫(', slot(0), ',', slot(1), ',', slot(2), ')'], small, p);
      return limitsBox('integral', '∫', slot(0), slot(1, sm), slot(2, sm), 'dx', small, p);
    }
    case 'sum': {
      if (!mth) return linear(['Σ(', slot(0), ',', slot(1), ',', slot(2), ')'], small, p);
      const lowerRow = hbox('row', [textBox('X=', sm), slot(1, sm)], sm);
      return limitsBox('sum', 'Σ', paren(slot(0), small), lowerRow, slot(2, sm), null, small, p);
    }
    case 'deriv': {
      if (!mth) return linear(['d/dx(', slot(0), ',', slot(1), ')'], small, p);
      const at = hbox('row', [textBox('X=', sm), slot(1, sm)], sm);
      return hbox('deriv', [textBox('d/dx', small), paren(slot(0), small), textBox('|', small), lower(at, small)], small, p);
    }
    case 'fn': {
      const name = n.name;
      if (!mth) {
        const head = name === '10^' ? '10^(' : name === 'e^' ? 'e^(' : `${name}(`;
        const parts: (string | LcdBox)[] = [head];
        slots.forEach((_, i) => {
          if (i > 0) parts.push(',');
          parts.push(slot(i));
        });
        parts.push(')');
        return linear(parts, small, p);
      }
      if (name === '√') return sqrtBox(slot(0), small, p);
      if (name === '∛') return rootBox(textBox('3', sm), sqrtBox(slot(0), small), p);
      if (name === 'Abs') {
        const inner = slot(0);
        const bw = 3;
        return box('abs', { children: [{ ...inner, x: bw, y: 0 }], w: inner.w + 2 * bw, h: inner.h, baseline: inner.baseline, ...(p ? { path: p } : {}) });
      }
      if (name === '10^' || name === 'e^') return hbox('row', [textBox(name === '10^' ? '10' : 'e', small), raise(slot(0, sm), small)], small, p);
      const parts: (string | LcdBox)[] = [`${name}(`];
      slots.forEach((_, i) => {
        if (i > 0) parts.push(',');
        parts.push(slot(i));
      });
      parts.push(')');
      return linear(parts, small, p);
    }
    default:
      return textBox(nodeText(n, c.setup), small, p);
  }
}

function withPath(b: LcdBox, p?: number[]): LcdBox {
  return p ? { ...b, path: p } : b;
}

function rootBox(index: LcdBox, radical: LcdBox, p?: number[]): LcdBox {
  const ix = 0;
  const rx = Math.max(0, index.w - 3);
  const ry = Math.max(0, index.h - 6);
  const b = box('root', {
    children: [{ ...index, x: ix, y: 0 }, { ...radical, x: rx, y: ry }],
    w: rx + radical.w, h: Math.max(index.h, ry + radical.h), baseline: ry + radical.baseline,
  });
  if (p) b.path = p;
  return b;
}

/** ∫ and Σ: the sign with the upper limit above and the lower limit below, then the body. */
function limitsBox(kind: LcdBoxKind, sign: string, body: LcdBox, lo: LcdBox, hi: LcdBox, tail: string | null, small: boolean, p?: number[]): LcdBox {
  const signBox = textBox(sign, small);
  const colW = Math.max(signBox.w, lo.w, hi.w);
  const top = hi.h;
  const bodyY = top + Math.max(0, signBox.baseline - body.baseline);
  const signY = top + Math.max(0, body.baseline - signBox.baseline);
  const midH = Math.max(signY + signBox.h, bodyY + body.h) - top;
  const loY = top + midH;
  const kids: LcdBox[] = [
    { ...hi, x: (colW - hi.w) / 2, y: 0 },
    { ...signBox, x: (colW - signBox.w) / 2, y: signY },
    { ...lo, x: (colW - lo.w) / 2, y: loY },
    { ...body, x: colW + 2, y: bodyY },
  ];
  let w = colW + 2 + body.w;
  if (tail) {
    const t = textBox(tail, small);
    kids.push({ ...t, x: w, y: bodyY + body.baseline - t.baseline });
    w += t.w;
  }
  const b = box(kind, { children: kids, w, h: loY + lo.h, baseline: bodyY + body.baseline });
  if (p) b.path = p;
  return b;
}

/** Lays out a MathRow (no caret, no paths), e.g. an exact result form. */
export function layoutMath(row: MathRow, setup: CalcSetup): LcdBox {
  return layRow(row, [], false, { setup, cursor: null, overwrite: false, paths: false }, false);
}

/** Lays out an input row with an optional caret path. */
export function layoutInput(row: MathRow, setup: CalcSetup, cursor: number[] | null, overwrite: boolean = false): LcdBox {
  return layRow(row, [], false, { setup, cursor, overwrite, paths: true }, false);
}

/** Absolute position of the caret box in a layout, or null. */
export function findCursor(b: LcdBox, ox: number = 0, oy: number = 0): { x: number; y: number; h: number } | null {
  const x = ox + b.x;
  const y = oy + b.y;
  if (b.kind === 'cursor') return { x, y, h: b.h };
  for (const c of b.children) {
    const r = findCursor(c, x, y);
    if (r) return r;
  }
  return null;
}

/**
 * The cursor path for a tap at (x, y) in the coordinates of the input box `root` (as returned in
 * DisplayModel.input, including its x offset). Picks the deepest row under the tap, then the gap
 * between its nodes nearest to x. null when the tap misses the input.
 */
export function pathAt(root: LcdBox, x: number, y: number): number[] | null {
  type Hit = { row: LcdBox; ox: number; oy: number; depth: number };
  let best: Hit | null = null;
  const walk = (b: LcdBox, ox: number, oy: number, depth: number) => {
    const bx = ox + b.x;
    const by = oy + b.y;
    const inside = x >= bx - 2 && x <= bx + b.w + 2 && y >= by && y <= by + b.h;
    if (!inside) return;
    if ((b.kind === 'row' || b.kind === 'slot') && b.path && b.path.length % 2 === 0) {
      if (!best || depth >= best.depth) best = { row: b, ox: bx, oy: by, depth };
    }
    for (const c of b.children) walk(c, bx, by, depth + 1);
  };
  walk(root, 0, 0, 0);
  const hit = best as Hit | null;
  if (!hit) return null;
  const prefix = hit.row.path ?? [];
  // Node boxes that belong directly to this row (not inside a deeper slot row).
  const nodes: { i: number; x0: number; x1: number }[] = [];
  const collect = (b: LcdBox, ox: number) => {
    const bx = ox + b.x;
    if (b.path && b.path.length === prefix.length + 1 && b.path.slice(0, -1).every((v, k) => v === prefix[k])) {
      nodes.push({ i: b.path[b.path.length - 1], x0: bx, x1: bx + b.w });
      return;
    }
    if (b.path && b.path.length % 2 === 0 && b !== hit.row) return;
    for (const c of b.children) collect(c, bx);
  };
  for (const c of hit.row.children) collect(c, hit.ox);
  if (nodes.length === 0) return [...prefix, 0];
  nodes.sort((a, b) => a.x0 - b.x0);
  for (const n of nodes) if (x < (n.x0 + n.x1) / 2) return [...prefix, n.i];
  return [...prefix, nodes[nodes.length - 1].i + 1];
}

// ===== the display model

export type DisplayView = 'calc' | 'menu' | 'error' | 'message' | 'prompt' | 'screen';

export interface KeyDisplayModel extends DisplayModel {
  view: DisplayView;
  /** Line above the input (menu question, screen title such as 'MatA', 'f(X)=', 'X?'). */
  title?: string;
  /** Extra lines: error hints, menu prompt, SOLVE 'X=' and 'L−R=', Pol/Rec r= θ=, INEQ text. */
  lines?: string[];
  /** Column headers and row labels of grid. */
  header?: string[];
  rowLabels?: string[];
  /** Selected grid cell (mode screens). */
  selected?: { row: number; col: number };
  /** Menu and result screens: more above or below (▲ ▼ indicators). */
  more?: { up: boolean; down: boolean };
  /** Menu items with long names (CONST, CONV), in grid order. */
  hints?: ({ ar: string; en: string } | null)[];
  /** LCD contrast 1..9 (SETUP ◀CONT▶). */
  contrast: number;
}

const ANGLE_FLAG = { Deg: 'D', Rad: 'R', Gra: 'G' } as const;
const RADIX_FLAG = { 10: 'Dec', 16: 'Hex', 2: 'Bin', 8: 'Oct' } as const;

/** The status line indicators, in LCD order. */
export function statusFlags(s: KeyState): string[] {
  const ctx = s.ctx;
  const out: string[] = [];
  if (s.shift) out.push('S');
  if (s.alpha || s.pending) out.push('A');
  const m = ctx.vars.M;
  if ((m.t === 'real' && m.x !== 0) || (m.t === 'cplx' && (m.re !== 0 || m.im !== 0)) || (m.t === 'base' && m.n !== 0)) out.push('M');
  if (s.pending === 'sto') out.push('STO');
  if (s.pending === 'rcl') out.push('RCL');
  if (ctx.mode === 'STAT') out.push('STAT');
  if (ctx.mode === 'CMPLX') out.push('CMPLX');
  if (ctx.mode === 'MATRIX') out.push('MAT');
  if (ctx.mode === 'VECTOR') out.push('VCT');
  out.push(ANGLE_FLAG[ctx.setup.angle]);
  if (ctx.setup.disp.mode === 'Fix') out.push('FIX');
  if (ctx.setup.disp.mode === 'Sci') out.push('SCI');
  if (ctx.setup.io === 'MthIO') out.push('Math');
  const pos = s.aux.histPos;
  const editingEmpty = !s.result && s.editor.row.length === 0;
  const canUp = s.history.length > 0 && (pos === null ? editingEmpty : pos > 0);
  const canDown = pos !== null && pos + 1 < s.history.length;
  if (s.menu.length === 0 && !s.screen && !s.error) {
    if (canDown) out.push('▼');
    if (canUp) out.push('▲');
  }
  if (ctx.mode === 'BASE-N') out.push(RADIX_FLAG[ctx.base]);
  return out;
}

const emptyInput = (): LcdBox => box('row', { w: 0, h: LCD_METRICS.normal.ascent + LCD_METRICS.normal.descent, baseline: LCD_METRICS.normal.ascent, path: [] });

function textInput(text: string): LcdBox {
  return hbox('row', [textBox(text, false)], false);
}

function appendText(row: LcdBox, text: string): LcdBox {
  const t = textBox(text, false);
  return hbox('row', [...row.children.map((c) => ({ ...c })), t], false, row.path);
}

function scrolled(input: LcdBox, cursor: { x: number; y: number; h: number } | undefined, width: number): { input: LcdBox; cursor?: { x: number; y: number; h: number } } {
  if (input.w <= width || !cursor) return { input, ...(cursor ? { cursor } : {}) };
  const margin = LCD_METRICS.normal.charW;
  let dx = 0;
  if (cursor.x > width - margin) dx = width - margin - cursor.x;
  dx = Math.max(dx, width - input.w);
  return { input: { ...input, x: input.x + dx }, cursor: { ...cursor, x: cursor.x + dx } };
}

/**
 * The LCD for a state. o.width (LCD units, default LCD_METRICS.width) scrolls a long input so the
 * caret stays visible.
 */
export function layoutDisplay(s0: MachineState, o: { width?: number } = {}): KeyDisplayModel {
  const s = asKeyState(s0);
  const ctx: CalcContext = s.ctx;
  const setup = ctx.setup;
  const width = o.width ?? LCD_METRICS.width;
  const status = statusFlags(s);
  const base = { status, contrast: setup.contrast, result: null };

  if (s.aux.message) {
    const [first, ...rest] = s.aux.message.lines;
    return { ...base, view: 'message', input: textInput(first ?? ''), lines: rest };
  }
  if (s.error) {
    return { ...base, view: 'error', input: textInput(s.error.kind), lines: errorHint(s.error.kind) };
  }
  if (s.menu.length > 0) {
    const top = s.menu[s.menu.length - 1];
    const v = menuView(top, ctx);
    const grid: string[][] = [];
    const hints: ({ ar: string; en: string } | null)[] = [];
    for (let i = 0; i < v.items.length; i += v.columns) {
      const lineItems = v.items.slice(i, i + v.columns);
      grid.push(lineItems.map((it) => `${it.key}:${it.label}`));
      for (const it of lineItems) hints.push(it.hint ?? null);
    }
    const model: KeyDisplayModel = {
      ...base, view: 'menu', input: v.title ? textInput(v.title) : emptyInput(), grid,
      more: { up: v.page > 0, down: v.page + 1 < v.pages },
    };
    if (v.title) model.title = v.title;
    if (v.prompt) model.lines = [v.prompt];
    if (hints.some((h) => h !== null)) model.hints = hints;
    if (top.id === 'SETUP_CONT') model.lines = [...(model.lines ?? []), `${setup.contrast}`];
    return model;
  }
  if (s.prompt) {
    const entry = s.aux.entry;
    const cur = formatValue(ctx.vars[s.prompt.varName], setup, { base: ctx.base }).text;
    const input = entry ? layoutInput(entry.row, setup, entry.cursor) : layoutInput([], setup, [0]);
    const cursor = findCursor(input) ?? undefined;
    const sc = scrolled(input, cursor, width);
    return { ...base, view: 'prompt', title: `${s.prompt.varName}?`, lines: [cur], input: sc.input, ...(sc.cursor ? { cursor: sc.cursor } : {}) };
  }
  if (s.screen) {
    const v = screenView(s.screen, ctx);
    let input: LcdBox;
    let cursor: { x: number; y: number; h: number } | undefined;
    if (v.entry) {
      input = layoutInput(v.entry.row, setup, v.entry.cursor);
      cursor = findCursor(input) ?? undefined;
    } else {
      input = v.value !== undefined ? textInput(v.value) : emptyInput();
    }
    const sc = scrolled(input, cursor, width);
    const model: KeyDisplayModel = { ...base, view: 'screen', input: sc.input, ...(sc.cursor ? { cursor: sc.cursor } : {}) };
    if (v.title) model.title = v.title;
    if (v.header) model.header = v.header;
    if (v.rowLabels) model.rowLabels = v.rowLabels;
    if (v.grid) model.grid = v.grid;
    if (v.selected) model.selected = v.selected;
    if (v.lines) model.lines = v.lines;
    if (v.more) model.more = v.more;
    if (v.result !== undefined) model.result = { text: v.result, align: 'end' };
    return model;
  }

  // The calculation screen.
  const showCursor = !s.result;
  const overwrite = !s.editor.insert && setup.io === 'LineIO';
  let input = layoutInput(s.editor.row, setup, showCursor ? s.editor.cursor : null, overwrite);
  if (s.result && s.aux.suffix) input = appendText(input, s.aux.suffix);
  const cursor = showCursor ? findCursor(input) ?? undefined : undefined;
  const sc = scrolled(input, cursor, width);
  const model: KeyDisplayModel = { ...base, view: 'calc', input: sc.input, ...(sc.cursor ? { cursor: sc.cursor } : {}) };
  if (s.result) {
    const d = s.result.display;
    const res: NonNullable<DisplayModel['result']> = { text: d.text, align: 'end' };
    if (d.math && setup.io === 'MthIO') res.exact = layoutMath(d.math, setup);
    model.result = res;
    if (d.lines) model.lines = d.lines.slice();
    if (d.grid) model.grid = d.grid.map((r) => r.slice());
  }
  return model;
}
