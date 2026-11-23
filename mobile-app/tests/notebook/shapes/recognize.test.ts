import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readEncodedItem } from '../../../src/notebook/core/model/index.ts';
import type { ShapeItem } from '../../../src/notebook/core/model/index.ts';
import { closedness, pointsOf, resample, shortStraw } from '../../../src/notebook/core/shapes/corners.ts';
import { CIRCLE_SNAP_RATIO, SQUARE_SNAP } from '../../../src/notebook/core/shapes/fit.ts';
import { doneText, hintText, shapeName, SNAP_UNDO_LABEL, variantOf } from '../../../src/notebook/core/shapes/names.ts';
import { recognizeShape, SHAPE_MIN_SIZE, shapeOutline, toShapeItem } from '../../../src/notebook/core/shapes/recognize.ts';
import type { ShapeCandidate } from '../../../src/notebook/core/shapes/recognize.ts';
import { FIXTURE_KINDS, fixturesOf, pairsOf } from './fixtures.ts';

const DEG = Math.PI / 180;

/** Clean outline sampled every `step` points as stroke triples. */
function strokeOf(outline: { x: number; y: number }[], closed: boolean, step = 2): number[] {
  const pts = closed ? outline.concat([outline[0]]) : outline;
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) out.push(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, 0.5);
  }
  const last = pts[pts.length - 1];
  out.push(last.x, last.y, 0.5);
  return out;
}

function rectOutline(cx: number, cy: number, w: number, h: number, rot: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

function ellipseOutline(cx: number, cy: number, rx: number, ry: number, rot: number, n = 120) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return out;
}

function assertNear(actual: number[] | undefined, expected: number[], tol: number): void {
  assert.ok(actual && actual.length === expected.length, String(actual));
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= tol, `${actual.join(',')} vs ${expected.join(',')}`);
}

function matches(c: ShapeCandidate | null, expect: { kind: string | null; sides?: number }): boolean {
  if (expect.kind === null) return c === null;
  return !!c && c.kind === expect.kind && (expect.sides === undefined || c.sides === expect.sides);
}

describe('recognizeShape on noisy hand-drawn fixtures', () => {
  for (const kind of FIXTURE_KINDS) {
    test(`at least 90 percent of 40 ${kind} fixtures are recognized`, () => {
      const fx = fixturesOf(kind, 40);
      assert.equal(fx.length, 40);
      const misses = fx.filter((f) => !matches(recognizeShape(f.pts), f.expect)).map((f) => f.name);
      assert.ok(fx.length - misses.length >= 36, `${kind}: ${40 - misses.length}/40 recognized; missed ${misses.join(', ')}`);
    });
  }

  test('scribbles return null', () => {
    const fx = fixturesOf('scribble', 40);
    const wrong = fx
      .map((f) => ({ f, c: recognizeShape(f.pts) }))
      .filter((x) => x.c !== null)
      .map((x) => `${x.f.name} -> ${x.c?.kind}`);
    assert.deepEqual(wrong, []);
  });

  test('handwriting-sized strokes are never shapes', () => {
    for (const f of fixturesOf('tiny', 40)) assert.equal(recognizeShape(f.pts), null, f.name);
    const small = strokeOf(rectOutline(100, 100, SHAPE_MIN_SIZE - 2, SHAPE_MIN_SIZE - 6, 0), true);
    assert.equal(recognizeShape(small), null);
  });

  test('a second, larger seed set also stays above 90 percent', () => {
    for (const kind of FIXTURE_KINDS) {
      const fx = fixturesOf(kind, 120, 4242 + kind.length);
      const hits = fx.filter((f) => matches(recognizeShape(f.pts), f.expect)).length;
      assert.ok(hits >= 108, `${kind}: ${hits}/120`);
    }
  });

  test('square and circle variants follow the snaps', () => {
    for (const kind of ['rect', 'ellipse'] as const) {
      const fx = fixturesOf(kind, 40);
      let right = 0;
      let total = 0;
      for (const f of fx) {
        const c = recognizeShape(f.pts);
        if (!c || c.kind !== kind) continue;
        total++;
        if (c.variant === f.expect.variant) right++;
        if (c.variant === 'square' || c.variant === 'circle') assert.equal(c.box?.w, c.box?.h, f.name);
      }
      assert.ok(right >= total - 2, `${kind}: ${right}/${total} variants`);
    }
  });

  test('nearly axis-aligned rects, lines and arrows snap to exactly 0 or 90 degrees', () => {
    for (const f of fixturesOf('rect', 40)) {
      const c = recognizeShape(f.pts);
      if (f.expect.rotZero && c?.box) assert.equal(c.box.rot, 0, f.name);
    }
    for (const f of fixturesOf('line', 40)) {
      const c = recognizeShape(f.pts);
      if (!f.expect.rotZero || !c?.pts) continue;
      assert.ok(c.pts[0] === c.pts[2] || c.pts[1] === c.pts[3], `${f.name}: ${c.pts.join(',')}`);
    }
  });

  test('recognized boxes land on the drawn shape', () => {
    for (const kind of ['rect', 'ellipse'] as const) {
      for (const f of fixturesOf(kind, 40)) {
        const c = recognizeShape(f.pts);
        if (!c?.box || !f.ideal || f.ideal.cx === undefined || f.ideal.cy === undefined) continue;
        const size = Math.max(f.ideal.w ?? 0, f.ideal.h ?? 0);
        const cx = c.box.x + c.box.w / 2;
        const cy = c.box.y + c.box.h / 2;
        assert.ok(Math.hypot(cx - f.ideal.cx, cy - f.ideal.cy) < 0.05 * size, `${f.name} center`);
        assert.ok(Math.abs(Math.max(c.box.w, c.box.h) - size) < 0.08 * size, `${f.name} size`);
      }
    }
  });

  test('polygon fixtures keep their number of sides', () => {
    const fx = fixturesOf('polygon', 40);
    for (const f of fx) {
      const c = recognizeShape(f.pts);
      if (c?.kind === 'polygon') assert.equal(c.pts?.length, 2 * c.sides, f.name);
    }
  });

  test('stride 2 input gives the same answer as stride 3', () => {
    for (const kind of FIXTURE_KINDS) {
      for (const f of fixturesOf(kind, 6)) assert.deepEqual(recognizeShape(pairsOf(f.pts), 2), recognizeShape(f.pts, 3), f.name);
    }
  });

  test('is deterministic and does not change its input', () => {
    const f = fixturesOf('rect', 1)[0];
    const copy = f.pts.slice();
    const a = recognizeShape(f.pts);
    const b = recognizeShape(f.pts);
    assert.deepEqual(a, b);
    assert.deepEqual(f.pts, copy);
  });
});

describe('recognizeShape on clean geometry', () => {
  test('rectangles: square snap at 12 percent, rotation snap at 6 degrees', () => {
    const sq = recognizeShape(strokeOf(rectOutline(200, 200, 150, 150 * (1 - SQUARE_SNAP + 0.02), 0), true));
    assert.equal(sq?.variant, 'square');
    assert.equal(sq?.box?.w, sq?.box?.h);
    const rect = recognizeShape(strokeOf(rectOutline(200, 200, 150, 150 * (1 - SQUARE_SNAP - 0.04), 0), true));
    assert.equal(rect?.variant, 'rect');
    assert.ok(rect?.box && rect.box.w !== rect.box.h);

    const snapped = recognizeShape(strokeOf(rectOutline(300, 300, 200, 100, 5 * DEG), true));
    assert.equal(snapped?.kind, 'rect');
    assert.equal(snapped?.box?.rot, 0);
    assert.ok(Math.abs((snapped?.box?.w ?? 0) - 200) < 4 && Math.abs((snapped?.box?.h ?? 0) - 100) < 4);

    const turned = recognizeShape(strokeOf(rectOutline(300, 300, 200, 100, 15 * DEG), true));
    assert.equal(turned?.kind, 'rect');
    assert.ok(Math.abs((turned?.box?.rot ?? 0) - 15 * DEG) < 1.5 * DEG, String(turned?.box?.rot));

    // Near 90 degrees: width and height swap and the rotation snaps to 0.
    const upright = recognizeShape(strokeOf(rectOutline(300, 300, 200, 100, 87 * DEG), true));
    assert.equal(upright?.box?.rot, 0);
    assert.ok(Math.abs((upright?.box?.w ?? 0) - 100) < 4 && Math.abs((upright?.box?.h ?? 0) - 200) < 4);
  });

  test('ellipses: circle snap above a 0.9 axis ratio, rotation snap', () => {
    const circle = recognizeShape(strokeOf(ellipseOutline(200, 200, 80, 80 * (CIRCLE_SNAP_RATIO + 0.04), 0.4), true));
    assert.equal(circle?.variant, 'circle');
    assert.equal(circle?.box?.w, circle?.box?.h);
    assert.equal(circle?.box?.rot, 0);
    const ellipse = recognizeShape(strokeOf(ellipseOutline(200, 200, 80, 80 * (CIRCLE_SNAP_RATIO - 0.05), 0), true));
    assert.equal(ellipse?.variant, 'ellipse');
    const tilted = recognizeShape(strokeOf(ellipseOutline(200, 200, 120, 60, 4 * DEG), true));
    assert.equal(tilted?.box?.rot, 0);
    assert.ok(Math.abs((tilted?.box?.w ?? 0) - 240) < 5 && Math.abs((tilted?.box?.h ?? 0) - 120) < 5);
    const turned = recognizeShape(strokeOf(ellipseOutline(200, 200, 120, 60, 30 * DEG), true));
    assert.ok(Math.abs((turned?.box?.rot ?? 0) - 30 * DEG) < 1.5 * DEG);
  });

  test('a clean octagon and hexagon stay polygons, a clean circle stays a circle', () => {
    for (const sides of [5, 6, 7, 8]) {
      const verts = [];
      for (let k = 0; k < sides; k++) verts.push({ x: 300 + 120 * Math.cos((k / sides) * Math.PI * 2 + 0.2), y: 300 + 120 * Math.sin((k / sides) * Math.PI * 2 + 0.2) });
      const c = recognizeShape(strokeOf(verts, true));
      assert.equal(c?.kind, 'polygon', `${sides} sides`);
      assert.equal(c?.sides, sides);
    }
    assert.equal(recognizeShape(strokeOf(ellipseOutline(300, 300, 120, 120, 0, 240), true))?.variant, 'circle');
  });

  test('triangle vertices', () => {
    const tri = [
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 180, y: 120 },
    ];
    const c = recognizeShape(strokeOf(tri, true));
    assert.equal(c?.kind, 'triangle');
    assert.equal(c?.pts?.length, 6);
    for (const v of tri) {
      let best = Infinity;
      for (let i = 0; i < 6; i += 2) best = Math.min(best, Math.hypot((c?.pts?.[i] ?? 0) - v.x, (c?.pts?.[i + 1] ?? 0) - v.y));
      assert.ok(best < 3, `vertex ${v.x},${v.y}`);
    }
  });

  test('lines: snap within 6 degrees, keep their angle beyond', () => {
    const at = (deg: number) => {
      const a = deg * DEG;
      return strokeOf([{ x: 100, y: 100 }, { x: 100 + 200 * Math.cos(a), y: 100 + 200 * Math.sin(a) }], false);
    };
    const flat = recognizeShape(at(5));
    assert.equal(flat?.kind, 'line');
    assert.equal(flat?.pts?.[1], flat?.pts?.[3]);
    const vertical = recognizeShape(at(94));
    assert.equal(vertical?.pts?.[0], vertical?.pts?.[2]);
    const slanted = recognizeShape(at(12));
    const p = slanted?.pts ?? [];
    assert.ok(Math.abs(Math.atan2(p[3] - p[1], p[2] - p[0]) - 12 * DEG) < 0.5 * DEG);
  });

  test('arrows: 1- and 2-segment hooks, hook drawn first, wrong hook angles rejected', () => {
    const tail = { x: 100, y: 300 };
    const tip = { x: 400, y: 300 };
    const barb = (deg: number, side: 1 | -1, l = 60) => ({ x: tip.x - l * Math.cos(deg * DEG), y: tip.y + side * l * Math.sin(deg * DEG) });
    const one = recognizeShape(strokeOf([tail, tip, barb(35, 1)], false));
    assert.equal(one?.kind, 'arrow');
    assertNear(one?.pts, [100, 300, 400, 300], 2);
    assert.equal(recognizeShape(strokeOf([tail, tip, barb(35, 1), barb(35, -1)], false))?.kind, 'arrow');
    assert.equal(recognizeShape(strokeOf([tail, tip, barb(35, 1), tip, barb(35, -1)], false))?.kind, 'arrow');
    const first = recognizeShape(strokeOf([barb(40, -1), tip, tail], false));
    assert.equal(first?.kind, 'arrow');
    assertNear(first?.pts, [100, 300, 400, 300], 2);
    // A hook at 85 degrees is not an arrow head (it is a corner), nor are both barbs on one side.
    assert.equal(recognizeShape(strokeOf([tail, tip, barb(85, 1)], false)), null);
    assert.equal(recognizeShape(strokeOf([tail, tip, barb(30, 1), tip, barb(50, 1)], false)), null);
    // A hook as long as the shaft is not an arrow either.
    assert.equal(recognizeShape(strokeOf([tail, tip, barb(35, 1, 280)], false)), null);
    // A small head on a long shaft (8 percent of it) is still an arrow, with 1 or 2 barbs.
    for (const deg of [25, 35, 50]) {
      assert.equal(recognizeShape(strokeOf([tail, tip, barb(deg, 1, 24)], false))?.kind, 'arrow', `${deg} one barb`);
      assert.equal(recognizeShape(strokeOf([tail, tip, barb(deg, 1, 24), barb(deg, -1, 24)], false))?.kind, 'arrow', `${deg} two barbs`);
    }
    // A flick at the end of a line, turning back at 70 to 170 degrees, is never an arrow.
    for (let deg = 70; deg <= 170; deg += 10) {
      const c = recognizeShape(strokeOf([tail, tip, { x: tip.x - 30 * Math.cos(deg * DEG), y: tip.y + 30 * Math.sin(deg * DEG) }], false));
      assert.notEqual(c?.kind, 'arrow', `flick ${deg}`);
    }
  });

  test('bad input never throws', () => {
    assert.equal(recognizeShape([]), null);
    assert.equal(recognizeShape([1, 2, 0.5]), null);
    assert.equal(recognizeShape([5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5]), null);
    assert.equal(recognizeShape([NaN, 1, 0, Infinity, 2, 0, 3, NaN, 0]), null);
    const withNaN = strokeOf(rectOutline(200, 200, 160, 100, 0), true);
    withNaN.splice(30, 0, NaN, NaN, 0.5);
    assert.equal(recognizeShape(withNaN)?.kind, 'rect');
    const far = strokeOf(rectOutline(1e7, 1e7, 160, 100, 0), true);
    assert.equal(recognizeShape(far)?.kind, 'rect');
  });

  test('a 4000-point stroke is recognized quickly', () => {
    const outline = ellipseOutline(400, 400, 200, 150, 0.3, 4000);
    const pts: number[] = [];
    for (const p of outline) pts.push(p.x, p.y, 0.5);
    const t0 = performance.now();
    const c = recognizeShape(pts);
    const ms = performance.now() - t0;
    assert.equal(c?.kind, 'ellipse');
    assert.ok(ms < 250, `${ms.toFixed(1)} ms`);
  });
});

describe('corners and closedness', () => {
  test('ShortStraw finds the 4 corners of a square loop and the start is not a corner', () => {
    const raw = pointsOf(strokeOf(rectOutline(200, 200, 200, 200, 0).slice(0), true), 3);
    // Start in the middle of the top side.
    const mid = raw.findIndex((p) => p.x > 199 && p.y < 101);
    const loop = resample(raw.slice(mid).concat(raw.slice(0, mid)), 283 / 40, true);
    const cs = shortStraw(loop, true);
    assert.equal(cs.corners.length - 1, 4);
  });

  test('closedness trims an overshoot and refuses an open U', () => {
    const square = pointsOf(strokeOf(rectOutline(200, 200, 200, 200, 0), true), 3);
    const over = square.concat(square.slice(1, 40));
    const cl = closedness(over);
    assert.ok(cl.closed);
    assert.ok(cl.pts.length < over.length);
    const u = pointsOf(strokeOf([{ x: 100, y: 100 }, { x: 100, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 100 }], false), 3);
    assert.equal(closedness(u).closed, false);
  });
});

describe('toShapeItem and shapeOutline', () => {
  test('builds a valid shape item in the stroke style', () => {
    const c = recognizeShape(strokeOf(rectOutline(200, 200, 160, 100, 0), true));
    assert.ok(c);
    const item = toShapeItem(c, { color: '#1D4ED8', width: 3 }, 'shape1', { recordingId: 'rec1', ms: 1200 }, 1790000000000);
    assert.equal(item.kind, 'shape');
    assert.equal(item.shape, 'rect');
    assert.equal(item.fill, null);
    assert.equal(item.highlighter, undefined);
    assert.deepEqual(item.rec, { recordingId: 'rec1', ms: 1200 });
    assert.equal(item.at, 1790000000000);
    assert.notEqual(item.box, c.box);
    assert.deepEqual(readEncodedItem(JSON.parse(JSON.stringify(item))), item);

    const tri = recognizeShape(strokeOf([{ x: 100, y: 300 }, { x: 300, y: 300 }, { x: 180, y: 120 }], true));
    assert.ok(tri);
    const hl = toShapeItem(tri, { color: '#FDE047', width: 18, highlighter: true, fill: '#FFFFFF' }, 't1');
    assert.equal(hl.highlighter, true);
    assert.equal(hl.fill, '#FFFFFF');
    assert.notEqual(hl.pts, tri.pts);
    assert.equal(hl.rec, undefined);
    assert.equal('at' in hl, false);
    assert.deepEqual(readEncodedItem(JSON.parse(JSON.stringify(hl))), hl);
  });

  test('outlines for every kind', () => {
    const rect = shapeOutline({ shape: 'rect', box: { x: 0, y: 0, w: 100, h: 50, rot: 0 } });
    assert.deepEqual(rect, [{ pts: [0, 0, 100, 0, 100, 50, 0, 50], closed: true }]);
    const ell = shapeOutline({ shape: 'ellipse', box: { x: 0, y: 0, w: 100, h: 50, rot: 0.3 } }, 36);
    assert.equal(ell[0].pts.length, 72);
    assert.ok(ell[0].closed);
    const arrow = shapeOutline({ shape: 'arrow', pts: [0, 0, 100, 0], width: 3 });
    assert.equal(arrow.length, 2);
    assert.deepEqual(arrow[0].pts, [0, 0, 100, 0]);
    assert.equal(arrow[1].pts[2], 100);
    assert.ok(arrow[1].pts[0] < 100 && arrow[1].pts[1] * arrow[1].pts[5] < 0);
    assert.deepEqual(shapeOutline({ shape: 'line', pts: [1, 2, 3, 4] }), [{ pts: [1, 2, 3, 4], closed: false }]);
    assert.deepEqual(shapeOutline({ shape: 'triangle', pts: [0, 0, 10, 0, 5, 9] }), [{ pts: [0, 0, 10, 0, 5, 9], closed: true }]);
    assert.deepEqual(shapeOutline({ shape: 'polygon' }), []);
  });
});

describe('names', () => {
  const rect: ShapeCandidate = { kind: 'rect', variant: 'rect', sides: 4, box: { x: 0, y: 0, w: 100, h: 50, rot: 0 }, error: 0 };

  test('exact Figma and PRD strings', () => {
    assert.equal(hintText(rect).ar, 'ثبّت القلم لحظة… سيصبح مستطيلاً');
    assert.equal(doneText(rect).ar, 'تحوّل إلى مستطيل');
    assert.equal(SNAP_UNDO_LABEL.ar, 'تراجع');
    assert.deepEqual(shapeName(rect), { ar: 'مستطيل', en: 'rectangle' });
    assert.equal(hintText(rect).en, 'Hold still… it will become a rectangle');
    assert.equal(doneText(rect).en, 'Turned into a rectangle');
  });

  test('every variant has a name, a hint and a done text', () => {
    const expected: [Parameters<typeof shapeName>[0], string, string][] = [
      [{ variant: 'line' }, 'خط مستقيم', 'سيصبح خطاً مستقيماً'],
      [{ variant: 'arrow' }, 'سهم', 'سيصبح سهماً'],
      [{ variant: 'square' }, 'مربع', 'سيصبح مربعاً'],
      [{ variant: 'ellipse' }, 'شكل بيضاوي', 'سيصبح شكلاً بيضاوياً'],
      [{ variant: 'circle' }, 'دائرة', 'سيصبح دائرةً'],
      [{ variant: 'triangle' }, 'مثلث', 'سيصبح مثلثاً'],
      [{ variant: 'polygon', sides: 4 }, 'شكل رباعي', 'سيصبح شكلاً رباعياً'],
      [{ variant: 'polygon', sides: 5 }, 'شكل خماسي', 'سيصبح شكلاً خماسياً'],
      [{ variant: 'polygon', sides: 6 }, 'شكل سداسي', 'سيصبح شكلاً سداسياً'],
      [{ variant: 'polygon', sides: 7 }, 'شكل سباعي', 'سيصبح شكلاً سباعياً'],
      [{ variant: 'polygon', sides: 8 }, 'شكل ثماني', 'سيصبح شكلاً ثمانياً'],
      [{ variant: 'polygon' }, 'مضلع', 'سيصبح مضلعاً'],
    ];
    for (const [s, name, hint] of expected) {
      assert.equal(shapeName(s).ar, name);
      assert.ok(hintText(s).ar.endsWith(hint), hintText(s).ar);
      assert.equal(doneText(s).ar, `تحوّل إلى ${name}`);
      assert.ok(shapeName(s).en.length > 0);
    }
    assert.equal(hintText({ variant: 'ellipse' }).en, 'Hold still… it will become an ellipse');
    assert.equal(doneText({ variant: 'arrow' }).en, 'Turned into an arrow');
    assert.equal(doneText({ variant: 'polygon', sides: 8 }).en, 'Turned into an octagon');
  });

  test('names shape items by their geometry', () => {
    const item = (s: Partial<ShapeItem>): ShapeItem => ({ id: 'x', kind: 'shape', shape: 'rect', color: '#000000', width: 2, fill: null, ...s });
    assert.equal(shapeName(item({ shape: 'rect', box: { x: 0, y: 0, w: 50, h: 50, rot: 0 } })).ar, 'مربع');
    assert.equal(shapeName(item({ shape: 'rect', box: { x: 0, y: 0, w: 80, h: 50, rot: 0 } })).ar, 'مستطيل');
    assert.equal(shapeName(item({ shape: 'ellipse', box: { x: 0, y: 0, w: 50, h: 50, rot: 0 } })).ar, 'دائرة');
    assert.equal(shapeName(item({ shape: 'polygon', pts: [0, 0, 1, 0, 2, 1, 1, 2, 0, 1, 0, 0.5] })).ar, 'شكل سداسي');
    assert.deepEqual(variantOf(item({ shape: 'triangle', pts: [0, 0, 1, 0, 0, 1] })), { variant: 'triangle', sides: 3 });
  });

  test('candidates from real recognition are named', () => {
    for (const kind of FIXTURE_KINDS) {
      for (const f of fixturesOf(kind, 5)) {
        const c = recognizeShape(f.pts);
        if (!c) continue;
        assert.ok(shapeName(c).ar.length > 0 && hintText(c).ar.startsWith('ثبّت القلم لحظة… سيصبح '), f.name);
      }
    }
  });
});
