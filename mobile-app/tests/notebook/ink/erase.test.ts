import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { eraseItems, pathHitsItem, splitPolyline, splitShapeByEraser, splitStrokeByEraser } from '../../../src/notebook/core/ink/erase.ts';
import type { PageItem, ShapeItem, StrokeItem } from '../../../src/notebook/core/model/types.ts';

function ids(): () => string {
  let n = 0;
  return () => 'new' + ++n;
}

const line = (id: string, o: Partial<StrokeItem> = {}): StrokeItem => ({
  id,
  kind: 'stroke',
  tool: 'pen',
  color: '#DC2626',
  width: 3,
  pressure: true,
  pts: [0, 0, 0.3, 50, 0, 0.5, 100, 0, 0.7],
  rec: { recordingId: 'rec1', ms: 4200 },
  at: 1790000000000,
  ...o,
});

describe('pixel eraser', () => {
  test('a pass through the middle gives two strokes with the same style and rec', () => {
    const s = line('s1');
    const pieces = splitStrokeByEraser(s, [50, -20, 50, 20], 5, ids());
    assert.ok(pieces);
    assert.equal(pieces.length, 2);
    const [a, b] = pieces;
    assert.equal(a.id, 's1'); // the first piece keeps the id (replaced in place)
    assert.equal(b.id, 'new1');
    for (const p of pieces) {
      assert.equal(p.kind, 'stroke');
      assert.equal(p.tool, 'pen');
      assert.equal(p.color, '#DC2626');
      assert.equal(p.width, 3);
      assert.equal(p.pressure, true);
      assert.deepEqual(p.rec, { recordingId: 'rec1', ms: 4200 });
      assert.equal(p.at, 1790000000000);
    }
    // The cut lands where the ink edge meets the eraser: |x - 50| = 5 + half width at that pressure.
    // Pen with pressure, width 3: half width = 3 * (0.25 + 0.5 * p); p runs 0.3 -> 0.5 -> 0.7.
    const aEnd = a.pts.slice(-3);
    const bStart = b.pts.slice(0, 3);
    const half = (p: number) => 3 * (0.25 + 0.5 * p);
    assert.ok(Math.abs(aEnd[0] - 43.8 / 1.006) < 0.01, String(aEnd[0]));
    assert.ok(Math.abs(bStart[0] - (50 + 6.5 / 0.994)) < 0.01, String(bStart[0]));
    assert.ok(Math.abs(50 - aEnd[0] - (5 + half(aEnd[2]))) < 0.01);
    assert.ok(Math.abs(bStart[0] - 50 - (5 + half(bStart[2]))) < 0.01);
    assert.ok(Math.abs(aEnd[2] - (0.3 + 0.004 * aEnd[0])) < 1e-6); // pressure interpolated
    assert.deepEqual(a.pts.slice(0, 3), [0, 0, 0.3]);
    assert.deepEqual(b.pts.slice(-3), [100, 0, 0.7]);
    // the rec object is a copy
    assert.notEqual(a.rec, s.rec);
  });

  test('untouched, fully erased, an end trimmed, and several cuts', () => {
    assert.equal(splitStrokeByEraser(line('s'), [50, 30, 60, 40], 5, ids()), null);
    assert.deepEqual(splitStrokeByEraser(line('s'), [-10, 0, 110, 0], 5, ids()), []);
    const trimmed = splitStrokeByEraser(line('s'), [100, -10, 100, 10], 4, ids());
    assert.ok(trimmed && trimmed.length === 1);
    const tEnd = trimmed[0].pts.slice(-3);
    assert.ok(Math.abs(100 - tEnd[0] - (4 + 3 * (0.25 + 0.5 * tEnd[2]))) < 0.01, String(tEnd[0]));
    // a zig-zag eraser crossing three times gives four pieces
    const many = splitStrokeByEraser(line('s'), [20, -10, 20, 10, 40, 10, 40, -10, 60, -10, 60, 10], 2, ids());
    assert.ok(many);
    assert.equal(many.length, 4);
    assert.deepEqual(
      many.map((p) => p.id),
      ['s', 'new1', 'new2', 'new3'],
    );
  });

  test('a single-point eraser path and a dot stroke', () => {
    const pieces = splitStrokeByEraser(line('s'), [50, 1], 3, ids());
    assert.ok(pieces && pieces.length === 2);
    const dot = line('d', { pts: [10, 10, 0.5] });
    assert.deepEqual(splitStrokeByEraser(dot, [11, 10], 3, ids()), []);
    assert.equal(splitStrokeByEraser(dot, [30, 10], 3, ids()), null);
  });

  test('a thick highlighter opens up: the remaining caps end at the eraser edge', () => {
    // width 30 (half 15), eraser radius 10: without the ink-width pad the caps would close the gap
    const hl = line('h', { tool: 'highlighter', width: 30, pressure: false, pts: [0, 0, 0.5, 200, 0, 0.5] });
    const pieces = splitStrokeByEraser(hl, [100, -40, 100, 40], 10, ids());
    assert.ok(pieces && pieces.length === 2);
    const aEnd = pieces[0].pts[pieces[0].pts.length - 3];
    const bStart = pieces[1].pts[0];
    assert.ok(Math.abs(aEnd - 75) < 0.01, String(aEnd));
    assert.ok(Math.abs(bStart - 125) < 0.01, String(bStart));
    // a visible gap of 2 * radius remains between the round caps
    assert.ok(Math.abs(bStart - 15 - (aEnd + 15) - 20) < 0.02);
  });

  test('splitPolyline drops specks shorter than 0.5 pt', () => {
    const runs = splitPolyline([0, 0, 10.3, 0], 2, [5, -5, 5, 5, 10, -5], 5);
    assert.ok(runs);
    for (const r of runs) {
      let len = 0;
      for (let i = 2; i < r.length; i += 2) len += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
      assert.ok(len >= 0.5);
    }
  });

  test('an unfilled shape is cut into plain strokes', () => {
    const sq: ShapeItem = { id: 'sq', kind: 'shape', shape: 'rect', color: '#1D4ED8', width: 2, fill: null, highlighter: true, box: { x: 0, y: 0, w: 40, h: 40, rot: 0 } };
    const pieces = splitShapeByEraser(sq, [20, -5, 20, 5], 3, ids());
    assert.ok(pieces);
    assert.equal(pieces.length, 1); // the closed outline opened at one place stays one piece
    assert.equal(pieces[0].tool, 'highlighter');
    assert.equal(pieces[0].pressure, false);
    assert.equal(pieces[0].id, 'sq');
  });
});

describe('eraseItems', () => {
  const pen = line('pen', { pts: [0, 0, 0.5, 100, 0, 0.5] });
  const hl = line('hl', { tool: 'highlighter', width: 18, pressure: false, pts: [0, 10, 0.5, 100, 10, 0.5] });
  const filled: ShapeItem = { id: 'f', kind: 'shape', shape: 'ellipse', color: '#000000', width: 2, fill: '#FDE047', box: { x: 40, y: -20, w: 20, h: 60, rot: 0 } };
  const text: PageItem = { id: 't', kind: 'text', box: { x: 0, y: -30, w: 100, h: 80, rot: 0 }, text: 'x', size: 16, color: '#000000', bold: false };
  const items: PageItem[] = [pen, hl, filled, text];
  const path = [50, -40, 50, 40];

  test('stroke mode removes every touched stroke and shape, never text', () => {
    const r = eraseItems(items, path, 4, { mode: 'stroke', highlighterOnly: false, newId: ids() });
    assert.deepEqual(r.removeIds, ['pen', 'hl', 'f']);
    assert.deepEqual(r.add, []);
  });

  test('highlighterOnly leaves pen strokes untouched', () => {
    const r = eraseItems(items, path, 4, { mode: 'stroke', highlighterOnly: true, newId: ids() });
    assert.deepEqual(r.removeIds, ['hl']);
    const px = eraseItems(items, path, 4, { mode: 'pixel', highlighterOnly: true, newId: ids() });
    assert.deepEqual(px.removeIds, []);
    assert.deepEqual(
      px.add.map((i) => i.id),
      ['hl', 'new1'],
    );
    assert.ok(px.add.every((i) => i.kind === 'stroke' && i.tool === 'highlighter'));
  });

  test('pixel mode splits strokes and removes filled shapes whole', () => {
    const r = eraseItems(items, path, 4, { mode: 'pixel', highlighterOnly: false, newId: ids() });
    assert.deepEqual(r.removeIds, ['f']);
    assert.deepEqual(
      r.add.map((i) => i.id),
      ['pen', 'new1', 'hl', 'new2'],
    );
  });

  test('nothing touched gives empty lists; pathHitsItem with a bbox prefilter', () => {
    const r = eraseItems(items, [500, 500, 510, 510], 4, { mode: 'pixel', highlighterOnly: false, newId: ids() });
    assert.deepEqual(r, { removeIds: [], add: [] });
    assert.equal(pathHitsItem(pen, [50, 3], 2), true);
    assert.equal(pathHitsItem(pen, [50, 8], 2), false);
    assert.equal(pathHitsItem(pen, [], 2), false);
  });
});
