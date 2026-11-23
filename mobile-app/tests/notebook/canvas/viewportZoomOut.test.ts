import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeLayout, layoutContentW, pageRect } from '../../../src/notebook/core/canvas/layout.ts';
import { clampViewport, FIT_MARGIN, MIN_ZOOM, minZoomFor, translateBounds, zoomAbout, zoomToCenter } from '../../../src/notebook/core/canvas/viewport.ts';

const A4 = { w: 595.28, h: 841.89 };
const WIDE = { w: 841.89, h: 595.28 };
const INSETS = { top: 80, bottom: 48, left: 0, right: 0 };

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('zooming out until the tallest page fits', () => {
  test('portrait iPad, A4: the minimum shows the whole page with the margin', () => {
    const view = { w: 834, h: 1194 };
    const layout = computeLayout([A4, A4, A4], view.w, INSETS);
    const min = minZoomFor(layout, view, INSETS);
    assert.ok(min < 1 && min > 0.5, String(min));
    const r = pageRect(layout, 0);
    assert.ok(r);
    const bandH = view.h - INSETS.top - INSETS.bottom;
    close(r[3] * min, bandH - 2 * FIT_MARGIN);
  });

  test('landscape iPad: a much smaller minimum', () => {
    const view = { w: 1194, h: 834 };
    const layout = computeLayout([A4, A4], view.w, INSETS);
    const min = minZoomFor(layout, view, INSETS);
    assert.ok(min < 0.5, String(min));
  });

  test('a page that already fits at 100% cannot zoom out', () => {
    const view = { w: 834, h: 1194 };
    const layout = computeLayout([WIDE], view.w, INSETS);
    assert.equal(minZoomFor(layout, view, INSETS), MIN_ZOOM);
  });

  test('the tallest page decides', () => {
    const view = { w: 834, h: 1194 };
    const mixed = computeLayout([WIDE, A4, WIDE, A4], view.w, INSETS);
    const tallest = Math.max(...[0, 1, 2, 3].map((i) => pageRect(mixed, i)![3]));
    const bandH = view.h - INSETS.top - INSETS.bottom;
    const min = minZoomFor(mixed, view, INSETS);
    close(Math.min(1, (bandH - 2 * FIT_MARGIN) / tallest), min);
  });

  test('no pages: 100%', () => {
    assert.equal(minZoomFor([], { w: 834, h: 1194 }, INSETS), MIN_ZOOM);
  });

  test('pinch and clamp stop at the minimum, and the column is centered', () => {
    const view = { w: 834, h: 1194 };
    const layout = computeLayout([A4], view.w, INSETS);
    const min = minZoomFor(layout, view, INSETS);
    const z = zoomAbout({ scale: 1, tx: 0, ty: 80 }, 400, 600, 0.05, min);
    close(z.scale, min);
    const c = clampViewport({ scale: 0.05, tx: 0, ty: 0 }, layout, view, INSETS);
    close(c.scale, min);
    // Centered across the band (horizontally and, for one page, vertically).
    const cw = layoutContentW(layout) * c.scale;
    close(c.tx, (view.w - cw) / 2);
    const b = translateBounds(c.scale, layoutContentW(layout), pageRect(layout, 0)![3] + pageRect(layout, 0)![1] * 2, view, INSETS);
    assert.equal(b[2], b[3]);
    // Without a minimum, zoomAbout still stops at 100%.
    close(zoomAbout({ scale: 1, tx: 0, ty: 80 }, 400, 600, 0.5).scale, 1);
  });

  test('zoomToCenter can zoom out to the minimum', () => {
    const view = { w: 834, h: 1194 };
    const layout = computeLayout([A4, A4], view.w, INSETS);
    const z = zoomToCenter({ scale: 1, tx: 0, ty: 80 }, 0.2, layout, view, INSETS);
    close(z.scale, minZoomFor(layout, view, INSETS));
  });
});
