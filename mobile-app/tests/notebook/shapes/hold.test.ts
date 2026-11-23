import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createHoldState,
  HOLD_MS,
  HOLD_TOL_SCREEN,
  holdTolerance,
  resetHold,
  STILL_MS,
  tickHold,
  updateHold,
} from '../../../src/notebook/core/shapes/hold.ts';
import type { HoldState, HoldUpdate } from '../../../src/notebook/core/shapes/hold.ts';

const TOL = 2;

/** Draws a stroke from (0,0) to the right, one sample every 8 ms, 3 pt apart; returns the last time. */
function drawTo(s: HoldState, t0: number, samples: number, out: HoldUpdate[]): number {
  let t = t0;
  for (let i = 0; i < samples; i++) {
    out.push(updateHold(s, i * 3, 0, t, TOL));
    t += 8;
  }
  return t - 8;
}

/** Holds still at (x, y) with sub-tolerance jitter, one sample every 8 ms, from t0 to t1 inclusive. */
function holdAt(s: HoldState, x: number, y: number, t0: number, t1: number, out: HoldUpdate[]): void {
  let k = 0;
  for (let t = t0; t <= t1; t += 8) {
    const j = (k++ % 3) * 0.4 - 0.4;
    out.push(updateHold(s, x + j, y - j, t, TOL));
  }
}

const fires = (list: HoldUpdate[]) => list.filter((u) => u.justFired).length;

describe('hold detector (5-path matrix)', () => {
  test('constants', () => {
    assert.equal(STILL_MS, 120);
    assert.equal(HOLD_MS, 500);
    assert.equal(HOLD_TOL_SCREEN, 2);
    assert.equal(holdTolerance(2), 1);
    assert.equal(holdTolerance(0.5), 4);
    assert.equal(holdTolerance(0), HOLD_TOL_SCREEN);
  });

  test('1. lifting before 500 ms never fires', () => {
    const s = createHoldState();
    const out: HoldUpdate[] = [];
    const t = drawTo(s, 1000, 40, out);
    const x = 39 * 3;
    holdAt(s, x, 0, t + 8, t + HOLD_MS - 8, out);
    assert.equal(fires(out), 0);
    assert.ok(out.every((u) => u.phase !== 'fired'));
    // The ring was showing (holding) before the lift.
    assert.equal(out[out.length - 1].phase, 'holding');
    assert.ok(out[out.length - 1].progress < 1);
    resetHold(s);
    // A new stroke starts fresh: the old stillness does not carry over.
    assert.equal(updateHold(s, x, 0, t + HOLD_MS + 100, TOL).phase, 'moving');
  });

  test('2. staying still for 500 ms fires exactly once, then stays fired', () => {
    const s = createHoldState();
    const out: HoldUpdate[] = [];
    const t = drawTo(s, 0, 30, out);
    const x = 29 * 3;
    holdAt(s, x, 0, t + 8, t + 1500, out);
    assert.equal(fires(out), 1);
    const i = out.findIndex((u) => u.justFired);
    assert.equal(out[i].phase, 'fired');
    assert.equal(out[i].progress, 1);
    assert.ok(out.slice(i).every((u) => u.phase === 'fired' && u.progress === 1));
    // The fire happens once the pen has been still for HOLD_MS (measured from the last movement).
    const firedAt = t + 8 * (i - 30 + 1);
    assert.ok(firedAt - t >= HOLD_MS && firedAt - t < HOLD_MS + 16, `fired after ${firedAt - t} ms`);
  });

  test('phases in order: moving, holding after STILL_MS with a rising ring, fired at HOLD_MS', () => {
    const s = createHoldState();
    assert.deepEqual(updateHold(s, 10, 10, 0, TOL), { phase: 'moving', progress: 0, justFired: false, justHeld: false });
    assert.equal(updateHold(s, 10, 10, STILL_MS - 1, TOL).phase, 'moving');
    const held = updateHold(s, 10, 10, STILL_MS, TOL);
    assert.deepEqual(held, { phase: 'holding', progress: 0, justFired: false, justHeld: true });
    const mid = updateHold(s, 10.5, 10, (STILL_MS + HOLD_MS) / 2, TOL);
    assert.equal(mid.phase, 'holding');
    assert.equal(mid.justHeld, false);
    assert.ok(Math.abs(mid.progress - 0.5) < 1e-9);
    const late = updateHold(s, 10, 10.5, HOLD_MS - 1, TOL);
    assert.ok(late.progress > 0.99 && late.progress < 1);
    assert.deepEqual(updateHold(s, 10, 10, HOLD_MS, TOL), { phase: 'fired', progress: 1, justFired: true, justHeld: false });
  });

  test('3. moving during holding resets to moving with progress 0, and the clock restarts', () => {
    const s = createHoldState();
    const out: HoldUpdate[] = [];
    updateHold(s, 0, 0, 0, TOL);
    const h = updateHold(s, 0.5, 0, 400, TOL);
    assert.equal(h.phase, 'holding');
    assert.ok(h.progress > 0.7);
    const moved = updateHold(s, 0 + TOL + 0.5, 0, 410, TOL);
    assert.deepEqual(moved, { phase: 'moving', progress: 0, justFired: false, justHeld: false });
    // 500 ms after the FIRST stop is not enough any more; 500 ms after the move is.
    out.push(updateHold(s, TOL + 0.5, 0, 520, TOL));
    assert.equal(out[0].justFired, false);
    assert.equal(updateHold(s, TOL + 0.5, 0, 410 + STILL_MS, TOL).justHeld, true);
    assert.equal(updateHold(s, TOL + 0.5, 0, 410 + HOLD_MS - 1, TOL).phase, 'holding');
    assert.equal(updateHold(s, TOL + 0.5, 0, 410 + HOLD_MS, TOL).justFired, true);
  });

  test('4. moving after the fire neither fires again nor resets', () => {
    const s = createHoldState();
    const out: HoldUpdate[] = [];
    updateHold(s, 0, 0, 0, TOL);
    out.push(updateHold(s, 0, 0, HOLD_MS, TOL));
    assert.equal(out[0].justFired, true);
    // Big moves, then a fresh still period long enough to fire again.
    for (let i = 1; i <= 50; i++) out.push(updateHold(s, i * 10, i * 5, HOLD_MS + i * 8, TOL));
    holdAt(s, 500, 250, HOLD_MS + 420, HOLD_MS + 2000, out);
    out.push(tickHold(s, HOLD_MS + 3000, TOL));
    assert.equal(fires(out), 1);
    assert.ok(out.slice(1).every((u) => u.phase === 'fired' && u.progress === 1 && !u.justFired && !u.justHeld));
  });

  test('5. slow drift beyond the tolerance counts as movement; jitter within it does not', () => {
    const drift = createHoldState();
    const out: HoldUpdate[] = [];
    // 0.5 pt every 50 ms: after 250 ms it is 2.5 pt away from where it stopped.
    for (let t = 0, x = 0; t <= 1000; t += 50, x += 0.5) out.push(updateHold(drift, x, 0, t, TOL));
    assert.equal(fires(out), 0);
    assert.ok(out.some((u) => u.phase === 'holding'));

    const jitter = createHoldState();
    const out2: HoldUpdate[] = [];
    holdAt(jitter, 100, 100, 0, 600, out2);
    assert.equal(fires(out2), 1);
  });
});

describe('hold detector details', () => {
  test('tickHold fires with no new samples (a perfectly still pen sends no events)', () => {
    const s = createHoldState();
    assert.equal(tickHold(s, 0, TOL).phase, 'moving');
    updateHold(s, 50, 50, 1000, TOL);
    assert.equal(tickHold(s, 1000 + STILL_MS, TOL).phase, 'holding');
    const f = tickHold(s, 1000 + HOLD_MS, TOL);
    assert.equal(f.justFired, true);
    assert.equal(tickHold(s, 1000 + HOLD_MS + 16, TOL).justFired, false);
  });

  test('zoom changes the tolerance in page points', () => {
    const zoomedIn = createHoldState();
    updateHold(zoomedIn, 0, 0, 0, holdTolerance(4));
    // 1 pt in page space is 4 screen points at 400 percent: that is movement.
    assert.equal(updateHold(zoomedIn, 1, 0, 300, holdTolerance(4)).phase, 'moving');
    const zoomedOut = createHoldState();
    updateHold(zoomedOut, 0, 0, 0, holdTolerance(0.5));
    // 3 pt in page space is 1.5 screen points at 50 percent: still holding.
    assert.equal(updateHold(zoomedOut, 3, 0, 300, holdTolerance(0.5)).phase, 'holding');
  });

  test('resetHold readies the next stroke; the hold time is tunable', () => {
    const s = createHoldState({ holdMs: 300 });
    updateHold(s, 0, 0, 0, TOL);
    assert.equal(updateHold(s, 0, 0, 300, TOL).justFired, true);
    resetHold(s);
    assert.equal(s.phase, 'moving');
    assert.equal(s.started, false);
    assert.equal(s.holdMs, 300);
    assert.equal(updateHold(s, 0, 0, 400, TOL).phase, 'moving');
    assert.equal(updateHold(s, 0, 0, 700, TOL).justFired, true);

    const bad = createHoldState({ holdMs: 100, stillMs: 400 });
    assert.ok(bad.stillMs < bad.holdMs);
    assert.equal(createHoldState({ holdMs: -5 }).holdMs, HOLD_MS);
  });

  test('a stalled frame that skips the holding window still asks for recognition on the fire', () => {
    const s = createHoldState();
    updateHold(s, 0, 0, 0, TOL);
    assert.equal(updateHold(s, 0, 0, STILL_MS - 20, TOL).phase, 'moving');
    // The next frame arrives 600 ms later: straight from 'moving' to 'fired'.
    assert.deepEqual(tickHold(s, STILL_MS + 600, TOL), { phase: 'fired', progress: 1, justFired: true, justHeld: true });
    assert.deepEqual(tickHold(s, STILL_MS + 700, TOL), { phase: 'fired', progress: 1, justFired: false, justHeld: false });
  });

  test('non-finite samples neither count as stillness nor freeze the clock', () => {
    const s = createHoldState();
    // A broken first sample does not start the stroke.
    assert.equal(updateHold(s, NaN, 0, 0, TOL).phase, 'moving');
    assert.equal(s.started, false);
    updateHold(s, 0, 0, 1000, TOL);
    // A NaN time is ignored: the next good sample still fires on time.
    assert.equal(updateHold(s, 0, 0, NaN, TOL).phase, 'moving');
    // A NaN position after real movement does not hide that movement.
    updateHold(s, 50, 0, 1100, TOL);
    assert.equal(updateHold(s, NaN, NaN, 1300, TOL).phase, 'holding');
    assert.equal(s.lx, 50);
    assert.equal(updateHold(s, 50, 0, 1100 + HOLD_MS, TOL).justFired, true);
    assert.equal(tickHold(s, Infinity, TOL).justFired, false);
  });

  test('time going backwards never fires early', () => {
    const s = createHoldState();
    updateHold(s, 0, 0, 1000, TOL);
    assert.equal(updateHold(s, 0, 0, 900, TOL).phase, 'moving');
    assert.equal(updateHold(s, 0, 0, 1000 + HOLD_MS - 1, TOL).justFired, false);
    assert.equal(updateHold(s, 0, 0, 1000 + HOLD_MS, TOL).justFired, true);
  });
});
