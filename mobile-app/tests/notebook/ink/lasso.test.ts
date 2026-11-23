import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { boxInLasso, fractionInside, itemInLasso, selectByLasso } from '../../../src/notebook/core/ink/lasso.ts';
import type { ImageItem, PageItem, ShapeItem, StrokeItem, TextItem } from '../../../src/notebook/core/model/types.ts';

const stroke = (id: string, pts: number[]): StrokeItem => ({ id, kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: false, pts });
/** A horizontal stroke of 10 points from x0 to x0 + 90 at y. */
const row = (id: string, x0: number, y: number): StrokeItem => {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) pts.push(x0 + i * 10, y, 0.5);
  return stroke(id, pts);
};
const LASSO = [0, 0, 100, 0, 100, 100, 0, 100];

describe('lasso rules', () => {
  test('strokes need at least half of their points inside', () => {
    assert.equal(fractionInside(LASSO, row('a', 5, 50).pts, 3), 1);
    assert.equal(itemInLasso(LASSO, row('half', 55, 50)), true); // 55..95 inside = 5 of 10
    assert.equal(itemInLasso(LASSO, row('less', 65, 50)), false); // 4 of 10
    assert.equal(itemInLasso(LASSO, stroke('dot', [50, 50, 0.5])), true);
  });

  test('boxed items need the center inside or 3 corners inside', () => {
    const img = (x: number, y: number, w: number, h: number, rot = 0): ImageItem => ({ id: 'i', kind: 'image', fileId: 'f', box: { x, y, w, h, rot }, crop: null });
    assert.equal(itemInLasso(LASSO, img(90, 90, 30, 30)), false); // 1 corner, center outside
    assert.equal(itemInLasso(LASSO, img(70, 70, 50, 50)), true); // center (95, 95) inside
    // a concave lasso holding 3 corners but not the center
    const lshape = [0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100];
    const b = { x: 10, y: 10, w: 80, h: 80, rot: 0 };
    assert.equal(boxInLasso(lshape, b), true);
    const text: TextItem = { id: 't', kind: 'text', box: { x: 60, y: 60, w: 80, h: 80, rot: 0 }, text: 'x', size: 16, color: '#000000', bold: false };
    assert.equal(itemInLasso(LASSO, text), false);
  });

  test('point shapes count by length, box shapes by the box rule', () => {
    const lineShape: ShapeItem = { id: 'l', kind: 'shape', shape: 'line', color: '#000000', width: 2, fill: null, pts: [10, 50, 180, 50] };
    assert.equal(itemInLasso(LASSO, lineShape), true); // 45 of 86 samples inside
    const longer: ShapeItem = { ...lineShape, pts: [10, 50, 210, 50] };
    assert.equal(itemInLasso(LASSO, longer), false);
    const rect: ShapeItem = { id: 'r', kind: 'shape', shape: 'rect', color: '#000000', width: 2, fill: null, box: { x: 20, y: 20, w: 30, h: 30, rot: 0.4 } };
    assert.equal(itemInLasso(LASSO, rect), true);
    const tri: ShapeItem = { id: 'tr', kind: 'shape', shape: 'triangle', color: '#000000', width: 2, fill: null, pts: [10, 10, 90, 10, 50, 90] };
    assert.equal(itemInLasso(LASSO, tri), true);
  });

  test('selectByLasso keeps item order and needs a polygon', () => {
    const items: PageItem[] = [row('out', 300, 300), row('in1', 5, 10), row('in2', 5, 90)];
    assert.deepEqual(selectByLasso(items, LASSO), ['in1', 'in2']);
    assert.deepEqual(selectByLasso(items, [0, 0, 100, 100]), []);
  });
});
