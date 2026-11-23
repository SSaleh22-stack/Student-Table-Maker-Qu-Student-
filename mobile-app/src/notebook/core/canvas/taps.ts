/**
 * Taps on the canvas (P22).
 *
 * MULTI-FINGER TAPS (NB-48): a two-finger tap undoes and a three-finger tap redoes. They are RNGH tap
 * gestures (minPointers 2 / 3, maxDuration MULTI_TAP_MAX_MS, exclusive: three wins over two); the constants
 * live here so the gestures and their review agree.
 *
 * ONE-POINTER PRESS for the forwarded tools (lasso, shapes, text) and the play tool: a press is held
 * back until it is clearly a drag (moved TAP_SLOP screen px) or a long press (LONG_PRESS_MS without
 * moving); a press lifted before either is a tap (a slow tap is still a tap). Forwarded drags are
 * sent to the JS tool handler at most every FORWARD_INTERVAL_MS (60 Hz), plus the last point at the end.
 *
 * The press state is a small plain object MUTATED in place (it lives in a shared value on the UI
 * runtime, updated with sv.modify). Every function is a worklet.
 */

/** Longest press that still counts as a multi-finger tap. */
export const MULTI_TAP_MAX_MS = 250;
/** Movement allowed during a multi-finger tap (screen px). */
export const MULTI_TAP_MAX_DIST = 12;
/** A one-pointer press that moved this far is a drag (screen px). */
export const TAP_SLOP = 8;
/** A still press this long is a long press. */
export const LONG_PRESS_MS = 500;
/** Forwarded tool updates: at most one per this many ms (60 Hz). */
export const FORWARD_INTERVAL_MS = 16;

export type PressPhase = 'idle' | 'pending' | 'drag' | 'long';

export interface PressState {
  phase: PressPhase;
  x0: number;
  y0: number;
  t0: number;
  /** Largest distance from the start so far (screen px). */
  moved: number;
  /** Time of the last forwarded update. */
  lastForward: number;
}

/** What a press event means. */
export type PressEvent = 'none' | 'drag-start' | 'long-press';
/** How a press ended. */
export type PressEnd = 'tap' | 'drag' | 'long' | 'none';

export function createPress(): PressState {
  'worklet';
  return { phase: 'idle', x0: 0, y0: 0, t0: 0, moved: 0, lastForward: -Infinity };
}

export function beginPress(s: PressState, x: number, y: number, t: number): void {
  'worklet';
  s.phase = 'pending';
  s.x0 = x;
  s.y0 = y;
  s.t0 = t;
  s.moved = 0;
  s.lastForward = -Infinity;
}

/** Time passed without a move: 'long-press' once a pending press was held LONG_PRESS_MS. */
export function tickPress(s: PressState, t: number): PressEvent {
  'worklet';
  if (s.phase !== 'pending') return 'none';
  if (t - s.t0 >= LONG_PRESS_MS) {
    s.phase = 'long';
    return 'long-press';
  }
  return 'none';
}

/** A move: 'drag-start' on the move that turns a pending press into a drag. */
export function movePress(s: PressState, x: number, y: number, t: number): PressEvent {
  'worklet';
  const dx = x - s.x0;
  const dy = y - s.y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > s.moved) s.moved = d;
  if (s.phase !== 'pending') return 'none';
  if (s.moved >= TAP_SLOP) {
    s.phase = 'drag';
    return 'drag-start';
  }
  return tickPress(s, t);
}

/** The pointer lifted at time t. */
export function endPress(s: PressState, t: number): PressEnd {
  'worklet';
  const phase = s.phase;
  s.phase = 'idle';
  if (phase === 'drag') return 'drag';
  if (phase === 'long') return 'long';
  if (phase === 'pending') return t - s.t0 < LONG_PRESS_MS && s.moved < TAP_SLOP ? 'tap' : 'none';
  return 'none';
}

/** True (and the clock is advanced) when a forwarded update may be sent at time t. */
export function shouldForward(s: PressState, t: number): boolean {
  'worklet';
  if (t - s.lastForward >= FORWARD_INTERVAL_MS) {
    s.lastForward = t;
    return true;
  }
  return false;
}
