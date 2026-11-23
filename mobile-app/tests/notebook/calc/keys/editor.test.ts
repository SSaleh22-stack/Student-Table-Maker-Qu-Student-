import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_NODES, countNodes, cursorTo, deleteAt, emptyEditor, insertNodes, makeTemplate, moveLeft, moveRight, moveVertical, replaceRowAt, rowAt,
  slotsOf, validCursor, withSlots,
} from '../../../../src/notebook/core/calc/keys/editor.ts';
import type { MathNode, MathRow } from '../../../../src/notebook/core/calc/types.ts';
import { parseLinear } from '../../../../src/notebook/core/calc/eval.ts';

const d = (c: string): MathNode => ({ k: 'digit', d: c as '1' });
const ed = (row: MathRow, cursor: number[]) => ({ row, cursor, insert: true });

describe('editor', () => {
  test('insert puts nodes before the caret and moves it on', () => {
    let e = emptyEditor();
    e = insertNodes(e, [d('1')]);
    e = insertNodes(e, [d('2')]);
    assert.deepEqual(e.row, [d('1'), d('2')]);
    assert.deepEqual(e.cursor, [2]);
    e = insertNodes({ ...e, cursor: [1] }, [d('9')]);
    assert.deepEqual(e.row, [d('1'), d('9'), d('2')]);
    assert.deepEqual(e.cursor, [2]);
  });

  test('a template puts the caret into its first slot', () => {
    const e = insertNodes(emptyEditor(), [makeTemplate('frac')]);
    assert.deepEqual(e.cursor, [0, 0, 0]);
    const f = insertNodes(e, [d('5')]);
    assert.deepEqual(f.row, [{ k: 'frac', num: [d('5')], den: [] }]);
    assert.deepEqual(f.cursor, [0, 0, 1]);
  });

  test('overwrite replaces the flat node under the caret', () => {
    const e = insertNodes(ed([d('1'), d('2'), d('3')], [1]), [d('9')], true);
    assert.deepEqual(e.row, [d('1'), d('9'), d('3')]);
    // at the end it inserts
    const f = insertNodes(ed([d('1')], [1]), [d('9')], true);
    assert.deepEqual(f.row, [d('1'), d('9')]);
  });

  test('▶ walks into templates, through their slots and out', () => {
    const row: MathRow = [d('1'), { k: 'frac', num: [d('2')], den: [d('3')] }, d('4')];
    const path: number[][] = [];
    let e = ed(row, [0]);
    for (let i = 0; i < 8; i++) {
      path.push(e.cursor);
      e = moveRight(e);
    }
    assert.deepEqual(path, [[0], [1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1], [2], [3]]);
    // wraps around at the end
    assert.deepEqual(e.cursor, [0]);
  });

  test('◀ is the reverse of ▶', () => {
    const row: MathRow = [d('1'), { k: 'frac', num: [d('2')], den: [d('3')] }, d('4')];
    const path: number[][] = [];
    let e = ed(row, [3]);
    for (let i = 0; i < 8; i++) {
      path.push(e.cursor);
      e = moveLeft(e);
    }
    assert.deepEqual(path, [[3], [2], [1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0], [1], [0]]);
    assert.deepEqual(e.cursor, [3]);
  });

  test('▲ ▼ move between numerator and denominator, and between ∫ limits', () => {
    const row: MathRow = [{ k: 'frac', num: [d('1'), d('2')], den: [d('3')] }];
    assert.deepEqual(moveVertical(ed(row, [0, 0, 2]), 'down')?.cursor, [0, 1, 1]);
    assert.deepEqual(moveVertical(ed(row, [0, 1, 0]), 'up')?.cursor, [0, 0, 0]);
    assert.equal(moveVertical(ed(row, [1]), 'up'), null);
    const int: MathRow = [{ k: 'integral', f: [d('1')], a: [d('0')], b: [d('2')] }];
    assert.deepEqual(moveVertical(ed(int, [0, 0, 1]), 'up')?.cursor, [0, 2, 1]);
    assert.deepEqual(moveVertical(ed(int, [0, 0, 1]), 'down')?.cursor, [0, 1, 1]);
    // nested: a √ inside a numerator still goes down to the denominator
    const nested: MathRow = [{ k: 'frac', num: [{ k: 'fn', name: '√', args: [[d('2')]] }], den: [d('5')] }];
    assert.deepEqual(moveVertical(ed(nested, [0, 0, 0, 0, 1]), 'down')?.cursor, [0, 1, 1]);
  });

  test('DEL deletes left, enters a filled template, removes an empty one', () => {
    assert.deepEqual(deleteAt(ed([d('1'), d('2')], [2])).row, [d('1')]);
    const filled: MathRow = [{ k: 'fn', name: '√', args: [[d('2')]] }];
    const e = deleteAt(ed(filled, [1]));
    assert.deepEqual(e.row, filled);
    assert.deepEqual(e.cursor, [0, 0, 1]);
    const empty: MathRow = [{ k: 'fn', name: '√', args: [[]] }];
    assert.deepEqual(deleteAt(ed(empty, [1])).row, []);
  });

  test('DEL at the start of a slot unwraps the template when the other slots are empty', () => {
    const row: MathRow = [d('7'), { k: 'frac', num: [d('1'), d('2')], den: [] }];
    const e = deleteAt(ed(row, [1, 0, 0]));
    assert.deepEqual(e.row, [d('7'), d('1'), d('2')]);
    assert.deepEqual(e.cursor, [1]);
    // with a filled denominator it only moves left
    const full: MathRow = [{ k: 'frac', num: [d('1')], den: [d('2')] }];
    const f = deleteAt(ed(full, [0, 1, 0]));
    assert.deepEqual(f.row, full);
    assert.deepEqual(f.cursor, [0, 0, 1]);
    // at the very start nothing happens
    assert.deepEqual(deleteAt(ed([d('1')], [0])).row, [d('1')]);
  });

  test('overwrite DEL deletes under the caret', () => {
    const e = deleteAt(ed([d('1'), d('2'), d('3')], [1]), true);
    assert.deepEqual(e.row, [d('1'), d('3')]);
    assert.deepEqual(e.cursor, [1]);
  });

  test('input stops at MAX_NODES', () => {
    let e = emptyEditor();
    for (let i = 0; i < MAX_NODES + 20; i++) e = insertNodes(e, [d('1')]);
    assert.equal(countNodes(e.row), MAX_NODES);
  });

  test('rowAt / replaceRowAt / slots', () => {
    const row = parseLinear('1+frac{2}{sqrt{3}}');
    assert.deepEqual(rowAt(row, [2, 1, 0, 0]), [d('3')]);
    const next = replaceRowAt(row, [2, 1, 0, 0], [d('5')]);
    assert.deepEqual(rowAt(next, [2, 1, 0, 0]), [d('5')]);
    assert.deepEqual(rowAt(row, [2, 1, 0, 0]), [d('3')], 'input unchanged');
    assert.equal(rowAt(row, [0, 0]).length, 0, 'a flat node has no slots');
    for (const t of ['frac', 'mixed', 'sqrt', 'cbrt', 'pow', 'root', 'abs', 'tenpow', 'epow', 'logb', 'integral', 'deriv', 'sum'] as const) {
      const n = makeTemplate(t);
      const slots = slotsOf(n);
      assert.ok(slots && slots.length >= 1, t);
      assert.deepEqual(withSlots(n, slots), n, t);
    }
  });

  test('cursor validity and cursorTo', () => {
    const row = parseLinear('1+frac{2}{3}');
    assert.equal(validCursor(row, [3]), true);
    assert.equal(validCursor(row, [4]), false);
    assert.equal(validCursor(row, [2, 1, 1]), true);
    assert.equal(validCursor(row, [0, 0, 0]), false);
    assert.equal(validCursor(row, [2, 1]), false);
    assert.deepEqual(cursorTo(ed(row, [0]), 99).cursor, [3]);
    // an invalid caret is repaired to the end before editing
    assert.deepEqual(insertNodes(ed(row, [9, 9, 9]), [d('4')]).cursor, [4]);
  });
});
