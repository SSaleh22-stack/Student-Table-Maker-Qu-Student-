import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { LCD_METRICS, layoutDisplay, layoutInput, layoutMath, pathAt, statusFlags } from '../../../../src/notebook/core/calc/keys/display.ts';
import { KEY_LABELS, KEY_LAYOUT, resolveKey, varOfKey, type KeyText } from '../../../../src/notebook/core/calc/keys/keymap.ts';
import { initialMachine, press, type KeyState } from '../../../../src/notebook/core/calc/keys/machine.ts';
import { defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import { parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import { KEY_IDS, type KeyId, type LcdBox } from '../../../../src/notebook/core/calc/types.ts';
import { installStubs, resetStubs, run } from './stubHooks.ts';

before(installStubs);
after(resetStubs);

/** All text of a layout in drawing order. */
function texts(b: LcdBox): string {
  return (b.kind === 'text' ? b.text ?? '' : '') + b.children.map(texts).join('');
}
function find(b: LcdBox, kind: LcdBox['kind']): LcdBox | null {
  if (b.kind === kind) return b;
  for (const c of b.children) {
    const r = find(c, kind);
    if (r) return r;
  }
  return null;
}

// The design file's key rows (design-options/notebook-figma-plugin/code.js ROWS_FN, ROWS_NUM and top block).
type K = { l: KeyText; g?: KeyText; p?: string; b?: string };
const ROWS_FN: K[][] = [
  [{ l: '#frac', g: '' }, { l: '#sqrt', g: '∛' }, { l: 'x²', g: 'x³', b: 'DEC' }, { l: '#xpow', g: 'ʸ√x', b: 'HEX' }, { l: 'log', g: ['10', 'x'], b: 'BIN' }, { l: 'ln', g: ['e', 'x'], b: 'OCT' }],
  [{ l: '(−)', g: '∠', p: 'A' }, { l: "° ' \"", g: '←', p: 'B' }, { l: 'hyp', g: 'Abs', p: 'C' }, { l: 'sin', g: ['sin', '−1'], p: 'D' }, { l: 'cos', g: ['cos', '−1'], p: 'E' }, { l: 'tan', g: ['tan', '−1'], p: 'F' }],
  [{ l: 'RCL', g: 'STO' }, { l: 'ENG', g: '←', p: 'i' }, { l: '(', g: '%' }, { l: ')', g: ',', p: 'X' }, { l: 'S⇔D', g: 'a b/c', p: 'Y' }, { l: 'M+', g: 'M−', p: 'M' }],
];
const ROWS_NUM: K[][] = [
  [{ l: '7', g: 'CONST' }, { l: '8', g: 'CONV' }, { l: '9', g: 'CLR' }, { l: 'DEL', g: 'INS' }, { l: 'AC', g: 'OFF' }],
  [{ l: '4', g: 'MATRIX' }, { l: '5', g: 'VECTOR' }, { l: '6' }, { l: '×', g: 'nPr' }, { l: '÷', g: 'nCr' }],
  [{ l: '1', g: 'STAT' }, { l: '2', g: 'CMPLX' }, { l: '3', g: 'BASE' }, { l: '+', g: 'Pol' }, { l: '−', g: 'Rec' }],
  [{ l: '0', g: 'Rnd' }, { l: '•', g: 'Ran#' }, { l: ['×10', 'x'], g: 'π', p: 'e' }, { l: 'Ans', g: 'DRG' }, { l: '=' }],
];
const TOP: K[] = [{ l: 'CALC', g: 'SOLVE', p: '=' }, { l: '#int', g: 'd/dx', p: ':' }, { l: ['x', '−1'], g: 'x!' }, { l: '#logb', g: 'Σ' }];

describe('keymap', () => {
  test('labels match the design rows exactly', () => {
    const check = (ids: readonly KeyId[], row: K[]) => {
      ids.forEach((id, i) => {
        const lab = KEY_LABELS[id];
        const k = row[i];
        assert.deepEqual(lab.face, k.l, `${id} face`);
        assert.deepEqual(lab.shift, k.g, `${id} shift`);
        assert.equal(lab.alpha, k.p, `${id} alpha`);
        assert.equal(lab.blue, k.b, `${id} blue`);
      });
    };
    KEY_LAYOUT.fnRows.forEach((ids, r) => check(ids, ROWS_FN[r]));
    KEY_LAYOUT.numRows.forEach((ids, r) => check(ids, ROWS_NUM[r]));
    check(KEY_LAYOUT.topKeys.map((t) => t.id), TOP);
    assert.deepEqual(KEY_LAYOUT.topRound.map((t) => KEY_LABELS[t.id].caption), ['SHIFT', 'ALPHA', 'MODE SETUP', 'ON']);
    assert.equal(KEY_LABELS.SHIFT.captionTone, 'gold');
    assert.equal(KEY_LABELS.ALPHA.captionTone, 'pink');
    assert.equal(KEY_LABELS.DEL.green && KEY_LABELS.AC.green, true);
  });

  test('every key id has a label and is placed exactly once', () => {
    const placed = [
      ...KEY_LAYOUT.topRound.map((t) => t.id), ...KEY_LAYOUT.topKeys.map((t) => t.id), ...Object.values(KEY_LAYOUT.pad),
      ...KEY_LAYOUT.fnRows.flat(), ...KEY_LAYOUT.numRows.flat(),
    ];
    assert.deepEqual([...placed].sort(), [...KEY_IDS].sort());
    for (const id of KEY_IDS) assert.equal(KEY_LABELS[id].id, id);
  });

  test('every printed shift and alpha label has a meaning', () => {
    for (const id of KEY_IDS) {
      const lab = KEY_LABELS[id];
      if (lab.shift !== undefined) assert.notEqual(resolveKey(id, { shift: true, alpha: false, mode: 'COMP' }).a, 'none', `${id} shift`);
      if (lab.alpha !== undefined) assert.notEqual(resolveKey(id, { shift: false, alpha: true, mode: 'COMP' }).a, 'none', `${id} alpha`);
      if (lab.blue !== undefined) assert.equal(resolveKey(id, { shift: false, alpha: false, mode: 'BASE-N' }).a, 'radix', `${id} blue`);
    }
    assert.equal(varOfKey('SD'), 'Y');
    assert.equal(varOfKey('D1'), null);
    assert.deepEqual(resolveKey('NEG', { shift: false, alpha: false, mode: 'BASE-N' }), { a: 'digit', d: 'A' });
  });
});

describe('layout', () => {
  test('a fraction stacks with a bar, the caret sits in the denominator', () => {
    const d = layoutDisplay(run('FRAC 1 DOWN 3'));
    const frac = find(d.input, 'frac');
    assert.ok(frac);
    assert.equal(frac?.children.length, 3);
    assert.equal(frac?.children[1].kind, 'bar');
    assert.ok((frac?.children[2].y ?? 0) > (frac?.children[1].y ?? 0));
    assert.ok(d.cursor && d.cursor.y > 10, 'caret below the bar');
    assert.equal(d.view, 'calc');
  });

  test('LineIO writes templates on one line', () => {
    const line = { ...defaultSetup(), io: 'LineIO' as const };
    assert.equal(texts(layoutMath(parseLinear('frac{2}{3}+sqrt{2}'), line)), '2⌟3+√(2)');
    assert.equal(texts(layoutMath(parseLinear('int{X}{0}{1}'), line)), '∫(X,0,1)');
    assert.equal(texts(layoutMath(parseLinear('2pow{3}'), line)), '2^(3)');
    assert.equal(texts(layoutMath(parseLinear('2ᴇ3'), line)), '2ᴇ3');
  });

  test('MthIO draws √, powers, |x|, log base, ∫ and Σ boxes', () => {
    const s = defaultSetup();
    assert.ok(find(layoutMath(parseLinear('sqrt{2}'), s), 'sqrt'));
    assert.ok(find(layoutMath(parseLinear('cbrt{8}'), s), 'root'));
    assert.ok(find(layoutMath(parseLinear('2pow{3}'), s), 'sup'));
    assert.ok(find(layoutMath(parseLinear('abs{~2}'), s), 'abs'));
    assert.ok(find(layoutMath(parseLinear('logb{2}{8}'), s), 'logb'));
    const integral = find(layoutMath(parseLinear('int{X}{0}{1}'), s), 'integral');
    assert.ok(integral);
    assert.equal(texts(integral as LcdBox), '1∫0Xdx');
    assert.ok(find(layoutMath(parseLinear('sum{X}{1}{5}'), s), 'sum'));
    assert.ok(find(layoutMath(parseLinear('deriv{X}{2}'), s), 'deriv'));
    // a power's exponent is small and raised
    const sup = find(layoutMath(parseLinear('2pow{3}'), s), 'sup');
    assert.equal(sup?.children[0].children[0].small, true);
  });

  test('×10ˣ raises the exponent and keeps the caret in it', () => {
    const d = layoutDisplay(run('2 EXP NEG 3'));
    const sup = find(d.input, 'sup');
    assert.ok(sup);
    assert.equal(texts(sup as LcdBox), '−3');
    assert.ok(find(sup as LcdBox, 'cursor'));
  });

  test('empty slots show placeholder boxes', () => {
    const b = layoutInput(parseLinear('frac{}{}'), defaultSetup(), [0, 0, 0]);
    const frac = find(b, 'frac');
    assert.equal(frac?.children[0].kind, 'slot');
    assert.equal(frac?.children[2].kind, 'slot');
    assert.ok(find(frac?.children[0] as LcdBox, 'cursor'));
  });

  test('results: decimal text, exact form box in MthIO, Pol lines', () => {
    const d = layoutDisplay(run('SQRT 8 EQ'));
    assert.equal(d.result?.text, '2√2');
    assert.equal(d.result?.align, 'end');
    assert.ok(d.result?.exact && find(d.result.exact, 'sqrt'));
    assert.equal(d.cursor, undefined, 'no caret on a result');
    const p = layoutDisplay(run('SHIFT ADD 1 SHIFT RPAR 1 RPAR EQ'));
    assert.deepEqual(p.lines, ['r=√2', 'θ=45']);
    const line = layoutDisplay(run('SHIFT MODE 2 1 DIV 3 EQ'));
    assert.equal(line.result?.exact, undefined);
  });

  test('STO and M+ show after the input', () => {
    assert.ok(texts(layoutDisplay(run('7 SHIFT RCL NEG')).input).endsWith('→A'));
    assert.ok(texts(layoutDisplay(run('7 MPLUS')).input).endsWith('M+'));
  });

  test('errors show the message and the hint lines', () => {
    const d = layoutDisplay(run('1 DIV 0 EQ'));
    assert.equal(d.view, 'error');
    assert.equal(texts(d.input), 'Math ERROR');
    assert.deepEqual(d.lines, ['[AC] :Cancel', '[◀][▶]:Goto']);
  });

  test('CALC prompt shows the variable and its value', () => {
    const d = layoutDisplay(run('7 SHIFT RCL RPAR ALPHA RPAR ADD 1 CALC'));
    assert.equal(d.view, 'prompt');
    assert.equal(d.title, 'X?');
    assert.deepEqual(d.lines, ['7']);
    assert.ok(d.cursor);
  });

  test('mode screens: matrix grid, STAT columns, EQN result, TABLE field', () => {
    const m = layoutDisplay(run('MODE 6 1 5 1 EQ 2'));
    assert.equal(m.view, 'screen');
    assert.equal(m.title, 'MatA');
    assert.deepEqual(m.grid, [['1', '0'], ['0', '0']]);
    assert.deepEqual(m.selected, { row: 0, col: 1 });
    assert.equal(texts(m.input), '2');
    const st = layoutDisplay(run('SHIFT MODE DOWN 4 1 MODE 3 2 1 EQ'));
    assert.deepEqual(st.header, ['X', 'Y', 'FREQ']);
    assert.deepEqual(st.grid, [['1', '0', '1'], ['', '', '']]);
    const e = layoutDisplay(run('MODE 5 1 1 EQ 1 EQ 3 EQ 1 EQ NEG 1 EQ 1 EQ EQ'));
    assert.equal(e.title, 'X=');
    assert.equal(e.result?.text, '2');
    assert.deepEqual(e.more, { up: false, down: true });
    const t = layoutDisplay(run('MODE 7 ALPHA RPAR'));
    assert.equal(t.title, 'f(X)=');
    assert.equal(texts(t.input), 'X');
  });

  test('status line', () => {
    assert.deepEqual(statusFlags(initialMachine()), ['D', 'Math']);
    assert.deepEqual(statusFlags(press(initialMachine(), 'SHIFT')), ['S', 'D', 'Math']);
    assert.deepEqual(statusFlags(run('RCL')), ['A', 'RCL', 'D', 'Math']);
    assert.deepEqual(statusFlags(run('3 MPLUS AC')), ['M', 'D', 'Math', '▲']);
    assert.deepEqual(statusFlags(run('MODE 2 SHIFT MODE 4 SHIFT MODE 6 2')), ['CMPLX', 'R', 'FIX', 'Math']);
    assert.deepEqual(statusFlags(run('MODE 4 POW')), ['D', 'Math', 'Hex']);
    assert.deepEqual(statusFlags(run('1 EQ 2 EQ UP')), ['D', 'Math', '▼']);
    assert.equal(layoutDisplay(run('SHIFT MODE DOWN 7 LEFT')).contrast, 4);
  });

  test('a long input scrolls to keep the caret visible', () => {
    let s: KeyState = initialMachine();
    for (let i = 0; i < 30; i++) s = press(s, 'D7');
    const d = layoutDisplay(s);
    assert.ok(d.input.w > LCD_METRICS.width);
    assert.ok(d.input.x < 0);
    assert.ok(d.cursor && d.cursor.x <= LCD_METRICS.width && d.cursor.x >= 0);
  });

  test('pathAt turns a tap into a caret path', () => {
    const b = layoutInput(parseLinear('12+frac{3}{4}'), defaultSetup(), null);
    assert.deepEqual(pathAt(b, 1, 20), [0]);
    assert.deepEqual(pathAt(b, 9, 20), [1]);
    const frac = find(b, 'frac') as LcdBox;
    const den = frac.children[2];
    const num = frac.children[0];
    assert.deepEqual(pathAt(b, frac.x + den.x + den.w - 1, frac.y + den.y + 5), [3, 1, 1]);
    assert.deepEqual(pathAt(b, frac.x + num.x + 1, frac.y + num.y + 5), [3, 0, 0]);
    assert.equal(pathAt(b, 500, 500), null);
  });
});
