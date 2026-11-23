/**
 * Incremental ("wet") outline for the stroke being drawn, so a long stroke costs O(STREAMLINE_WINDOW)
 * per pointer event instead of O(n).
 *
 * The caller owns a flat number[] state (wetCreate) and calls wetStep with the whole raw point list
 * (flat x, y, p) after every pointer event:
 * - Stroke points more than STREAMLINE_WINDOW samples behind the head are FROZEN: their left and right
 *   outline points can never change again. Each step returns the newly frozen region as a closed
 *   polygon patch (frozenOutlineAppend) that the caller adds once to a frozen path (nonzero fill).
 *   The first patch includes the start cap.
 * - tail is a closed polygon from the last frozen left point, around the head and the end cap, back
 *   to the last frozen right point. Redraw it every step. Before anything is frozen, tail is the
 *   whole outline (exactly getStroke).
 * - Frozen patches plus the tail cover exactly getStroke(pts, o) for the same options (tested).
 *
 * A point freezes only when it is also at least max(3, taperEnd) pt behind the head along the stroke
 * (upstream drops points within 3 pt of the end as noise, and the end taper changes their radius).
 * When the pen stays almost still, points pile up inside that distance, so a point is force-frozen
 * once WET_FORCE_WINDOW samples are behind it (at its untapered radius). Only then can the wet
 * outline differ from getStroke, only by outline points within max(3, taperEnd) pt of a resting pen
 * tip, and only while it rests: once the pen moves on, the result is exact again. Freezing needs numeric tapers;
 * taperStart/taperEnd === true (whole-stroke tapers) freezes nothing.
 *
 * At WET_MAX_POINTS raw points the caller commits the stroke (last: true) and starts a new stroke at
 * wetCarry(pts), the last raw point, so the two round caps overlap and the line looks continuous.
 *
 * State layout (flat numbers):
 *  0 frozenCount        stroke points whose outline is frozen
 *  1 rawDone            raw points turned into permanent stroke points (0 = not started)
 *  2 spCount            permanent stroke points
 *  3 runningLength      4 hasReachedMinimumLength (0|1)
 *  5..14                outline state of the frozen part (freehand.ts outlineInit layout)
 *  15-16 last frozen left point, 17-18 last frozen right point
 *  19 frozen left count, 20 frozen right count
 *  21 work done by the last step (outline iterations + raw points processed), for instrumentation
 *  22 raw point count seen by the last step (a shorter list resets the state)
 *  23 reserved
 *  24.. permanent stroke points, SP_STRIDE numbers each
 */
import type { FreehandOptions } from './freehand.ts';
import {
  endCapPoints,
  getStroke,
  outlineInit,
  outlineRange,
  outlineStep,
  pushReversedPairs,
  resolveFreehand,
  startCapPoints,
  strokePointStep,
  taperLength,
} from './freehand.ts';

/** Stroke points within this many samples of the head are recomputed every step. */
export const STREAMLINE_WINDOW = 16;
/** A point this many samples behind the head freezes even when it is within 3 pt of the head. */
export const WET_FORCE_WINDOW = 64;
/** At this many raw points the caller commits the stroke and continues with a new one. */
export const WET_MAX_POINTS = 4000;
/** Header size of the wet state. */
export const WET_HEADER = 24;

export interface WetStepResult {
  /** Closed polygon (flat x, y) of the newly frozen region; empty when nothing froze this step. */
  frozenOutlineAppend: number[];
  /** The newly frozen left and right outline points (flat x, y, in stroke order). */
  frozenLeft: number[];
  frozenRight: number[];
  /** The start cap, only on the step where the first points freeze (it is inside that patch too). */
  startCap: number[];
  /** Closed polygon (flat x, y) of the live part. Before anything freezes: the whole outline. */
  tail: number[];
  /** Outline iterations + raw points processed in this step (O(STREAMLINE_WINDOW) per event). */
  work: number;
}

/** Puts state back to "no points yet" (reuses the array). */
export function wetReset(state: number[]): void {
  'worklet';
  state.length = WET_HEADER;
  for (let k = 0; k < WET_HEADER; k++) state[k] = 0;
  state[13] = NaN;
}

/** A fresh wet state. */
export function wetCreate(): number[] {
  'worklet';
  const s: number[] = [];
  wetReset(s);
  return s;
}

/** True once the stroke reached WET_MAX_POINTS raw points and must be committed and continued. */
export function wetShouldSplit(pts: ArrayLike<number>): boolean {
  'worklet';
  return Math.floor(pts.length / 3) >= WET_MAX_POINTS;
}

/** The raw points the continuation stroke starts with: the last raw point (x, y, p). */
export function wetCarry(pts: ArrayLike<number>): number[] {
  'worklet';
  const n = Math.floor(pts.length / 3);
  if (n === 0) return [];
  const o = (n - 1) * 3;
  return [pts[o], pts[o + 1], pts[o + 2]];
}

function emptyResult(tail: number[], work: number): WetStepResult {
  'worklet';
  return { frozenOutlineAppend: [], frozenLeft: [], frozenRight: [], startCap: [], tail, work };
}

/**
 * Advances the wet outline to the raw points pts (flat x, y, p; the same growing list every call).
 * o must be the same options on every call of one stroke, except last, which may turn true on the
 * final call.
 */
export function wetStep(state: number[], pts: ArrayLike<number>, o?: FreehandOptions): WetStepResult {
  'worklet';
  const n = Math.floor(pts.length / 3);
  if (state.length < WET_HEADER || n < state[22]) wetReset(state);
  state[22] = n;
  if (n <= 2) {
    // Upstream special-cases 1 and 2 input points; nothing can freeze yet.
    state[21] = n;
    return emptyResult(getStroke(pts, o), n);
  }
  const R = resolveFreehand(o);
  const H = WET_HEADER;
  const size = R.size;
  const t = 0.15 + (1 - R.streamline) * 0.85;
  let work = 0;

  // ----- permanent stroke points: every raw point except the last
  if (state[1] === 0) {
    const p0 = pts[2];
    state.length = H;
    state.push(pts[0], pts[1], p0 >= 0 ? p0 : 0.25, 1, 1, 0, 0);
    state[1] = 1;
    state[2] = 1;
    state[3] = 0;
    state[4] = 0;
  }
  const rs = [state[3], state[4]];
  let count = state[2];
  for (let i = state[1]; i <= n - 2; i++) {
    if (strokePointStep(state, H, count, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], false, false, t, size, rs)) count++;
    work++;
  }
  state[1] = n - 1;
  state[2] = count;
  state[3] = rs[0];
  state[4] = rs[1];
  state.length = H + count * 7;

  // ----- the transient stroke point from the last raw point (as i === max)
  const rt = [rs[0], rs[1]];
  const li = (n - 1) * 3;
  const pushed = strokePointStep(state, H, count, pts[li], pts[li + 1], pts[li + 2], R.last, true, t, size, rt);
  const S = pushed ? count + 1 : count;
  work++;
  if (S > 1) {
    state[H + 3] = state[H + 10];
    state[H + 4] = state[H + 11];
  } else {
    state[H + 3] = 0;
    state[H + 4] = 0;
  }

  if (size <= 0) {
    state.length = H + count * 7;
    state[21] = work;
    return emptyResult([], work);
  }

  const totalLength = state[H + (S - 1) * 7 + 6];
  const taperS = taperLength(R.taperStart, size, totalLength);
  const taperE = taperLength(R.taperEnd, size, totalLength);
  const minDistance = Math.pow(size * R.smoothing, 2);
  const canFreeze = R.taperStart !== true && R.taperEnd !== true;

  // ----- freeze
  const frozenLeft: number[] = [];
  const frozenRight: number[] = [];
  const hadFrozen = state[0] > 0;
  const prevLx = state[15];
  const prevLy = state[16];
  const prevRx = state[17];
  const prevRy = state[18];
  if (canFreeze) {
    const limit = totalLength - Math.max(3, taperE);
    while (state[0] + STREAMLINE_WINDOW < S) {
      const i = state[0];
      const forced = i + WET_FORCE_WINDOW < S;
      if (!forced && state[H + i * 7 + 6] > limit) break;
      if (i === 0) outlineInit(state, H, S, R, state, 5);
      // A forced point is frozen at its full (untapered) radius: once the pen moves on, upstream
      // draws it that way too, so the wet ink matches getStroke again instead of keeping a notch.
      outlineStep(state, H, i, S, forced ? Infinity : totalLength, R, taperS, taperE, minDistance, state, 5, frozenLeft, frozenRight, forced);
      state[0] = i + 1;
      work++;
    }
  }
  let patch: number[] = [];
  let startCap: number[] = [];
  if (frozenLeft.length > 0 || frozenRight.length > 0) {
    if (!hadFrozen) {
      startCap = startCapPoints(R, S, state[H], state[H + 1], frozenLeft[0], frozenLeft[1], frozenRight[0], frozenRight[1], taperS, taperE);
      patch = frozenLeft.slice();
      pushReversedPairs(patch, frozenRight);
      for (let k = 0; k < startCap.length; k++) patch.push(startCap[k]);
    } else {
      patch = [prevLx, prevLy];
      for (let k = 0; k < frozenLeft.length; k++) patch.push(frozenLeft[k]);
      pushReversedPairs(patch, frozenRight);
      patch.push(prevRx, prevRy);
    }
    if (frozenLeft.length > 0) {
      state[15] = frozenLeft[frozenLeft.length - 2];
      state[16] = frozenLeft[frozenLeft.length - 1];
    }
    if (frozenRight.length > 0) {
      state[17] = frozenRight[frozenRight.length - 2];
      state[18] = frozenRight[frozenRight.length - 1];
    }
    state[19] += frozenLeft.length / 2;
    state[20] += frozenRight.length / 2;
  }

  // ----- tail
  let tail: number[];
  const fc = state[0];
  if (fc === 0) {
    tail = outlineRange(state, H, S, R);
    work += S;
  } else {
    const os = [state[5], state[6], state[7], state[8], state[9], state[10], state[11], state[12], state[13], state[14]];
    const tl: number[] = [];
    const tr: number[] = [];
    for (let i = fc; i < S; i++) {
      outlineStep(state, H, i, S, totalLength, R, taperS, taperE, minDistance, os, 0, tl, tr, false);
      work++;
    }
    const lo = H + (S - 1) * 7;
    const endCap = endCapPoints(R, S, state[lo], state[lo + 1], state[lo + 3], state[lo + 4], os[9], taperS, taperE);
    tail = [state[15], state[16]];
    for (let k = 0; k < tl.length; k++) tail.push(tl[k]);
    for (let k = 0; k < endCap.length; k++) tail.push(endCap[k]);
    pushReversedPairs(tail, tr);
    tail.push(state[17], state[18]);
  }

  // drop the transient point again
  state.length = H + count * 7;
  state[21] = work;
  return { frozenOutlineAppend: patch, frozenLeft, frozenRight, startCap, tail, work };
}
