import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CARD_MARGIN,
  clipRect,
  holePath,
  holeRadius,
  intersects,
  padRect,
  placeCard,
  unionAll,
  unionRect,
} from '../../../src/notebook/core/tours/placement.ts';

const WIN = { width: 834, height: 1194 };
const CARD = { width: 352, height: 180 };

describe('unionRect / unionAll', () => {
  test('union of two rects (Figma 28: search field + header buttons)', () => {
    const search = { x: 20, y: 100, width: 600, height: 50 };
    const buttons = { x: 700, y: 30, width: 100, height: 44 };
    assert.deepEqual(unionRect(search, buttons), { x: 20, y: 30, width: 780, height: 120 });
  });

  test('unionAll skips nulls and returns null when empty', () => {
    assert.equal(unionAll([]), null);
    assert.equal(unionAll([null, undefined]), null);
    const a = { x: 10, y: 10, width: 10, height: 10 };
    assert.deepEqual(unionAll([null, a]), a);
    assert.notEqual(unionAll([a]), a, 'returns a copy');
    assert.deepEqual(unionAll([a, null, { x: 0, y: 30, width: 5, height: 5 }]), { x: 0, y: 10, width: 20, height: 25 });
  });
});

describe('padRect', () => {
  test('grows every side by pad', () => {
    assert.deepEqual(padRect({ x: 100, y: 50, width: 40, height: 40 }, 10), { x: 90, y: 40, width: 60, height: 60 });
  });
  test('a negative pad never goes below zero size', () => {
    const r = padRect({ x: 0, y: 0, width: 10, height: 4 }, -5);
    assert.equal(r.width, 0);
    assert.equal(r.height, 0);
    assert.equal(r.x, 5);
    assert.equal(r.y, 2);
  });
});

describe('clipRect / intersects', () => {
  const view = { x: 0, y: 0, width: 400, height: 800 };
  test('a rect below the fold is not on screen', () => {
    assert.equal(intersects({ x: 0, y: 900, width: 100, height: 100 }, view), false);
    assert.equal(clipRect({ x: 0, y: 900, width: 100, height: 100 }, view), null);
  });
  test('a partly visible rect is clipped', () => {
    assert.deepEqual(clipRect({ x: -20, y: 750, width: 100, height: 100 }, view), { x: 0, y: 750, width: 80, height: 50 });
  });
});

describe('placeCard', () => {
  test('below the hole, centred on it (Figma 25)', () => {
    const hole = { x: 300, y: 200, width: 234, height: 100 };
    const p = placeCard(hole, CARD, WIN, { prefer: 'below' });
    assert.equal(p.side, 'below');
    assert.equal(p.y, 316);
    assert.equal(p.x, 300 + 117 - 176);
    assert.equal(p.pointer, 417);
  });

  test('clamped 20 pt from the left and right edges, pointer kept off the corners', () => {
    const left = placeCard({ x: 0, y: 100, width: 40, height: 40 }, CARD, WIN);
    assert.equal(left.x, CARD_MARGIN);
    assert.equal(left.pointer, CARD_MARGIN + 30);
    const right = placeCard({ x: WIN.width - 40, y: 100, width: 40, height: 40 }, CARD, WIN);
    assert.equal(right.x, WIN.width - CARD_MARGIN - CARD.width);
    assert.equal(right.pointer, right.x + CARD.width - 30);
  });

  test('the safe-area insets add to the margin', () => {
    const p = placeCard({ x: 0, y: 100, width: 40, height: 40 }, CARD, WIN, { insets: { top: 24, bottom: 20, left: 44, right: 0 } });
    assert.equal(p.x, 44 + CARD_MARGIN);
  });

  test("prefer 'above' (Figma 27: the new-notebook button at the bottom)", () => {
    const fab = { x: 600, y: 1100, width: 200, height: 56 };
    const p = placeCard(fab, CARD, WIN, { prefer: 'above' });
    assert.equal(p.side, 'above');
    assert.equal(p.y, 1100 - 16 - CARD.height);
  });

  test('flips to the other side when the preferred one has no room', () => {
    const bottomBar = { x: 100, y: 1100, width: 600, height: 60 };
    assert.equal(placeCard(bottomBar, CARD, WIN, { prefer: 'below' }).side, 'above');
    const topBar = { x: 100, y: 20, width: 600, height: 60 };
    assert.equal(placeCard(topBar, CARD, WIN, { prefer: 'above' }).side, 'below');
  });

  test('a tall vertical toolbar puts the card beside it, on the side with more room', () => {
    const leftBar = { x: 14, y: 40, width: 56, height: 1110 };
    const p = placeCard(leftBar, CARD, WIN, { prefer: 'below' });
    assert.equal(p.side, 'right');
    assert.equal(p.x, 14 + 56 + 16);
    assert.ok(p.pointer >= p.y + 30 && p.pointer <= p.y + CARD.height - 30);
    const rightBar = { x: WIN.width - 70, y: 40, width: 56, height: 1110 };
    const q = placeCard(rightBar, CARD, WIN, { prefer: 'below' });
    assert.equal(q.side, 'left');
    assert.equal(q.x, WIN.width - 70 - 16 - CARD.width);
  });

  test('nothing fits: the preferred side, clamped inside the window', () => {
    const huge = { x: 0, y: 0, width: WIN.width, height: WIN.height };
    const p = placeCard(huge, CARD, WIN, { prefer: 'below' });
    assert.equal(p.side, 'below');
    assert.ok(p.y >= CARD_MARGIN && p.y + CARD.height <= WIN.height - CARD_MARGIN);
    assert.ok(p.x >= CARD_MARGIN && p.x + CARD.width <= WIN.width - CARD_MARGIN);
  });

  test('a card wider than the room sticks to the start margin', () => {
    const p = placeCard({ x: 10, y: 10, width: 10, height: 10 }, { width: 400, height: 100 }, { width: 320, height: 600 });
    assert.equal(p.x, CARD_MARGIN);
  });
});

describe('holePath / holeRadius', () => {
  test('radius 999 becomes a pill (half the height)', () => {
    assert.equal(holeRadius({ x: 0, y: 0, width: 200, height: 56 }, 999), 28);
    assert.equal(holeRadius({ x: 0, y: 0, width: 200, height: 56 }, 18), 18);
  });
  test('the path holds the outer rect and the hole', () => {
    const d = holePath({ width: 100, height: 200 }, { x: 10, y: 20, width: 30, height: 40 }, 0);
    assert.equal(d, 'M0 0H100V200H0ZM10 20H40V60H10Z');
    const rounded = holePath({ width: 100, height: 200 }, { x: 10, y: 20, width: 30, height: 40 }, 8);
    assert.ok(rounded.startsWith('M0 0H100V200H0ZM18 20H32A8 8 0 0 1 40 28'));
    assert.equal((rounded.match(/A/g) ?? []).length, 4);
  });
  test('an empty hole draws only the dim', () => {
    assert.equal(holePath({ width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 }, 5), 'M0 0H10V10H0Z');
  });
});
