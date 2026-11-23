/**
 * The input editor: a MathRow with a cursor path, edited by key actions.
 *
 * Cursor paths: [i] is the caret before index i of the top row (0..row.length). Inside a template the
 * path continues with the template's index and slot: [n, s, i] is the caret before index i of slot s
 * of the template at top index n, and so on for deeper levels. So a path of odd length is a caret,
 * a prefix of even length names a row ([] is the top row).
 *
 * Templates and their slot order (also the cursor order): frac (num, den), mixed (whole, num, den),
 * pow (exp), root (index, radicand), logb (base, arg), integral (f, a, b), deriv (f, at),
 * sum (f, a, b), fn with args filled (√, ∛, Abs, 10^, e^: one slot each).
 * Every function is pure: it returns a new state and never changes its input.
 */
import type { CellEntry, MathNode, MathRow } from '../types.ts';
import type { KeyAction, TemplateName } from './keymap.ts';

export interface EditorState {
  row: MathRow;
  cursor: number[];
  /** true = insert mode, false = overwrite (LineIO only, toggled by INS). */
  insert: boolean;
}

/** Most nodes one input may hold (the reference stops accepting keys near 99 bytes). */
export const MAX_NODES = 200;

export function emptyEditor(): EditorState {
  return { row: [], cursor: [0], insert: true };
}

export function emptyEntry(): CellEntry {
  return { row: [], cursor: [0] };
}

/** The slots of a template node, in cursor order, or null for a flat token. */
export function slotsOf(n: MathNode): MathRow[] | null {
  switch (n.k) {
    case 'frac': return [n.num, n.den];
    case 'mixed': return [n.whole, n.num, n.den];
    case 'pow': return [n.exp];
    case 'root': return [n.index, n.radicand];
    case 'logb': return [n.base, n.arg];
    case 'integral': return [n.f, n.a, n.b];
    case 'deriv': return [n.f, n.at];
    case 'sum': return [n.f, n.a, n.b];
    case 'fn': return n.args.length > 0 ? n.args : null;
    default: return null;
  }
}

export function isTemplate(n: MathNode): boolean {
  return slotsOf(n) !== null;
}

/** The same template with new slot rows. */
export function withSlots(n: MathNode, s: MathRow[]): MathNode {
  switch (n.k) {
    case 'frac': return { k: 'frac', num: s[0], den: s[1] };
    case 'mixed': return { k: 'mixed', whole: s[0], num: s[1], den: s[2] };
    case 'pow': return { k: 'pow', exp: s[0] };
    case 'root': return { k: 'root', index: s[0], radicand: s[1] };
    case 'logb': return { k: 'logb', base: s[0], arg: s[1] };
    case 'integral': return { k: 'integral', f: s[0], a: s[1], b: s[2] };
    case 'deriv': return { k: 'deriv', f: s[0], at: s[1] };
    case 'sum': return { k: 'sum', f: s[0], a: s[1], b: s[2] };
    case 'fn': return { k: 'fn', name: n.name, args: s };
    default: return n;
  }
}

/** A new, empty template. */
export function makeTemplate(t: TemplateName): MathNode {
  switch (t) {
    case 'frac': return { k: 'frac', num: [], den: [] };
    case 'mixed': return { k: 'mixed', whole: [], num: [], den: [] };
    case 'sqrt': return { k: 'fn', name: '√', args: [[]] };
    case 'cbrt': return { k: 'fn', name: '∛', args: [[]] };
    case 'abs': return { k: 'fn', name: 'Abs', args: [[]] };
    case 'tenpow': return { k: 'fn', name: '10^', args: [[]] };
    case 'epow': return { k: 'fn', name: 'e^', args: [[]] };
    case 'pow': return { k: 'pow', exp: [] };
    case 'root': return { k: 'root', index: [], radicand: [] };
    case 'logb': return { k: 'logb', base: [], arg: [] };
    case 'integral': return { k: 'integral', f: [], a: [], b: [] };
    case 'deriv': return { k: 'deriv', f: [], at: [] };
    case 'sum': return { k: 'sum', f: [], a: [], b: [] };
  }
}

/** The row named by an even-length prefix ([] is the top row). Invalid prefixes give []. */
export function rowAt(row: MathRow, prefix: readonly number[]): MathRow {
  let r = row;
  for (let i = 0; i + 1 < prefix.length; i += 2) {
    const n = r[prefix[i]];
    const slots = n ? slotsOf(n) : null;
    if (!slots || !slots[prefix[i + 1]]) return [];
    r = slots[prefix[i + 1]];
  }
  return r;
}

/** row with the row at prefix replaced (copying only the nodes on the way down). */
export function replaceRowAt(row: MathRow, prefix: readonly number[], next: MathRow): MathRow {
  if (prefix.length < 2) return next;
  const [ni, si] = prefix;
  const n = row[ni];
  const slots = n ? slotsOf(n) : null;
  if (!slots || !slots[si]) return row;
  const newSlots = slots.slice();
  newSlots[si] = replaceRowAt(slots[si], prefix.slice(2), next);
  const out = row.slice();
  out[ni] = withSlots(n, newSlots);
  return out;
}

export function countNodes(row: MathRow): number {
  let c = 0;
  for (const n of row) {
    c++;
    const slots = slotsOf(n);
    if (slots) for (const s of slots) c += countNodes(s);
  }
  return c;
}

/** True when the cursor path names a caret in row. */
export function validCursor(row: MathRow, cursor: readonly number[]): boolean {
  if (cursor.length % 2 !== 1) return false;
  let r = row;
  for (let i = 0; i + 1 < cursor.length; i += 2) {
    const n = r[cursor[i]];
    const slots = n ? slotsOf(n) : null;
    if (!slots || !slots[cursor[i + 1]]) return false;
    r = slots[cursor[i + 1]];
  }
  const last = cursor[cursor.length - 1];
  return Number.isInteger(last) && last >= 0 && last <= r.length;
}

function split(cursor: readonly number[]): { prefix: number[]; i: number } {
  return { prefix: cursor.slice(0, -1), i: cursor[cursor.length - 1] };
}

function safe(ed: EditorState): EditorState {
  return validCursor(ed.row, ed.cursor) ? ed : { ...ed, cursor: [ed.row.length] };
}

export function isEmpty(ed: { row: MathRow }): boolean {
  return ed.row.length === 0;
}

/**
 * Inserts nodes at the cursor. Insert mode puts them before the caret; overwrite mode replaces the
 * flat node under the caret by a single flat node. When the last node is a template, the caret goes
 * into its first slot. Input that would pass MAX_NODES is refused (state unchanged).
 */
export function insertNodes<T extends { row: MathRow; cursor: number[] }>(ed0: T, nodes: MathNode[], overwrite: boolean = false): T {
  const ed = validCursor(ed0.row, ed0.cursor) ? ed0 : { ...ed0, cursor: [ed0.row.length] };
  if (nodes.length === 0) return ed;
  let added = 0;
  for (const n of nodes) added += countNodes([n]);
  const { prefix, i } = split(ed.cursor);
  const r = rowAt(ed.row, prefix);
  const replace = overwrite && nodes.length === 1 && !isTemplate(nodes[0]) && i < r.length && !isTemplate(r[i]);
  if (countNodes(ed.row) + added - (replace ? 1 : 0) > MAX_NODES) return ed;
  const nr = replace ? [...r.slice(0, i), nodes[0], ...r.slice(i + 1)] : [...r.slice(0, i), ...nodes, ...r.slice(i)];
  const row = replaceRowAt(ed.row, prefix, nr);
  const last = nodes[nodes.length - 1];
  const lastIndex = i + nodes.length - 1;
  const cursor = isTemplate(last) ? [...prefix, lastIndex, 0, 0] : [...prefix, i + nodes.length];
  return { ...ed, row, cursor };
}

/** Caret one step right (into templates, through slots, wrapping at the end of the top row). */
export function moveRight<T extends { row: MathRow; cursor: number[] }>(ed: T): T {
  const s = validCursor(ed.row, ed.cursor) ? ed : { ...ed, cursor: [ed.row.length] };
  const { prefix, i } = split(s.cursor);
  const r = rowAt(s.row, prefix);
  if (i < r.length) {
    const slots = slotsOf(r[i]);
    if (slots) return { ...s, cursor: [...prefix, i, 0, 0] };
    return { ...s, cursor: [...prefix, i + 1] };
  }
  if (prefix.length === 0) return { ...s, cursor: [0] };
  const pp = prefix.slice(0, -2);
  const ni = prefix[prefix.length - 2];
  const si = prefix[prefix.length - 1];
  const parent = rowAt(s.row, pp)[ni];
  const slots = slotsOf(parent) ?? [];
  if (si + 1 < slots.length) return { ...s, cursor: [...pp, ni, si + 1, 0] };
  return { ...s, cursor: [...pp, ni + 1] };
}

/** Caret one step left (into templates from the right, wrapping at the start of the top row). */
export function moveLeft<T extends { row: MathRow; cursor: number[] }>(ed: T): T {
  const s = validCursor(ed.row, ed.cursor) ? ed : { ...ed, cursor: [ed.row.length] };
  const { prefix, i } = split(s.cursor);
  const r = rowAt(s.row, prefix);
  if (i > 0) {
    const slots = slotsOf(r[i - 1]);
    if (slots) {
      const last = slots.length - 1;
      return { ...s, cursor: [...prefix, i - 1, last, slots[last].length] };
    }
    return { ...s, cursor: [...prefix, i - 1] };
  }
  if (prefix.length === 0) return { ...s, cursor: [r.length] };
  const pp = prefix.slice(0, -2);
  const ni = prefix[prefix.length - 2];
  const si = prefix[prefix.length - 1];
  if (si > 0) {
    const slots = slotsOf(rowAt(s.row, pp)[ni]) ?? [];
    return { ...s, cursor: [...pp, ni, si - 1, slots[si - 1]?.length ?? 0] };
  }
  return { ...s, cursor: [...pp, ni] };
}

/** Vertical neighbours of template slots: slot -> { up, down } slot index. */
const VERT: Partial<Record<MathNode['k'], Record<number, { up?: number; down?: number }>>> = {
  frac: { 0: { down: 1 }, 1: { up: 0 } },
  mixed: { 1: { down: 2 }, 2: { up: 1 } },
  integral: { 0: { up: 2, down: 1 }, 1: { up: 0 }, 2: { down: 0 } },
  sum: { 0: { up: 2, down: 1 }, 1: { up: 0 }, 2: { down: 0 } },
};

/** Caret up or down between stacked slots (fraction parts, limits), or null when there is none. */
export function moveVertical<T extends { row: MathRow; cursor: number[] }>(ed: T, dir: 'up' | 'down'): T | null {
  if (!validCursor(ed.row, ed.cursor)) return null;
  const c = ed.cursor;
  for (let level = c.length - 3; level >= 0; level -= 2) {
    const pp = c.slice(0, level);
    const ni = c[level];
    const si = c[level + 1];
    const n = rowAt(ed.row, pp)[ni];
    const target = VERT[n.k]?.[si]?.[dir];
    if (target !== undefined) {
      const slots = slotsOf(n) ?? [];
      const len = slots[target]?.length ?? 0;
      const inner = c[level + 2];
      const at = level + 3 === c.length ? Math.min(inner, len) : len;
      return { ...ed, cursor: [...pp, ni, target, at] };
    }
  }
  return null;
}

/**
 * DEL. Insert mode: deletes the node before the caret. A template before the caret is entered (caret
 * to the end of its last slot) unless all its slots are empty, then it is deleted. At the start of a
 * slot, the template is unwrapped when its other slots are empty (its contents stay), else the caret
 * moves left. Overwrite mode deletes the flat node under the caret.
 */
export function deleteAt<T extends { row: MathRow; cursor: number[] }>(ed0: T, overwrite: boolean = false): T {
  const ed = validCursor(ed0.row, ed0.cursor) ? ed0 : { ...ed0, cursor: [ed0.row.length] };
  const { prefix, i } = split(ed.cursor);
  const r = rowAt(ed.row, prefix);
  if (overwrite && i < r.length && !isTemplate(r[i])) {
    return { ...ed, row: replaceRowAt(ed.row, prefix, [...r.slice(0, i), ...r.slice(i + 1)]) };
  }
  if (i > 0) {
    const prev = r[i - 1];
    const slots = slotsOf(prev);
    if (slots && slots.some((s) => s.length > 0)) return moveLeft(ed);
    return { ...ed, row: replaceRowAt(ed.row, prefix, [...r.slice(0, i - 1), ...r.slice(i)]), cursor: [...prefix, i - 1] };
  }
  if (prefix.length === 0) return ed;
  const pp = prefix.slice(0, -2);
  const ni = prefix[prefix.length - 2];
  const si = prefix[prefix.length - 1];
  const pr = rowAt(ed.row, pp);
  const slots = slotsOf(pr[ni]) ?? [];
  if (slots.every((s, k) => k === si || s.length === 0)) {
    const nr = [...pr.slice(0, ni), ...slots[si], ...pr.slice(ni + 1)];
    return { ...ed, row: replaceRowAt(ed.row, pp, nr), cursor: [...pp, ni] };
  }
  return moveLeft(ed);
}

export function toEnd<T extends { row: MathRow; cursor: number[] }>(ed: T): T {
  return { ...ed, cursor: [ed.row.length] };
}

export function toStart<T extends { row: MathRow; cursor: number[] }>(ed: T): T {
  return { ...ed, cursor: [0] };
}

/** Caret before top-level index at (the error position of evaluate). */
export function cursorTo<T extends { row: MathRow; cursor: number[] }>(ed: T, at: number): T {
  return { ...ed, cursor: [Math.max(0, Math.min(at, ed.row.length))] };
}

/** Plain-data clone of a row (rows are immutable here, but callers persisting them may want a copy). */
export function cloneRow(row: MathRow): MathRow {
  return row.map((n) => {
    const slots = slotsOf(n);
    return slots ? withSlots(n, slots.map(cloneRow)) : { ...n };
  });
}

/** Structural equality of two rows. */
export function rowsEqual(a: MathRow, b: MathRow): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export { safe as normalizeCursor };

/** The nodes an input key action types, or null when the action is not an input. */
export function actionNodes(act: KeyAction): MathNode[] | null {
  switch (act.a) {
    case 'insert': return [act.node];
    case 'template': return [makeTemplate(act.tpl)];
    case 'digit': return [{ k: 'digit', d: act.d }];
    case 'var': return [{ k: 'var', name: act.name }];
    default: return null;
  }
}

