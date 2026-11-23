import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  arrowHead,
  boundsOfBox,
  boundsOfPoints,
  boxCorners,
  emptyBounds,
  isEmptyBounds,
  itemBounds,
  itemsBounds,
  shapeOutline,
  unionBounds,
} from '../../../src/notebook/core/ink/bounds.ts';
import {
  distToSegmentSq,
  flatEntry,
  flatHalfWidth,
  flatIsFilled,
  hitItem,
  hitTestFlat,
  itemDistance,
  itemsIntersectingSegment,
  nearestItemWithRec,
  pointInPolygon,
  segmentDistanceSq,
} from '../../../src/notebook/core/ink/hittest.ts';
import { getStroke, strokeOptions } from '../../../src/notebook/core/ink/freehand.ts';
import { outlineToCommands, outlineToSvgPath } from '../../../src/notebook/core/ink/outline.ts';
import { polylineLength, resample, simplify, SIMPLIFY_EPSILON } from '../../../src/notebook/core/ink/resample.ts';
import { straighten, streamlinePoints } from '../../../src/notebook/core/ink/smooth.ts';
import type { ImageItem, PageItem, ShapeItem, StrokeItem, TextItem } from '../../../src/notebook/core/model/types.ts';

const stroke = (id: string, pts: number[], o: Partial<StrokeItem> = {}): StrokeItem => ({
  id,
  kind: 'stroke',
  tool: 'pen',
  color: '#1B2533',
  width: 2,
  pressure: false,
  pts,
  ...o,
});
const rect = (id: string, x: number, y: number, w: number, h: number, o: Partial<ShapeItem> = {}): ShapeItem => ({
  id,
  kind: 'shape',
  shape: 'rect',
  color: '#1B2533',
  width: 2,
  fill: null,
  box: { x, y, w, h, rot: 0 },
  ...o,
});
const text = (id: string, x: number, y: number, w: number, h: number, rot = 0): TextItem => ({
  id,
  kind: 'text',
  box: { x, y, w, h, rot },
  text: 'مرحبا',
  size: 16,
  color: '#1B2533',
  bold: false,
});

describe('geometry primitives', () => {
  test('segment distances', () => {
    assert.equal(distToSegmentSq(5, 5, 0, 0, 10, 0), 25);
    assert.equal(distToSegmentSq(-3, 4, 0, 0, 10, 0), 25);
    assert.equal(distToSegmentSq(3, 4, 0, 0, 0, 0), 25);
    assert.equal(segmentDistanceSq(0, 0, 10, 10, 0, 10, 10, 0), 0); // crossing
    assert.equal(segmentDistanceSq(0, 0, 10, 0, 0, 3, 10, 3), 9); // parallel
  });

  test('point in polygon (even-odd)', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    assert.equal(pointInPolygon(sq, 5, 5), true);
    assert.equal(pointInPolygon(sq, 15, 5), false);
    const c = [0, 0, 10, 0, 10, 10, 6, 10, 6, 4, 4, 4, 4, 10, 0, 10]; // U shape
    assert.equal(pointInPolygon(c, 5, 8), false);
    assert.equal(pointInPolygon(c, 2, 8), true);
  });

  test('bounds', () => {
    assert.ok(isEmptyBounds(emptyBounds()));
    assert.deepEqual(boundsOfPoints([1, 5, 0.5, -2, 3, 0.5], 3), [-2, 3, 1, 5]);
    assert.deepEqual(unionBounds(emptyBounds(), [0, 0, 1, 1]), [0, 0, 1, 1]);
    const b = boundsOfBox({ x: 0, y: 0, w: 10, h: 10, rot: Math.PI / 4 });
    const half = Math.SQRT2 * 5;
    assert.ok(Math.abs(b[0] - (5 - half)) < 1e-9 && Math.abs(b[2] - (5 + half)) < 1e-9);
    const c = boxCorners({ x: 0, y: 0, w: 4, h: 2, rot: 0 });
    assert.deepEqual(c, [0, 0, 4, 0, 4, 2, 0, 2]);
    // stroke bounds include the widest ink: pen with pressure reaches 0.75 x width
    assert.deepEqual(itemBounds(stroke('s', [0, 0, 0.5, 10, 0, 0.5], { width: 4, pressure: true })), [-3, -3, 13, 3]);
    assert.deepEqual(itemsBounds([]), emptyBounds());
  });

  test('shape outlines', () => {
    assert.equal(shapeOutline(rect('r', 0, 0, 10, 5)).pts.length, 8);
    const ell = shapeOutline({ ...rect('e', 0, 0, 20, 10), shape: 'ellipse' });
    assert.equal(ell.closed, true);
    assert.equal(ell.pts.length, 96);
    const tri = shapeOutline({ ...rect('t', 0, 0, 10, 10), shape: 'triangle' });
    assert.deepEqual(tri.pts, [5, 0, 10, 10, 0, 10]);
    const triPts = shapeOutline({ id: 't2', kind: 'shape', shape: 'triangle', color: '#000000', width: 1, fill: null, pts: [0, 0, 9, 0, 3, 7] });
    assert.deepEqual(triPts.pts, [0, 0, 9, 0, 3, 7]);
    const arrow = shapeOutline({ id: 'a', kind: 'shape', shape: 'arrow', color: '#000000', width: 2, fill: null, pts: [0, 0, 100, 0] });
    assert.equal(arrow.closed, false);
    assert.equal(arrow.pts.length, 10);
    const h = arrowHead(0, 0, 100, 0, 2);
    assert.deepEqual(h.slice(2, 4), [100, 0]);
    assert.ok(h[0] < 100 && h[0] === h[4] && Math.abs(h[1] + h[5]) < 1e-9 && h[1] !== 0);
    // barbs of min(max(10, 4w), 0.4 * length) at 30 degrees, as core/shapes draws them
    assert.ok(Math.abs(Math.hypot(h[0] - 100, h[1]) - 10) < 1e-9);
    assert.ok(Math.abs(Math.abs(Math.atan2(h[1], 100 - h[0])) - Math.PI / 6) < 1e-9);
    assert.ok(Math.abs(Math.hypot(arrowHead(0, 0, 20, 0, 2)[0] - 20, arrowHead(0, 0, 20, 0, 2)[1]) - 8) < 1e-9);
    // the shaft is first to last point, as drawn
    const bent = shapeOutline({ id: 'l', kind: 'shape', shape: 'line', color: '#000000', width: 2, fill: null, pts: [0, 0, 50, 40, 100, 0] });
    assert.deepEqual(bent.pts, [0, 0, 100, 0]);
  });
});

describe('item hit tests', () => {
  const s1 = stroke('s1', [0, 0, 0.5, 100, 0, 0.5], { width: 4 });
  const filled = rect('f', 200, 0, 50, 50, { fill: '#FDE047' });
  const empty = rect('e', 300, 0, 50, 50);
  const t = text('t', 0, 100, 80, 30, 0.3);
  const img: ImageItem = { id: 'i', kind: 'image', fileId: 'f1', box: { x: 400, y: 0, w: 40, h: 40, rot: 0 }, crop: null };

  test('hitItem', () => {
    assert.equal(hitItem(s1, 50, 3, 2), true); // 3 from the centerline, half width 2, radius 2
    assert.equal(hitItem(s1, 50, 5, 2), false);
    assert.equal(hitItem(filled, 225, 25, 0), true); // inside a filled shape
    assert.equal(hitItem(empty, 325, 25, 2), false); // inside an unfilled one
    assert.equal(hitItem(empty, 300, 25, 2), true); // on its edge
    assert.equal(hitItem(t, 40, 115, 0), true);
    assert.equal(hitItem(img, 420, 20, 0), true);
    assert.equal(hitItem(img, 445, 20, 2), false);
  });

  test('itemDistance', () => {
    assert.equal(itemDistance(s1, 50, 10), 8);
    assert.equal(itemDistance(filled, 210, 10), 0);
    assert.equal(itemDistance(img, 450, 0), 10);
  });

  test('nearestItemWithRec picks the closest recorded item, top-most on ties', () => {
    const items: PageItem[] = [
      { ...s1, rec: { recordingId: 'r1', ms: 1000 } },
      stroke('s2', [0, 6, 0.5, 100, 6, 0.5], { width: 2 }),
      { ...stroke('s3', [0, 20, 0.5, 100, 20, 0.5]), rec: { recordingId: 'r1', ms: 5000 } },
      { ...stroke('s4', [0, 20, 0.5, 100, 20, 0.5]), rec: { recordingId: 'r1', ms: 7000 } },
    ];
    assert.equal(nearestItemWithRec(items, 50, 7, 10)?.id, 's1'); // s2 is closer but has no rec
    assert.equal(nearestItemWithRec(items, 50, 19, 10)?.id, 's4');
    assert.equal(nearestItemWithRec(items, 50, 60, 10), null);
  });

  test('itemsIntersectingSegment with filters', () => {
    const hl = stroke('hl', [0, 50, 0.5, 100, 50, 0.5], { tool: 'highlighter', width: 18 });
    const hlShape: ShapeItem = { ...rect('hs', 0, 40, 100, 20), highlighter: true };
    const items: PageItem[] = [s1, hl, hlShape, t];
    assert.deepEqual(itemsIntersectingSegment(items, 50, -10, 50, 60, 1), ['s1', 'hl', 'hs']);
    assert.deepEqual(itemsIntersectingSegment(items, 50, -10, 50, 60, 1, { highlighterOnly: true }), ['hl', 'hs']);
    assert.deepEqual(itemsIntersectingSegment(items, 20, 110, 30, 112, 1, { inkOnly: false }), ['t']);
    assert.deepEqual(itemsIntersectingSegment(items, 500, 500, 510, 510, 1), []);
  });
});

describe('hitTestFlat (UI-runtime mirror)', () => {
  test('matches itemsIntersectingSegment on the same items', () => {
    const items: PageItem[] = [];
    for (let i = 0; i < 40; i++) {
      const y = i * 7;
      items.push(stroke('s' + i, [0, y, 0.5, 30, y + 3, 0.5, 60, y, 0.5], { width: 1 + (i % 4) }));
    }
    items.push(rect('r', 100, 0, 40, 40), { ...rect('e', 100, 60, 40, 30), shape: 'ellipse' });
    items.push(stroke('dot', [200, 200, 0.5], { width: 6 }));
    const bboxes: number[] = [];
    const offsets: number[] = [0];
    const pts: number[] = [];
    for (const it of items) {
      const e = flatEntry(it);
      bboxes.push(...e.bbox);
      pts.push(...e.pts);
      offsets.push(pts.length);
    }
    const f64 = Float64Array.from(bboxes);
    const segs = [
      [30, -5, 30, 300],
      [0, 50, 0, 51],
      [120, 20, 120, 20],
      [99, 75, 99, 75],
      [140, 70, 145, 80],
      [203, 200, 203, 200],
      [500, 500, 600, 600],
    ];
    for (const seg of segs) {
      const flat = hitTestFlat(f64, offsets, pts, seg, 2).map((i) => items[i].id);
      const ref = itemsIntersectingSegment(items, seg[0], seg[1], seg[2], seg[3], 2);
      assert.deepEqual(flat, ref, JSON.stringify(seg));
    }
    // the center of an unfilled rect is not a hit; its edge is
    assert.deepEqual(hitTestFlat(f64, offsets, pts, [120, 20, 120, 20], 2), []);
    assert.deepEqual(hitTestFlat(f64, offsets, pts, [100, 20, 100, 20], 2).map((i) => items[i].id), ['r']);
  });

  test('a filled shape is hit inside, like itemsIntersectingSegment', () => {
    const items: PageItem[] = [
      rect('f', 0, 0, 100, 60, { fill: '#FDE047', width: 4 }),
      { ...rect('fe', 200, 0, 80, 40, { fill: '#FDE047' }), shape: 'ellipse' },
      rect('u', 0, 100, 100, 60),
    ];
    const bboxes: number[] = [];
    const offsets: number[] = [0];
    const pts: number[] = [];
    for (const it of items) {
      const e = flatEntry(it);
      bboxes.push(...e.bbox);
      pts.push(...e.pts);
      offsets.push(pts.length);
    }
    assert.equal(flatHalfWidth(bboxes[4]), 2);
    assert.equal(flatIsFilled(bboxes[4]), true);
    assert.equal(flatIsFilled(bboxes[14]), false);
    assert.equal(flatHalfWidth(bboxes[14]), 1);
    for (const seg of [
      [50, 30, 50, 30],
      [40, 20, 60, 25],
      [240, 20, 240, 20],
      [50, 130, 50, 130],
      [50, 101, 50, 101],
      [-3, 30, -3, 30],
      [-8, 30, -8, 30],
    ]) {
      const flat = hitTestFlat(bboxes, offsets, pts, seg, 2).map((i) => items[i].id);
      assert.deepEqual(flat, itemsIntersectingSegment(items, seg[0], seg[1], seg[2], seg[3], 2), JSON.stringify(seg));
    }
    assert.deepEqual(hitTestFlat(bboxes, offsets, pts, [50, 30, 50, 30], 2).map((i) => items[i].id), ['f']);
  });
});

describe('item bounds edge cases', () => {
  test('stroke bounds contain the drawn outline: dots, short strokes, small loops, long strokes', () => {
    let seed = 7;
    const r = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const cases: StrokeItem[] = [stroke('d', [10, 10, 0.5], { width: 6 }), stroke('d2', [10, 10, 0.5, 11, 10, 0.5], { width: 6 })];
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(r() * 40);
      const step = [0.05, 0.2, 1, 4][k % 4];
      const pts: number[] = [];
      let x = 50;
      let y = 50;
      let a = r() * 6.28;
      for (let i = 0; i < n; i++) {
        pts.push(x, y, 0.1 + 0.9 * r());
        a += k % 3 === 0 ? 0.6 : (r() - 0.5) * 3;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
      }
      cases.push(stroke('s' + k, pts, { width: 1 + (k % 9) * 3, pressure: k % 2 === 0, tool: k % 5 === 0 ? 'highlighter' : 'pen' }));
    }
    for (const s of cases) {
      const ob = boundsOfPoints(getStroke(s.pts, strokeOptions(s, true)), 2);
      const b = itemBounds(s);
      const e = 1e-9;
      assert.ok(b[0] <= ob[0] + e && b[1] <= ob[1] + e && b[2] >= ob[2] - e && b[3] >= ob[3] - e, `${s.id}: ${b} vs ${ob}`);
    }
    // a long stroke is not padded beyond its half width
    assert.deepEqual(itemBounds(stroke('l', [0, 0, 0.5, 50, 0, 0.5], { width: 4 })), [-2, -2, 52, 2]);
  });

  test('a rotated ellipse uses its exact extents', () => {
    const e: ShapeItem = { ...rect('e', 0, 0, 300, 100), shape: 'ellipse', box: { x: 0, y: 0, w: 300, h: 100, rot: 0.3 } };
    const b = itemBounds(e);
    let maxX = -Infinity;
    for (let k = 0; k < 3600; k++) {
      const t = (k / 3600) * Math.PI * 2;
      const lx = 150 * Math.cos(t);
      const ly = 50 * Math.sin(t);
      maxX = Math.max(maxX, 150 + lx * Math.cos(0.3) - ly * Math.sin(0.3));
    }
    assert.ok(Math.abs(b[2] - (maxX + 1)) < 1e-3, `${b[2]} vs ${maxX + 1}`);
  });
});

describe('outline, smoothing and simplification helpers', () => {
  test('outlineToCommands and outlineToSvgPath trace the same closed curve', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    const cmds = outlineToCommands(sq);
    assert.deepEqual(cmds[0], [0, 0, 5]);
    assert.equal(cmds.length, 6);
    assert.deepEqual(cmds[1], [2, 0, 0, 5, 0]);
    assert.deepEqual(cmds[5], [5]);
    assert.equal(outlineToSvgPath(sq), 'M0,5 Q0,0 5,0 Q10,0 10,5 Q10,10 5,10 Q0,10 0,5 Z');
    assert.equal(outlineToSvgPath([1.234567, 2, 3, 4], false), 'M1.23,2 L3,4');
    assert.deepEqual(outlineToCommands([]), []);
    const open = outlineToCommands([0, 0, 10, 0, 20, 10], false);
    assert.deepEqual(open, [[0, 0, 0], [2, 10, 0, 15, 5], [1, 20, 10]]);
  });

  test('streamline and straighten', () => {
    const pts = [0, 0, 0.2, 10, 0, 0.4, 20, 0, 0.6, 30, 0, 0.8];
    const s = streamlinePoints(pts, 0.5);
    assert.equal(s.length, pts.length);
    assert.deepEqual(s.slice(0, 3), [0, 0, 0.2]);
    assert.ok(s[3] > 0 && s[3] < 10);
    assert.deepEqual(s.slice(-3), [30, 0, 0.8]);
    const st = straighten(pts);
    assert.equal(st.length, 6);
    assert.deepEqual([st[0], st[1], st[3], st[4]], [0, 0, 30, 0]);
    assert.ok(Math.abs(st[2] - 0.5) < 1e-12 && st[2] === st[5]);
    assert.deepEqual(straighten([1, 2, 0.3]), [1, 2, 0.3]);
  });

  test('resample spacing and Douglas-Peucker with epsilon 0.15', () => {
    const line = [0, 0, 0.5, 10, 0, 0.5];
    const r = resample(line, 2.5);
    assert.deepEqual(r.filter((_, i) => i % 3 === 0), [0, 2.5, 5, 7.5, 10]);
    assert.equal(polylineLength(r), 10);
    assert.equal(SIMPLIFY_EPSILON, 0.15);
    const noisy: number[] = [];
    for (let i = 0; i <= 100; i++) noisy.push(i, (i % 2) * 0.1, 0.5);
    const simple = simplify(noisy);
    assert.equal(simple.length, 6); // within 0.15 of the chord: endpoints only
    const bent = [0, 0, 0.5, 5, 0.2, 0.5, 10, 0, 0.5];
    assert.equal(simplify(bent).length, 9);
    // a pressure change keeps the point
    assert.equal(simplify([0, 0, 0.2, 5, 0, 0.9, 10, 0, 0.2]).length, 9);
    assert.equal(simplify([0, 0, 0.2, 5, 0, 0.9, 10, 0, 0.2], 0.15, 3, 0).length, 6);
  });
});
