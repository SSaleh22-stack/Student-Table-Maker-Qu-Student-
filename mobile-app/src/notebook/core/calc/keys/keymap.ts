/**
 * Calculator keymap (NB-47a): the printed labels of every key (exactly as in the design file's
 * ROWS_FN, ROWS_NUM and top block, plus the round SHIFT, ALPHA, MODE and ON keys) and what each key
 * means under SHIFT, ALPHA and in BASE-N (resolveKey).
 *
 * Faces that need drawn boxes use the design's codes: '#frac', '#sqrt', '#int', '#xpow', '#logb'.
 * A two-part label [base, raised] is drawn with the second part as a superscript (x⁻¹, 10ˣ, eˣ, ×10ˣ).
 * Colours are the caller's (P24): shift labels are gold, alpha labels pink, BASE-N labels blue.
 *
 * Unprinted extras (kept from the reference calculator): SHIFT on the fraction key gives the mixed
 * fraction (its printed gold label is empty in the design), ALPHA on '•' gives RanInt#( and, in
 * BASE-N, the (−) ° ' " hyp sin cos tan keys type the hex digits A to F without ALPHA.
 */
import type { CalcMode, Digit, FnName, KeyId, MathNode, MenuId, PostOp, Radix, VarName, BinOp, SymName } from '../types.ts';

// ===== labels

/** A label: plain text, or [base, superscript] drawn as one face. */
export type KeyText = string | readonly [string, string];

export interface KeyLabel {
  id: KeyId;
  /** Face printed on the key (codes starting with '#' are drawn faces). Round keys have none. */
  face: KeyText;
  /** Gold label above the key (SHIFT meaning). */
  shift?: KeyText;
  /** Pink label above the key (ALPHA meaning). */
  alpha?: KeyText;
  /** Blue label above the key (BASE-N meaning). */
  blue?: string;
  /** Text printed above a round key ('SHIFT', 'ALPHA', 'MODE SETUP', 'ON'). */
  caption?: string;
  /** Caption colour role for round keys. */
  captionTone?: 'gold' | 'pink' | 'plain';
  kind: 'round' | 'pad' | 'fn' | 'num';
  green?: boolean;
  small?: boolean;
}

const L = (id: KeyId, kind: KeyLabel['kind'], face: KeyText, o: Partial<Omit<KeyLabel, 'id' | 'kind' | 'face'>> = {}): KeyLabel => ({ id, kind, face, ...o });

/** Every key's printed labels, keyed by id. */
export const KEY_LABELS: Record<KeyId, KeyLabel> = {
  SHIFT: L('SHIFT', 'round', '', { caption: 'SHIFT', captionTone: 'gold' }),
  ALPHA: L('ALPHA', 'round', '', { caption: 'ALPHA', captionTone: 'pink' }),
  MODE: L('MODE', 'round', '', { caption: 'MODE SETUP', captionTone: 'plain' }),
  ON: L('ON', 'round', '', { caption: 'ON', captionTone: 'plain' }),
  UP: L('UP', 'pad', '▲'),
  DOWN: L('DOWN', 'pad', '▼'),
  LEFT: L('LEFT', 'pad', '◀'),
  RIGHT: L('RIGHT', 'pad', '▶'),
  CALC: L('CALC', 'fn', 'CALC', { shift: 'SOLVE', alpha: '=', small: true }),
  INTEG: L('INTEG', 'fn', '#int', { shift: 'd/dx', alpha: ':' }),
  INV: L('INV', 'fn', ['x', '−1'], { shift: 'x!' }),
  LOGB: L('LOGB', 'fn', '#logb', { shift: 'Σ' }),
  FRAC: L('FRAC', 'fn', '#frac', { shift: '' }),
  SQRT: L('SQRT', 'fn', '#sqrt', { shift: '∛' }),
  SQR: L('SQR', 'fn', 'x²', { shift: 'x³', blue: 'DEC' }),
  POW: L('POW', 'fn', '#xpow', { shift: 'ʸ√x', blue: 'HEX' }),
  LOG: L('LOG', 'fn', 'log', { shift: ['10', 'x'], blue: 'BIN' }),
  LN: L('LN', 'fn', 'ln', { shift: ['e', 'x'], blue: 'OCT' }),
  NEG: L('NEG', 'fn', '(−)', { shift: '∠', alpha: 'A' }),
  DMS: L('DMS', 'fn', "° ' \"", { shift: '←', alpha: 'B', small: true }),
  HYP: L('HYP', 'fn', 'hyp', { shift: 'Abs', alpha: 'C' }),
  SIN: L('SIN', 'fn', 'sin', { shift: ['sin', '−1'], alpha: 'D' }),
  COS: L('COS', 'fn', 'cos', { shift: ['cos', '−1'], alpha: 'E' }),
  TAN: L('TAN', 'fn', 'tan', { shift: ['tan', '−1'], alpha: 'F' }),
  RCL: L('RCL', 'fn', 'RCL', { shift: 'STO' }),
  ENG: L('ENG', 'fn', 'ENG', { shift: '←', alpha: 'i' }),
  LPAR: L('LPAR', 'fn', '(', { shift: '%' }),
  RPAR: L('RPAR', 'fn', ')', { shift: ',', alpha: 'X' }),
  SD: L('SD', 'fn', 'S⇔D', { shift: 'a b/c', alpha: 'Y', small: true }),
  MPLUS: L('MPLUS', 'fn', 'M+', { shift: 'M−', alpha: 'M' }),
  D7: L('D7', 'num', '7', { shift: 'CONST' }),
  D8: L('D8', 'num', '8', { shift: 'CONV' }),
  D9: L('D9', 'num', '9', { shift: 'CLR' }),
  DEL: L('DEL', 'num', 'DEL', { shift: 'INS', green: true, small: true }),
  AC: L('AC', 'num', 'AC', { shift: 'OFF', green: true, small: true }),
  D4: L('D4', 'num', '4', { shift: 'MATRIX' }),
  D5: L('D5', 'num', '5', { shift: 'VECTOR' }),
  D6: L('D6', 'num', '6'),
  MUL: L('MUL', 'num', '×', { shift: 'nPr' }),
  DIV: L('DIV', 'num', '÷', { shift: 'nCr' }),
  D1: L('D1', 'num', '1', { shift: 'STAT' }),
  D2: L('D2', 'num', '2', { shift: 'CMPLX' }),
  D3: L('D3', 'num', '3', { shift: 'BASE' }),
  ADD: L('ADD', 'num', '+', { shift: 'Pol' }),
  SUB: L('SUB', 'num', '−', { shift: 'Rec' }),
  D0: L('D0', 'num', '0', { shift: 'Rnd' }),
  DOT: L('DOT', 'num', '•', { shift: 'Ran#' }),
  EXP: L('EXP', 'num', ['×10', 'x'], { shift: 'π', alpha: 'e', small: true }),
  ANS: L('ANS', 'num', 'Ans', { shift: 'DRG', small: true }),
  EQ: L('EQ', 'num', '='),
};

/**
 * Key layout, as in the design: the top block (columns 0..5: SHIFT, ALPHA, replay pad over columns 2
 * and 3, MODE, ON; then CALC, ∫, x⁻¹, log□ under columns 0, 1, 4, 5), three function rows of six
 * keys and four number rows of five keys. Rows read left to right (the keypad is never mirrored).
 */
export const KEY_LAYOUT = {
  topRound: [
    { col: 0, id: 'SHIFT' },
    { col: 1, id: 'ALPHA' },
    { col: 4, id: 'MODE' },
    { col: 5, id: 'ON' },
  ] as readonly { col: number; id: KeyId }[],
  pad: { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' } as const,
  topKeys: [
    { col: 0, id: 'CALC' },
    { col: 1, id: 'INTEG' },
    { col: 4, id: 'INV' },
    { col: 5, id: 'LOGB' },
  ] as readonly { col: number; id: KeyId }[],
  fnRows: [
    ['FRAC', 'SQRT', 'SQR', 'POW', 'LOG', 'LN'],
    ['NEG', 'DMS', 'HYP', 'SIN', 'COS', 'TAN'],
    ['RCL', 'ENG', 'LPAR', 'RPAR', 'SD', 'MPLUS'],
  ] as readonly (readonly KeyId[])[],
  numRows: [
    ['D7', 'D8', 'D9', 'DEL', 'AC'],
    ['D4', 'D5', 'D6', 'MUL', 'DIV'],
    ['D1', 'D2', 'D3', 'ADD', 'SUB'],
    ['D0', 'DOT', 'EXP', 'ANS', 'EQ'],
  ] as readonly (readonly KeyId[])[],
};

// ===== meanings

export type TemplateName =
  | 'frac' | 'mixed' | 'sqrt' | 'cbrt' | 'pow' | 'root' | 'abs' | 'tenpow' | 'epow' | 'logb' | 'integral' | 'deriv' | 'sum';

export type KeyCommand =
  | 'up' | 'down' | 'left' | 'right' | 'eq' | 'del' | 'ins' | 'ac' | 'off' | 'on'
  | 'calc' | 'solve' | 'sd' | 'abc' | 'eng' | 'engBack' | 'dms' | 'dmsBack' | 'mplus' | 'mminus' | 'rcl' | 'sto';

/** What one key press means once SHIFT, ALPHA and the mode are applied. */
export type KeyAction =
  | { a: 'insert'; node: MathNode }
  | { a: 'template'; tpl: TemplateName }
  | { a: 'digit'; d: Digit }
  | { a: 'var'; name: VarName }
  | { a: 'radix'; base: Radix }
  | { a: 'menu'; id: MenuId }
  | { a: 'cmd'; cmd: KeyCommand }
  | { a: 'none' };

const node = (n: MathNode): KeyAction => ({ a: 'insert', node: n });
const tpl = (t: TemplateName): KeyAction => ({ a: 'template', tpl: t });
const cmd = (c: KeyCommand): KeyAction => ({ a: 'cmd', cmd: c });
const menu = (id: MenuId): KeyAction => ({ a: 'menu', id });
const fn = (name: FnName): KeyAction => node({ k: 'fn', name, args: [] });
const post = (op: PostOp | 'E'): KeyAction => node({ k: 'post', op });
const op = (o: BinOp): KeyAction => node({ k: 'op', op: o });
const sym = (name: SymName): KeyAction => node({ k: 'sym', name });
const digit = (d: Digit): KeyAction => ({ a: 'digit', d });
const v = (name: VarName): KeyAction => ({ a: 'var', name });

const MAIN: Partial<Record<KeyId, KeyAction>> = {
  UP: cmd('up'), DOWN: cmd('down'), LEFT: cmd('left'), RIGHT: cmd('right'),
  MODE: menu('MODE'), ON: cmd('on'),
  CALC: cmd('calc'), INTEG: tpl('integral'), INV: post('⁻¹'), LOGB: tpl('logb'),
  FRAC: tpl('frac'), SQRT: tpl('sqrt'), SQR: post('²'), POW: tpl('pow'), LOG: fn('log'), LN: fn('ln'),
  NEG: node({ k: 'neg' }), DMS: cmd('dms'), HYP: menu('HYP'), SIN: fn('sin'), COS: fn('cos'), TAN: fn('tan'),
  RCL: cmd('rcl'), ENG: cmd('eng'), LPAR: node({ k: 'lpar' }), RPAR: node({ k: 'rpar' }), SD: cmd('sd'), MPLUS: cmd('mplus'),
  D0: digit('0'), D1: digit('1'), D2: digit('2'), D3: digit('3'), D4: digit('4'),
  D5: digit('5'), D6: digit('6'), D7: digit('7'), D8: digit('8'), D9: digit('9'), DOT: digit('.'),
  EXP: post('E'), ANS: node({ k: 'ans' }), EQ: cmd('eq'), DEL: cmd('del'), AC: cmd('ac'),
  MUL: op('×'), DIV: op('÷'), ADD: op('+'), SUB: op('-'),
};

const SHIFTED: Partial<Record<KeyId, KeyAction>> = {
  MODE: menu('SETUP'), CALC: cmd('solve'), INTEG: tpl('deriv'), INV: post('!'), LOGB: tpl('sum'),
  FRAC: tpl('mixed'), SQRT: tpl('cbrt'), SQR: post('³'), POW: tpl('root'), LOG: tpl('tenpow'), LN: tpl('epow'),
  NEG: op('∠'), DMS: cmd('dmsBack'), HYP: tpl('abs'), SIN: fn('sin⁻¹'), COS: fn('cos⁻¹'), TAN: fn('tan⁻¹'),
  RCL: cmd('sto'), ENG: cmd('engBack'), LPAR: post('%'), RPAR: node({ k: 'comma' }), SD: cmd('abc'), MPLUS: cmd('mminus'),
  D7: menu('CONST'), D8: menu('CONV'), D9: menu('CLR'), DEL: cmd('ins'), AC: cmd('off'),
  D4: menu('MATRIX'), D5: menu('VECTOR'), MUL: op('nPr'), DIV: op('nCr'),
  D1: menu('STAT'), D2: menu('CMPLX'), D3: menu('BASE'), ADD: fn('Pol'), SUB: fn('Rec'),
  D0: fn('Rnd'), DOT: sym('Ran#'), EXP: sym('π'), ANS: menu('DRG'),
  UP: cmd('up'), DOWN: cmd('down'), LEFT: cmd('left'), RIGHT: cmd('right'), ON: cmd('on'),
};

const ALPHA: Partial<Record<KeyId, KeyAction>> = {
  CALC: node({ k: 'eq' }), INTEG: node({ k: 'colon' }),
  NEG: v('A'), DMS: v('B'), HYP: v('C'), SIN: v('D'), COS: v('E'), TAN: v('F'),
  ENG: sym('i'), RPAR: v('X'), SD: v('Y'), MPLUS: v('M'),
  EXP: sym('e'), DOT: fn('RanInt#'),
  UP: cmd('up'), DOWN: cmd('down'), LEFT: cmd('left'), RIGHT: cmd('right'), ON: cmd('on'), AC: cmd('ac'), DEL: cmd('del'),
};

/** BASE-N, no SHIFT or ALPHA: the blue radix keys and the hex digits. */
const BASE_N: Partial<Record<KeyId, KeyAction>> = {
  SQR: { a: 'radix', base: 10 }, POW: { a: 'radix', base: 16 }, LOG: { a: 'radix', base: 2 }, LN: { a: 'radix', base: 8 },
  NEG: digit('A'), DMS: digit('B'), HYP: digit('C'), SIN: digit('D'), COS: digit('E'), TAN: digit('F'),
};

/** The variable a key names after RCL or STO (the pink letters), or null. */
export function varOfKey(k: KeyId): VarName | null {
  const a = ALPHA[k];
  return a && a.a === 'var' ? a.name : null;
}

/**
 * The meaning of key k. SHIFT and ALPHA keys themselves are handled by the machine.
 * A key with no meaning under the active SHIFT or ALPHA gives { a: 'none' }.
 */
export function resolveKey(k: KeyId, o: { shift: boolean; alpha: boolean; mode: CalcMode }): KeyAction {
  if (o.alpha) return ALPHA[k] ?? { a: 'none' };
  if (o.shift) return SHIFTED[k] ?? { a: 'none' };
  if (o.mode === 'BASE-N') {
    const b = BASE_N[k];
    if (b) return b;
  }
  return MAIN[k] ?? { a: 'none' };
}
