import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { itemBounds } from '../../../src/notebook/core/ink/bounds.ts';
import {
  matApply,
  matApplyFlat,
  matDeterminant,
  matIdentity,
  matInvert,
  matIsIdentity,
  matMultiply,
  matRotate,
  matRotateAt,
  matRotation,
  matScale,
  matScaleAt,
  matTranslate,
  matUniformScale,
} from '../../../src/notebook/core/ink/matrix.ts';
import { applyMatrixToBox, applyMatrixToItem, applyMatrixToItems, scaleAbout, translateItem } from '../../../src/notebook/core/ink/transform.ts';
import type { ImageItem, ShapeItem, StrokeItem, TextItem } from '../../../src/notebook/core/model/types.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

describe('matrix', () => {
  test('compose, apply and invert', () => {
    const m = matMultiply(matTranslate(10, 5), matScale(2)); // scale first, then move
    assert.deepEqual(matApply(m, 1, 1), [12, 7]);
    const inv = matInvert(m);
    assert.ok(inv);
    const p = matApply(inv, 12, 7);
    close(p[0], 1);
    close(p[1], 1);
    assert.ok(matIsIdentity(matMultiply(m, inv)));
    assert.equal(matInvert([0, 0, 0, 0, 1, 1]), null);
    assert.equal(matDeterminant(matScale(2, 3)), 6);
    close(matUniformScale(matScale(2, 8)), 4);
    close(matRotation(matRotate(0.7)), 0.7);
    assert.deepEqual(matIdentity(), [1, 0, 0, 1, 0, 0]);
  });

  test('about a point', () => {
    const r = matApply(matRotateAt(10, 10, Math.PI / 2), 20, 10);
    close(r[0], 10);
    close(r[1], 20); // y-down: +90° turns clockwise on screen
    assert.deepEqual(matApply(matScaleAt(10, 10, 2), 20, 10), [30, 10]);
    assert.deepEqual(matApplyFlat(matTranslate(1, 2), [0, 0, 0.4, 5, 5, 0.6], 3), [1, 2, 0.4, 6, 7, 0.6]);
  });
});

describe('applyMatrixToItem', () => {
  const s: StrokeItem = { id: 's', kind: 'stroke', tool: 'pen', color: '#000000', width: 3, pressure: true, pts: [0, 0, 0.2, 10, 0, 0.8], rec: { recordingId: 'r', ms: 5 } };

  test('strokes: points move, pressure kept, width scales with sqrt(|det|)', () => {
    const out = applyMatrixToItem(s, matScaleAt(0, 0, 2));
    assert.deepEqual(out.pts, [0, 0, 0.2, 20, 0, 0.8]);
    assert.equal(out.width, 6);
    assert.deepEqual(out.rec, s.rec);
    assert.equal(applyMatrixToItem(s, matScale(2), { scaleWidth: false }).width, 3);
    assert.deepEqual(s.pts, [0, 0, 0.2, 10, 0, 0.8]); // input unchanged
    assert.deepEqual(translateItem(s, 5, 1).pts, [5, 1, 0.2, 15, 1, 0.8]);
  });

  test('boxes: rotation adds, scale follows the box axes', () => {
    const b = applyMatrixToBox({ x: 0, y: 0, w: 20, h: 10, rot: 0 }, matRotateAt(10, 5, 0.5));
    close(b.rot, 0.5);
    close(b.w, 20);
    close(b.h, 10);
    close(b.x, 0);
    close(b.y, 0);
    // non-uniform scale of an unrotated box
    const c = applyMatrixToBox({ x: 0, y: 0, w: 20, h: 10, rot: 0 }, matScaleAt(0, 0, 2, 3));
    assert.deepEqual(c, { x: 0, y: 0, w: 40, h: 30, rot: 0 });
    // full turn normalises
    const d = applyMatrixToBox({ x: 0, y: 0, w: 4, h: 4, rot: 3 }, matRotateAt(2, 2, 1));
    assert.ok(d.rot > -Math.PI && d.rot <= Math.PI);
    close(Math.cos(d.rot), Math.cos(4));
  });

  test('shapes, text and images', () => {
    const rect: ShapeItem = { id: 'r', kind: 'shape', shape: 'rect', color: '#000000', width: 2, fill: null, box: { x: 0, y: 0, w: 10, h: 10, rot: 0 } };
    const r2 = applyMatrixToItem(rect, matScaleAt(0, 0, 3));
    assert.deepEqual(r2.box, { x: 0, y: 0, w: 30, h: 30, rot: 0 });
    close(r2.width, 6);
    const line: ShapeItem = { id: 'l', kind: 'shape', shape: 'line', color: '#000000', width: 2, fill: null, pts: [0, 0, 10, 0] };
    assert.deepEqual(applyMatrixToItem(line, matTranslate(1, 1)).pts, [1, 1, 11, 1]);
    const t: TextItem = { id: 't', kind: 'text', box: { x: 0, y: 0, w: 100, h: 20, rot: 0 }, text: 'نص', size: 16, color: '#000000', bold: true };
    const ts = applyMatrixToItem(t, matScaleAt(0, 0, 2));
    assert.equal(ts.size, 32);
    assert.deepEqual(ts.box, { x: 0, y: 0, w: 200, h: 40, rot: 0 });
    const tr = applyMatrixToItem(t, matScaleAt(0, 0, 2, 1), { textMode: 'reflow' });
    assert.equal(tr.size, 16);
    assert.equal(tr.box.w, 200);
    assert.equal(tr.box.h, 20);
    const img: ImageItem = { id: 'i', kind: 'image', fileId: 'f', box: { x: 0, y: 0, w: 10, h: 10, rot: 0 }, crop: { x: 0.1, y: 0, w: 0.5, h: 1 } };
    const i2 = applyMatrixToItem(img, matTranslate(5, 5));
    assert.deepEqual(i2.box, { x: 5, y: 5, w: 10, h: 10, rot: 0 });
    assert.deepEqual(i2.crop, img.crop);
    assert.notEqual(i2.crop, img.crop);
    assert.equal(applyMatrixToItems([rect, line], matTranslate(1, 0)).length, 2);
  });

  test('scaleAbout keeps the selection centered (preset resize)', () => {
    const items = [s];
    const before = itemBounds(s);
    const m = scaleAbout(before, 2);
    const after = itemBounds(applyMatrixToItem(items[0], m));
    close((after[0] + after[2]) / 2, (before[0] + before[2]) / 2);
    close((after[1] + after[3]) / 2, (before[1] + before[3]) / 2);
    close(after[2] - after[0], (before[2] - before[0]) * 2);
  });
});
