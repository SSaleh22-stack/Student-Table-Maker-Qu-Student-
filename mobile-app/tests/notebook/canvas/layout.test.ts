import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  bandWidth,
  computeLayout,
  LAYOUT_HEADER,
  layoutContentH,
  layoutContentW,
  layoutCount,
  layoutScale,
  nearestPageIndex,
  PAGE_GAP,
  PAGE_MARGIN,
  pageIndexAt,
  pageRect,
  pageTop,
  remapContentPoint,
  sameLayout,
  visibleRange,
} from '../../../src/notebook/core/canvas/layout.ts';

const A4 = { w: 595.28, h: 841.89 };
const WIDE = { w: 960, h: 540 };
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('computeLayout', () => {
  test('one fit scale: the widest page fills the band minus the margins', () => {
    const l = computeLayout([A4, A4, A4], 834, NO_INSETS);
    assert.equal(layoutCount(l), 3);
    assert.equal(l.length, LAYOUT_HEADER + 3 * 4);
    close(layoutScale(l), (834 - 2 * PAGE_MARGIN) / A4.w);
    assert.equal(layoutContentW(l), 834);
    const r0 = pageRect(l, 0)!;
    close(r0[0], PAGE_MARGIN);
    close(r0[1], PAGE_MARGIN);
    close(r0[2], 834 - 2 * PAGE_MARGIN);
    close(r0[3], A4.h * layoutScale(l));
    const r1 = pageRect(l, 1)!;
    close(r1[1], r0[1] + r0[3] + PAGE_GAP);
    const r2 = pageRect(l, 2)!;
    close(layoutContentH(l), r2[1] + r2[3] + PAGE_MARGIN);
  });

  test('mixed sizes: narrower pages are centred and keep the same scale', () => {
    const l = computeLayout([A4, WIDE], 1000, NO_INSETS);
    const k = layoutScale(l);
    close(k, (1000 - 2 * PAGE_MARGIN) / WIDE.w);
    const a = pageRect(l, 0)!;
    const b = pageRect(l, 1)!;
    close(a[2], A4.w * k);
    close(a[0], (1000 - a[2]) / 2);
    close(b[0], PAGE_MARGIN);
  });

  test('physical insets narrow the band (dock and vertical toolbar)', () => {
    const insets = { top: 60, bottom: 48, left: 68, right: 300 };
    assert.equal(bandWidth(1194, insets), 1194 - 68 - 300);
    const l = computeLayout([A4], 1194, insets);
    assert.equal(layoutContentW(l), 1194 - 68 - 300);
    close(layoutScale(l), (1194 - 368 - 2 * PAGE_MARGIN) / A4.w);
  });

  test('no pages and bad sizes', () => {
    const empty = computeLayout([], 400, NO_INSETS);
    assert.equal(layoutCount(empty), 0);
    assert.equal(layoutContentH(empty), 2 * PAGE_MARGIN);
    assert.equal(pageRect(empty, 0), null);
    assert.ok(Number.isNaN(pageTop(empty, 0)));
    const odd = computeLayout([{ w: 0, h: Number.NaN }, A4], 400, NO_INSETS);
    const r = pageRect(odd, 0)!;
    assert.ok(r[2] > 0 && r[3] > 0, 'a broken size still gets a box');
  });

  test('a view narrower than its margins keeps a positive scale', () => {
    const l = computeLayout([A4], 10, NO_INSETS);
    assert.ok(layoutScale(l) > 0);
  });
});

describe('lookups', () => {
  const l = computeLayout(Array.from({ length: 100 }, () => A4), 834, NO_INSETS);
  const k = layoutScale(l);
  const h = A4.h * k;

  test('pageIndexAt finds pages and gaps (binary search over 100 pages)', () => {
    assert.equal(pageIndexAt(l, PAGE_MARGIN + 1), 0);
    assert.equal(pageIndexAt(l, PAGE_MARGIN + h + PAGE_GAP / 2), -1);
    assert.equal(pageIndexAt(l, PAGE_MARGIN + h + PAGE_GAP / 2, PAGE_GAP), 0);
    for (const i of [0, 1, 37, 99]) assert.equal(pageIndexAt(l, pageTop(l, i) + h / 2), i);
    assert.equal(pageIndexAt(l, -5), -1);
    assert.equal(pageIndexAt(l, layoutContentH(l) + 5), -1);
  });

  test('nearestPageIndex never misses', () => {
    assert.equal(nearestPageIndex(l, -100), 0);
    assert.equal(nearestPageIndex(l, 1e9), 99);
    const gapTop = pageTop(l, 4) + h;
    assert.equal(nearestPageIndex(l, gapTop + 1), 4);
    assert.equal(nearestPageIndex(l, gapTop + PAGE_GAP - 1), 5);
    assert.equal(nearestPageIndex(computeLayout([], 100, NO_INSETS), 0), -1);
  });

  test('visibleRange', () => {
    assert.deepEqual(visibleRange(l, 0, 10), [-1, -1], 'above the first page (margin)');
    assert.deepEqual(visibleRange(l, 0, PAGE_MARGIN + 1), [0, 0]);
    assert.deepEqual(visibleRange(l, pageTop(l, 3) + 10, pageTop(l, 5) + 10), [3, 5]);
    assert.deepEqual(visibleRange(l, pageTop(l, 3) + h + 2, pageTop(l, 3) + h + 4), [-1, -1]);
    assert.deepEqual(visibleRange(l, -50, 1e9), [0, 99]);
    assert.deepEqual(visibleRange(l, 1e9, 1e9 + 1), [-1, -1]);
    assert.deepEqual(visibleRange(l, 10, 5), [-1, -1]);
  });
});

describe('remapContentPoint keeps the page position', () => {
  test('a page above grows: the point moves down by the growth', () => {
    const before = computeLayout([A4, A4, A4], 834, NO_INSETS);
    const after = computeLayout([{ w: A4.w, h: A4.h * 2 }, A4, A4], 834, NO_INSETS);
    const k = layoutScale(before);
    const y = pageTop(before, 2) + 100;
    const p = remapContentPoint(before, after, 200, y);
    close(p[1], y + A4.h * k);
    close(p[0], 200);
  });

  test('a narrower band rescales around the page', () => {
    const before = computeLayout([A4, A4], 834, NO_INSETS);
    const after = computeLayout([A4, A4], 534, NO_INSETS);
    const kb = layoutScale(before);
    const ka = layoutScale(after);
    const rb = pageRect(before, 1)!;
    const ra = pageRect(after, 1)!;
    const p = remapContentPoint(before, after, rb[0] + 50 * kb, rb[1] + 70 * kb);
    close(p[0], ra[0] + 50 * ka);
    close(p[1], ra[1] + 70 * ka);
  });

  test('sameLayout', () => {
    const a = computeLayout([A4], 834, NO_INSETS);
    assert.ok(sameLayout(a, computeLayout([A4], 834, NO_INSETS)));
    assert.ok(!sameLayout(a, computeLayout([A4], 835, NO_INSETS)));
    assert.ok(!sameLayout(a, computeLayout([A4, A4], 834, NO_INSETS)));
  });
});
