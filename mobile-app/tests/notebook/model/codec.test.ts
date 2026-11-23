import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decodeItem, decodePage, decodePts, encodeItem, encodePage, encodePts } from '../../../src/notebook/core/model/codec.ts';
import { readPageFile, makePageFile } from '../../../src/notebook/core/model/readers.ts';
import type { Page, StrokeItem } from '../../../src/notebook/core/model/index.ts';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStroke(r: () => number, n: number): number[] {
  const pts: number[] = [];
  let x = r() * 600;
  let y = r() * 800;
  for (let i = 0; i < n; i++) {
    x += (r() - 0.5) * 8;
    y += (r() - 0.5) * 8;
    pts.push(x, y, r());
  }
  return pts;
}

describe('d10 point codec', () => {
  test('round trip error is at most 0.05 pt for x and y and 0.005 for pressure', () => {
    const r = rng(7);
    for (let s = 0; s < 50; s++) {
      const pts = randomStroke(r, 1 + Math.floor(r() * 4000));
      const back = decodePts(encodePts(pts));
      assert.equal(back.length, pts.length);
      for (let i = 0; i < pts.length; i += 3) {
        assert.ok(Math.abs(back[i] - pts[i]) <= 0.05 + 1e-9, `x ${pts[i]} -> ${back[i]}`);
        assert.ok(Math.abs(back[i + 1] - pts[i + 1]) <= 0.05 + 1e-9);
        assert.ok(Math.abs(back[i + 2] - pts[i + 2]) <= 0.005 + 1e-9);
      }
    }
  });

  test('errors do not accumulate along a long stroke', () => {
    const pts: number[] = [];
    for (let i = 0; i < 10000; i++) pts.push(i * 0.123456, 1000 - i * 0.0789, 0.5);
    const back = decodePts(encodePts(pts));
    const last = pts.length - 3;
    assert.ok(Math.abs(back[last] - pts[last]) <= 0.05);
    assert.ok(Math.abs(back[last + 1] - pts[last + 1]) <= 0.05);
  });

  test('encoded values are integers and deltas after the first point', () => {
    const enc = encodePts([10, 20, 0.5, 10.5, 19, 1]);
    assert.deepEqual(enc, [100, 200, 50, 5, -10, 100]);
    assert.ok(enc.every(Number.isInteger));
  });

  test('negative coordinates, clamped pressure and a trailing partial triple', () => {
    const back = decodePts(encodePts([-5.04, -0.01, 1.7, 3, 4, -1, 9]));
    assert.equal(back.length, 6);
    assert.deepEqual(back, [-5, 0, 1, 3, 4, 0]);
  });

  test('items and pages encode and decode; other items pass through', () => {
    const stroke: StrokeItem = { id: 's1', kind: 'stroke', tool: 'pen', color: '#1B2533', width: 3, pressure: true, pts: [1.23, 4.56, 0.42], rec: { recordingId: 'r1', ms: 1200 } };
    const e = encodeItem(stroke);
    assert.equal(e.kind, 'stroke');
    assert.equal((e as { enc?: string }).enc, 'd10');
    const d = decodeItem(e) as StrokeItem;
    assert.equal(d.rec?.ms, 1200);
    assert.ok(!('enc' in d));
    const page: Page = {
      id: 'p1',
      size: { w: 595.28, h: 841.89 },
      background: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } },
      items: [stroke, { id: 't1', kind: 'text', box: { x: 1, y: 2, w: 100, h: 20, rot: 0 }, text: 'مرحبا', size: 16, color: '#000000', bold: false }],
    };
    const back = decodePage(encodePage(page));
    assert.equal(back.items[1], page.items[1]);
    assert.ok(Math.abs((back.items[0] as StrokeItem).pts[0] - 1.23) <= 0.05);
  });

  test('raw float points (no enc) are accepted when decoding', () => {
    const raw = { id: 's', kind: 'stroke' as const, tool: 'pen' as const, color: '#000000', width: 2, pressure: false, pts: [1.11, 2.22, 0.3, 4] };
    const d = decodeItem(raw) as StrokeItem;
    assert.deepEqual(d.pts, [1.11, 2.22, 0.3]);
    // Pressure from a foreign file is kept in 0..1, like decoded d10 points.
    const wild = decodeItem({ ...raw, pts: [0, 0, 7, 1, 1, -2] }) as StrokeItem;
    assert.deepEqual(wild.pts, [0, 0, 1, 1, 1, 0]);
  });

  test('a page survives JSON + the page reader', () => {
    const r = rng(3);
    const page: Page = {
      id: 'pg',
      size: { w: 612, h: 792 },
      background: { kind: 'pdf', fileId: 'f1', pageIndex: 3, rotation: 90 },
      items: [{ id: 'a', kind: 'stroke', tool: 'highlighter', color: '#FDE047', width: 18, pressure: false, pts: randomStroke(r, 300) }],
    };
    const file = makePageFile(page, { rev: 4, savedAt: '2026-11-23T10:00:00.000Z' });
    const read = readPageFile(JSON.parse(JSON.stringify(file)));
    assert.ok(read);
    assert.equal(read.rev, 4);
    const back = decodePage(read.page);
    const a = (page.items[0] as StrokeItem).pts;
    const b = (back.items[0] as StrokeItem).pts;
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= 0.05 + 1e-9);
  });
});
