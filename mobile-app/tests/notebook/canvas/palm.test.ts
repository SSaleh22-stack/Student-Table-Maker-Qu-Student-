import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ignoreTouch,
  NAV_YIELD_MS,
  NAV_YIELD_PX,
  PALM_H,
  PALM_MS,
  PALM_W,
  palmZone,
  pointerName,
  shouldDraw,
  yieldsToNav,
} from '../../../src/notebook/core/canvas/palm.ts';
import {
  beginPress,
  createPress,
  endPress,
  FORWARD_INTERVAL_MS,
  LONG_PRESS_MS,
  movePress,
  shouldForward,
  TAP_SLOP,
  tickPress,
} from '../../../src/notebook/core/canvas/taps.ts';

describe('shouldDraw (NB-50 / NB-51)', () => {
  test('a stylus and a mouse always draw', () => {
    for (const input of ['pen', 'finger'] as const) {
      for (const fingerDraws of [false, true]) {
        for (const seen of [false, true]) {
          assert.equal(shouldDraw('stylus', input, fingerDraws, seen), true);
          assert.equal(shouldDraw('mouse', input, fingerDraws, seen), true);
        }
      }
    }
  });

  test('pen input: fingers scroll unless "draw with finger" is on', () => {
    assert.equal(shouldDraw('touch', 'pen', false, false), false);
    assert.equal(shouldDraw('touch', 'pen', false, true), false);
    assert.equal(shouldDraw('touch', 'pen', true, true), true);
  });

  test('finger input (phones): fingers draw until a stylus shows up', () => {
    assert.equal(shouldDraw('touch', 'finger', false, false), true);
    assert.equal(shouldDraw('touch', 'finger', false, true), false);
    assert.equal(shouldDraw('touch', 'finger', true, true), true, 'the phone default (fingerDraws on) keeps drawing');
  });

  test('pointerName maps RNGH PointerType', () => {
    assert.equal(pointerName(0), 'touch');
    assert.equal(pointerName(1), 'stylus');
    assert.equal(pointerName(2), 'mouse');
    assert.equal(pointerName(4), 'touch');
  });
});

describe('palm zone after a stylus lift', () => {
  test('right hand: beside (to the right) and below the pen, 150 x 220', () => {
    const z = palmZone({ x: 400, y: 300 }, 'right');
    assert.equal(z.w, PALM_W);
    assert.equal(z.h, PALM_H);
    assert.equal(PALM_W, 150);
    assert.equal(PALM_H, 220);
    assert.ok(ignoreTouch({ x: 480, y: 420 }, z, 50), 'the heel of the hand');
    assert.ok(!ignoreTouch({ x: 300, y: 420 }, z, 50), 'the other side of the pen');
    assert.ok(!ignoreTouch({ x: 480, y: 100 }, z, 50), 'far above the pen');
  });

  test('left hand mirrors the zone', () => {
    const z = palmZone({ x: 400, y: 300 }, 'left');
    assert.ok(ignoreTouch({ x: 320, y: 420 }, z, 50));
    assert.ok(!ignoreTouch({ x: 480, y: 420 }, z, 50));
  });

  test('only for 300 ms after the lift', () => {
    const z = palmZone({ x: 400, y: 300 }, 'right');
    const p = { x: 450, y: 400 };
    assert.equal(PALM_MS, 300);
    assert.ok(ignoreTouch(p, z, 0));
    assert.ok(ignoreTouch(p, z, 299));
    assert.ok(!ignoreTouch(p, z, 300));
    assert.ok(!ignoreTouch(p, z, -1), 'no lift yet');
    assert.ok(!ignoreTouch(p, null, 10), 'no zone');
  });
});

describe('finger stroke yields to two-finger navigation', () => {
  test('second finger within 120 ms and before 4 px', () => {
    assert.equal(NAV_YIELD_MS, 120);
    assert.equal(NAV_YIELD_PX, 4);
    assert.ok(yieldsToNav('touch', 60, 1));
    assert.ok(yieldsToNav('touch', 120, 3.9));
    assert.ok(!yieldsToNav('touch', 121, 1), 'too late: the stroke keeps going, the touch is ignored');
    assert.ok(!yieldsToNav('touch', 60, 4), 'already drawing');
  });

  test('a stylus stroke never yields (a palm landing mid-stroke keeps the stroke)', () => {
    assert.ok(!yieldsToNav('stylus', 10, 0));
    assert.ok(!yieldsToNav('mouse', 10, 0));
  });
});

describe('one-pointer press (taps.ts)', () => {
  test('tap', () => {
    const s = createPress();
    beginPress(s, 100, 100, 0);
    assert.equal(movePress(s, 102, 101, 30), 'none');
    assert.equal(endPress(s, 120), 'tap');
    assert.equal(s.phase, 'idle');
  });

  test('a slow tap is still a tap, a held one is a long press', () => {
    const s = createPress();
    beginPress(s, 0, 0, 0);
    assert.equal(endPress(s, LONG_PRESS_MS - 10), 'tap');
  });

  test('drag starts once past the slop, exactly once', () => {
    const s = createPress();
    beginPress(s, 0, 0, 0);
    assert.equal(movePress(s, TAP_SLOP - 1, 0, 10), 'none');
    assert.equal(movePress(s, TAP_SLOP, 0, 20), 'drag-start');
    assert.equal(movePress(s, TAP_SLOP * 3, 0, 30), 'none');
    assert.equal(endPress(s, 40), 'drag');
  });

  test('long press fires from a tick with no movement', () => {
    const s = createPress();
    beginPress(s, 0, 0, 0);
    assert.equal(tickPress(s, LONG_PRESS_MS - 1), 'none');
    assert.equal(tickPress(s, LONG_PRESS_MS), 'long-press');
    assert.equal(tickPress(s, LONG_PRESS_MS + 100), 'none');
    assert.equal(movePress(s, TAP_SLOP - 1, 0, LONG_PRESS_MS + 110), 'none', 'a small wobble stays a long press');
    assert.equal(endPress(s, 900), 'long');
  });

  test('a long press that then moves becomes a drag (a shape aimed with the pencil)', () => {
    const s = createPress();
    beginPress(s, 0, 0, 0);
    assert.equal(tickPress(s, LONG_PRESS_MS), 'long-press');
    assert.equal(movePress(s, 50, 0, LONG_PRESS_MS + 120), 'drag-start');
    assert.equal(endPress(s, 900), 'drag');
  });

  test('moving away and coming back is a drag, not a tap', () => {
    const s = createPress();
    beginPress(s, 0, 0, 0);
    movePress(s, 20, 0, 10);
    movePress(s, 0, 0, 20);
    assert.equal(endPress(s, 30), 'drag');
  });

  test('forwarding is throttled to 60 Hz', () => {
    const s = createPress();
    beginPress(s, 0, 0, 0);
    assert.ok(shouldForward(s, 0));
    assert.ok(!shouldForward(s, FORWARD_INTERVAL_MS - 1));
    assert.ok(shouldForward(s, FORWARD_INTERVAL_MS));
  });
});
