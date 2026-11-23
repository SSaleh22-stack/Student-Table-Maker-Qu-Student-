import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { itemBounds } from '../../../src/notebook/core/ink/bounds.ts';
import { matApply } from '../../../src/notebook/core/ink/matrix.ts';
import { applyMatrixToItem } from '../../../src/notebook/core/ink/transform.ts';
import type { ImageItem, ShapeItem, StrokeItem, TextItem } from '../../../src/notebook/core/model/types.ts';
import {
  CROP_ASPECTS,
  FULL_CROP,
  RESIZE_HANDLES,
  SIZE_PRESETS,
  applyCrop,
  cropToDisplay,
  displayToCrop,
  dragCropRect,
  fitAspect,
  fitContain,
  framePoint,
  handleKind,
  handleTransform,
  insertImageBox,
  isHighlighterSelection,
  itemAt,
  normalizeCrop,
  pageToPageMatrix,
  pasteOffset,
  presetLabel,
  presetScale,
  recolorItems,
  selectionBounds,
  selectionColor,
  selectionFrame,
  sizeChipText,
  snapRotation,
  transformFrame,
  transformOptionsFor,
  type SelFrame,
} from '../../../src/notebook/core/tools/selection.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const closePt = (p: number[], x: number, y: number, eps = 1e-6) => {
  close(p[0], x, eps);
  close(p[1], y, eps);
};
const deg = (d: number) => (d * Math.PI) / 180;

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
const rect = (id: string, x: number, y: number, w: number, h: number, rot = 0): ShapeItem => ({
  id,
  kind: 'shape',
  shape: 'rect',
  color: '#1D4ED8',
  width: 3,
  fill: null,
  box: { x, y, w, h, rot },
});
const image = (id: string, x: number, y: number, w: number, h: number, rot = 0, crop: ImageItem['crop'] = null): ImageItem => ({
  id,
  kind: 'image',
  fileId: 'f1',
  box: { x, y, w, h, rot },
  crop,
});
const text = (id: string): TextItem => ({
  id,
  kind: 'text',
  box: { x: 10, y: 10, w: 200, h: 40, rot: 0 },
  text: 'ملاحظة',
  size: 18,
  color: '#1B2533',
  bold: false,
});

const FRAME: SelFrame = { cx: 200, cy: 150, w: 200, h: 100, rot: 0 };

describe('frame', () => {
  test('a single boxed item uses its own (rotated) box; others use the bounds', () => {
    const r = rect('r', 100, 100, 330, 210, 0.3);
    const f = selectionFrame([r]);
    assert.ok(f);
    close(f.w, 330);
    close(f.h, 210);
    close(f.rot, 0.3);
    close(f.cx, 265);
    close(f.cy, 205);
    const img = selectionFrame([image('i', 0, 0, 40, 20, -0.2)]);
    assert.ok(img);
    close(img.rot, -0.2);
    const t = selectionFrame([text('t')]);
    assert.ok(t);
    close(t.w, 200);

    const s = stroke('s', [0, 0, 0.5, 100, 50, 0.5]);
    const fs = selectionFrame([s]);
    const b = itemBounds(s);
    assert.ok(fs);
    close(fs.rot, 0);
    close(fs.w, b[2] - b[0]);
    close(fs.h, b[3] - b[1]);

    const two = selectionFrame([r, s]);
    assert.ok(two);
    close(two.rot, 0);
    assert.equal(selectionFrame([]), null);
    assert.equal(selectionBounds([]), null);
  });

  test('a triangle drawn from points uses the bounds', () => {
    const tri: ShapeItem = { ...rect('t', 0, 0, 10, 10, 0.5), shape: 'triangle', pts: [0, 0, 10, 0, 5, 8] };
    const f = selectionFrame([tri]);
    assert.ok(f);
    close(f.rot, 0);
  });

  test('framePoint and transformFrame', () => {
    closePt(framePoint(FRAME, -1, -1), 100, 100);
    closePt(framePoint(FRAME, 1, 0), 300, 150);
    const rotated = { ...FRAME, rot: Math.PI / 2 };
    closePt(framePoint(rotated, 1, 0), 200, 250);
    const moved = transformFrame(FRAME, handleTransform(FRAME, 'move', 10, -5));
    close(moved.cx, 210);
    close(moved.cy, 145);
    assert.equal(transformFrame(FRAME, []), FRAME);
  });
});

describe('handleTransform', () => {
  test('8 resize handles: 4 corners and 4 edges', () => {
    assert.equal(RESIZE_HANDLES.length, 8);
    assert.equal(RESIZE_HANDLES.filter((h) => handleKind(h) === 'corner').length, 4);
    assert.equal(RESIZE_HANDLES.filter((h) => handleKind(h) === 'edge').length, 4);
    assert.equal(handleKind('rotate'), 'rotate');
    assert.equal(handleKind('move'), 'move');
  });

  test('move is a translation', () => {
    const m = handleTransform(FRAME, 'move', 12, 7);
    closePt(matApply(m, 0, 0), 12, 7);
  });

  test('a corner scales uniformly about the opposite corner', () => {
    // Drag the bottom-right corner along its diagonal to double the size.
    const m = handleTransform(FRAME, 'br', 200, 100);
    closePt(matApply(m, 100, 100), 100, 100); // anchor (top-left) stays
    closePt(matApply(m, 300, 200), 500, 300);
    close(m[0], 2);
    close(m[3], 2);
    // A sideways drag still scales uniformly (projection on the diagonal).
    const side = handleTransform(FRAME, 'br', 100, 0);
    close(side[0], side[3]);
    close(side[1], 0);
    // Top-left: anchor is bottom-right.
    const tl = handleTransform(FRAME, 'tl', 50, 25);
    closePt(matApply(tl, 300, 200), 300, 200);
    close(tl[0], 0.75);
  });

  test('corner scale never flips or goes below the minimum size', () => {
    const m = handleTransform(FRAME, 'br', -1000, -1000);
    assert.ok(m[0] > 0);
    close(m[0] * FRAME.w, 4, 1e-9); // the larger side ends at 4 pt
    const big = handleTransform(FRAME, 'br', 1e7, 1e7);
    close(big[0], 50);
  });

  test('an edge scales one axis only (non-uniform)', () => {
    const r = handleTransform(FRAME, 'r', 100, 999);
    close(r[0], 1.5);
    close(r[3], 1);
    closePt(matApply(r, 100, 150), 100, 150); // left edge stays
    const t = handleTransform(FRAME, 't', 999, -50);
    close(t[0], 1);
    close(t[3], 1.5);
    closePt(matApply(t, 200, 200), 200, 200); // bottom edge stays
    const l = handleTransform(FRAME, 'l', 50, 0);
    close(l[0], 0.75);
    closePt(matApply(l, 300, 150), 300, 150);
    // Strokes are stretched, widths kept, text reflowed.
    const s = stroke('s', [100, 100, 0.5, 300, 200, 0.5]);
    const out = applyMatrixToItem(s, r, transformOptionsFor('r'));
    assert.deepEqual(out.pts.map((v) => Math.round(v * 1000) / 1000), [100, 100, 0.5, 400, 200, 0.5]);
    assert.equal(out.width, 2);
    assert.deepEqual(transformOptionsFor('r'), { scaleWidth: false, textMode: 'reflow' });
    assert.deepEqual(transformOptionsFor('br'), { scaleWidth: true, textMode: 'scale' });
  });

  test('an edge of a rotated frame scales along the frame axis', () => {
    const f: SelFrame = { cx: 0, cy: 0, w: 100, h: 50, rot: Math.PI / 2 };
    // The frame's local +x points down the page; dragging the 'r' handle 50 pt down stretches 1.5x.
    const m = handleTransform(f, 'r', 0, 50);
    const box = applyMatrixToItem(image('i', -50, -25, 100, 50, Math.PI / 2), m).box;
    close(box.w, 150);
    close(box.h, 50);
    close(box.rot, Math.PI / 2);
    // The opposite edge (local -x, page y = -50) stays.
    closePt(matApply(m, 0, -50), 0, -50);
  });

  test('rotate: about the center, snapping to 15° multiples', () => {
    // Handle above the top-middle (200, 100 - 20). Drag it to the right of the center: 90°.
    const m = handleTransform(FRAME, 'rotate', 100 + 0, 70, { rotateOffset: 20 });
    // pointer = (300, 150) -> angle 0 from the center; start angle -90° -> delta +90°.
    closePt(matApply(m, 200, 150), 200, 150);
    closePt(matApply(m, 200, 100), 250, 150);
    // 42° snaps to 45°, 37° does not snap (8° away from 45, 7° from 30).
    const at = (a: number) => {
      const r = 50 + 20;
      // start point at (200, 80); target at center + r * (sin a, -cos a)
      return handleTransform(FRAME, 'rotate', r * Math.sin(a), r - r * Math.cos(a), { rotateOffset: 20 });
    };
    close(Math.atan2(at(deg(42))[1], at(deg(42))[0]), deg(45));
    close(Math.atan2(at(deg(37))[1], at(deg(37))[0]), deg(37));
    close(Math.atan2(at(deg(-2))[1], at(deg(-2))[0]), 0);
    const free = handleTransform(FRAME, 'rotate', 70 * Math.sin(deg(41)), 70 - 70 * Math.cos(deg(41)), { rotateOffset: 20, snap: false });
    close(Math.atan2(free[1], free[0]), deg(41));
  });

  test('rotation snapping uses the total angle of a rotated frame', () => {
    const f: SelFrame = { ...FRAME, rot: deg(10) };
    // Turn by 33°: total 43° snaps to 45°, so the delta is 35°.
    const a = deg(10 + 33);
    const r = 50;
    const start = [f.cx + r * Math.sin(f.rot), f.cy - r * Math.cos(f.rot)];
    const target = [f.cx + r * Math.sin(a), f.cy - r * Math.cos(a)];
    const m = handleTransform(f, 'rotate', target[0] - start[0], target[1] - start[1]);
    close(Math.atan2(m[1], m[0]), deg(35));
  });

  test('snapRotation', () => {
    close(snapRotation(deg(88)), deg(90));
    close(snapRotation(deg(80)), deg(80));
    close(snapRotation(deg(-46)), deg(-45));
    close(snapRotation(deg(179)), Math.PI);
  });

  test('non-finite input gives the identity', () => {
    assert.deepEqual(handleTransform(FRAME, 'br', NaN, 1), [1, 0, 0, 1, 0, 0]);
  });
});

describe('presets, chip, paste', () => {
  test('presets scale about the selection center', () => {
    assert.deepEqual([...SIZE_PRESETS], [50, 75, 125, 150, 200]);
    const b = [100, 100, 300, 200];
    for (const pct of SIZE_PRESETS) {
      const m = presetScale(b, pct);
      closePt(matApply(m, 200, 150), 200, 150);
      close(m[0], pct / 100);
      close(m[3], pct / 100);
    }
    const half = presetScale(b, 50);
    closePt(matApply(half, 100, 100), 150, 125);
    assert.deepEqual(presetScale(b, 0), [1, 0, 0, 1, 0, 0]);
    assert.equal(presetLabel(125), '125%');
  });

  test('sizeChipText', () => {
    assert.equal(sizeChipText({ w: 330.2, h: 209.6 }, 'ar'), 'عرض 330 · ارتفاع 210');
    assert.equal(sizeChipText({ w: 330, h: 210 }, 'en'), 'W 330 · H 210');
    assert.equal(sizeChipText([10, 20, 110.5, 70], 'en'), 'W 101 · H 50');
    assert.equal(sizeChipText({ w: NaN, h: -3 }, 'en'), 'W 0 · H 0');
  });

  test('pasteOffset centers on the target and stays on the page', () => {
    const b = [10, 10, 110, 60];
    assert.deepEqual(pasteOffset(b, { x: 300, y: 300 }), { dx: 240, dy: 265 });
    assert.deepEqual(pasteOffset(b, null), { dx: 20, dy: 20 });
    // Near the bottom-right corner of a 400 x 400 page: clamped.
    assert.deepEqual(pasteOffset(b, { x: 390, y: 395 }, { w: 400, h: 400 }), { dx: 290, dy: 340 });
    // Near the top-left: clamped at 0.
    assert.deepEqual(pasteOffset(b, { x: 0, y: 0 }, { w: 400, h: 400 }), { dx: -10, dy: -10 });
    // Larger than the page: centered.
    const wide = [0, 0, 600, 10];
    assert.equal(pasteOffset(wide, { x: 100, y: 100 }, { w: 400, h: 400 }).dx, -100);
    assert.deepEqual(pasteOffset(null, { x: 1, y: 1 }), { dx: 0, dy: 0 });
  });

  test('pageToPageMatrix keeps items in place on screen', () => {
    const from = { x: 10, y: 100, k: 2 };
    const to = { x: 10, y: 1800, k: 2 };
    const m = pageToPageMatrix(from, to);
    // Page point (50, 800) on the first page is at screen (110, 1700): on the second page that is (50, -50).
    closePt(matApply(m, 50, 800), 50, -50);
    const zoomed = pageToPageMatrix({ x: 0, y: 0, k: 2 }, { x: 0, y: 0, k: 1 });
    closePt(matApply(zoomed, 10, 10), 20, 20);
  });
});

describe('items', () => {
  test('itemAt finds the top-most item', () => {
    const a = rect('a', 0, 0, 100, 100);
    const s = stroke('s', [0, 50, 0.5, 100, 50, 0.5]);
    assert.equal(itemAt([a, s], 50, 50, 4)?.id, 's');
    assert.equal(itemAt([a, s], 0, 20, 4)?.id, 'a');
    assert.equal(itemAt([a, s], 500, 500, 4), null);
  });

  test('colors', () => {
    const img = image('i', 0, 0, 10, 10);
    const s = stroke('s', [0, 0, 0.5], { color: '#DC2626' });
    const h = stroke('h', [0, 0, 0.5], { tool: 'highlighter', color: '#FDE047' });
    assert.equal(selectionColor([img, s]), '#DC2626');
    assert.equal(selectionColor([img]), null);
    assert.equal(isHighlighterSelection([h, img]), true);
    assert.equal(isHighlighterSelection([h, s]), false);
    assert.equal(isHighlighterSelection([img]), false);
    const out = recolorItems([img, s, h], '#dc2626');
    assert.deepEqual(
      out.map((i) => i.id),
      ['h'],
    );
    assert.equal(recolorItems([s], '#1D4ED8')[0].kind === 'stroke' && (recolorItems([s], '#1D4ED8')[0] as StrokeItem).color, '#1D4ED8');
  });
});

describe('image crop', () => {
  test('normalizeCrop', () => {
    assert.equal(normalizeCrop(null), null);
    assert.equal(normalizeCrop(FULL_CROP), null);
    assert.deepEqual(normalizeCrop({ x: 0.9, y: -1, w: 0.5, h: 0.5 }), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    const tiny = normalizeCrop({ x: 0.5, y: 0.5, w: 0, h: 0.1 });
    assert.ok(tiny && tiny.w > 0);
  });

  test('applyCrop keeps the visible part in place', () => {
    const img = image('i', 100, 100, 200, 100);
    const c = applyCrop(img, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    assert.deepEqual(c.crop, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    close(c.box.x, 200);
    close(c.box.y, 100);
    close(c.box.w, 100);
    close(c.box.h, 50);
    // Reset: back to the whole image, where it was.
    const r = applyCrop(c, null);
    assert.equal(r.crop, null);
    close(r.box.x, 100);
    close(r.box.y, 100);
    close(r.box.w, 200);
    close(r.box.h, 100);
    // The input is untouched.
    assert.equal(img.crop, null);
  });

  test('applyCrop on a rotated image moves along its axes', () => {
    const img = image('i', -100, -50, 200, 100, Math.PI / 2);
    const c = applyCrop(img, { x: 0.5, y: 0, w: 0.5, h: 1 });
    // The right half of the image: its center moves +50 along the image x axis (= page +y).
    close(c.box.x + c.box.w / 2, 0);
    close(c.box.y + c.box.h / 2, 50);
    close(c.box.w, 100);
    close(c.box.rot, Math.PI / 2);
  });

  test('display conversions', () => {
    const b = { w: 400, h: 200 };
    assert.deepEqual(cropToDisplay({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, b), { x: 100, y: 100, w: 200, h: 100 });
    assert.deepEqual(cropToDisplay(null, b), { x: 0, y: 0, w: 400, h: 200 });
    assert.deepEqual(displayToCrop({ x: 100, y: 100, w: 200, h: 100 }, b), { x: 0.25, y: 0.5, w: 0.5, h: 0.5 });
    assert.equal(displayToCrop({ x: 0, y: 0, w: 400, h: 200 }, b), null);
    assert.deepEqual(fitContain(400, 200, 200, 200), { x: 0, y: 50, w: 200, h: 100 });
  });

  test('dragCropRect: free resize, move and clamping', () => {
    const B = { w: 400, h: 300 };
    const r = { x: 50, y: 50, w: 200, h: 100 };
    assert.deepEqual(dragCropRect(r, 'br', 30, 20, B, null, 20), { x: 50, y: 50, w: 230, h: 120 });
    assert.deepEqual(dragCropRect(r, 'tl', -100, -100, B, null, 20), { x: 0, y: 0, w: 250, h: 150 });
    assert.deepEqual(dragCropRect(r, 'l', 500, 0, B, null, 20), { x: 230, y: 50, w: 20, h: 100 });
    assert.deepEqual(dragCropRect(r, 'move', 1000, -1000, B, null, 20), { x: 200, y: 0, w: 200, h: 100 });
    assert.deepEqual(dragCropRect(r, 't', 0, 10, B, null, 20), { x: 50, y: 60, w: 200, h: 90 });
  });

  test('dragCropRect keeps the aspect ratio', () => {
    const B = { w: 400, h: 300 };
    const r = { x: 50, y: 50, w: 100, h: 100 };
    const c = dragCropRect(r, 'br', 50, 10, B, 1, 20);
    close(c.w, c.h);
    close(c.w, 150);
    close(c.x, 50);
    // Clamped by the bounds: the bottom edge can only reach 300.
    const big = dragCropRect(r, 'br', 1000, 1000, B, 1, 20);
    close(big.w, 250);
    close(big.h, 250);
    // Edge with a ratio: height follows, centered.
    const e = dragCropRect({ x: 50, y: 100, w: 160, h: 90 }, 'r', 32, 0, B, 16 / 9, 20);
    close(e.w, 192);
    close(e.h, 108);
    close(e.y + e.h / 2, 145);
    const top = dragCropRect({ x: 100, y: 100, w: 120, h: 90 }, 't', 0, -30, B, 4 / 3, 20);
    close(top.h, 120);
    close(top.w, 160);
    close(top.y + top.h, 190);
  });

  test('fitAspect gives the largest rect of the ratio inside the current one', () => {
    const B = { w: 400, h: 300 };
    const sq = fitAspect({ x: 0, y: 0, w: 400, h: 300 }, 1, B);
    assert.deepEqual(sq, { x: 50, y: 0, w: 300, h: 300 });
    const wide = fitAspect({ x: 0, y: 0, w: 400, h: 300 }, 16 / 9, B);
    close(wide.w, 400);
    close(wide.h, 225);
    close(wide.y, 37.5);
    assert.deepEqual(fitAspect({ x: 1, y: 2, w: 3, h: 4 }, null, B), { x: 1, y: 2, w: 3, h: 4 });
    assert.deepEqual(
      CROP_ASPECTS.map((a) => a.key),
      ['free', '1:1', '4:3', '3:4', '16:9'],
    );
  });

  test('insertImageBox: at most 60% of the page width, centered and on the page', () => {
    const page = { w: 595.28, h: 841.89 };
    const b = insertImageBox(4000, 3000, page, { x: 300, y: 400 });
    close(b.w, 595.28 * 0.6);
    close(b.h, (595.28 * 0.6 * 3) / 4);
    close(b.x + b.w / 2, 300);
    close(b.y + b.h / 2, 400);
    // Small images keep their size.
    const s = insertImageBox(100, 50, page, { x: 300, y: 400 });
    close(s.w, 100);
    // Very tall images are capped at 80% of the page height.
    const tall = insertImageBox(100, 10000, page, { x: 0, y: 0 });
    close(tall.h, 841.89 * 0.8);
    close(tall.x, 0);
    close(tall.y, 0);
  });
});
