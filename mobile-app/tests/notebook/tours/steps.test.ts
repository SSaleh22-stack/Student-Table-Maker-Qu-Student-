import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  availableSteps,
  stepCountLabel,
  stepRect,
  stepsPhrase,
  stepTargetIds,
  undoLayout,
} from '../../../src/notebook/core/tours/steps.ts';

const LIB = [
  { key: 'courses', targets: ['lib.courses'] },
  { key: 'folders', targets: ['lib.folders'] },
  { key: 'new', targets: ['lib.new'] },
  { key: 'search', targets: ['lib.search', 'lib.headerActions'] },
] as const;

const r = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

describe('availableSteps', () => {
  test('all four measured: 1..4 of 4, the last one marked', () => {
    const m = { 'lib.courses': r(0, 100), 'lib.folders': r(0, 300), 'lib.new': r(500, 900), 'lib.search': r(0, 40), 'lib.headerActions': r(600, 0) };
    const s = availableSteps(LIB, m);
    assert.deepEqual(
      s.map((x) => [x.step.key, x.number, x.total, x.last]),
      [
        ['courses', 1, 4, false],
        ['folders', 2, 4, false],
        ['new', 3, 4, false],
        ['search', 4, 4, true],
      ],
    );
  });

  test("3 of 4 available renumbers to '1 من 3'", () => {
    // No course folders (no timetable): the courses row is not mounted.
    const m = new Map([
      ['lib.courses', null],
      ['lib.folders', r(0, 300)],
      ['lib.new', r(500, 900)],
      ['lib.search', r(0, 40)],
    ]);
    const s = availableSteps(LIB, m);
    assert.equal(s.length, 3);
    assert.deepEqual(
      s.map((x) => x.step.key),
      ['folders', 'new', 'search'],
    );
    assert.equal(stepCountLabel(s[0].number, s[0].total).ar, '1 من 3');
    assert.equal(stepCountLabel(s[2].number, s[2].total).ar, '3 من 3');
    assert.equal(stepCountLabel(s[0].number, s[0].total).en, '1 of 3');
    assert.ok(s[2].last);
    assert.ok(!s[1].last);
  });

  test('a union step shows the union of what was measured', () => {
    const both = stepRect(LIB[3], { 'lib.search': r(20, 100, 600, 50), 'lib.headerActions': r(700, 30, 100, 44) });
    assert.deepEqual(both, { x: 20, y: 30, width: 780, height: 120 });
    const one = stepRect(LIB[3], { 'lib.headerActions': r(700, 30, 100, 44) });
    assert.deepEqual(one, r(700, 30, 100, 44));
  });

  test('zero-size and non-finite rects count as not measured', () => {
    const m = { 'lib.courses': r(0, 0, 0, 0), 'lib.folders': { x: NaN, y: 0, width: 10, height: 10 }, 'lib.new': r(1, 1) };
    const s = availableSteps(LIB, m);
    assert.deepEqual(
      s.map((x) => [x.step.key, x.number, x.total]),
      [['new', 1, 1]],
    );
  });

  test('a target scrolled off screen is dropped; a partly visible one is clipped', () => {
    const view = { x: 0, y: 0, width: 390, height: 844 };
    const m = { 'lib.courses': r(0, 100), 'lib.folders': r(0, 1200), 'lib.new': r(200, 820, 150, 56) };
    const s = availableSteps(LIB, m, view);
    assert.deepEqual(
      s.map((x) => x.step.key),
      ['courses', 'new'],
    );
    assert.equal(s[1].rect.height, 24);
    assert.equal(s[1].number, 2);
    assert.equal(s[1].total, 2);
  });

  test('nothing measured: no steps', () => {
    assert.deepEqual(availableSteps(LIB, {}), []);
  });
});

describe('labels and helpers', () => {
  test('stepTargetIds lists every id once, in order', () => {
    assert.deepEqual(stepTargetIds([...LIB, { targets: ['lib.new'] }]), ['lib.courses', 'lib.folders', 'lib.new', 'lib.search', 'lib.headerActions']);
  });

  test('stepsPhrase agrees with the number', () => {
    assert.equal(stepsPhrase(4).ar, '4 خطوات');
    assert.equal(stepsPhrase(3).ar, '3 خطوات');
    assert.equal(stepsPhrase(2).ar, 'خطوتين');
    assert.equal(stepsPhrase(1).ar, 'خطوة واحدة');
    assert.equal(stepsPhrase(1).en, '1 step');
    assert.equal(stepsPhrase(4).en, '4 steps');
  });

  test('undoLayout follows the reading direction and a vertical toolbar', () => {
    assert.equal(undoLayout(true), 'undo-right');
    assert.equal(undoLayout(false), 'undo-left');
    assert.equal(undoLayout(true, { width: 88, height: 40 }), 'undo-right');
    assert.equal(undoLayout(false, { width: 88, height: 40 }), 'undo-left');
    assert.equal(undoLayout(true, { width: 40, height: 88 }), 'undo-top');
    assert.equal(undoLayout(false, null), 'undo-left');
  });
});
