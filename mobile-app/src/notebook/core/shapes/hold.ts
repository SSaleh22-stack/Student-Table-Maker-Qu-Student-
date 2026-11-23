/**
 * Hold detector for hold-to-snap (NB-44) and the highlighter's hold-to-straighten (NB-41).
 *
 * Feed it every pen sample of the current stroke: updateHold(state, x, y, t, tolPt).
 * - 'moving': the pen moved within the last STILL_MS (progress 0).
 * - 'holding': the pen has stayed within tolPt of where it stopped for STILL_MS. The canvas runs
 *   recognition once (justHeld) and shows the ring; progress goes 0 -> 1 between STILL_MS and holdMs.
 * - 'fired': the pen stayed still for holdMs (HOLD_MS = 500 by default). justFired is true on
 *   exactly one update. From then on the state stays 'fired' whatever the pen does, until
 *   resetHold; the canvas ignores further ink until lift.
 * Moving more than tolPt before the fire goes back to 'moving' with progress 0 and restarts the
 * clock from the new position. Lifting before the fire simply never fires (call resetHold).
 *
 * Pen events stop arriving when the pen is perfectly still, so the canvas also calls
 * tickHold(state, t, tolPt) every frame while the pen is down (for example from a frame callback).
 *
 * The state is a small plain object that updateHold MUTATES (it lives on the UI runtime, for
 * example in a shared value updated with sv.modify). Everything here is a worklet.
 */

/** Stillness before the ring appears and recognition runs. */
export const STILL_MS = 120;
/** Stillness that snaps (tunable per state through createHoldState). */
export const HOLD_MS = 500;
/** Allowed wobble while holding, in SCREEN points; pass holdTolerance(zoom) as tolPt. */
export const HOLD_TOL_SCREEN = 2;

export type HoldPhase = 'moving' | 'holding' | 'fired';

export interface HoldState {
  phase: HoldPhase;
  /** False until the first sample of a stroke. */
  started: boolean;
  /** Where and when the pen came to rest. */
  ax: number;
  ay: number;
  at: number;
  /** The latest sample (tickHold reuses it). */
  lx: number;
  ly: number;
  lt: number;
  holdMs: number;
  stillMs: number;
}

export interface HoldUpdate {
  phase: HoldPhase;
  /** Ring fill 0..1: 0 while moving, rising while holding, 1 once fired. */
  progress: number;
  /** True on the one update that fired. */
  justFired: boolean;
  /**
   * True on the update that entered 'holding' (run recognition then). Also true on the fire when
   * the pen went from 'moving' straight to 'fired' (no update landed in the holding window).
   */
  justHeld: boolean;
}

export function createHoldState(o?: { holdMs?: number; stillMs?: number }): HoldState {
  'worklet';
  const holdMs = o && o.holdMs !== undefined && o.holdMs > 0 ? o.holdMs : HOLD_MS;
  let stillMs = o && o.stillMs !== undefined && o.stillMs >= 0 ? o.stillMs : STILL_MS;
  if (stillMs >= holdMs) stillMs = holdMs / 2;
  return { phase: 'moving', started: false, ax: 0, ay: 0, at: 0, lx: 0, ly: 0, lt: 0, holdMs, stillMs };
}

/** Readies the state for the next stroke (keeps holdMs and stillMs). */
export function resetHold(s: HoldState): void {
  'worklet';
  s.phase = 'moving';
  s.started = false;
  s.ax = 0;
  s.ay = 0;
  s.at = 0;
  s.lx = 0;
  s.ly = 0;
  s.lt = 0;
}

/** tolPt for a zoom (screen-to-page scale): HOLD_TOL_SCREEN screen points in page points. */
export function holdTolerance(zoom: number): number {
  'worklet';
  return zoom > 0 && Number.isFinite(zoom) ? HOLD_TOL_SCREEN / zoom : HOLD_TOL_SCREEN;
}

/** One pen sample at page point (x, y), time t (ms). */
export function updateHold(s: HoldState, x0: number, y0: number, t0: number, tolPt: number): HoldUpdate {
  'worklet';
  // A broken sample (non-finite position) counts as no movement at the last good position, and a
  // non-finite time as no time passing, so neither can freeze or fake the clock.
  const t = Number.isFinite(t0) ? t0 : s.lt;
  const good = Number.isFinite(x0) && Number.isFinite(y0);
  if (!good && !s.started) return { phase: 'moving', progress: 0, justFired: false, justHeld: false };
  const x = good ? x0 : s.lx;
  const y = good ? y0 : s.ly;
  if (s.phase === 'fired') {
    s.lx = x;
    s.ly = y;
    s.lt = t;
    return { phase: 'fired', progress: 1, justFired: false, justHeld: false };
  }
  if (!s.started) {
    s.started = true;
    s.ax = x;
    s.ay = y;
    s.at = t;
    s.lx = x;
    s.ly = y;
    s.lt = t;
    s.phase = 'moving';
    return { phase: 'moving', progress: 0, justFired: false, justHeld: false };
  }
  s.lx = x;
  s.ly = y;
  if (t > s.lt) s.lt = t;
  const dx = x - s.ax;
  const dy = y - s.ay;
  const tol = tolPt > 0 ? tolPt : 0;
  if (dx * dx + dy * dy > tol * tol) {
    s.ax = x;
    s.ay = y;
    s.at = s.lt;
    s.phase = 'moving';
    return { phase: 'moving', progress: 0, justFired: false, justHeld: false };
  }
  const elapsed = s.lt - s.at;
  if (elapsed >= s.holdMs) {
    // A stalled frame can jump straight from 'moving' past HOLD_MS. justHeld is then true on the
    // fire itself, so the canvas still runs recognition before it snaps.
    const skipped = s.phase !== 'holding';
    s.phase = 'fired';
    return { phase: 'fired', progress: 1, justFired: true, justHeld: skipped };
  }
  if (elapsed >= s.stillMs) {
    const justHeld = s.phase !== 'holding';
    s.phase = 'holding';
    const span = s.holdMs - s.stillMs;
    const progress = span > 0 ? Math.min(1, Math.max(0, (elapsed - s.stillMs) / span)) : 1;
    return { phase: 'holding', progress, justFired: false, justHeld };
  }
  s.phase = 'moving';
  return { phase: 'moving', progress: 0, justFired: false, justHeld: false };
}

/** No new sample: time passed at the last position (call every frame while the pen is down). */
export function tickHold(s: HoldState, t: number, tolPt: number): HoldUpdate {
  'worklet';
  if (!s.started) return { phase: 'moving', progress: 0, justFired: false, justHeld: false };
  return updateHold(s, s.lx, s.ly, t, tolPt);
}
