import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMPACT_COLUMNS,
  DROP_BAR_W,
  REGULAR_COLUMNS,
  THUMB_ASPECT,
  WIDE_COLUMNS,
  autoScrollStep,
  cellAt,
  cellOrigin,
  clampScroll,
  contentHeight,
  dropBar,
  gridColumns,
  gridMetrics,
  moveIndex,
  reorderIds,
  rowsFor,
  slotAt,
  visibleRange,
  type GridMetrics,
} from '../../../src/notebook/core/pages/reorder.ts';

/** Figma 13: a 730 pt grid of 4 columns, 160 pt cells 30 pt apart. */
const FIGMA: GridMetrics = gridMetrics({ width: 730, columns: 4, compact: false });

/** Center of a cell's thumbnail. */
function centerOf(m: GridMetrics, i: number, rtl: boolean) {
  const o = cellOrigin(m, i, rtl);
  return { x: o.x + m.cellW / 2, y: o.y + m.thumbH / 2 };
}

describe('gridColumns', () => {
  test('compact 3, regular 4, 6 from 1100', () => {
    assert.equal(gridColumns(320), COMPACT_COLUMNS);
    assert.equal(gridColumns(375), 3);
    assert.equal(gridColumns(599), 3);
    assert.equal(gridColumns(600), REGULAR_COLUMNS);
    assert.equal(gridColumns(834), 4);
    assert.equal(gridColumns(1099), 4);
    assert.equal(gridColumns(1100), WIDE_COLUMNS);
    assert.equal(gridColumns(1366), 6);
  });
  test('bad widths are compact', () => {
    assert.equal(gridColumns(Number.NaN), 3);
    assert.equal(gridColumns(-1), 3);
  });
});

describe('gridMetrics', () => {
  test('matches the Figma regular grid', () => {
    assert.equal(FIGMA.cellW, 160);
    assert.equal(FIGMA.gapX, 30);
    assert.equal(FIGMA.thumbH, 226);
    assert.equal(FIGMA.rowH, FIGMA.thumbH + FIGMA.labelH + FIGMA.gapY);
  });
  test('compact cells fill the width', () => {
    const m = gridMetrics({ width: 343, columns: 3, compact: true });
    assert.ok(Math.abs(m.cellW * 3 + m.gapX * 2 - 343) < 1e-9);
    assert.equal(m.thumbH, Math.round(m.cellW * THUMB_ASPECT));
  });
  test('a cell is never narrower than 24 pt', () => {
    assert.equal(gridMetrics({ width: 10, columns: 6, compact: true }).cellW, 24);
    assert.equal(gridMetrics({ width: 400, columns: 0, compact: true }).columns, 1);
  });
});

describe('rows and height', () => {
  test('rowsFor', () => {
    assert.equal(rowsFor(0, 4), 0);
    assert.equal(rowsFor(1, 4), 1);
    assert.equal(rowsFor(4, 4), 1);
    assert.equal(rowsFor(5, 4), 2);
    assert.equal(rowsFor(9, 4), 3);
  });
  test('contentHeight: pages plus the add tile', () => {
    // 8 pages + the add tile = 9 slots = 3 rows (Figma 13).
    const h = contentHeight(FIGMA, 9);
    assert.equal(h, FIGMA.padTop + 3 * FIGMA.rowH - FIGMA.gapY + FIGMA.padBottom);
    assert.equal(contentHeight(FIGMA, 0), FIGMA.padTop + FIGMA.padBottom);
  });
});

describe('cellOrigin', () => {
  test('LTR: first cell at the left', () => {
    assert.deepEqual(cellOrigin(FIGMA, 0, false), { x: 0, y: FIGMA.padTop });
    assert.deepEqual(cellOrigin(FIGMA, 3, false), { x: 570, y: FIGMA.padTop });
    assert.deepEqual(cellOrigin(FIGMA, 4, false), { x: 0, y: FIGMA.padTop + FIGMA.rowH });
  });
  test('RTL: first cell at the physical right', () => {
    assert.deepEqual(cellOrigin(FIGMA, 0, true), { x: 570, y: FIGMA.padTop });
    assert.deepEqual(cellOrigin(FIGMA, 3, true), { x: 0, y: FIGMA.padTop });
    // The add tile after 8 pages: row 3, at the reading start (physical right), as in Figma 13.
    assert.deepEqual(cellOrigin(FIGMA, 8, true), { x: 570, y: FIGMA.padTop + 2 * FIGMA.rowH });
  });
});

describe('cellAt', () => {
  for (const rtl of [false, true]) {
    test(`hits every page center (${rtl ? 'rtl' : 'ltr'})`, () => {
      for (let i = 0; i < 8; i++) {
        const c = centerOf(FIGMA, i, rtl);
        assert.equal(cellAt(FIGMA, c.x, c.y, 8, rtl), i);
      }
    });
  }
  test('gaps, the add tile and outside give -1', () => {
    // The gap between columns.
    assert.equal(cellAt(FIGMA, 175, FIGMA.padTop + 50, 8, false), -1);
    // The gap between rows.
    assert.equal(cellAt(FIGMA, 50, FIGMA.padTop + FIGMA.thumbH + FIGMA.labelH + 2, 8, false), -1);
    // The add tile (slot 8) is not a page.
    const t = centerOf(FIGMA, 8, false);
    assert.equal(cellAt(FIGMA, t.x, t.y, 8, false), -1);
    assert.equal(cellAt(FIGMA, -5, 40, 8, false), -1);
    assert.equal(cellAt(FIGMA, 50, -5, 8, false), -1);
    assert.equal(cellAt(FIGMA, Number.NaN, 40, 8, false), -1);
  });
  test('the label under a thumbnail belongs to the page', () => {
    const o = cellOrigin(FIGMA, 1, false);
    assert.equal(cellAt(FIGMA, o.x + 10, o.y + FIGMA.thumbH + 10, 8, false), 1);
  });
});

describe('slotAt', () => {
  test('no pages: slot 0', () => {
    assert.equal(slotAt(FIGMA, 100, 100, 0, false), 0);
  });
  for (const rtl of [false, true]) {
    test(`before or after a cell by its center (${rtl ? 'rtl' : 'ltr'})`, () => {
      for (let i = 0; i < 8; i++) {
        const o = cellOrigin(FIGMA, i, rtl);
        const y = o.y + 20;
        // Reading-start half of a cell -> before it; reading-end half -> after it.
        const startX = rtl ? o.x + FIGMA.cellW - 10 : o.x + 10;
        const endX = rtl ? o.x + 10 : o.x + FIGMA.cellW - 10;
        assert.equal(slotAt(FIGMA, startX, y, 8, rtl), i, `start half of ${i}`);
        assert.equal(slotAt(FIGMA, endX, y, 8, rtl), i + 1, `end half of ${i}`);
      }
    });
  }
  test('below the grid and over the add tile: the end', () => {
    assert.equal(slotAt(FIGMA, 50, 5000, 8, false), 8);
    const t = centerOf(FIGMA, 8, false);
    assert.equal(slotAt(FIGMA, t.x, t.y, 8, false), 8);
  });
  test('above the grid: the first row', () => {
    assert.equal(slotAt(FIGMA, 10, -100, 8, false), 0);
  });
  test('past the last cell of a partial row: the end', () => {
    // 6 pages: row 1 has pages 4 and 5; a point at column 3 of row 1 -> slot 6.
    const o = cellOrigin(FIGMA, 7, false);
    assert.equal(slotAt(FIGMA, o.x + 100, o.y + 20, 6, false), 6);
  });
  test('the row splits in the middle of the row gap', () => {
    const y0 = FIGMA.padTop + FIGMA.rowH - FIGMA.gapY / 2 - 1;
    const y1 = FIGMA.padTop + FIGMA.rowH - FIGMA.gapY / 2 + 1;
    assert.equal(slotAt(FIGMA, 5, y0, 8, false), 0);
    assert.equal(slotAt(FIGMA, 5, y1, 8, false), 4);
  });
});

describe('moveIndex', () => {
  test('slots before and after itself do not move', () => {
    assert.equal(moveIndex(3, 3, 8), -1);
    assert.equal(moveIndex(3, 4, 8), -1);
  });
  test('forward drops subtract the removed page', () => {
    assert.equal(moveIndex(0, 8, 8), 7);
    assert.equal(moveIndex(2, 6, 8), 5);
  });
  test('backward drops keep the slot', () => {
    assert.equal(moveIndex(7, 0, 8), 0);
    assert.equal(moveIndex(5, 2, 8), 2);
  });
  test('bad input', () => {
    assert.equal(moveIndex(-1, 2, 8), -1);
    assert.equal(moveIndex(8, 2, 8), -1);
    assert.equal(moveIndex(1, Number.NaN, 8), -1);
    assert.equal(moveIndex(0, 99, 3), 2);
  });
  test('slot -> moveIndex -> reorderIds agrees with an insert before the slot', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (let from = 0; from < ids.length; from++) {
      for (let slot = 0; slot <= ids.length; slot++) {
        const to = moveIndex(from, slot, ids.length);
        const got = to < 0 ? ids.slice() : reorderIds(ids, from, to);
        // Expected: put ids[from] before ids[slot] (or at the end).
        const rest = ids.filter((_, i) => i !== from);
        const anchor = slot < ids.length ? ids[slot] : null;
        const at = anchor === null || anchor === ids[from] ? (anchor === null ? rest.length : from) : rest.indexOf(anchor);
        const want = rest.slice();
        want.splice(at, 0, ids[from]);
        assert.deepEqual(got, want, `from ${from} slot ${slot}`);
      }
    }
  });
});

describe('reorderIds', () => {
  test('moves like session.movePage', () => {
    assert.deepEqual(reorderIds(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(reorderIds(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(reorderIds(['a', 'b', 'c'], 1, 99), ['a', 'c', 'b']);
  });
  test('bad input copies', () => {
    const ids = ['a', 'b'];
    const out = reorderIds(ids, 5, 0);
    assert.deepEqual(out, ids);
    assert.notEqual(out, ids);
  });
});

describe('dropBar', () => {
  test('LTR: in the gap before the slot', () => {
    const b = dropBar(FIGMA, 1, 8, false);
    assert.equal(b.x, 160 + 15 - DROP_BAR_W / 2);
    assert.equal(b.y, FIGMA.padTop);
    assert.equal(b.h, FIGMA.thumbH);
  });
  test('the first slot sits at the row start, inside the grid', () => {
    assert.equal(dropBar(FIGMA, 0, 8, false).x, 0);
    assert.equal(dropBar(FIGMA, 0, 8, true).x, FIGMA.width - DROP_BAR_W);
  });
  test('a slot that starts a row shows at the previous row end', () => {
    const b = dropBar(FIGMA, 4, 8, false);
    assert.equal(b.y, FIGMA.padTop);
    assert.equal(b.x, FIGMA.width - DROP_BAR_W);
    const e = dropBar(FIGMA, 8, 8, false);
    assert.equal(e.y, FIGMA.padTop + FIGMA.rowH);
  });
  test('RTL mirrors LTR', () => {
    for (let s = 0; s <= 8; s++) {
      const l = dropBar(FIGMA, s, 8, false);
      const r = dropBar(FIGMA, s, 8, true);
      assert.ok(Math.abs(r.x - (FIGMA.width - l.x - DROP_BAR_W)) < 1e-9, `slot ${s}`);
      assert.equal(r.y, l.y);
    }
  });
  test('Figma 13: dropping before page 8 in RTL puts the bar between pages 7 and 8', () => {
    // Pages 7 and 8 are columns 2 and 3 of row 1 (physical x 190 and 0 in RTL).
    const b = dropBar(FIGMA, 7, 8, true);
    const p7 = cellOrigin(FIGMA, 6, true);
    const p8 = cellOrigin(FIGMA, 7, true);
    assert.ok(b.x > p8.x + FIGMA.cellW && b.x + DROP_BAR_W < p7.x);
  });
});

describe('visibleRange', () => {
  test('mounts the rows around the viewport', () => {
    const r = visibleRange(FIGMA, 0, 600, 41, 0);
    assert.equal(r.first, 0);
    // 600 pt shows rows 0..2 (rowH 288).
    assert.equal(r.last, 11);
    const s = visibleRange(FIGMA, FIGMA.rowH * 5, 600, 41, 1);
    assert.equal(s.first, 2 * 4);
    assert.ok(s.last >= 7 * 4 && s.last <= 40);
  });
  test('clamped to the slots', () => {
    assert.deepEqual(visibleRange(FIGMA, 0, 2000, 3, 1), { first: 0, last: 2 });
    assert.deepEqual(visibleRange(FIGMA, 0, 600, 0, 1), { first: 0, last: -1 });
    assert.deepEqual(visibleRange(FIGMA, 99999, 600, 9, 0), { first: 0, last: -1 });
  });
});

describe('autoScrollStep and clampScroll', () => {
  test('edges scroll, the middle does not', () => {
    assert.equal(autoScrollStep(400, 800), 0);
    assert.ok(autoScrollStep(10, 800) < 0);
    assert.ok(autoScrollStep(790, 800) > 0);
    assert.equal(autoScrollStep(0, 800, 80, 18), -18);
    assert.equal(autoScrollStep(800, 800, 80, 18), 18);
    assert.equal(autoScrollStep(Number.NaN, 800), 0);
    assert.equal(autoScrollStep(10, 0), 0);
  });
  test('faster closer to the edge', () => {
    assert.ok(Math.abs(autoScrollStep(5, 800)) > Math.abs(autoScrollStep(60, 800)));
  });
  test('clampScroll', () => {
    assert.equal(clampScroll(-5, 2000, 800), 0);
    assert.equal(clampScroll(500, 2000, 800), 500);
    assert.equal(clampScroll(5000, 2000, 800), 1200);
    assert.equal(clampScroll(100, 500, 800), 0);
  });
});
