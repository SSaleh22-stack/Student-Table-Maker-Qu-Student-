/**
 * Real-modes integration (P24): P19's key machine driven with P18's real ModeOps and ModeHooks,
 * wired exactly as the app wires them (installCalc). Every expected value was worked out by hand:
 * EQN, MATRIX, VECTOR, STAT (1-variable and regression), BASE-N logic, CONST, CONV, TABLE, RATIO,
 * INEQ, CMPLX and DRG. The persistence block checks the saved string the app writes
 * (encodeMachine / decodeMachine): memory, Ans with exact fractions (bigints), setup, matrices and
 * history survive a restart.
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { decodeMachine, encodeMachine, installCalc } from '../../../../src/notebook/calc/installCalc.ts';
import { getModeHooks, initialMachine, press, pressAll, type KeyState } from '../../../../src/notebook/core/calc/keys/machine.ts';
import { layoutDisplay } from '../../../../src/notebook/core/calc/keys/display.ts';
import { modeHooks } from '../../../../src/notebook/core/calc/modes/index.ts';
import type { MachineState } from '../../../../src/notebook/core/calc/types.ts';
import { answer, seq } from '../keys/stubHooks.ts';

before(() => {
  installCalc();
  installCalc(); // idempotent
});

const run = (text: string, s: MachineState = initialMachine()): KeyState => pressAll(s, seq(text));

/** What the LCD shows as the answer: an error, a calculation result, or a mode screen's result. */
function shown(s: KeyState): string {
  if (s.error) return s.error.kind;
  if (s.screen) {
    const d = layoutDisplay(s);
    if (d.result) return `${d.title ?? ''}${d.result.text}`;
    if (d.lines && !d.grid) return d.lines.join(', ');
    if (d.grid) return d.grid.map((r) => r.join(' ')).join(' | ');
    return '';
  }
  return answer(s);
}

// STAT data used by several rows: 1-VAR 2 4 4 4 5 5 7 9 (mean 5, σx 2, sx = √(32/7) = 4√14/7).
const STAT1 = 'MODE 3 1 2 EQ 4 EQ 4 EQ 4 EQ 5 EQ 5 EQ 7 EQ 9 EQ AC';
// A+BX data (1,3) (2,5) (3,7): y = 1 + 2x exactly.
const STAT_LIN = 'MODE 3 2 1 EQ 2 EQ 3 EQ UP UP UP RIGHT 3 EQ 5 EQ 7 EQ AC';
// MatA = [[1,2],[3,4]].
const MAT_A = 'MODE 6 1 5 1 EQ 2 EQ 3 EQ 4 EQ AC';

/** [key sequence, what the LCD shows]. */
const SEQUENCES: [string, string][] = [
  // EQN: polynomials and systems
  ['MODE 5 3 1 EQ NEG 3 EQ 2 EQ EQ', 'X1=2'],
  ['MODE 5 3 1 EQ NEG 3 EQ 2 EQ EQ DOWN', 'X2=1'],
  ['MODE 5 3 1 EQ 2 EQ 5 EQ EQ', 'X1=−1+2i'],
  ['MODE 5 3 1 EQ 2 EQ 5 EQ EQ DOWN', 'X2=−1−2i'],
  ['MODE 5 3 1 EQ 0 EQ NEG 2 EQ EQ', 'X1=√2'],
  ['MODE 5 1 1 EQ 1 EQ 3 EQ 1 EQ NEG 1 EQ 1 EQ EQ', 'X=2'],
  ['MODE 5 1 1 EQ 1 EQ 3 EQ 1 EQ NEG 1 EQ 1 EQ EQ DOWN', 'Y=1'],
  ['MODE 5 4 1 EQ NEG 6 EQ 11 EQ NEG 6 EQ EQ', 'X1=3'],
  ['MODE 5 4 1 EQ NEG 6 EQ 11 EQ NEG 6 EQ EQ DOWN DOWN', 'X3=1'],
  ['MODE 5 1 1 EQ 1 EQ 2 EQ 2 EQ 2 EQ 4 EQ EQ', 'Infinite Sol'],
  ['MODE 5 1 1 EQ 1 EQ 2 EQ 2 EQ 2 EQ 5 EQ EQ', 'No Solution'],
  // MATRIX
  [`${MAT_A} SHIFT 4 7 SHIFT 4 3 RPAR EQ`, '−2'],
  ['MODE 6 1 1 2 EQ 0 EQ 1 EQ 1 EQ 3 EQ 2 EQ 4 EQ 1 EQ 5 EQ AC SHIFT 4 7 SHIFT 4 3 RPAR EQ', '15'],
  [`${MAT_A} SHIFT 4 3 MUL SHIFT 4 3 EQ`, '7 10 | 15 22'],
  [`${MAT_A} SHIFT 4 3 INV EQ`, '−2 1 | 3/2 −1/2'],
  [`${MAT_A} SHIFT 4 8 SHIFT 4 3 RPAR EQ`, '1 3 | 2 4'],
  // VECTOR
  ['MODE 8 1 2 3 EQ 4 EQ AC SHIFT 5 1 2 2 1 EQ 2 EQ AC SHIFT 5 3 SHIFT 5 7 SHIFT 5 4 EQ', '11'],
  ['MODE 8 1 1 1 EQ 0 EQ 0 EQ AC SHIFT 5 1 2 1 0 EQ 1 EQ 0 EQ AC SHIFT 5 3 MUL SHIFT 5 4 EQ', '0 0 1'],
  ['MODE 8 1 2 3 EQ 4 EQ AC SHIFT HYP SHIFT 5 3 EQ', '5'],
  // STAT: 1-variable and regression
  [`${STAT1} SHIFT 1 4 1 EQ`, '8'],
  [`${STAT1} SHIFT 1 4 2 EQ`, '5'],
  [`${STAT1} SHIFT 1 4 3 EQ`, '2'],
  [`${STAT1} SHIFT 1 4 4 EQ`, '4√14/7'],
  ['MODE 3 1 1 EQ 2 EQ 3 EQ 4 EQ AC SHIFT 1 6 4 EQ', '5/2'],
  [`${STAT_LIN} SHIFT 1 5 1 EQ`, '1'],
  [`${STAT_LIN} SHIFT 1 5 2 EQ`, '2'],
  [`${STAT_LIN} SHIFT 1 5 3 EQ`, '1'],
  [`${STAT_LIN} 10 SHIFT 1 5 5 EQ`, '21'],
  [`${STAT_LIN} 11 SHIFT 1 5 4 EQ`, '5'],
  ['MODE 3 3 1 EQ 2 EQ 3 EQ UP UP UP RIGHT 1 EQ 4 EQ 9 EQ AC SHIFT 1 5 3 EQ', '1'],
  // BASE-N: logic, radix keys, prefixes
  ['MODE 4 12 SHIFT 3 1 10 EQ', '8'],
  ['MODE 4 12 SHIFT 3 2 10 EQ', '14'],
  ['MODE 4 12 SHIFT 3 4 10 EQ', '6'],
  ['MODE 4 12 SHIFT 3 3 10 EQ', '−7'],
  ['MODE 4 SHIFT 3 5 5 RPAR EQ', '−6'],
  ['MODE 4 SHIFT 3 6 5 RPAR EQ', '−5'],
  ['MODE 4 POW HYP ADD 1 EQ', '0000000D'],
  ['MODE 4 5 EQ LOG', '0000000000000101'],
  ['MODE 4 LOG 1010 ADD 11 EQ SQR', '13'],
  ['MODE 4 POW SHIFT 3 DOWN 1 1 0 ADD SHIFT 3 DOWN 2 HYP EQ', '00000016'],
  // CONST and CONV
  ['SHIFT 7 3 EQ', '9.109383702×10⁻³¹'],
  ['SHIFT 7 DOWN 1 EQ', '1.054571817×10⁻³⁴'],
  ['1 SHIFT 8 1 EQ', '127/50'],
  ['100 SHIFT 8 DOWN DOWN 5 EQ', '2834.952313'],
  ['212 SHIFT 8 DOWN DOWN DOWN DOWN 5 EQ', '100'],
  // TABLE
  ['MODE 7 ALPHA RPAR SQR EQ 1 EQ 3 EQ 1 EQ', '1 1 | 2 4 | 3 9'],
  ['MODE 7 ALPHA RPAR SQR EQ 0 EQ 1 EQ 0.5 EQ', '0 0 | 1/2 1/4 | 1 1'],
  // RATIO
  ['MODE DOWN 0 1 2 EQ 3 EQ 6 EQ EQ', 'X=4'],
  ['MODE DOWN 0 2 4 EQ 8 EQ 3 EQ EQ', 'X=6'],
  // INEQ
  ['MODE 9 1 1 1 EQ NEG 4 EQ 3 EQ EQ', 'x<1, 3<x'],
  ['MODE 9 1 2 1 EQ NEG 4 EQ 3 EQ EQ', '1<x<3'],
  // CMPLX
  ['MODE 2 LPAR 1 ADD 2 ALPHA ENG RPAR LPAR 3 SUB ALPHA ENG RPAR EQ', '5+5i'],
  ['MODE 2 SHIFT 2 2 3 ADD 4 ALPHA ENG RPAR EQ', '3−4i'],
  // DRG
  ['SHIFT MODE 4 180 SHIFT ANS 1 EQ', 'π'],
];

describe('real modes: key sequences', () => {
  test('at least 30 sequences', () => {
    assert.ok(SEQUENCES.length >= 30, `only ${SEQUENCES.length} sequences`);
  });
  for (const [keys, expected] of SEQUENCES) {
    test(keys, () => {
      assert.equal(shown(run(keys)), expected);
    });
  }
});

describe('real modes: wiring and screens', () => {
  test('installCalc registers P18 modeHooks with the key machine', () => {
    assert.equal(getModeHooks(), modeHooks);
  });

  test('EQN roots keep their exact forms on the result screen', () => {
    const s = run('MODE 5 3 2 EQ NEG 1 EQ 0 EQ EQ DOWN');
    assert.equal(s.screen?.kind, 'eqn-result');
    if (s.screen?.kind === 'eqn-result') {
      const xs = s.screen.roots.map((r) => (r.t === 'real' ? r.x : NaN));
      assert.deepEqual(xs, [0.5, 0]);
    }
    assert.equal(shown(run('MODE 5 3 2 EQ NEG 1 EQ 0 EQ EQ')), 'X1=1/2');
  });

  test('MATRIX: the determinant also works as an expression with Ans', () => {
    const s = run(`${MAT_A} SHIFT 4 7 SHIFT 4 3 RPAR EQ MUL 3 EQ`);
    assert.equal(answer(s), '−6');
  });

  test('STAT: changing the type clears the data', () => {
    const s = run(`${STAT1} SHIFT 1 1 2`);
    assert.deepEqual(s.ctx.stat, { kind: 'A+BX', x: [], y: [], freq: [] });
  });

  test('CONST menu shows the real symbols with Arabic and English names', () => {
    const d = layoutDisplay(run('SHIFT 7'));
    assert.equal(d.view, 'menu');
    assert.equal(d.grid?.[0]?.[0], '1:mp');
    assert.deepEqual(d.hints?.[0], { ar: 'كتلة البروتون', en: 'proton mass' });
  });

  test('CONV menu labels and a typed conversion node', () => {
    const d = layoutDisplay(run('SHIFT 8'));
    assert.equal(d.grid?.[0]?.[0], '1:in▶cm');
    const s = run('5 SHIFT 8 2');
    assert.deepEqual(s.editor.row[s.editor.row.length - 1], { k: 'conv', index: 2 });
    assert.equal(answer(press(s, 'EQ')), '250/127');
  });

  test('TABLE: a step that walks away from End is Math ERROR', () => {
    const s = run('MODE 7 ALPHA RPAR EQ 1 EQ 3 EQ NEG 1 EQ');
    assert.equal(s.error?.kind, 'Math ERROR');
  });

  test('RATIO: a zero divisor is Math ERROR', () => {
    const s = run('MODE DOWN 0 1 2 EQ 0 EQ 6 EQ EQ');
    assert.equal(s.error?.kind, 'Math ERROR');
  });

  test('BASE-N: the status line shows the radix', () => {
    assert.ok(layoutDisplay(run('MODE 4 POW')).status.includes('Hex'));
    assert.ok(layoutDisplay(run('MODE 4 LN')).status.includes('Oct'));
  });
});

describe('real modes: persistence (the saved string)', () => {
  test('memory, Ans with an exact fraction, setup and history survive a restart', () => {
    let s = run('1 DIV 3 EQ SHIFT RCL NEG');
    s = run('5 MPLUS 2 MPLUS', s);
    s = run('1 DIV 7 EQ', s);
    s = run('SHIFT MODE 4', s);
    const saved = encodeMachine(s);
    assert.equal(typeof saved, 'string');
    const { machine, unreadable } = decodeMachine(saved);
    assert.equal(unreadable, false);
    assert.equal(machine.setup.angle, 'Rad');
    assert.equal(machine.ctx.setup.angle, 'Rad');
    assert.deepEqual(machine.history, s.history);
    assert.equal(answer(run('ANS EQ', machine)), '1/7');
    assert.equal(answer(run('ALPHA NEG EQ', machine)), '1/3');
    assert.equal(answer(run('ALPHA MPLUS EQ', machine)), '7');
    assert.deepEqual(machine.ctx.ans, s.ctx.ans);
  });

  test('a fraction with a large denominator keeps its bigints', () => {
    const s = run('1 DIV 3 POW 33 EQ');
    assert.equal(s.ctx.ans.t, 'real');
    const text = encodeMachine(s);
    assert.ok(!text.includes('Infinity'));
    const back = decodeMachine(text).machine;
    assert.deepEqual(back.ctx.ans, s.ctx.ans);
    assert.equal(answer(run('ANS EQ', back)), answer(run('ANS EQ', s)));
  });

  test('matrices, vectors and STAT data persist; the mode opens at its home', () => {
    const m = decodeMachine(encodeMachine(run(MAT_A))).machine;
    assert.equal(m.mode, 'MATRIX');
    assert.deepEqual(m.ctx.mats.A?.m, [[1, 2], [3, 4]]);
    assert.equal(answer(run('SHIFT 4 7 SHIFT 4 3 RPAR EQ', m)), '−2');
    const st = decodeMachine(encodeMachine(run(STAT1))).machine;
    assert.deepEqual(st.ctx.stat.x, [2, 4, 4, 4, 5, 5, 7, 9]);
    assert.equal(answer(run('SHIFT 1 4 2 EQ', st)), '5');
    const eq = decodeMachine(encodeMachine(run('MODE 5'))).machine;
    assert.equal(eq.mode, 'EQN');
    assert.equal(eq.menu[0]?.id, 'EQN_TYPE');
    const b = decodeMachine(encodeMachine(run('MODE 4 POW'))).machine;
    assert.equal(b.mode, 'BASE-N');
    assert.equal(b.ctx.base, 16);
  });

  test('nothing saved, garbage and foreign data give a fresh machine', () => {
    assert.deepEqual(decodeMachine(null), { machine: initialMachine(), unreadable: false });
    const bad = decodeMachine('{not json');
    assert.equal(bad.unreadable, true);
    assert.equal(bad.machine.mode, 'COMP');
    assert.equal(decodeMachine('{"v":2}').unreadable, true);
    assert.equal(decodeMachine('[1,2]').unreadable, true);
    const partial = decodeMachine('{"v":1,"mode":"STAT","history":"x"}');
    assert.equal(partial.unreadable, false);
    assert.equal(partial.machine.mode, 'STAT');
    assert.deepEqual(partial.machine.history, []);
  });

  test('saving is stable: decode then encode gives the same string', () => {
    const s = run('1 DIV 3 EQ SHIFT RCL NEG 2 MPLUS SHIFT MODE 2');
    const a = encodeMachine(s);
    const b = encodeMachine(decodeMachine(a).machine);
    assert.equal(b, a);
  });
});
