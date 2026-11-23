import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  HIGHLIGHTER_GROUP_OPACITY,
  IMAGE_PLACEHOLDER,
  PDF_PLACEHOLDER_FILL,
  applyMat,
  blankTarget,
  buildPageOps,
  displayedSize,
  multiply,
  normalizeRotate,
  pageToPdfMatrix,
  parseHex,
  rotateAbout,
  type Mat,
  type PdfOp,
  type PdfTarget,
} from '../../../src/notebook/core/export/pdfOps.ts';
import { blankPage } from '../../../src/notebook/core/model/paper.ts';
import type { ImageItem, Page, PageItem, ShapeItem, StrokeItem, TextItem } from '../../../src/notebook/core/model/types.ts';
import { patternFor } from '../../../src/notebook/core/paper/pattern.ts';

const A4 = { w: 595.28, h: 841.89 };

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
function assertPt(actual: [number, number], expected: [number, number], msg?: string): void {
  assert.ok(near(actual[0], expected[0]) && near(actual[1], expected[1]), `${msg ?? ''} got ${actual.join(',')} want ${expected.join(',')}`);
}

function paperPage(items: PageItem[] = [], style: 'blank' | 'lined' = 'blank'): Page {
  const p = blankPage('p1', { style, color: 'white', size: 'a4' });
  return { ...p, items };
}

const stroke = (id: string, tool: 'pen' | 'highlighter', color = '#1D4ED8'): StrokeItem => ({
  id,
  kind: 'stroke',
  tool,
  color,
  width: tool === 'pen' ? 3 : 14,
  pressure: false,
  pts: [100, 100, 0.5, 140, 110, 0.5, 180, 100, 0.5, 220, 120, 0.5],
});

const text = (id: string): TextItem => ({ id, kind: 'text', box: { x: 50, y: 60, w: 200, h: 40, rot: 0 }, text: 'مرحبا', size: 18, color: '#1B2533', bold: false });

const image = (id: string, crop: ImageItem['crop'] = null): ImageItem => ({ id, kind: 'image', fileId: 'img1', box: { x: 10, y: 20, w: 100, h: 50, rot: 0 }, crop });

const kinds = (ops: PdfOp[]) => ops.map((o) => o.op);
const imagesOf = (ops: PdfOp[]) => ops.filter((o): o is Extract<PdfOp, { op: 'image' }> => o.op === 'image');
const firstMove = (ops: PdfOp[]) => ops.find((o): o is Extract<PdfOp, { op: 'moveTo' }> => o.op === 'moveTo');

describe('pageToPdfMatrix: Y flip and crop box origin', () => {
  test('a blank page flips y about its height', () => {
    const m = pageToPdfMatrix(A4, blankTarget(A4));
    assertPt(applyMat(m, 0, 0), [0, A4.h], 'top-left');
    assertPt(applyMat(m, 10, 20), [10, A4.h - 20]);
    assertPt(applyMat(m, A4.w, A4.h), [A4.w, 0], 'bottom-right');
  });

  test('a crop box with a non-zero origin shifts everything into it', () => {
    const t: PdfTarget = { box: { x: 50, y: 30, w: 500, h: 700 }, rotate: 0 };
    const m = pageToPdfMatrix({ w: 500, h: 700 }, t);
    assertPt(applyMat(m, 0, 0), [50, 730], 'page top-left is the crop top-left');
    assertPt(applyMat(m, 500, 700), [550, 30], 'page bottom-right is the crop bottom-right');
    assertPt(applyMat(m, 100, 200), [150, 530]);
  });

  test('rotated pages: the displayed top-left lands where the viewer shows it', () => {
    const box = { x: 10, y: 20, w: 600, h: 400 };
    // 90 clockwise: the crop's lower-left corner is shown at the top-left
    const t90: PdfTarget = { box, rotate: 90 };
    assert.deepEqual(displayedSize(t90), { w: 400, h: 600 });
    const m90 = pageToPdfMatrix({ w: 400, h: 600 }, t90);
    assertPt(applyMat(m90, 0, 0), [10, 20]);
    assertPt(applyMat(m90, 400, 0), [10, 420], 'top-right shows the crop top-left');
    assertPt(applyMat(m90, 0, 600), [610, 20]);
    // 180: the crop's lower-right corner is shown at the top-left
    const m180 = pageToPdfMatrix({ w: 600, h: 400 }, { box, rotate: 180 });
    assertPt(applyMat(m180, 0, 0), [610, 20]);
    assertPt(applyMat(m180, 600, 400), [10, 420]);
    // 270: the crop's upper-right corner is shown at the top-left
    const m270 = pageToPdfMatrix({ w: 400, h: 600 }, { box, rotate: 270 });
    assertPt(applyMat(m270, 0, 0), [610, 420]);
    assertPt(applyMat(m270, 0, 600), [10, 420], 'bottom-left shows the crop top-left');
  });

  test('every rotation maps the page onto the crop box, corners to corners', () => {
    const box = { x: -5, y: 7, w: 300, h: 500 };
    for (const rotate of [0, 90, 180, 270] as const) {
      const t: PdfTarget = { box, rotate };
      const d = displayedSize(t);
      const m = pageToPdfMatrix(d, t);
      const corners = [
        applyMat(m, 0, 0),
        applyMat(m, d.w, 0),
        applyMat(m, d.w, d.h),
        applyMat(m, 0, d.h),
      ].map(([x, y]) => `${Math.round(x)},${Math.round(y)}`);
      assert.deepEqual(new Set(corners), new Set(['-5,7', '295,7', '295,507', '-5,507']), `rotate ${rotate}`);
    }
  });

  test('a page size that differs from the crop box is stretched over it', () => {
    const m = pageToPdfMatrix({ w: 100, h: 100 }, blankTarget({ w: 200, h: 300 }));
    assertPt(applyMat(m, 100, 100), [200, 0]);
    assertPt(applyMat(m, 50, 50), [100, 150]);
  });

  test('normalizeRotate', () => {
    assert.equal(normalizeRotate(-90), 270);
    assert.equal(normalizeRotate(450), 90);
    assert.equal(normalizeRotate(180), 180);
    assert.equal(normalizeRotate(Number.NaN), 0);
  });
});

describe('buildPageOps: draw order split', () => {
  test('images under, highlighter items in the group, everything else over, in array order', () => {
    const hlShape: ShapeItem = { id: 'hs', kind: 'shape', shape: 'rect', color: '#FDE047', width: 10, fill: null, highlighter: true, box: { x: 300, y: 300, w: 80, h: 40, rot: 0 } };
    const penShape: ShapeItem = { id: 'ps', kind: 'shape', shape: 'line', color: '#DC2626', width: 3, fill: null, pts: [10, 10, 90, 90] };
    const page = paperPage([stroke('pen1', 'pen'), stroke('hl1', 'highlighter', '#FDE047'), image('im'), text('t'), hlShape, penShape]);
    const ops = buildPageOps(page, blankTarget(page.size), { textSize: (t) => ({ w: t.box.w, h: 48 }) });

    // under: blank paper fill, then the image
    const underImages = imagesOf(ops.under);
    assert.equal(underImages.length, 1);
    assert.match(underImages[0].key, /^asset:img1:/);

    // group: two fills (highlighter stroke outline, highlighter rect stroke), opaque
    assert.ok(ops.highlighterGroup.length > 0);
    assert.ok(!ops.highlighterGroup.some((o) => o.op === 'alpha'), 'the group is drawn opaque');
    assert.equal(kinds(ops.highlighterGroup).filter((k) => k === 'fill').length, 1);
    assert.equal(kinds(ops.highlighterGroup).filter((k) => k === 'stroke').length, 1);

    // over: pen stroke (fill), text (image), line (stroke) in that order
    const seq = ops.over.filter((o) => o.op === 'fill' || o.op === 'stroke' || o.op === 'image').map((o) => o.op);
    assert.deepEqual(seq, ['fill', 'image', 'stroke']);
    assert.deepEqual(
      ops.images.map((r) => r.kind),
      ['asset', 'text'],
    );
    assert.equal(HIGHLIGHTER_GROUP_OPACITY, 0.35);
  });

  test('a page without highlights has an empty group', () => {
    const ops = buildPageOps(paperPage([stroke('a', 'pen')]), blankTarget(A4));
    assert.deepEqual(ops.highlighterGroup, []);
  });

  test('save/restore stay balanced in every layer', () => {
    const page = paperPage([stroke('a', 'pen', '#1D4ED880'), stroke('b', 'highlighter'), image('i', { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }), text('t')], 'lined');
    const ops = buildPageOps(page, blankTarget(page.size));
    for (const layer of [ops.under, ops.highlighterGroup, ops.over]) {
      let depth = 0;
      for (const o of layer) {
        if (o.op === 'save') depth++;
        if (o.op === 'restore') depth--;
        assert.ok(depth >= 0);
      }
      assert.equal(depth, 0);
    }
  });
});

describe('buildPageOps: geometry', () => {
  test('paper from patternFor, y flipped', () => {
    const page = paperPage([], 'lined');
    const ops = buildPageOps(page, blankTarget(page.size));
    const pat = patternFor(page.background.kind === 'paper' ? page.background.paper : { style: 'lined', color: 'white', size: 'a4' }, page.size);
    const fill = ops.under.find((o) => o.op === 'fillColor');
    assert.deepEqual(fill && fill.op === 'fillColor' ? fill.rgb : null, [1, 1, 1]);
    // the rule lines: one moveTo + lineTo per line, plus the margin line
    const moves = ops.under.filter((o) => o.op === 'moveTo');
    assert.equal(moves.length, 1 + pat.lines.length + 1, 'page rect + rules + margin');
    const firstRule = moves[1];
    assert.ok(firstRule.op === 'moveTo' && near(firstRule.y, A4.h - pat.lines[0].y1));
  });

  test('pen strokes are filled outlines made of cubic curves', () => {
    const ops = buildPageOps(paperPage([stroke('a', 'pen')]), blankTarget(A4));
    const k = kinds(ops.over);
    assert.equal(k[0], 'save');
    assert.ok(k.includes('moveTo'));
    assert.ok(k.filter((x) => x === 'curveTo').length > 4);
    assert.ok(k.indexOf('close') < k.indexOf('fill'));
    const m = firstMove(ops.over);
    assert.ok(m && m.y > A4.h - 140 && m.y < A4.h - 80, 'y is flipped');
  });

  test('a color with alpha adds a constant-alpha op', () => {
    const ops = buildPageOps(paperPage([stroke('a', 'pen', '#1D4ED880')]), blankTarget(A4));
    const a = ops.over.find((o) => o.op === 'alpha');
    assert.ok(a && a.op === 'alpha' && near(a.value, 128 / 255, 1e-3));
    assert.deepEqual(parseHex('#FF000080').rgb, [1, 0, 0]);
    assert.deepEqual(parseHex('nonsense'), { rgb: [0, 0, 0], alpha: 1 });
  });

  test('arrowheads are filled triangles after the stroked shaft', () => {
    const arrow: ShapeItem = { id: 'a', kind: 'shape', shape: 'arrow', color: '#DC2626', width: 3, fill: null, pts: [100, 100, 300, 100] };
    const ops = buildPageOps(paperPage([arrow]), blankTarget(A4));
    const k = kinds(ops.over).filter((x) => x === 'stroke' || x === 'fill');
    assert.deepEqual(k, ['stroke', 'fill', 'stroke']);
    // the filled head is a closed 3-point path ending at the tip
    const fillAt = kinds(ops.over).indexOf('fill');
    const headOps = ops.over.slice(0, fillAt).reverse();
    const close = headOps.findIndex((o) => o.op === 'close');
    assert.ok(close >= 0);
    const tip = ops.over.filter((o) => o.op === 'lineTo')[1];
    assert.ok(tip.op === 'lineTo' && near(tip.x, 300) && near(tip.y, A4.h - 100));
  });

  test('ellipses are 4 Béziers, filled first when they have a fill', () => {
    const el: ShapeItem = { id: 'e', kind: 'shape', shape: 'ellipse', color: '#000000', width: 2, fill: '#FDE047', box: { x: 100, y: 100, w: 200, h: 100, rot: Math.PI / 6 } };
    const ops = buildPageOps(paperPage([el]), blankTarget(A4));
    const k = kinds(ops.over);
    assert.equal(k.filter((x) => x === 'curveTo').length, 8, '4 for the fill, 4 for the stroke');
    assert.ok(k.indexOf('fill') < k.indexOf('stroke'));
    const lw = ops.over.find((o) => o.op === 'lineWidth');
    assert.ok(lw && lw.op === 'lineWidth' && near(lw.w, 2));
    const cap = ops.over.find((o) => o.op === 'lineCap');
    assert.ok(cap && cap.op === 'lineCap' && cap.cap === 1, 'round caps');
  });

  test('a one-point shape is a dot', () => {
    const dot: ShapeItem = { id: 'd', kind: 'shape', shape: 'line', color: '#000000', width: 6, fill: null, pts: [50, 50] };
    const ops = buildPageOps(paperPage([dot]), blankTarget(A4));
    assert.deepEqual(
      kinds(ops.over).filter((x) => x === 'fill' || x === 'stroke'),
      ['fill'],
    );
  });

  test('text images cover the box, upright', () => {
    const t = text('t');
    const ops = buildPageOps(paperPage([t]), blankTarget(A4), { textSize: () => ({ w: 200, h: 48 }) });
    const [img] = imagesOf(ops.over);
    assert.equal(img.key, 'text:t');
    assert.equal(img.placeholder, null);
    // the image's top-left (unit 0,1) is the box's top-left, bottom-right (1,0) is box + size
    assertPt(applyMat(img.m, 0, 1), [50, A4.h - 60]);
    assertPt(applyMat(img.m, 1, 0), [250, A4.h - 108]);
  });

  test('rotated text rotates about the box center', () => {
    const t = { ...text('t'), box: { x: 0, y: 0, w: 100, h: 50, rot: Math.PI / 2 } };
    const ops = buildPageOps(paperPage([t]), blankTarget(A4), { textSize: () => ({ w: 100, h: 50 }) });
    const [img] = imagesOf(ops.over);
    // top-left corner (0, 0) turned 90 degrees clockwise about (50, 25) lands at (75, -25)
    const expected = applyMat(pageToPdfMatrix(A4, blankTarget(A4)), ...(applyMat(rotateAbout(Math.PI / 2, 50, 25), 0, 0) as [number, number]));
    assertPt(applyMat(img.m, 0, 1), expected);
  });

  test('cropped images are clipped to the box and offset by the crop', () => {
    const ops = buildPageOps(paperPage([image('i', { x: 0.5, y: 0, w: 0.5, h: 1 })]), blankTarget(A4));
    const k = kinds(ops.under);
    const clipAt = k.indexOf('clip');
    assert.ok(clipAt > 0 && clipAt < k.indexOf('image'));
    const [img] = imagesOf(ops.under);
    // the whole image is 200 x 50 pt wide, shifted left by half, so its right half covers the box
    assertPt(applyMat(img.m, 0.5, 1), [10, A4.h - 20], 'image middle-top is the box top-left');
    assertPt(applyMat(img.m, 1, 0), [110, A4.h - 70]);
    assert.ok(img.placeholder && img.placeholder.fill === IMAGE_PLACEHOLDER && img.placeholder.quad.length === 8);
  });

  test('image resolution follows the shown size and is capped', () => {
    const big: ImageItem = { ...image('b'), box: { x: 0, y: 0, w: 4000, h: 3000, rot: 0 } };
    const ops = buildPageOps(paperPage([image('s'), big]), blankTarget(A4));
    const px = ops.images.map((r) => (r.kind === 'asset' ? r.maxPx : 0));
    assert.deepEqual(px, [512, 3072]);
  });
});

describe('buildPageOps: PDF and image backgrounds', () => {
  const pdfPage = (damaged = false, rotation: 0 | 90 | 180 | 270 = 0): Page => ({
    id: 'p',
    size: rotation === 90 || rotation === 270 ? { w: 792, h: 612 } : { w: 612, h: 792 },
    background: { kind: 'pdf', fileId: 'doc', pageIndex: 3, rotation, ...(damaged ? { damaged: true } : {}) },
    items: [stroke('a', 'pen')],
  });

  test('the original page is the background: nothing drawn under the ink', () => {
    const t: PdfTarget = { box: { x: 0, y: 0, w: 612, h: 792 }, rotate: 0 };
    const ops = buildPageOps(pdfPage(), t);
    assert.deepEqual(ops.under, []);
    assert.deepEqual(ops.images, []);
  });

  test('damaged pages get the placeholder, whatever the mode', () => {
    const ops = buildPageOps(pdfPage(true), blankTarget({ w: 612, h: 792 }), { pdfBackground: 'source' });
    const fill = ops.under.find((o) => o.op === 'fillColor');
    assert.ok(fill && fill.op === 'fillColor');
    assert.deepEqual(fill.rgb, parseHex(PDF_PLACEHOLDER_FILL).rgb);
  });

  test('raster fallback: a white page and the rendered PDF image, rotated', () => {
    const page = pdfPage(false, 90);
    const ops = buildPageOps(page, blankTarget(page.size), { pdfBackground: 'raster' });
    assert.equal(ops.images.length, 1);
    const r = ops.images[0];
    assert.ok(r.kind === 'pdf' && r.fileId === 'doc' && r.pageIndex === 3 && r.widthPx === 1224);
    const [img] = imagesOf(ops.under);
    // the rendered (unrotated, 612 x 792) image's top-left is shown at the page's top-right
    assertPt(applyMat(img.m, 0, 1), [792, 612]);
  });

  test('an image page: paper fill, then the photo over the whole page', () => {
    const page: Page = { id: 'p', size: A4, background: { kind: 'image', fileId: 'scan', paper: { style: 'lined', color: 'cream', size: 'a4' } }, items: [] };
    const ops = buildPageOps(page, blankTarget(A4));
    assert.equal(kinds(ops.under).filter((k) => k === 'moveTo').length, 1, 'no paper lines under a photo');
    const [img] = imagesOf(ops.under);
    assertPt(applyMat(img.m, 0, 1), [0, A4.h]);
    assertPt(applyMat(img.m, 1, 0), [A4.w, 0]);
  });

  test('ink on a cropped, rotated source page lands inside its crop box', () => {
    const t: PdfTarget = { box: { x: 36, y: 36, w: 540, h: 720 }, rotate: 90 };
    const page: Page = { ...pdfPage(), size: displayedSize(t) };
    const ops = buildPageOps(page, t);
    for (const o of ops.over) {
      if (o.op !== 'moveTo' && o.op !== 'lineTo' && o.op !== 'curveTo') continue;
      assert.ok(o.x >= 36 && o.x <= 576 && o.y >= 36 && o.y <= 756, `${o.x},${o.y}`);
    }
  });
});

describe('matrix helpers', () => {
  test('multiply applies the right matrix first', () => {
    const t: Mat = [1, 0, 0, 1, 10, 0];
    const s: Mat = [2, 0, 0, 2, 0, 0];
    assertPt(applyMat(multiply(t, s), 1, 1), [12, 2]);
    assertPt(applyMat(multiply(s, t), 1, 1), [22, 2]);
  });
});
