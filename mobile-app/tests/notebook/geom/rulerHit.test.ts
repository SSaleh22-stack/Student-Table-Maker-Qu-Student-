import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { rulerContains, rulerCorners, rulerLocal } from '../../../src/notebook/core/geom/rulerHit.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('rulerContains', () => {
  const L = 600;
  const W = 60;

  test('level ruler: inside, edges and outside', () => {
    assert.ok(rulerContains(400, 300, 400, 300, 0, L, W));
    assert.ok(rulerContains(100, 330, 400, 300, 0, L, W)); // left end, bottom edge
    assert.ok(rulerContains(700, 270, 400, 300, 0, L, W)); // right end, top edge
    assert.ok(!rulerContains(701, 300, 400, 300, 0, L, W));
    assert.ok(!rulerContains(400, 331, 400, 300, 0, L, W));
    assert.ok(!rulerContains(99, 300, 400, 300, 0, L, W));
  });

  test('rotated 90 degrees: the long axis is vertical', () => {
    const a = Math.PI / 2;
    assert.ok(rulerContains(400, 590, 400, 300, a, L, W));
    assert.ok(rulerContains(425, 20, 400, 300, a, L, W));
    assert.ok(!rulerContains(600, 300, 400, 300, a, L, W));
    assert.ok(!rulerContains(400, 601, 400, 300, a, L, W));
  });

  test('rotated 30 degrees (y down: clockwise on screen)', () => {
    const a = Math.PI / 6;
    const along = 250;
    const across = 25;
    const x = 400 + along * Math.cos(a) - across * Math.sin(a);
    const y = 300 + along * Math.sin(a) + across * Math.cos(a);
    assert.ok(rulerContains(x, y, 400, 300, a, L, W));
    // The same offset on an unrotated ruler would be outside the width.
    assert.ok(!rulerContains(400 + 250 * Math.cos(a), 300 - 250 * Math.sin(a), 400, 300, a, L, W));
  });

  test('slop widens every side', () => {
    assert.ok(!rulerContains(400, 340, 400, 300, 0, L, W));
    assert.ok(rulerContains(400, 340, 400, 300, 0, L, W, 10));
    assert.ok(rulerContains(710, 300, 400, 300, 0, L, W, 10));
  });

  test('bad numbers never hit', () => {
    assert.ok(!rulerContains(Number.NaN, 300, 400, 300, 0, L, W));
    assert.ok(!rulerContains(400, 300, 400, 300, Number.NaN, L, W));
    assert.ok(!rulerContains(400, 300, 400, 300, 0, -1, W));
    assert.ok(!rulerContains(400, 300, 400, 300, 0, L, Number.NaN));
  });
});

describe('rulerLocal and rulerCorners', () => {
  test('local frame', () => {
    const [along, across] = rulerLocal(400, 350, 400, 300, Math.PI / 2);
    close(along, 50);
    close(across, 0);
  });

  test('corners are on the ruler and in order', () => {
    const a = 0.4;
    const c = rulerCorners(400, 300, a, 600, 60);
    assert.equal(c.length, 8);
    for (let i = 0; i < 8; i += 2) assert.ok(rulerContains(c[i], c[i + 1], 400, 300, a, 600, 60));
    const [a0, b0] = rulerLocal(c[0], c[1], 400, 300, a);
    close(a0, -300);
    close(b0, -30);
    const [a2, b2] = rulerLocal(c[4], c[5], 400, 300, a);
    close(a2, 300);
    close(b2, 30);
  });
});
