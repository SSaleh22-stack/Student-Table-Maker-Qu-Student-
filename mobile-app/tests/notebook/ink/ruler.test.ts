import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { angleLabel, projectToRuler, rulerDegrees, rulerEdgeAt, snapRulerAngle, snapToRuler } from '../../../src/notebook/core/ink/ruler.ts';
import type { RulerPage } from '../../../src/notebook/core/ink/ruler.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const flat: RulerPage = { cx: 300, cy: 400, angle: 0, length: 600, width: 60 };

describe('snapToRuler', () => {
  test('a stroke starting on an edge is projected onto it, pressure kept', () => {
    const pts = [100, 432, 0.3, 200, 436, 0.5, 300, 428, 0.7];
    const r = snapToRuler(pts, flat, 8);
    assert.equal(r.edge, 1);
    assert.deepEqual(r.pts, [100, 430, 0.3, 200, 430, 0.5, 300, 430, 0.7]);
    const top = snapToRuler([100, 366, 0.5, 150, 362, 0.5], flat, 8);
    assert.equal(top.edge, -1);
    assert.deepEqual(top.pts, [100, 370, 0.5, 150, 370, 0.5]);
  });

  test('strokes that start away from the edges, or past the ends, are untouched', () => {
    const away = [100, 470, 0.5, 200, 480, 0.5];
    const r = snapToRuler(away, flat, 8);
    assert.equal(r.edge, 0);
    assert.equal(r.pts, away);
    assert.equal(snapToRuler([100, 400, 0.5], flat, 8).edge, 0); // on the ruler body
    assert.equal(snapToRuler([700, 430, 0.5], flat, 8).edge, 0); // past the end
    assert.equal(snapToRuler([], flat, 8).edge, 0);
  });

  test('a rotated ruler; projection is clamped to its length', () => {
    const r: RulerPage = { cx: 0, cy: 0, angle: Math.PI / 4, length: 100, width: 20 };
    // the +normal edge of a 45° ruler runs through (-7.07, 7.07)
    const e = rulerEdgeAt(-7, 7.5, r, 3);
    assert.equal(e, 1);
    const q = projectToRuler(-7 + 20, 7.5 + 20, r, 1);
    const ux = Math.cos(Math.PI / 4);
    // q lies on the edge line: across === width / 2
    close(-q[0] * ux + q[1] * ux, 10);
    const far = projectToRuler(1000, 1000, r, 1);
    close(far[0] * ux + far[1] * ux, 50); // clamped to length / 2
  });
});

describe('ruler angle', () => {
  test('angleLabel shows the tilt 0..90 in whole degrees', () => {
    assert.equal(angleLabel(0), '0°');
    assert.equal(angleLabel((8 * Math.PI) / 180), '8°');
    assert.equal(angleLabel((-8 * Math.PI) / 180), '8°');
    assert.equal(angleLabel((172 * Math.PI) / 180), '8°');
    assert.equal(angleLabel(Math.PI / 2), '90°');
    assert.equal(angleLabel(Math.PI), '0°');
    assert.equal(rulerDegrees((45.4 * Math.PI) / 180), 45);
    assert.equal(rulerDegrees((-0.2 * Math.PI) / 180), 0);
  });

  test('snapRulerAngle settles on multiples of 45°', () => {
    close(snapRulerAngle((44 * Math.PI) / 180), Math.PI / 4);
    close(snapRulerAngle((40 * Math.PI) / 180), (40 * Math.PI) / 180);
    close(snapRulerAngle((-0.5 * Math.PI) / 180), 0);
  });
});
