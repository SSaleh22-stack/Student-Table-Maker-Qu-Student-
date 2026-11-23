import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  awayFromHand,
  coversHandSide,
  placeNearPoint,
  placePopover,
  preferredSide,
  shiftAwayFromHand,
  type Rect,
} from '../../../src/notebook/core/toolbar/hand.ts';

const SCREEN = { width: 834, height: 1194 };
const CARD = { width: 356, height: 520 };
const GAP = 14;
const MARGIN = 12;

// A pen button in the middle of a top bar.
const topButton: Rect = { x: 400, y: 91, width: 40, height: 40 };
const bottomButton: Rect = { x: 400, y: 1079, width: 40, height: 40 };
// Pen buttons in vertical bars (Figma 19 / 21).
const leftBarButton: Rect = { x: 21, y: 400, width: 40, height: 40 };
const rightBarButton: Rect = { x: 773, y: 400, width: 40, height: 40 };

const cx = (r: Rect) => r.x + r.width / 2;
const cy = (r: Rect) => r.y + r.height / 2;

describe('awayFromHand', () => {
  test('a right-hander gets the left side, a left-hander the right', () => {
    assert.equal(awayFromHand('right'), 'left');
    assert.equal(awayFromHand('left'), 'right');
  });

  test('preferred sides by bar position', () => {
    assert.equal(preferredSide('top'), 'below');
    assert.equal(preferredSide('bottom'), 'above');
    assert.equal(preferredSide('left'), 'right');
    assert.equal(preferredSide('right'), 'left');
  });
});

describe('placePopover: horizontal bars shift away from the hand', () => {
  test('right hand, top bar: below the button, extending to the left', () => {
    const p = placePopover(topButton, CARD, SCREEN, 'right', 'top');
    assert.equal(p.side, 'below');
    assert.equal(p.y, topButton.y + topButton.height + GAP);
    // The card's right (hand-side) edge sits just past the button center.
    assert.ok(p.x + CARD.width <= cx(topButton) + 26 + 0.001);
    assert.ok(p.x + CARD.width > cx(topButton));
    assert.equal(p.caret, cx(topButton) - p.x);
    assert.equal(coversHandSide({ x: p.x, y: p.y, ...CARD }, SCREEN, 'right'), p.x + CARD.width > SCREEN.width / 2);
  });

  test('left hand, top bar: below the button, extending to the right', () => {
    const p = placePopover(topButton, CARD, SCREEN, 'left', 'top');
    assert.equal(p.side, 'below');
    assert.equal(p.x, cx(topButton) - 26);
    assert.ok(p.x + CARD.width > cx(topButton) + 100);
    assert.equal(p.caret, 26);
  });

  test('a left-hander never gets the card further left than a right-hander', () => {
    for (const x of [30, 200, 400, 600, 760]) {
      const a = { ...topButton, x };
      const r = placePopover(a, CARD, SCREEN, 'right', 'top');
      const l = placePopover(a, CARD, SCREEN, 'left', 'top');
      assert.ok(l.x >= r.x, `x=${x}`);
      // Both stay on screen.
      for (const p of [r, l]) assert.ok(p.x >= MARGIN && p.x + CARD.width <= SCREEN.width - MARGIN);
    }
  });

  test('bottom bar opens above', () => {
    const p = placePopover(bottomButton, CARD, SCREEN, 'right', 'bottom');
    assert.equal(p.side, 'above');
    assert.equal(p.y, bottomButton.y - GAP - CARD.height);
  });

  test('clamped near the edge: the caret still points at the button', () => {
    const a = { ...topButton, x: 0 };
    const p = placePopover(a, CARD, SCREEN, 'right', 'top');
    assert.equal(p.x, MARGIN);
    assert.equal(p.caret, 26); // the caret can't go into the rounded corner
    const b = { ...topButton, x: 780 };
    const q = placePopover(b, CARD, SCREEN, 'left', 'top');
    assert.equal(q.x, SCREEN.width - MARGIN - CARD.width);
    assert.equal(q.caret, CARD.width - 26);
  });

  test('no room below (short landscape phone): opens above instead', () => {
    const screen = { width: 844, height: 390 };
    const a = { x: 400, y: 300, width: 36, height: 36 };
    const p = placePopover(a, { width: 300, height: 200 }, screen, 'right', 'top');
    assert.equal(p.side, 'above');
  });
});

describe('placePopover: vertical bars open inward', () => {
  test('left bar opens to the right for both hands, caret at the button', () => {
    for (const hand of ['right', 'left'] as const) {
      const p = placePopover(leftBarButton, CARD, SCREEN, hand, 'left');
      assert.equal(p.side, 'right');
      assert.equal(p.x, leftBarButton.x + leftBarButton.width + GAP);
      assert.equal(p.y, cy(leftBarButton) - CARD.height / 2);
      assert.equal(p.caret, cy(leftBarButton) - p.y);
    }
  });

  test('right bar opens to the left for both hands', () => {
    for (const hand of ['right', 'left'] as const) {
      const p = placePopover(rightBarButton, CARD, SCREEN, hand, 'right');
      assert.equal(p.side, 'left');
      assert.equal(p.x, rightBarButton.x - GAP - CARD.width);
    }
  });

  test('a button near the top: the card is clamped, the caret follows the button', () => {
    const a = { ...leftBarButton, y: 90 };
    const p = placePopover(a, CARD, SCREEN, 'right', 'left', { insets: { top: 24, bottom: 20, left: 0, right: 0 } });
    assert.equal(p.y, 24 + MARGIN);
    assert.equal(p.caret, cy(a) - p.y);
  });
});

describe('helpers', () => {
  test('shiftAwayFromHand', () => {
    assert.equal(shiftAwayFromHand(400, 100, 'right', 0, 1000), 400 + 26 - 100);
    assert.equal(shiftAwayFromHand(400, 100, 'left', 0, 1000), 400 - 26);
    assert.equal(shiftAwayFromHand(10, 100, 'right', 12, 1000), 12);
  });

  test('placeNearPoint: above the point, away from the hand; below when no room', () => {
    const size = { width: 300, height: 48 };
    const p = placeNearPoint({ x: 500, y: 600 }, size, SCREEN, 'right');
    assert.equal(p.side, 'above');
    assert.ok(p.x + size.width <= 500 + 26);
    const q = placeNearPoint({ x: 500, y: 20 }, size, SCREEN, 'left');
    assert.equal(q.side, 'below');
    assert.equal(q.x, 500 - 26);
  });
});
