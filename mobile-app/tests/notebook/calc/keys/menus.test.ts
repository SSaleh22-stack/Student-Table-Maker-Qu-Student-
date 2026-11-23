import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { menuAvailable, menuChoose, menuView, entryMenu } from '../../../../src/notebook/core/calc/keys/menus.ts';
import { layoutDisplay } from '../../../../src/notebook/core/calc/keys/display.ts';
import { createContext, emptyStat } from '../../../../src/notebook/core/calc/context.ts';
import { CALC_MODES, MENU_IDS, type CalcContext, type MenuId } from '../../../../src/notebook/core/calc/types.ts';
import type { KeyAction } from '../../../../src/notebook/core/calc/keys/keymap.ts';
import { installStubs, resetStubs, run } from './stubHooks.ts';

before(installStubs);
after(resetStubs);

const digit = (n: number): KeyAction => ({ a: 'digit', d: String(n) as '1' });
const labels = (id: MenuId, page = 0, ctx: CalcContext = createContext()) => menuView({ id, page }, ctx).items.map((i) => `${i.key}:${i.label}`);

describe('menus', () => {
  test('MODE lists the ten modes over two pages; 0 picks the tenth', () => {
    assert.deepEqual(labels('MODE', 0), ['1:COMP', '2:CMPLX', '3:STAT', '4:BASE-N', '5:EQN', '6:MATRIX', '7:TABLE', '8:VECTOR']);
    assert.deepEqual(labels('MODE', 1), ['9:INEQ', '0:RATIO']);
    const ctx = createContext();
    CALC_MODES.forEach((m, i) => {
      assert.deepEqual(menuChoose({ id: 'MODE', page: 0 }, digit((i + 1) % 10), ctx), { e: 'mode', mode: m });
    });
  });

  test('SETUP has two pages', () => {
    assert.deepEqual(labels('SETUP', 0), ['1:MthIO', '2:LineIO', '3:Deg', '4:Rad', '5:Gra', '6:Fix', '7:Sci', '8:Norm']);
    assert.deepEqual(labels('SETUP', 1), ['1:ab/c', '2:d/c', '3:CMPLX', '4:STAT', '5:TABLE', '6:Disp', '7:◀CONT▶']);
    const ctx = createContext();
    assert.deepEqual(menuChoose({ id: 'SETUP', page: 0 }, { a: 'cmd', cmd: 'down' }, ctx), { e: 'page', page: 1 });
    assert.deepEqual(menuChoose({ id: 'SETUP', page: 1 }, { a: 'cmd', cmd: 'down' }, ctx), { e: 'none' });
    assert.deepEqual(menuChoose({ id: 'SETUP', page: 1 }, { a: 'cmd', cmd: 'up' }, ctx), { e: 'page', page: 0 });
    const fix = menuChoose({ id: 'SETUP', page: 0 }, digit(6), ctx);
    assert.deepEqual(fix, { e: 'open', frame: { id: 'SETUP_FIX', page: 0 } });
  });

  test('SETUP sub-menus set the right fields', () => {
    const ctx = createContext();
    const setOf = (id: MenuId, n: number) => {
      const e = menuChoose({ id, page: 0 }, digit(n), ctx);
      assert.equal(e.e, 'setup', `${id} ${n}`);
      return e.e === 'setup' ? e.setup : ctx.setup;
    };
    assert.deepEqual(setOf('SETUP_FIX', 4).disp, { mode: 'Fix', n: 4 });
    assert.deepEqual(setOf('SETUP_SCI', 0).disp, { mode: 'Sci', n: 0 });
    assert.deepEqual(setOf('SETUP_NORM', 2).disp, { mode: 'Norm', n: 2 });
    assert.equal(setOf('SETUP_CMPLX', 2).cmplx, 'r∠θ');
    assert.equal(setOf('SETUP_STAT', 1).statFreq, true);
    assert.equal(setOf('SETUP_TABLE', 2).table, 'f(x),g(x)');
    assert.equal(setOf('SETUP_DISP', 2).decimal, 'Comma');
    assert.equal(menuChoose({ id: 'SETUP_NORM', page: 0 }, digit(3), ctx).e, 'none');
    assert.deepEqual(menuView({ id: 'SETUP_FIX', page: 0 }, ctx).title, 'Fix 0~9?');
  });

  test('contrast moves with ◀ ▶ within 1..9', () => {
    const ctx = createContext();
    assert.deepEqual(menuChoose({ id: 'SETUP_CONT', page: 0 }, { a: 'cmd', cmd: 'right' }, ctx), { e: 'contrast', value: 6 });
    const low = { ...ctx, setup: { ...ctx.setup, contrast: 1 } };
    assert.deepEqual(menuChoose({ id: 'SETUP_CONT', page: 0 }, { a: 'cmd', cmd: 'left' }, low), { e: 'contrast', value: 1 });
    assert.equal(run('SHIFT MODE DOWN 7 RIGHT RIGHT AC').ctx.setup.contrast, 7);
  });

  test('CLR lists Setup, Memory, All and asks before clearing', () => {
    assert.deepEqual(labels('CLR'), ['1:Setup', '2:Memory', '3:All']);
    const ctx = createContext();
    assert.deepEqual(menuChoose({ id: 'CLR', page: 0 }, digit(2), ctx), { e: 'open', frame: { id: 'CLR_CONFIRM', page: 0, target: 'Memory' } });
    assert.deepEqual(menuChoose({ id: 'CLR_CONFIRM', page: 0, target: 'Memory' }, { a: 'cmd', cmd: 'eq' }, ctx), { e: 'clr', target: 'Memory' });
    assert.equal(menuView({ id: 'CLR_CONFIRM', page: 0, target: 'Setup' }, ctx).title, 'Clear Setup?');
  });

  test('CONST and CONV are paged lists numbered from 1 on each page', () => {
    const ctx = createContext();
    const v = menuView({ id: 'CONST', page: 1 }, ctx);
    assert.equal(v.pages, 5);
    assert.equal(v.items[0].label, 'k9');
    assert.deepEqual(v.items[0].hint, { ar: 'ثابت 9', en: 'constant 9' });
    assert.deepEqual(menuChoose({ id: 'CONST', page: 1 }, digit(1), ctx), { e: 'insert', nodes: [{ k: 'const', index: 9 }] });
    assert.deepEqual(menuChoose({ id: 'CONV', page: 0 }, digit(5), ctx), { e: 'insert', nodes: [{ k: 'conv', index: 5 }] });
    assert.equal(menuView({ id: 'CONV', page: 0 }, ctx).items[4].label, 'u5▶v5');
  });

  test('STAT menu follows the data kind', () => {
    const one = createContext({ mode: 'STAT' });
    assert.deepEqual(labels('STAT', 0, one), ['1:Type', '2:Data', '3:Sum', '4:Var', '5:Distr', '6:MinMax']);
    assert.deepEqual(labels('STAT_VAR', 0, one), ['1:n', '2:x̄', '3:σx', '4:sx']);
    const lin = { ...one, stat: emptyStat('A+BX') };
    assert.deepEqual(labels('STAT', 0, lin), ['1:Type', '2:Data', '3:Sum', '4:Var', '5:Reg', '6:MinMax']);
    assert.deepEqual(labels('STAT_REG', 0, lin), ['1:A', '2:B', '3:r', '4:x̂', '5:ŷ']);
    const quad = { ...one, stat: emptyStat('_+CX²') };
    assert.deepEqual(labels('STAT_REG', 0, quad), ['1:A', '2:B', '3:C', '4:x̂1', '5:x̂2', '6:ŷ']);
    assert.deepEqual(labels('STAT_SUM', 0, quad).slice(5), ['6:Σx³', '7:Σx²y', '8:Σx⁴']);
    assert.deepEqual(labels('STAT_SUM', 0, one), ['1:Σx²', '2:Σx']);
    assert.deepEqual(menuChoose({ id: 'STAT_REG', page: 0 }, digit(5), lin), { e: 'insert', nodes: [{ k: 'statvar', name: 'ŷ' }] });
    assert.deepEqual(menuChoose({ id: 'STAT_DISTR', page: 0 }, digit(4), one), { e: 'insert', nodes: [{ k: 'post', op: '▶t' }] });
    assert.equal(labels('STAT_TYPE').length, 8);
  });

  test('MATRIX, VECTOR, CMPLX, BASE, DRG and hyp items', () => {
    const ctx = createContext();
    assert.deepEqual(labels('MATRIX'), ['1:Dim', '2:Data', '3:MatA', '4:MatB', '5:MatC', '6:MatAns', '7:det', '8:Trn']);
    assert.deepEqual(menuChoose({ id: 'MATRIX', page: 0 }, digit(6), ctx), { e: 'insert', nodes: [{ k: 'mat', name: 'Ans' }] });
    assert.deepEqual(menuChoose({ id: 'VECTOR', page: 0 }, digit(7), ctx), { e: 'insert', nodes: [{ k: 'op', op: '·' }] });
    assert.deepEqual(labels('MATRIX_DIM', 1), ['1:1×3', '2:1×2', '3:1×1']);
    assert.deepEqual(menuChoose({ id: 'MATRIX_DIM', page: 0, target: 'B' }, digit(4), ctx), { e: 'matDim', name: 'B', rows: 2, cols: 3 });
    assert.deepEqual(labels('CMPLX'), ['1:arg', '2:Conjg', '3:▶r∠θ', '4:▶a+bi']);
    assert.deepEqual(labels('BASE', 1), ['1:d', '2:h', '3:b', '4:o']);
    assert.deepEqual(menuChoose({ id: 'BASE', page: 0 }, digit(5), ctx), { e: 'insert', nodes: [{ k: 'fn', name: 'Not', args: [] }] });
    assert.deepEqual(menuChoose({ id: 'DRG', page: 0 }, digit(2), ctx), { e: 'insert', nodes: [{ k: 'post', op: 'ʳ' }] });
    assert.deepEqual(menuChoose({ id: 'HYP', page: 0 }, digit(4), ctx), { e: 'insert', nodes: [{ k: 'fn', name: 'sinh⁻¹', args: [] }] });
  });

  test('EQN, INEQ and RATIO type menus', () => {
    const ctx = createContext();
    assert.deepEqual(labels('EQN_TYPE'), ['1:anX+bnY=cn', '2:anX+bnY+cnZ=dn', '3:aX²+bX+c=0', '4:aX³+bX²+cX+d=0']);
    assert.deepEqual(labels('INEQ_REL', 2), ['1:aX²+bX+c>0', '2:aX²+bX+c<0', '3:aX²+bX+c≥0', '4:aX²+bX+c≤0']);
    assert.deepEqual(menuChoose({ id: 'INEQ_REL', page: 3 }, digit(4), ctx), { e: 'ineqRel', deg: 3, rel: '≤' });
    assert.deepEqual(labels('RATIO_TYPE'), ['1:A:B=X:D', '2:A:B=C:X']);
  });

  test('every menu id has a view, AC closes it', () => {
    const ctx = createContext();
    for (const id of MENU_IDS) {
      const v = menuView({ id, page: 0 }, ctx);
      assert.equal(v.id, id);
      assert.ok(v.pages >= 1);
      assert.deepEqual(menuChoose({ id, page: 0 }, { a: 'cmd', cmd: 'ac' }, ctx), { e: 'close' });
    }
  });

  test('mode menus only open in their mode', () => {
    assert.equal(menuAvailable('MATRIX', 'COMP'), false);
    assert.equal(menuAvailable('MATRIX', 'MATRIX'), true);
    assert.equal(menuAvailable('BASE', 'BASE-N'), true);
    assert.equal(menuAvailable('CONST', 'BASE-N'), false);
    assert.equal(menuAvailable('MODE', 'EQN'), true);
    assert.equal(entryMenu('COMP'), null);
    assert.deepEqual(entryMenu('VECTOR'), { id: 'VECTOR_SELECT', page: 0 });
    // SHIFT 4 does nothing in COMP
    assert.equal(run('SHIFT 4').menu.length, 0);
  });

  test('the menu display shows two items per line and the page arrows', () => {
    const d = layoutDisplay(run('MODE'));
    assert.equal(d.view, 'menu');
    assert.deepEqual(d.grid?.[0], ['1:COMP', '2:CMPLX']);
    assert.deepEqual(d.more, { up: false, down: true });
    const p = layoutDisplay(run('MODE DOWN'));
    assert.deepEqual(p.grid, [['9:INEQ', '0:RATIO']]);
    assert.deepEqual(p.more, { up: true, down: false });
  });
});
