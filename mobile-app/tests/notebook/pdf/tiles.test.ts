import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PREVIEW_MAX_LONG_PX,
  PREVIEW_MIN_LONG_PX,
  TILE_PX,
  clipToPage,
  hashString,
  levelFor,
  levelScale,
  needsTiles,
  pageCacheKey,
  pageHeightPx,
  pdfCacheId,
  pdfPathTail,
  previewScale,
  previewWidth,
  regionCacheKey,
  regionOf,
  tileAt,
  tileGrid,
  tilesFor,
} from '../../../src/notebook/core/pdf/tiles.ts';

const A4 = { w: 595.28, h: 841.89 };
const A4L = { w: 841.89, h: 595.28 };
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('previewWidth', () => {
  test('long side is 1.5 x the screen long side', () => {
    // iPad Pro 12.9: 2732 px long side -> 4098 is capped to 4096.
    assert.equal(previewWidth(A4L, 2732), PREVIEW_MAX_LONG_PX);
    // 2048 px screen -> 3072 px long side.
    assert.equal(previewWidth(A4L, 2048), 3072);
    // Portrait: the height is the long side, so width = 3072 * w / h.
    const w = previewWidth(A4, 2048);
    assert.equal(w, Math.floor((3072 * A4.w) / A4.h));
    assert.ok(pageHeightPx(A4, w) <= 3072);
  });

  test('never exceeds 1.5 x screen on the long side', () => {
    for (const screen of [800, 1334, 1920, 2048, 2388, 2732]) {
      for (const size of [A4, A4L, { w: 612, h: 792 }, { w: 960, h: 540 }, { w: 100, h: 3000 }]) {
        const w = previewWidth(size, screen);
        const h = pageHeightPx(size, w);
        assert.ok(Math.max(w, h) <= Math.floor(screen * 1.5), `${screen} ${size.w}x${size.h}: ${w}x${h}`);
        assert.ok(w >= 1 && Number.isInteger(w));
      }
    }
  });

  test('bad input gives a small sane width', () => {
    assert.equal(previewWidth({ w: 0, h: 0 }, 0), PREVIEW_MIN_LONG_PX);
    assert.equal(previewWidth({ w: NaN, h: 10 }, 1000), Math.floor((1500 * 1) / 10));
    assert.equal(previewWidth(A4L, -5), PREVIEW_MIN_LONG_PX);
  });

  test('previewScale and pageHeightPx', () => {
    close(previewScale(A4, 1190.56), 2);
    assert.equal(previewScale({ w: 0, h: 1 }, 100), 0);
    assert.equal(pageHeightPx(A4, 595), 841);
    assert.equal(pageHeightPx({ w: 0, h: 1 }, 100), 1);
  });
});

describe('levels', () => {
  test('levelFor picks the smallest level at or above the scale', () => {
    assert.equal(levelFor(1), 0);
    assert.equal(levelFor(2), 2);
    assert.equal(levelFor(Math.SQRT2), 1);
    assert.equal(levelFor(1.5), 2);
    assert.equal(levelFor(0.5), -2);
    assert.equal(levelFor(0.6), -1);
    for (const s of [0.3, 0.77, 1, 1.01, 2.2, 3.9, 7.5, 13.8]) {
      const k = levelFor(s);
      assert.ok(levelScale(k) >= s - 1e-9, `level ${k} too coarse for ${s}`);
      assert.ok(levelScale(k - 1) < s, `level ${k} not the smallest for ${s}`);
    }
  });

  test('exact level scales stay on their level despite float noise', () => {
    for (let k = -4; k <= 10; k++) assert.equal(levelFor(levelScale(k)), k);
  });

  test('a small zoom change keeps the level', () => {
    assert.equal(levelFor(2.9), levelFor(2.95));
  });

  test('needsTiles', () => {
    assert.equal(needsTiles(2, 2), false);
    assert.equal(needsTiles(2.15, 2), false);
    assert.equal(needsTiles(2.3, 2), true);
    assert.equal(needsTiles(1, 0), true);
    assert.equal(needsTiles(0, 2), false);
  });
});

describe('tileGrid and tileAt', () => {
  test('grid covers the whole page', () => {
    const g = tileGrid(A4, 2); // 2 px/pt
    assert.equal(g.widthPx, 1191);
    assert.equal(g.heightPx, 1684);
    assert.equal(g.cols, 3);
    assert.equal(g.rows, 4);
  });

  test('interior and edge tiles', () => {
    const t = tileAt(0, A4, 2, 0, 0);
    assert.equal(t.widthPx, TILE_PX);
    assert.equal(t.heightPx, TILE_PX);
    close(t.x, 0);
    close(t.w, 256);
    const e = tileAt(0, A4, 2, 2, 3);
    assert.equal(e.widthPx, 1191 - 1024);
    assert.equal(e.heightPx, 1684 - 1536);
    close(e.x + e.w, A4.w);
    close(e.y + e.h, A4.h);
    assert.equal(e.key, '0/2/2_3');
  });

  test('tiles of a level tile the page exactly, no gaps or overlaps', () => {
    for (const level of [-1, 0, 1, 3, 5]) {
      const g = tileGrid(A4, level);
      let area = 0;
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const t = tileAt(1, A4, level, c, r);
          assert.ok(t.w > 0 && t.h > 0);
          area += t.w * t.h;
          if (c > 0) close(tileAt(1, A4, level, c - 1, r).x + tileAt(1, A4, level, c - 1, r).w, t.x);
          if (r > 0) close(tileAt(1, A4, level, c, r - 1).y + tileAt(1, A4, level, c, r - 1).h, t.y);
        }
      }
      close(area, A4.w * A4.h, 1e-3);
    }
  });

  test('regionOf strips the grid fields', () => {
    const r = regionOf(tileAt(4, A4, 0, 1, 0));
    assert.deepEqual(Object.keys(r).sort(), ['h', 'heightPx', 'page', 'w', 'widthPx', 'x', 'y']);
    assert.equal(r.page, 4);
  });
});

describe('tilesFor', () => {
  test('covers the visible rect at a level not coarser than the screen', () => {
    const visible = { x: 100, y: 200, w: 150, h: 200 };
    const set = tilesFor({ page: 3, size: A4, pxPerPt: 5.3, visible });
    assert.ok(set.scale >= 5.3);
    assert.ok(set.tiles.length > 0);
    // Union of tiles contains the visible rect.
    const x0 = Math.min(...set.tiles.map((t) => t.x));
    const y0 = Math.min(...set.tiles.map((t) => t.y));
    const x1 = Math.max(...set.tiles.map((t) => t.x + t.w));
    const y1 = Math.max(...set.tiles.map((t) => t.y + t.h));
    assert.ok(x0 <= 100 && y0 <= 200 && x1 >= 250 && y1 >= 400);
    // Every tile overlaps the visible rect (no margin asked for).
    for (const t of set.tiles) {
      assert.ok(t.x < 250 && t.x + t.w > 100 && t.y < 400 && t.y + t.h > 200, t.key);
      assert.equal(t.page, 3);
    }
    // Pixel sizes match the level scale.
    for (const t of set.tiles) {
      assert.ok(Math.abs(t.w * set.scale - t.widthPx) <= 1);
      assert.ok(Math.abs(t.h * set.scale - t.heightPx) <= 1);
    }
  });

  test('nearest to the centre first', () => {
    const set = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: { x: 0, y: 0, w: A4.w, h: A4.h } });
    const cx = A4.w / 2;
    const cy = A4.h / 2;
    const d = (t: { x: number; y: number; w: number; h: number }) => (t.x + t.w / 2 - cx) ** 2 + (t.y + t.h / 2 - cy) ** 2;
    const first = set.tiles[0];
    const last = set.tiles[set.tiles.length - 1];
    assert.ok(d(first) <= d(last));
    // Whole page at the level: all tiles.
    assert.equal(set.tiles.length, set.cols * set.rows);
    assert.equal(new Set(set.tiles.map((t) => t.key)).size, set.tiles.length);
  });

  test('visible rect is clipped to the page; off-page gives no tiles', () => {
    const outside = tilesFor({ page: 0, size: A4, pxPerPt: 4, visible: { x: 700, y: 0, w: 100, h: 100 } });
    assert.equal(outside.tiles.length, 0);
    assert.equal(outside.level, levelFor(4));
    const partly = tilesFor({ page: 0, size: A4, pxPerPt: 4, visible: { x: -100, y: -100, w: 150, h: 150 } });
    assert.ok(partly.tiles.length >= 1);
    for (const t of partly.tiles) assert.ok(t.x >= 0 && t.y >= 0);
  });

  test('margin adds a ring of tiles, clamped to the grid', () => {
    const base = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: { x: 200, y: 300, w: 10, h: 10 } });
    const ring = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: { x: 200, y: 300, w: 10, h: 10 }, marginTiles: 1 });
    assert.equal(base.tiles.length, 1);
    assert.equal(ring.tiles.length, 9);
    assert.equal(ring.tiles[0].key, base.tiles[0].key);
    const corner = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: { x: 0, y: 0, w: 1, h: 1 }, marginTiles: 1 });
    assert.equal(corner.tiles.length, 4);
  });

  test('maxTiles drops to coarser levels until it fits', () => {
    const full = { x: 0, y: 0, w: A4.w, h: A4.h };
    const sharp = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: full });
    const capped = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: full, maxTiles: 12 });
    assert.ok(sharp.tiles.length > 12);
    assert.ok(capped.tiles.length <= 12);
    assert.ok(capped.level < sharp.level);
    const one = tilesFor({ page: 0, size: A4, pxPerPt: 8, visible: full, maxTiles: 1 });
    assert.equal(one.tiles.length, 1);
  });

  test('20 tiles for a 4x zoom on a big iPad screen', () => {
    // 1024 x 1366 pt screen at 2x, A4 fit to width (1.72 pt/pt), zoom 4 -> ~13.8 px/pt.
    const pxPerPt = (1024 / A4.w) * 4 * 2;
    const visible = { x: 100, y: 100, w: 2048 / pxPerPt, h: 2732 / pxPerPt };
    const set = tilesFor({ page: 0, size: A4, pxPerPt, visible });
    assert.ok(set.scale >= pxPerPt);
    assert.ok(set.tiles.length >= 20 && set.tiles.length <= 42, String(set.tiles.length));
  });

  test('bad numbers never throw', () => {
    assert.equal(tilesFor({ page: 0, size: { w: 0, h: 0 }, pxPerPt: 2, visible: { x: 0, y: 0, w: 1, h: 1 } }).tiles.length, 0);
    assert.equal(tilesFor({ page: 0, size: A4, pxPerPt: NaN, visible: { x: 0, y: 0, w: NaN, h: 1 } }).tiles.length, 0);
    assert.equal(clipToPage(A4, { x: 10, y: 10, w: 0, h: 5 }), null);
    // A negative-size rect is normalised.
    assert.deepEqual(clipToPage(A4, { x: 50, y: 50, w: -10, h: -10 }), { x: 40, y: 40, w: 10, h: 10 });
  });
});

describe('cache naming', () => {
  test('pdfPathTail strips the scheme, decodes, and keeps the notebooks tail', () => {
    assert.equal(
      pdfPathTail('file:///var/mobile/Containers/Data/Application/AAA/Documents/notebooks/nb1/assets/f1.pdf'),
      'notebooks/nb1/assets/f1.pdf',
    );
    assert.equal(pdfPathTail('/var/x/Documents/notebooks/nb1/assets/f1.pdf'), 'notebooks/nb1/assets/f1.pdf');
    assert.equal(pdfPathTail('file:///tmp/My%20File.pdf'), '/tmp/My File.pdf');
    assert.equal(pdfPathTail('/tmp/100%.pdf'), '/tmp/100%.pdf');
    assert.equal(pdfPathTail('file:///a//b.pdf'), '/a/b.pdf');
  });

  test('pdfCacheId survives a container move and differs per file', () => {
    const a = pdfCacheId('file:///var/mobile/Containers/Data/Application/AAA/Documents/notebooks/nb1/assets/f1.pdf');
    const b = pdfCacheId('/var/mobile/Containers/Data/Application/BBB/Documents/notebooks/nb1/assets/f1.pdf');
    const c = pdfCacheId('/var/mobile/Containers/Data/Application/AAA/Documents/notebooks/nb1/assets/f2.pdf');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{16}$/);
  });

  test('hashString is stable and spreads', () => {
    assert.equal(hashString('abc'), hashString('abc'));
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(hashString(`notebooks/nb${i}/assets/f.pdf`));
    assert.equal(seen.size, 5000);
  });

  test('region and page keys', () => {
    const r = { page: 2, x: 12.345, y: 0, w: 256, h: 256.004, widthPx: 512, heightPx: 512 };
    assert.equal(regionCacheKey(r), 'r2_1235_0_25600_25600_512x512');
    assert.equal(pageCacheKey(0, 1191), 'p0_w1191');
    assert.match(regionCacheKey(regionOf(tileAt(0, A4, 3, 1, 2))), /^r0_\d+_\d+_\d+_\d+_\d+x\d+$/);
  });
});
