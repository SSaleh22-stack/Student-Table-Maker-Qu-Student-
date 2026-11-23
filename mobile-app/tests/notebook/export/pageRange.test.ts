import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canStepRange,
  clampSpan,
  defaultSpan,
  exportFileName,
  rangeChipLabel,
  rangeCount,
  resolvePageRange,
  setRangeEnd,
  stepRange,
} from '../../../src/notebook/core/export/pageRange.ts';

describe('resolvePageRange', () => {
  test('all, current and spans give 0-based indices in order', () => {
    assert.deepEqual(resolvePageRange('all', 4, 2), [0, 1, 2, 3]);
    assert.deepEqual(resolvePageRange('current', 4, 2), [2]);
    assert.deepEqual(resolvePageRange({ from: 2, to: 5 }, 8, 0), [1, 2, 3, 4]);
    assert.deepEqual(resolvePageRange({ from: 3, to: 3 }, 8, 0), [2]);
  });

  test('clamps out-of-range input into the notebook', () => {
    assert.deepEqual(resolvePageRange('current', 3, 9), [2]);
    assert.deepEqual(resolvePageRange('current', 3, -4), [0]);
    assert.deepEqual(resolvePageRange({ from: 0, to: 99 }, 3, 0), [0, 1, 2]);
    assert.deepEqual(resolvePageRange({ from: 5, to: 2 }, 6, 0), [1, 2, 3, 4], 'reversed ends are swapped');
    assert.deepEqual(resolvePageRange({ from: Number.NaN, to: 2 }, 6, 0), [0, 1]);
  });

  test('an empty notebook exports nothing', () => {
    assert.deepEqual(resolvePageRange('all', 0, 0), []);
    assert.deepEqual(resolvePageRange('current', 0, 0), []);
    assert.deepEqual(resolvePageRange({ from: 1, to: 3 }, 0, 0), []);
    assert.equal(rangeCount('all', 0, 0), 0);
    assert.equal(rangeCount({ from: 2, to: 5 }, 10, 0), 4);
  });
});

describe('range steppers', () => {
  test('default span is the whole notebook', () => {
    assert.deepEqual(defaultSpan(7), { from: 1, to: 7 });
    assert.deepEqual(defaultSpan(0), { from: 1, to: 1 });
  });

  test('clampSpan keeps 1 <= from <= to <= N', () => {
    assert.deepEqual(clampSpan({ from: -3, to: 40 }, 10), { from: 1, to: 10 });
    assert.deepEqual(clampSpan({ from: 6, to: 2 }, 10), { from: 2, to: 6 });
    assert.deepEqual(clampSpan({ from: 2.6, to: 4.2 }, 10), { from: 3, to: 4 });
  });

  test('from never passes to, to never goes under from', () => {
    const n = 8;
    let s = { from: 2, to: 5 };
    assert.equal(canStepRange(s, 'from', +1, n), true);
    s = stepRange(s, 'from', +1, n);
    assert.deepEqual(s, { from: 3, to: 5 });
    s = stepRange(stepRange(s, 'from', +1, n), 'from', +1, n);
    assert.deepEqual(s, { from: 5, to: 5 });
    assert.equal(canStepRange(s, 'from', +1, n), false);
    assert.deepEqual(stepRange(s, 'from', +1, n), { from: 5, to: 5 }, 'blocked at to');
    assert.equal(canStepRange(s, 'to', -1, n), false);
    assert.deepEqual(stepRange(s, 'to', -1, n), { from: 5, to: 5 }, 'blocked at from');
    assert.equal(canStepRange(s, 'to', +1, n), true);
  });

  test('ends stop at 1 and N', () => {
    const n = 4;
    assert.equal(canStepRange({ from: 1, to: 4 }, 'from', -1, n), false);
    assert.equal(canStepRange({ from: 1, to: 4 }, 'to', +1, n), false);
    assert.deepEqual(stepRange({ from: 1, to: 4 }, 'from', -1, n), { from: 1, to: 4 });
    assert.deepEqual(stepRange({ from: 1, to: 4 }, 'to', +5, n), { from: 1, to: 4 });
    assert.equal(canStepRange({ from: 1, to: 4 }, 'to', 0, n), false);
  });

  test('setRangeEnd moves the other end along when crossed', () => {
    assert.deepEqual(setRangeEnd({ from: 2, to: 4 }, 'from', 6, 10), { from: 6, to: 6 });
    assert.deepEqual(setRangeEnd({ from: 5, to: 8 }, 'to', 3, 10), { from: 3, to: 3 });
    assert.deepEqual(setRangeEnd({ from: 2, to: 4 }, 'to', 99, 10), { from: 2, to: 10 });
  });

  test('chip label', () => {
    assert.equal(rangeChipLabel({ from: 2, to: 5 }, 'ar'), 'نطاق: 2 – 5');
    assert.equal(rangeChipLabel({ from: 1, to: 12 }, 'en'), 'Range: 1 – 12');
  });
});

describe('exportFileName', () => {
  test('strips path, reserved and bidi characters', () => {
    assert.equal(exportFileName('محاضرة 5 — المصفوفات', 'pdf', 'مذكرة'), 'محاضرة 5 — المصفوفات.pdf');
    assert.equal(exportFileName('a/b\\c:d*e?"f<g>h|', 'pdf', 'x'), 'a b c d e f g h.pdf');
    assert.equal(exportFileName('‮evil‬', 'png', 'x'), 'evil.png');
    assert.equal(exportFileName('...hidden', 'pdf', 'x'), 'hidden.pdf');
  });

  test('falls back for an empty title and caps the length', () => {
    assert.equal(exportFileName('   ', 'pdf', 'مذكرة'), 'مذكرة.pdf');
    assert.equal(exportFileName('', 'PNG', ''), 'export.png');
    assert.equal(exportFileName('x'.repeat(200), 'pdf', 'y').length, 80 + 4);
  });
});
