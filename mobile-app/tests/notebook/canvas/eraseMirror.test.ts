import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  appendedItems,
  emptyMirror,
  MIRROR_HIGHLIGHTER,
  MIRROR_MAX_POINTS,
  mirrorAppend,
  mirrorFromItems,
  mirrorHits,
} from '../../../src/notebook/core/canvas/eraseMirror.ts';
import { itemsIntersectingSegment } from '../../../src/notebook/core/ink/hittest.ts';
import type { ImageItem, PageItem, ShapeItem, StrokeItem, TextItem } from '../../../src/notebook/core/model/index.ts';

function stroke(id: string, pts: number[][], tool: 'pen' | 'highlighter' = 'pen', width = 2): StrokeItem {
  return { id, kind: 'stroke', tool, color: '#1B2533', width, pressure: false, pts: pts.flatMap(([x, y]) => [x, y, 0.5]) };
}
const rect: ShapeItem = { id: 'rect', kind: 'shape', shape: 'rect', color: '#1D4ED8', width: 3, fill: null, box: { x: 300, y: 300, w: 100, h: 60, rot: 0 } };
const hlLine: ShapeItem = { id: 'hlLine', kind: 'shape', shape: 'line', color: '#FDE047', width: 14, fill: null, highlighter: true, pts: [0, 500, 200, 500] };
const text: TextItem = { id: 'text', kind: 'text', box: { x: 0, y: 0, w: 100, h: 30, rot: 0 }, text: 'مرحبا', size: 18, color: '#1B2533', bold: false };
const image: ImageItem = { id: 'img', kind: 'image', fileId: 'f1', box: { x: 0, y: 0, w: 50, h: 50, rot: 0 }, crop: null };

const a = stroke('a', [
  [10, 10],
  [100, 10],
  [200, 10],
]);
const b = stroke('b', [
  [10, 100],
  [10, 200],
]);
const hl = stroke(
  'hl',
  [
    [0, 50],
    [300, 50],
  ],
  'highlighter',
  14,
);
const items: PageItem[] = [text, a, image, b, hl, rect, hlLine];

describe('mirror format', () => {
  test('only strokes and shapes, in page order, with offsets and flags', () => {
    const m = mirrorFromItems(items);
    assert.deepEqual(m.ids, ['a', 'b', 'hl', 'rect', 'hlLine']);
    assert.equal(m.bboxes.length, 5 * 5);
    assert.equal(m.offsets.length, m.ids.length + 1);
    assert.equal(m.offsets[0], 0);
    assert.equal(m.offsets[m.offsets.length - 1], m.pts.length);
    assert.deepEqual(m.flags, [0, 0, MIRROR_HIGHLIGHTER, 0, MIRROR_HIGHLIGHTER]);
    assert.equal(m.big, false);
    assert.equal(m.points, m.pts.length / 2);
    assert.deepEqual(m.pts.slice(m.offsets[0], m.offsets[1]), [10, 10, 100, 10, 200, 10]);
    // The closed rect repeats its first corner.
    const r = m.pts.slice(m.offsets[3], m.offsets[4]);
    assert.equal(r.length, 10);
    assert.deepEqual(r.slice(0, 2), r.slice(8, 10));
    // halfWidth in the 5th bbox slot.
    assert.equal(m.bboxes[3 * 5 + 4], 1.5);
  });

  test('empty page', () => {
    const m = mirrorFromItems([]);
    assert.deepEqual(m, emptyMirror());
    assert.deepEqual(mirrorHits(m, [0, 0, 10, 10], 5, false), []);
  });
});

describe('hits', () => {
  const m = mirrorFromItems(items);

  test('a segment across strokes hits them (same answer as itemsIntersectingSegment)', () => {
    const hits = mirrorHits(m, [50, 0, 50, 120], 4, false);
    assert.deepEqual(hits, ['a', 'hl']);
    assert.deepEqual(hits, itemsIntersectingSegment(items, 50, 0, 50, 120, 4));
  });

  test('ink width counts: a point near a thick highlighter edge', () => {
    assert.deepEqual(mirrorHits(m, [150, 58, 150, 58], 2, false), ['hl']);
    assert.deepEqual(mirrorHits(m, [150, 70, 150, 70], 2, false), []);
  });

  test('highlighterOnly keeps only highlighter items', () => {
    assert.deepEqual(mirrorHits(m, [50, 0, 50, 120], 4, true), ['hl']);
    assert.deepEqual(mirrorHits(m, [100, 490, 100, 510], 2, true), ['hlLine']);
  });

  test('shape outlines are hit on their edge, not inside', () => {
    assert.deepEqual(mirrorHits(m, [300, 330, 300, 330], 3, false), ['rect']);
    assert.deepEqual(mirrorHits(m, [350, 330, 350, 330], 3, false), []);
  });

  test('already erased ids are skipped', () => {
    assert.deepEqual(mirrorHits(m, [50, 0, 50, 120], 4, false, ['a']), ['hl']);
  });

  test('text and images are never hit', () => {
    const hits = mirrorHits(m, [0, 0, 60, 30], 10, false);
    assert.ok(!hits.includes('text') && !hits.includes('img'));
  });
});

describe('incremental append', () => {
  test('appendedItems detects a pure append', () => {
    const c = stroke('c', [
      [0, 0],
      [1, 1],
    ]);
    assert.deepEqual(
      appendedItems(items, [...items, c])?.map((i) => i.id),
      ['c'],
    );
    assert.deepEqual(appendedItems(items, items), []);
    assert.equal(appendedItems(items, items.slice(1)), null);
    const replaced = items.slice();
    replaced[1] = { ...a };
    assert.equal(appendedItems(items, replaced), null);
  });

  test('append equals a rebuild', () => {
    const c = stroke('c', [
      [500, 500],
      [600, 600],
    ]);
    const m = mirrorFromItems(items);
    mirrorAppend(m, [c]);
    assert.deepEqual(m, mirrorFromItems([...items, c]));
  });

  test('a page over the point budget becomes big and keeps ids only', () => {
    const n = Math.ceil(MIRROR_MAX_POINTS / 2) + 10;
    const long1 = stroke(
      'l1',
      Array.from({ length: n }, (_, i) => [i, 0]),
    );
    const long2 = stroke(
      'l2',
      Array.from({ length: n }, (_, i) => [i, 10]),
    );
    const m = mirrorFromItems([long1]);
    assert.equal(m.big, false);
    mirrorAppend(m, [long2, a]);
    assert.equal(m.big, true);
    assert.deepEqual(m.ids, ['l1', 'l2', 'a']);
    assert.deepEqual(m.pts, []);
    assert.deepEqual(m.bboxes, []);
    assert.ok(m.points > MIRROR_MAX_POINTS);
    assert.deepEqual(mirrorHits(m, [0, 0, 10, 10], 5, false), [], 'big mirrors hit-test on JS');
  });
});
