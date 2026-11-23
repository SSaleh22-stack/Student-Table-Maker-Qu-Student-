import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HISTORY_LIMIT, HISTORY_MAX_BYTES, createHistory, patchBytes } from '../../../src/notebook/core/model/index.ts';
import type { HistoryEntry, Patch } from '../../../src/notebook/core/model/index.ts';

const meta = (n: number): Patch => ({ t: 'meta', before: { title: `t${n}` }, after: { title: `t${n + 1}` } });
const entry = (id: string, bytes = 10, patches: Patch[] = [meta(0)]): HistoryEntry => ({ id, label: id, patches, at: 0, bytes });

describe('history', () => {
  test('defaults: 200 entries and 8 MB', () => {
    assert.equal(HISTORY_LIMIT, 200);
    assert.equal(HISTORY_MAX_BYTES, 8 * 1024 * 1024);
    const h = createHistory();
    for (let i = 0; i < 250; i++) h.push(entry(`e${i}`));
    assert.equal(h.stats().undo, 200);
    // The oldest were dropped.
    let last: HistoryEntry | null = null;
    let n = 0;
    while (h.canUndo()) {
      last = h.undo();
      n++;
    }
    assert.equal(n, 200);
    assert.equal(last?.id, 'e50');
  });

  test('undo, redo, top and a push clearing redo', () => {
    const h = createHistory();
    assert.equal(h.top(), null);
    assert.equal(h.undo(), null);
    h.push(entry('a'));
    h.push(entry('b'));
    assert.equal(h.top()?.id, 'b');
    assert.ok(h.isTop('b'));
    assert.equal(h.undo()?.id, 'b');
    assert.equal(h.top()?.id, 'a');
    assert.ok(h.canRedo());
    assert.equal(h.redo()?.id, 'b');
    assert.equal(h.redo(), null);
    h.undo();
    h.push(entry('c'));
    assert.ok(!h.canRedo());
    assert.equal(h.top()?.id, 'c');
    h.clear();
    assert.ok(!h.canUndo() && !h.canRedo());
    assert.equal(h.stats().bytes, 0);
  });

  test('byte cap drops the oldest entries, and counts undone (redo) entries too', () => {
    const h = createHistory({ maxBytes: 1000 });
    for (let i = 0; i < 10; i++) h.push(entry(`e${i}`, 300));
    assert.equal(h.stats().undo, 3);
    assert.equal(h.stats().bytes, 900);
    assert.equal(h.top()?.id, 'e9');
    h.undo();
    h.undo();
    assert.deepEqual(h.stats(), { undo: 1, redo: 2, bytes: 900 });
    h.push(entry('big', 950));
    // Redo is cleared by the push; then e7 is dropped to make room.
    assert.deepEqual(h.stats(), { undo: 1, redo: 0, bytes: 950 });
    assert.equal(h.top()?.id, 'big');
  });

  test('a single entry over the cap is still kept (the newest)', () => {
    const h = createHistory({ maxBytes: 100 });
    h.push(entry('a', 50));
    h.push(entry('huge', 500));
    assert.equal(h.stats().undo, 1);
    assert.equal(h.top()?.id, 'huge');
  });

  test('missing bytes are computed from the patches', () => {
    const h = createHistory();
    const p = meta(1);
    h.push({ id: 'x', label: 'x', patches: [p], at: 0, bytes: Number.NaN });
    assert.equal(h.stats().bytes, patchBytes(p));
    // A zero size with patches is measured too, so a forgetful caller cannot skip the cap.
    h.push({ id: 'y', label: 'y', patches: [p], at: 0, bytes: 0 });
    assert.equal(h.stats().bytes, 2 * patchBytes(p));
    h.push({ id: 'z', label: 'z', patches: [], at: 0, bytes: 0 });
    assert.equal(h.stats().bytes, 2 * patchBytes(p));
  });

  test('groups merge pushes into one entry with the first id and the group label', () => {
    const h = createHistory();
    h.push(entry('before'));
    h.beginGroup('نقل');
    assert.ok(h.inGroup());
    h.push(entry('g1', 5, [meta(1)]));
    h.beginGroup('inner');
    h.push(entry('g2', 7, [meta(2)]));
    h.endGroup();
    h.push(entry('g3', 1, [meta(3)]));
    h.endGroup();
    assert.ok(!h.inGroup());
    const top = h.top();
    assert.ok(top);
    assert.equal(top.id, 'g1');
    assert.equal(top.label, 'نقل');
    assert.equal(top.patches.length, 3);
    assert.equal(top.bytes, 13);
    assert.equal(h.stats().undo, 2);
    h.push(entry('after'));
    assert.equal(h.stats().undo, 3);
  });

  test('an empty group adds nothing; undo closes an open group', () => {
    const h = createHistory();
    h.beginGroup('x');
    h.endGroup();
    assert.equal(h.stats().undo, 0);
    h.beginGroup('y');
    h.push(entry('a'));
    assert.equal(h.undo()?.id, 'a');
    assert.ok(!h.inGroup());
    h.push(entry('b'));
    h.push(entry('c'));
    assert.equal(h.stats().undo, 2);
  });

  test('dropWhere removes matching entries from both stacks', () => {
    const h = createHistory();
    h.push(entry('a'));
    h.push(entry('b'));
    h.push(entry('c'));
    h.undo();
    h.dropWhere((e) => e.id === 'a' || e.id === 'c');
    assert.deepEqual(h.stats(), { undo: 1, redo: 0, bytes: 10 });
  });
});
