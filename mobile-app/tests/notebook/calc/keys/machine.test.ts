import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { initialMachine, press, pressAll, type KeyState } from '../../../../src/notebook/core/calc/keys/machine.ts';
import { HISTORY_MAX } from '../../../../src/notebook/core/calc/keys/history.ts';
import { screenKey, screenView, statMaxRows } from '../../../../src/notebook/core/calc/keys/modeScreens.ts';
import { createContext } from '../../../../src/notebook/core/calc/context.ts';
import { real } from '../../../../src/notebook/core/calc/num/value.ts';
import type { MachineState, ModeScreen } from '../../../../src/notebook/core/calc/types.ts';
import { answer, installStubs, resetStubs, run, seq } from './stubHooks.ts';

before(installStubs);
after(resetStubs);

/** [key sequence, LCD answer] — each row is one key sequence from a fresh machine. */
const SEQUENCES: [string, string][] = [
  // arithmetic and precedence
  ['1 ADD 2 EQ', '3'],
  ['2 MUL 3 ADD 4 EQ', '10'],
  ['2 ADD 3 MUL 4 EQ', '14'],
  ['LPAR 2 ADD 3 RPAR MUL 4 EQ', '20'],
  ['NEG 5 ADD 2 EQ', '−3'],
  ['7 SUB 10 EQ', '−3'],
  ['1 ALPHA INTEG 2 ADD 3 EQ', '5'],
  // natural display and S⇔D
  ['FRAC 1 DOWN 3 RIGHT ADD FRAC 1 DOWN 6 EQ', '1/2'],
  ['FRAC 1 DOWN 3 RIGHT ADD FRAC 1 DOWN 6 EQ SD', '0.5'],
  ['FRAC 1 DOWN 3 RIGHT ADD FRAC 1 DOWN 6 EQ SD SD', '1/2'],
  ['SQRT 8 EQ', '2√2'],
  ['SQRT 8 EQ SD', '2.828427125'],
  ['0.5 EQ', '1/2'],
  ['1 DIV 3 SD', '0.3333333333'],
  ['SHIFT FRAC 1 RIGHT 1 RIGHT 2 EQ', '3/2'],
  ['SHIFT FRAC 1 RIGHT 1 RIGHT 2 EQ SHIFT SD', '1 1/2'],
  ['SHIFT FRAC 1 RIGHT 1 RIGHT 2 EQ SHIFT SD SHIFT SD', '3/2'],
  // functions
  ['SIN 30 RPAR EQ', '1/2'],
  ['SIN 30 EQ', '1/2'],
  ['SHIFT SIN 1 EQ', '90'],
  ['COS 60 EQ', '1/2'],
  ['TAN 45 EQ', '1'],
  ['HYP 1 0 EQ', '0'],
  ['SHIFT EXP EQ', 'π'],
  ['SHIFT EXP DIV 6 EQ', 'π/6'],
  ['5 SHIFT INV EQ', '120'],
  ['2 POW 10 EQ', '1024'],
  ['3 SQR EQ', '9'],
  ['2 SHIFT SQR EQ', '8'],
  ['4 INV EQ', '1/4'],
  ['LOG 100 EQ', '2'],
  ['LOGB 2 RIGHT 8 EQ', '3'],
  ['LN ALPHA EXP EQ', '1'],
  ['SHIFT HYP NEG 3 EQ', '3'],
  ['SHIFT SQRT 27 EQ', '3'],
  ['SHIFT LOG 3 EQ', '1000'],
  ['SHIFT LN 0 EQ', '1'],
  ['SHIFT POW 3 RIGHT 8 EQ', '2'],
  ['5 SHIFT DIV 2 EQ', '10'],
  ['5 SHIFT MUL 2 EQ', '20'],
  ['200 MUL 10 SHIFT LPAR EQ', '20'],
  ['2 EXP 3 EQ', '2000'],
  ['1 EXP NEG 3 EQ', '1/1000'],
  ['INTEG ALPHA RPAR RIGHT 0 RIGHT 1 EQ', '1/2'],
  ['SHIFT INTEG ALPHA RPAR SQR RIGHT 3 EQ', '6'],
  ['SHIFT LOGB ALPHA RPAR RIGHT 1 RIGHT 10 EQ', '55'],
  ['SHIFT ADD 1 SHIFT RPAR 1 RPAR EQ', 'r=√2, θ=45'],
  ['SHIFT SUB 2 SHIFT RPAR 60 RPAR EQ', 'X=1, Y=√3'],
  ['SHIFT ADD 3 SHIFT RPAR 4 RPAR EQ AC ALPHA RPAR EQ', '5'],
  // errors
  ['1 DIV 0 EQ', 'Math ERROR'],
  ['1 ADD EQ', 'Syntax ERROR'],
  ['1 ADD 2 SHIFT CALC', 'Variable ERROR'],
  ['1 DIV 0 EQ AC', ''],
  // after a result
  ['2 ADD 3 EQ MUL 2 EQ', '10'],
  ['2 ADD 3 EQ SQR EQ', '25'],
  ['2 ADD 3 EQ 4 EQ', '4'],
  ['ANS ADD 1 EQ EQ EQ', '3'],
  ['1 ADD 2 EQ LEFT DEL 5 EQ', '6'],
  ['12 EQ DEL DEL 3 EQ', '13'],
  ['1 ADD 2 EQ RIGHT 5 EQ', '53'],
  // ENG and ° ' "
  ['12345 EQ ENG', '12.345×10³'],
  ['12345 EQ ENG ENG', '12345×10⁰'],
  ['12345 EQ SHIFT ENG', '0.012345×10⁶'],
  ['2.5 EQ DMS', '2°30\'0"'],
  ['2.5 EQ DMS SHIFT DMS', '5/2'],
  ['2 DMS 30 DMS EQ', '5/2'],
  // memory
  ['5 SHIFT RCL NEG ALPHA NEG MUL 2 EQ', '10'],
  ['3 MPLUS 4 MPLUS AC ALPHA MPLUS EQ', '7'],
  ['10 MPLUS 3 SHIFT MPLUS AC ALPHA MPLUS EQ', '7'],
  ['6 EQ SHIFT RCL TAN AC ALPHA TAN ADD 1 EQ', '7'],
  // CALC and SOLVE
  ['ALPHA RPAR ADD 1 CALC 5 EQ', '6'],
  ['ALPHA RPAR ADD 1 CALC 5 EQ EQ 7 EQ', '8'],
  ['ALPHA NEG MUL ALPHA DMS CALC 3 EQ 4 EQ', '12'],
  ['ALPHA NEG MUL ALPHA DMS CALC 3 EQ 4 EQ CALC EQ EQ', '12'],
  ['ALPHA SD ALPHA CALC ALPHA RPAR ADD 1 CALC 2 EQ ALPHA SD EQ', '3'],
  ['ALPHA RPAR SQR SUB 4 SHIFT CALC 1 EQ', '2'],
  ['ALPHA RPAR ADD 1 ALPHA CALC 5 SHIFT CALC EQ', '4'],
  // SETUP
  ['SHIFT MODE 2 1 DIV 3 EQ', '0.3333333333'],
  ['SHIFT MODE 2 1 DIV 3 EQ SD', '1⌟3'],
  ['SHIFT MODE 6 3 1 DIV 3 EQ SD', '0.333'],
  ['SHIFT MODE 6 2 SHIFT 0 1 DIV 3 RPAR EQ', '33/100'],
  ['SHIFT MODE 7 3 1 DIV 3 EQ SD', '3.33×10⁻¹'],
  ['SHIFT MODE 8 1 1 DIV 1000 EQ SD', '1×10⁻³'],
  ['SHIFT MODE 8 2 1 DIV 1000 EQ SD', '0.001'],
  ['SHIFT MODE 4 COS SHIFT EXP EQ', '−1'],
  ['SHIFT MODE 4 180 SHIFT ANS 1 EQ', 'π'],
  ['SHIFT MODE 5 SIN 100 EQ', '1'],
  ['SHIFT MODE DOWN 6 2 1.5 EQ SD', '1,5'],
  ['SHIFT MODE DOWN 1 FRAC 3 DOWN 2 EQ', '1 1/2'],
  ['SHIFT MODE 2 123 LEFT LEFT SHIFT DEL 9 EQ', '193'],
  ['SHIFT MODE 2 123 LEFT LEFT 9 EQ', '1923'],
  // CONST, CONV, random
  ['SHIFT 7 3 EQ', '30'],
  ['SHIFT 7 DOWN 1 EQ', '90'],
  ['2 SHIFT 8 5 EQ', '10'],
  // SHIFT and ALPHA
  ['SHIFT SHIFT 7 EQ', '7'],
  ['ALPHA ALPHA 7 EQ', '7'],
  ['ALPHA 7 EQ', ''],
  // CMPLX
  ['MODE 2 1 ADD 2 ALPHA ENG EQ', '1+2i'],
  ['MODE 2 2 SHIFT NEG 0 EQ', '2'],
  ['MODE 2 SHIFT 2 2 1 ADD ALPHA ENG RPAR EQ', '1−i'],
  ['ALPHA ENG 1 EQ', '1'],
  // BASE-N
  ['MODE 4 POW NEG ADD 1 EQ', '0000000B'],
  ['MODE 4 POW NEG ADD 1 EQ LOG', '0000000000001011'],
  ['MODE 4 POW NEG ADD 1 EQ SQR', '11'],
  ['MODE 4 12 SHIFT 3 1 10 EQ', '8'],
  ['MODE 4 12 SHIFT 3 3 10 EQ', '−7'],
  // STAT
  ['MODE 3 1 1 EQ 2 EQ 3 EQ AC SHIFT 1 4 2 EQ', '2'],
  ['MODE 3 1 1 EQ 2 EQ 3 EQ AC SHIFT 1 4 1 EQ', '3'],
  ['MODE 3 1 1 EQ 2 EQ 3 EQ UP DEL AC SHIFT 1 4 1 EQ', '2'],
  // VECTOR
  ['MODE 8 1 2 3 EQ 4 EQ AC SHIFT 5 3 SHIFT 5 7 SHIFT 5 3 EQ', '25'],
  // CLR
  ['5 SHIFT RCL NEG SHIFT 9 2 EQ AC ALPHA NEG EQ', '0'],
];

describe('key sequences', () => {
  for (const [keys, expected] of SEQUENCES) {
    test(keys, () => {
      assert.equal(answer(run(keys)), expected);
    });
  }
  test('there are at least 80 sequences', () => {
    assert.ok(SEQUENCES.length >= 80, `${SEQUENCES.length}`);
  });
});

describe('machine behaviour', () => {
  test('SHIFT and ALPHA light up and are consumed by the next key', () => {
    let s: MachineState = initialMachine();
    s = press(s, 'SHIFT');
    assert.equal(s.shift, true);
    s = press(s, 'ALPHA');
    assert.equal(s.shift, false);
    assert.equal(s.alpha, true);
    s = press(s, 'NEG');
    assert.equal(s.alpha, false);
    assert.deepEqual(s.editor.row, [{ k: 'var', name: 'A' }]);
  });

  test('typing after a result starts a new input; operators continue from Ans', () => {
    const a = run('2 ADD 3 EQ 7');
    assert.deepEqual(a.editor.row, [{ k: 'digit', d: '7' }]);
    const b = run('2 ADD 3 EQ ADD');
    assert.deepEqual(b.editor.row, [{ k: 'ans' }, { k: 'op', op: '+' }]);
    assert.equal(b.result, null);
  });

  test('a syntax error goes to its position with ◀', () => {
    const s = run('1 ADD MUL 2 EQ');
    assert.equal(s.error?.kind, 'Syntax ERROR');
    assert.equal(s.error?.at, 2);
    const t = press(s, 'LEFT');
    assert.equal(t.error, null);
    assert.deepEqual(t.editor.cursor, [2]);
    assert.equal(t.editor.row.length, 4);
  });

  test('keys other than AC and ◀ ▶ are ignored on an error', () => {
    const s = run('1 DIV 0 EQ 5 ADD');
    assert.equal(s.error?.kind, 'Math ERROR');
  });

  test('history: ▲ recalls earlier inputs, ▼ goes forward', () => {
    const s = run('1 ADD 1 EQ 2 ADD 2 EQ UP');
    assert.equal(answer(s), '2');
    assert.equal(s.editor.row.length, 3);
    assert.equal(answer(press(s, 'UP')), '2');
    assert.equal(answer(press(s, 'DOWN')), '4');
    // from an empty input ▲ shows the last calculation
    assert.equal(answer(run('1 ADD 1 EQ 2 ADD 2 EQ AC UP')), '4');
  });

  test('history keeps the last 30 entries', () => {
    let s: KeyState = initialMachine();
    for (let i = 0; i < 35; i++) s = pressAll(s, seq(`${i} EQ`));
    assert.equal(s.history.length, HISTORY_MAX);
    assert.equal(s.history[0].result, '5');
    assert.equal(s.history[29].result, '34');
  });

  test('▲ inside a fraction moves between its parts, not into history', () => {
    const s = run('1 EQ FRAC 2 DOWN 3 UP 4');
    const frac = s.editor.row[0];
    assert.equal(frac.k, 'frac');
    if (frac.k === 'frac') {
      assert.deepEqual(frac.num.map((n) => (n.k === 'digit' ? n.d : '?')), ['2', '4']);
      assert.deepEqual(frac.den.map((n) => (n.k === 'digit' ? n.d : '?')), ['3']);
    }
  });

  test('STO shows the target, RCL shows the variable', () => {
    const s = run('7 SHIFT RCL HYP');
    assert.equal(s.aux.suffix, '→C');
    assert.equal(s.ctx.vars.C.t === 'real' && s.ctx.vars.C.x, 7);
    const r = run('7 SHIFT RCL HYP AC RCL HYP');
    assert.deepEqual(r.aux.message?.lines, ['C=', '7']);
    // RCL's screen closes on the next key, which still works
    assert.deepEqual(press(r, 'D5').editor.row, [{ k: 'digit', d: '5' }]);
  });

  test('STO with an empty input stores Ans', () => {
    const s = run('9 EQ AC SHIFT RCL SIN');
    assert.equal(s.ctx.vars.D.t === 'real' && s.ctx.vars.D.x, 9);
  });

  test('a non-variable key cancels RCL', () => {
    const s = run('RCL 5');
    assert.equal(s.pending, null);
    assert.deepEqual(s.editor.row, []);
  });

  test('CALC prompts in order and shows the current value', () => {
    const s = run('ALPHA NEG MUL ALPHA DMS CALC');
    assert.deepEqual(s.prompt, { kind: 'calc', varName: 'A' });
    const t = pressAll(s, seq('3 EQ'));
    assert.deepEqual(t.prompt, { kind: 'calc', varName: 'B' });
    assert.equal(t.ctx.vars.A.t === 'real' && t.ctx.vars.A.x, 3);
    const u = press(t, 'AC');
    assert.equal(u.prompt, null);
    assert.equal(u.editor.row.length, 3);
  });

  test('SOLVE reports X and L−R and stores X', () => {
    const s = run('ALPHA RPAR SQR SUB 4 SHIFT CALC 1 EQ');
    assert.deepEqual(s.result?.display.lines, ['X=2', 'L−R=0']);
    assert.equal(s.ctx.vars.X.t === 'real' && Math.abs(s.ctx.vars.X.x - 2) < 1e-9, true);
    // = solves again, starting from the new X
    const t = pressAll(s, seq('EQ NEG 5 EQ'));
    assert.equal(t.result?.display.lines?.[0], 'X=−2');
  });

  test('M+ adds the result to M and marks the input', () => {
    const s = run('3 MPLUS');
    assert.equal(s.aux.suffix, 'M+');
    const m = s.ctx.vars.M;
    assert.equal(m.t === 'real' && m.x, 3);
  });

  test('LineIO INS toggles overwrite mode', () => {
    const s = run('SHIFT MODE 2 SHIFT DEL');
    assert.equal(s.editor.insert, false);
    assert.equal(press(press(s, 'SHIFT'), 'DEL').editor.insert, true);
    // MthIO has no overwrite mode
    assert.equal(run('SHIFT DEL').editor.insert, true);
  });

  test('RanInt# and Ran# stay in range and advance the seed', () => {
    const a = run('ALPHA DOT 1 SHIFT RPAR 6 RPAR EQ');
    const x = a.result?.value.t === 'real' ? a.result.value.x : -1;
    assert.ok(Number.isInteger(x) && x >= 1 && x <= 6);
    const b = run('SHIFT DOT EQ');
    const y = b.result?.value.t === 'real' ? b.result.value.x : -1;
    assert.ok(y >= 0 && y < 1);
    assert.notEqual(b.ctx.seed, initialMachine().ctx.seed);
    const c = pressAll(b, seq('EQ'));
    assert.notEqual(c.ctx.seed, b.ctx.seed);
  });

  test('ON and OFF clear the input', () => {
    assert.deepEqual(run('5 ON').editor.row, []);
    assert.deepEqual(run('5 SHIFT AC').editor.row, []);
  });

  test('mode and setup mirror the context', () => {
    const s = run('MODE 2 SHIFT MODE 4');
    assert.equal(s.mode, 'CMPLX');
    assert.equal(s.ctx.mode, 'CMPLX');
    assert.equal(s.setup.angle, 'Rad');
    assert.equal(s.setup, s.ctx.setup);
  });

  test('SETUP clears the display', () => {
    const s = run('1 ADD 2 EQ SHIFT MODE 4');
    assert.equal(s.result, null);
    assert.deepEqual(s.editor.row, []);
  });

  test('CLR All resets mode, setup, memory and history', () => {
    const s = run('MODE 2 SHIFT MODE 4 5 SHIFT RCL NEG SHIFT 9 3 EQ');
    assert.deepEqual(s.aux.message?.lines, ['Clear All', 'Press [AC] Key']);
    const t = press(s, 'AC');
    assert.equal(t.aux.message, null);
    assert.equal(t.mode, 'COMP');
    assert.equal(t.setup.angle, 'Deg');
    assert.equal(t.history.length, 0);
    assert.equal(t.ctx.vars.A.t === 'real' && t.ctx.vars.A.x, 0);
  });

  test('CLR asks for confirmation; AC cancels', () => {
    const s = run('5 SHIFT RCL NEG SHIFT 9 2 AC');
    assert.equal(s.menu.length, 0);
    assert.equal(s.ctx.vars.A.t === 'real' && s.ctx.vars.A.x, 5);
  });

  test('i and ∠ type nothing outside CMPLX', () => {
    assert.deepEqual(run('ALPHA ENG').editor.row, []);
    assert.deepEqual(run('2 SHIFT NEG').editor.row, [{ k: 'digit', d: '2' }]);
  });

  test('BASE-N: blue keys set the radix, hex keys type digits, functions are refused', () => {
    const s = run('MODE 4 POW');
    assert.equal(s.ctx.base, 16);
    assert.deepEqual(run('MODE 4 NEG DMS').editor.row, [{ k: 'digit', d: 'A' }, { k: 'digit', d: 'B' }]);
    assert.deepEqual(run('MODE 4 SQRT DOT 1').editor.row, [{ k: 'digit', d: '1' }]);
    assert.ok(run('MODE 4').menu.length === 0);
    assert.ok(run('MODE 4 LOG').ctx.base === 2);
  });
});

describe('mode screens', () => {
  test('EQN: linear system, results stepped with ▼ and =, AC back to the coefficients', () => {
    const s = run('MODE 5 1 1 EQ 1 EQ 3 EQ 1 EQ NEG 1 EQ 1 EQ EQ');
    assert.equal(s.screen?.kind, 'eqn-result');
    if (s.screen?.kind === 'eqn-result') {
      assert.deepEqual(s.screen.roots.map((r) => (r.t === 'real' ? r.x : NaN)), [2, 1]);
    }
    const back = press(s, 'AC');
    assert.equal(back.screen?.kind, 'eqn-edit');
    if (back.screen?.kind === 'eqn-edit') assert.deepEqual(back.screen.coef, [1, 1, 3, 1, -1, 1]);
    const t = pressAll(s, seq('EQ EQ'));
    assert.equal(t.screen?.kind, 'eqn-edit');
  });

  test('EQN: no type menu escape with AC, messages for infinite solutions', () => {
    const s = run('MODE 5 AC');
    assert.equal(s.menu[0]?.id, 'EQN_TYPE');
    const m = run('MODE 5 1 EQ');
    assert.equal(m.screen?.kind, 'eqn-message');
  });

  test('EQN: a bad cell entry shows the error and AC returns to the cell', () => {
    const s = run('MODE 5 3 1 DIV 0 EQ');
    assert.equal(s.error?.kind, 'Math ERROR');
    const t = press(s, 'AC');
    assert.equal(t.error, null);
    assert.equal(t.screen?.kind, 'eqn-edit');
  });

  test('MATRIX: dimension, data, AC to the calculation screen, matrix result', () => {
    const s = run('MODE 6 1 5 1 EQ 2 EQ 3 EQ 4 EQ');
    assert.deepEqual(s.ctx.mats.A?.m, [[1, 2], [3, 4]]);
    const r = pressAll(s, seq('AC SHIFT 4 3 ADD SHIFT 4 3 EQ'));
    assert.equal(r.screen?.kind, 'mat-result');
    assert.deepEqual(r.ctx.mats.Ans?.m, [[2, 4], [6, 8]]);
    // det of MatA from the MATRIX menu
    assert.equal(answer(pressAll(s, seq('AC SHIFT 4 7 SHIFT 4 3 RPAR EQ'))), '−2');
    // typing on a matrix result continues from Ans
    const t = press(r, 'ADD');
    assert.equal(t.screen, null);
    assert.deepEqual(t.editor.row, [{ k: 'ans' }, { k: 'op', op: '+' }]);
  });

  test('MATRIX: Data edits an existing matrix, an undefined one asks for its size', () => {
    const s = run('MODE 6 1 5 1 EQ AC SHIFT 4 2 1');
    assert.equal(s.screen?.kind, 'mat-edit');
    if (s.screen?.kind === 'mat-edit') assert.deepEqual(s.screen.cells, [[1, 0], [0, 0]]);
    const t = run('MODE 6 1 5 AC SHIFT 4 2 2');
    assert.equal(t.menu[t.menu.length - 1]?.id, 'MATRIX_DIM');
  });

  test('STAT: data rows are appended, DEL removes a row', () => {
    const s = run('MODE 3 1 1 EQ 2 EQ 3 EQ');
    assert.deepEqual(s.ctx.stat.x, [1, 2, 3]);
    assert.deepEqual(s.ctx.stat.freq, [1, 1, 1]);
    const t = pressAll(s, seq('UP DEL'));
    assert.deepEqual(t.ctx.stat.x, [1, 2]);
    // a new STAT type clears the data
    assert.deepEqual(pressAll(s, seq('SHIFT 1 1 2')).ctx.stat, { kind: 'A+BX', x: [], y: [], freq: [] });
  });

  test('STAT: paired data fills X then Y columns with ▶', () => {
    const s = run('MODE 3 2 1 EQ UP RIGHT 5 EQ');
    assert.deepEqual(s.ctx.stat.x, [1]);
    assert.deepEqual(s.ctx.stat.y, [5]);
  });

  test('TABLE: f(X), start, end and step build the table', () => {
    const s = run('MODE 7 ALPHA RPAR SQR EQ EQ AC 3 EQ EQ');
    assert.equal(s.screen?.kind, 'table-result');
    if (s.screen?.kind === 'table-result') assert.deepEqual(s.screen.rows, [[1, 1], [2, 4], [3, 9]]);
    const back = press(s, 'AC');
    assert.equal(back.screen?.kind, 'table-edit');
  });

  test('TABLE with f(x),g(x) asks for g(X)', () => {
    const s = run('SHIFT MODE DOWN 5 2 MODE 7 ALPHA RPAR EQ');
    assert.equal(s.screen?.kind === 'table-edit' && s.screen.field, 'g');
  });

  test('INEQ and RATIO', () => {
    const i = run('MODE 9 1 1 1 EQ NEG 4 EQ 3 EQ EQ');
    assert.equal(i.screen?.kind, 'ineq-result');
    if (i.screen?.kind === 'ineq-result') assert.deepEqual(i.screen.text, ['X<1', '3<X']);
    const r = run('MODE DOWN 0 1 2 EQ 3 EQ 6 EQ EQ');
    assert.equal(r.screen?.kind === 'ratio-result' && r.screen.value, 4);
    assert.equal(press(r, 'AC').screen?.kind, 'ratio-edit');
  });

  test('VECTOR: dimension 2, VctA·VctA', () => {
    const s = run('MODE 8 1 2 3 EQ 4 EQ');
    assert.deepEqual(s.ctx.vcts.A?.v, [3, 4]);
  });

  test('a CONST typed into a matrix cell', () => {
    const s = run('MODE 6 1 DOWN 3 SHIFT 7 2 EQ');
    assert.deepEqual(s.ctx.mats.A?.m, [[20]]);
  });
});

describe('review fixes', () => {
  test('MODE and SETUP open from the EQN, INEQ and RATIO type menus', () => {
    const m = run('MODE 5 MODE');
    assert.deepEqual(m.menu.map((f) => f.id), ['EQN_TYPE', 'MODE']);
    assert.equal(press(m, 'D1').mode, 'COMP');
    assert.deepEqual(press(m, 'AC').menu.map((f) => f.id), ['EQN_TYPE']);
    const st = run('MODE 9 SHIFT MODE 4');
    assert.equal(st.setup.angle, 'Rad');
    assert.deepEqual(st.menu.map((f) => f.id), ['INEQ_TYPE']);
    assert.equal(run('MODE DOWN 0 MODE 1').mode, 'COMP');
  });

  test('TABLE Start?, End? and Step? replace the old value when typed', () => {
    const s = run('MODE 7 ALPHA RPAR EQ 2 EQ 4 EQ 2 EQ');
    assert.equal(s.screen?.kind, 'table-result');
    if (s.screen?.kind === 'table-result') assert.deepEqual(s.screen.rows.map((r) => r[0]), [2, 4]);
    const kept = run('MODE 7 ALPHA RPAR EQ EQ EQ EQ');
    if (kept.screen?.kind === 'table-result') assert.deepEqual(kept.screen.rows.map((r) => r[0]), [1, 2, 3, 4, 5]);
    else assert.fail('no table');
  });

  test('SETUP f(x),g(x) in TABLE rebuilds the editor with g(X)', () => {
    const s = run('MODE 7 SHIFT MODE DOWN 5 2 ALPHA RPAR EQ');
    assert.equal(s.screen?.kind === 'table-edit' && s.screen.field, 'g');
  });

  test('CONST: 9 on a page of 8 picks nothing', () => {
    const s = run('SHIFT 7 DOWN 9');
    assert.equal(s.menu[0]?.id, 'CONST');
    assert.equal(s.editor.row.length, 0);
  });
});

describe('second review fixes', () => {
  test('SETUP or CLR during a CALC prompt ends the prompt and the next key is not swallowed', () => {
    const s = run('ALPHA RPAR ADD 1 CALC SHIFT MODE 3');
    assert.equal(s.prompt, null);
    assert.equal(answer(pressAll(s, seq('2 ADD 2 EQ'))), '4');
    const c = run('ALPHA RPAR ADD 1 CALC SHIFT 9 2 EQ AC');
    assert.equal(c.prompt, null);
    assert.equal(answer(pressAll(c, seq('5 EQ'))), '5');
  });

  test('a stale prompt in a plain MachineState is dropped, not swallowing the key', () => {
    const base = initialMachine();
    const plain: MachineState = { ...base, prompt: { kind: 'calc', varName: 'X' } };
    const s = press(plain, 'D7');
    assert.equal(s.prompt, null);
    assert.deepEqual(s.editor.row, [{ k: 'digit', d: '7' }]);
  });

  test('EQN: a single polynomial root is labelled X=, two roots X1= and X2=', () => {
    const ctx = createContext({ mode: 'EQN' });
    const one: ModeScreen = { kind: 'eqn-result', eqn: 'poly2', roots: [real(1)], index: 0 };
    assert.equal(screenView(one, ctx).title, 'X=');
    const two: ModeScreen = { kind: 'eqn-result', eqn: 'poly2', roots: [real(2), real(-2)], index: 1 };
    assert.equal(screenView(two, ctx).title, 'X2=');
  });

  test('TABLE: an error cell (NaN) shows ERROR', () => {
    const ctx = createContext({ mode: 'TABLE' });
    const t: ModeScreen = { kind: 'table-result', rows: [[-1, Number.NaN], [1, 0]], hasG: false, row: 0, col: 1 };
    const v = screenView(t, ctx);
    assert.deepEqual(v.grid, [['−1', 'ERROR'], ['1', '0']]);
    assert.equal(v.value, 'ERROR');
  });

  test('STAT row limits follow the type and FREQ (80/40 for 1-VAR, 40/26 paired)', () => {
    assert.equal(statMaxRows('1-VAR', false), 80);
    assert.equal(statMaxRows('1-VAR', true), 40);
    assert.equal(statMaxRows('A+BX', false), 40);
    assert.equal(statMaxRows('A+BX', true), 26);
    const fill = (kind: 'A+BX' | '1-VAR', n: number): ModeScreen => ({
      kind: 'stat-edit', data: { kind, x: new Array<number>(n).fill(1), y: new Array<number>(n).fill(0), freq: new Array<number>(n).fill(1) },
      row: n, col: 0, entry: { row: [{ k: 'digit', d: '5' }], cursor: [1] },
    });
    const ctx = createContext({ mode: 'STAT' });
    const eq = { a: 'cmd', cmd: 'eq' } as const;
    const full = screenKey(fill('A+BX', 40), eq, ctx, null);
    assert.equal(full.o === 'stay' && full.error, 'Insufficient MEM');
    const ok = screenKey(fill('1-VAR', 40), eq, ctx, null);
    assert.equal(ok.o === 'stay' && ok.screen?.kind === 'stat-edit' && ok.screen.data.x.length, 41);
  });
});
