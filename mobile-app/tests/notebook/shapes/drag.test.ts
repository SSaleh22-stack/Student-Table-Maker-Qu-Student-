import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SHAPE_MIN_DRAG, shapeFromDrag } from '../../../src/notebook/core/shapes/drag.ts';

const style = { color: '#1B2533', width: 3 };

describe('shapeFromDrag (the shape tool and its live preview)', () => {
  test('a rectangle is the dragged box, from any corner', () => {
    assert.deepEqual(shapeFromDrag('rect', 10, 10, 110, 60, style, 'a')?.box, { x: 10, y: 10, w: 100, h: 50, rot: 0 });
    assert.deepEqual(shapeFromDrag('rect', 110, 60, 10, 10, style, 'a')?.box, { x: 10, y: 10, w: 100, h: 50, rot: 0 });
  });

  test('nearly equal sides make a square', () => {
    const b = shapeFromDrag('rect', 0, 0, 100, 95, style, 'a')?.box;
    assert.equal(b?.w, 100);
    assert.equal(b?.h, 100);
  });

  test('a triangle has its apex at the top middle', () => {
    assert.deepEqual(shapeFromDrag('triangle', 0, 0, 100, 80, style, 'a')?.pts, [50, 0, 100, 80, 0, 80]);
  });

  test('lines and arrows keep both ends', () => {
    assert.deepEqual(shapeFromDrag('arrow', 1, 2, 50, 60, style, 'a')?.pts, [1, 2, 50, 60]);
  });

  test('a tiny drag adds nothing', () => {
    assert.equal(shapeFromDrag('rect', 0, 0, SHAPE_MIN_DRAG - 1, 1, style, 'a'), null);
    assert.equal(shapeFromDrag('line', 0, 0, 1, 1, style, 'a'), null);
  });
});
