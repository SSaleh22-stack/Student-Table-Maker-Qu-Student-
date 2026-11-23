import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PAGE_SIZES, PAPER_FILL, DEFAULT_PAPER, sizeOf, sizeKeyOf } from '../../../src/notebook/core/model/paper.ts';
import { DOT_STEP, GRID_STEP, LINED_STEP, LINED_TOP, patternFor } from '../../../src/notebook/core/paper/pattern.ts';
import type { PaperSpec } from '../../../src/notebook/core/model/types.ts';

const spec = (style: PaperSpec['style'], color: PaperSpec['color'] = 'white', size: PaperSpec['size'] = 'a4'): PaperSpec => ({ style, color, size });

describe('paper', () => {
  test('sizes, fills and default', () => {
    assert.deepEqual(PAGE_SIZES.a4, { w: 595.28, h: 841.89 });
    assert.deepEqual(PAGE_SIZES['a4-landscape'], { w: 841.89, h: 595.28 });
    assert.deepEqual(PAGE_SIZES.letter, { w: 612, h: 792 });
    assert.deepEqual(PAGE_SIZES.wide, { w: 960, h: 540 });
    assert.deepEqual(PAPER_FILL, { white: '#FFFFFF', cream: '#FBF6E9', dark: '#1F2937' });
    assert.deepEqual(DEFAULT_PAPER, { style: 'lined', color: 'white', size: 'a4' });
    assert.deepEqual(sizeOf('wide'), { w: 960, h: 540 });
    assert.deepEqual(sizeOf(spec('blank', 'white', 'letter')), { w: 612, h: 792 });
    assert.equal(sizeKeyOf({ w: 595, h: 842 }), 'a4');
    assert.equal(sizeKeyOf({ w: 500, h: 500 }), null);
  });
});

describe('patternFor', () => {
  test('blank paper is fill only', () => {
    const p = patternFor(spec('blank', 'cream'), sizeOf('a4'));
    assert.equal(p.fill, '#FBF6E9');
    assert.deepEqual(p.lines, []);
    assert.deepEqual(p.dots, []);
    assert.equal(p.margin, undefined);
  });

  test('lined: 36 pt rules from y = 120, and the margin line near the right edge', () => {
    const size = sizeOf('a4');
    const p = patternFor(spec('lined'), size);
    assert.equal(p.lines[0].y1, LINED_TOP);
    assert.equal(LINED_STEP, 36);
    for (let i = 1; i < p.lines.length; i++) assert.equal(p.lines[i].y1 - p.lines[i - 1].y1, 36);
    const last = p.lines[p.lines.length - 1];
    assert.ok(last.y1 < size.h - 10 && last.y1 + 36 >= size.h - 10);
    assert.equal(p.lines.length, 20);
    for (const l of p.lines) {
      assert.equal(l.x1, 0);
      assert.equal(l.x2, size.w);
      assert.equal(l.y1, l.y2);
    }
    assert.ok(p.margin);
    assert.ok(Math.abs(p.margin.x - (size.w - 72)) < 1e-9);
    assert.equal(p.margin.color, '#F3B4B4');
    assert.equal(p.lineColor, '#D6E2EE');
    assert.equal(p.lineWidth, 1);
  });

  test('grid: 18 pt both ways, edges excluded', () => {
    const size = sizeOf('wide');
    const p = patternFor(spec('grid'), size);
    const horiz = p.lines.filter((l) => l.y1 === l.y2);
    const vert = p.lines.filter((l) => l.x1 === l.x2);
    assert.equal(GRID_STEP, 18);
    assert.equal(horiz.length, Math.ceil(540 / 18) - 1);
    assert.equal(vert.length, Math.ceil(960 / 18) - 1);
    assert.equal(horiz[0].y1, 18);
    assert.equal(vert[0].x1, 18);
    assert.ok(vert.every((l) => l.y1 === 0 && l.y2 === 540));
  });

  test('dotted: 18 pt, r = 1; dark paper uses the dark line color', () => {
    const size = sizeOf('letter');
    const p = patternFor(spec('dotted', 'dark', 'letter'), size);
    assert.equal(DOT_STEP, 18);
    const cols = Math.ceil(612 / 18) - 1;
    const rows = Math.ceil(792 / 18) - 1;
    assert.equal(p.dots.length, cols * rows);
    assert.deepEqual(p.dots[0], { x: 18, y: 18, r: 1 });
    assert.equal(p.fill, '#1F2937');
    assert.equal(p.lineColor, '#374151');
    assert.deepEqual(p.lines, []);
  });

  test('every style on every size stays inside the page; a broken size gives no marks', () => {
    for (const style of ['blank', 'lined', 'grid', 'dotted'] as const) {
      for (const key of ['a4', 'a4-landscape', 'letter', 'wide'] as const) {
        const size = sizeOf(key);
        const p = patternFor(spec(style, 'white', key), size);
        for (const l of p.lines) assert.ok(l.x1 >= 0 && l.x2 <= size.w && l.y1 >= 0 && l.y2 <= size.h);
        for (const d of p.dots) assert.ok(d.x > 0 && d.x < size.w && d.y > 0 && d.y < size.h);
      }
      const broken = patternFor(spec(style), { w: Number.NaN, h: -4 });
      assert.deepEqual(broken.lines, []);
      assert.deepEqual(broken.dots, []);
    }
  });
});
