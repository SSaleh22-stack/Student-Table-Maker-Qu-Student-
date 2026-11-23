import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeLayout, layoutContentH, layoutScale, pageRect, pageTop } from '../../../src/notebook/core/canvas/layout.ts';
import {
  clampViewport,
  clampZoom,
  contentToScreen,
  currentPage,
  MAX_ZOOM,
  MIN_ZOOM,
  pageOriginOnScreen,
  pageToScreen,
  screenToContent,
  screenToPage,
  screenToPageOf,
  scrollToPage,
  translateBounds,
  visiblePageRect,
  visiblePages,
  zoomAbout,
  zoomToCenter,
} from '../../../src/notebook/core/canvas/viewport.ts';

const A4 = { w: 595.28, h: 841.89 };
const VIEW = { w: 834, h: 1194 };
const INSETS = { top: 80, bottom: 48, left: 0, right: 0 };
const layout = computeLayout(Array.from({ length: 10 }, () => A4), VIEW.w, INSETS);

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('zoom 1 to 4', () => {
  test('clampZoom', () => {
    assert.equal(MIN_ZOOM, 1);
    assert.equal(MAX_ZOOM, 4);
    assert.equal(clampZoom(0.3), 1);
    assert.equal(clampZoom(9), 4);
    assert.equal(clampZoom(2.5), 2.5);
    assert.equal(clampZoom(Number.NaN), 1);
  });

  test('zoomAbout keeps the focal content point still', () => {
    const vp = { scale: 1, tx: 0, ty: 80 };
    const fx = 300;
    const fy = 500;
    const before = screenToContent(vp, fx, fy);
    const z = zoomAbout(vp, fx, fy, 2.5);
    assert.equal(z.scale, 2.5);
    const after = contentToScreen(z, before[0], before[1]);
    close(after[0], fx);
    close(after[1], fy);
    assert.equal(zoomAbout(vp, fx, fy, 10).scale, 4);
  });

  test('zoomToCenter is clamped', () => {
    const z = zoomToCenter({ scale: 1, tx: 0, ty: 80 }, 3, layout, VIEW, INSETS);
    assert.equal(z.scale, 3);
    const b = translateBounds(3, VIEW.w, layoutContentH(layout), VIEW, INSETS);
    assert.ok(z.tx >= b[0] - 1e-9 && z.tx <= b[1] + 1e-9);
    assert.ok(z.ty >= b[2] - 1e-9 && z.ty <= b[3] + 1e-9);
  });
});

describe('bounds', () => {
  test('zoom 1: the column fills the band, no horizontal pan', () => {
    const b = translateBounds(1, VIEW.w, layoutContentH(layout), VIEW, INSETS);
    assert.equal(b[0], 0);
    assert.equal(b[1], 0);
    assert.equal(b[3], INSETS.top);
    close(b[2], INSETS.top + (VIEW.h - INSETS.top - INSETS.bottom) - layoutContentH(layout));
  });

  test('zoomed in: pan until the edges reach the band', () => {
    const b = translateBounds(2, VIEW.w, layoutContentH(layout), VIEW, INSETS);
    close(b[0], VIEW.w - 2 * VIEW.w);
    assert.equal(b[1], 0);
    const c = clampViewport({ scale: 2, tx: 50, ty: 1e6 }, layout, VIEW, INSETS);
    assert.equal(c.tx, 0);
    assert.equal(c.ty, INSETS.top);
    const d = clampViewport({ scale: 2, tx: -1e6, ty: -1e9 }, layout, VIEW, INSETS);
    close(d.tx, b[0]);
    close(d.ty, b[2]);
  });

  test('physical side insets keep the column between them', () => {
    const insets = { top: 0, bottom: 0, left: 68, right: 300 };
    const l = computeLayout([A4], 1194, insets);
    const b = translateBounds(1, 1194 - 368, layoutContentH(l), { w: 1194, h: 834 }, insets);
    assert.equal(b[0], 68);
    assert.equal(b[1], 68);
    const z = translateBounds(2, 1194 - 368, layoutContentH(l), { w: 1194, h: 834 }, insets);
    assert.equal(z[1], 68);
    close(z[0], 68 + (1194 - 368) - 2 * (1194 - 368));
  });

  test('a short column stays at the top', () => {
    const l = computeLayout([{ w: 600, h: 100 }], VIEW.w, INSETS);
    const b = translateBounds(1, VIEW.w, layoutContentH(l), VIEW, INSETS);
    assert.equal(b[2], INSETS.top);
    assert.equal(b[3], INSETS.top);
  });
});

describe('screen <-> page', () => {
  const vp = { scale: 2, tx: -100, ty: -300 };
  const k = layoutScale(layout);

  test('round trip through a page', () => {
    const s = pageToScreen(layout, vp, 1, 100, 200);
    const hit = screenToPage(layout, vp, s[0], s[1])!;
    assert.equal(hit.index, 1);
    close(hit.x, 100);
    close(hit.y, 200);
    const o = pageOriginOnScreen(layout, vp, 1)!;
    close(o[2], k * 2);
    close(o[0] + 100 * o[2], s[0]);
    close(o[1] + 200 * o[2], s[1]);
  });

  test('gaps and the margin are not on a page; slop widens the page', () => {
    const r = pageRect(layout, 0)!;
    const gapY = (r[1] + r[3] + 5) * vp.scale + vp.ty;
    const x = (r[0] + 10) * vp.scale + vp.tx;
    assert.equal(screenToPage(layout, vp, x, gapY), null);
    assert.equal(screenToPage(layout, vp, x, gapY, 20)!.index, 0);
    const beside = (r[0] - 4) * vp.scale + vp.tx;
    assert.equal(screenToPage(layout, vp, beside, (r[1] + 10) * vp.scale + vp.ty), null);
  });

  test('screenToPageOf follows a stroke beyond its page', () => {
    const r = pageRect(layout, 2)!;
    const s = contentToScreen(vp, r[0] - 10 * k, r[1] - 20 * k);
    const p = screenToPageOf(layout, vp, 2, s[0], s[1]);
    close(p[0], -10);
    close(p[1], -20);
    assert.ok(Number.isNaN(screenToPageOf(layout, vp, 99, 0, 0)[0]));
  });

  test('visible pages and the visible part of a page', () => {
    const top = { scale: 1, tx: 0, ty: INSETS.top };
    assert.deepEqual(visiblePages(layout, top, VIEW), [0, 0]);
    assert.deepEqual(visiblePages(layout, { scale: 1, tx: 0, ty: INSETS.top - 600 }, VIEW), [0, 1]);
    const r = visiblePageRect(layout, top, VIEW, 0)!;
    close(r.x, 0);
    close(r.y, 0);
    close(r.w, A4.w);
    close(r.h, (VIEW.h - INSETS.top - 16) / layoutScale(layout), 1e-6);
    assert.equal(visiblePageRect(layout, top, VIEW, 5), null);
    const zoomed = { scale: 4, tx: -1000, ty: -2000 };
    const z = visiblePageRect(layout, zoomed, VIEW, 0)!;
    assert.ok(z.w < A4.w / 3 && z.h < A4.h / 3);
  });

  test('current page and scrollToPage', () => {
    const top = { scale: 1, tx: 0, ty: INSETS.top };
    assert.equal(currentPage(layout, top, VIEW, INSETS), 0);
    const at5 = scrollToPage(layout, top, 5, VIEW, INSETS);
    close(at5.ty, INSETS.top + 16 - pageTop(layout, 5));
    assert.equal(currentPage(layout, at5, VIEW, INSETS), 5);
    const last = scrollToPage(layout, top, 99, VIEW, INSETS);
    close(last.ty, INSETS.top + 16 - pageTop(layout, 9), 1e-6);
    const zoomed = scrollToPage(layout, { scale: 4, tx: 0, ty: 0 }, 9, VIEW, INSETS);
    const b = translateBounds(4, VIEW.w, layoutContentH(layout), VIEW, INSETS);
    assert.ok(zoomed.ty >= b[2] - 1e-9 && zoomed.ty <= b[3] + 1e-9);
    assert.equal(currentPage(computeLayout([], 100, INSETS), top, VIEW, INSETS), -1);
  });
});
