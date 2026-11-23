/**
 * The hold-to-snap signal (P04, real), NB-44 / ruling (g). The canvas (P22) runs the hold detector on
 * the UI runtime and publishes it here; the snap hint (P28 SnapHint) reads it.
 *
 * - progress, sx, sy, active: shared values, written on the UI runtime by P22 (ring progress 0..1, the
 *   pen point in screen px, and whether the hold with a candidate is on screen).
 * - setCandidate(c | null): JS ONLY. From a worklet call scheduleOnRN(setCandidate, candidate) with
 *   plain data ({ variant, sides }, e.g. a core/shapes ShapeCandidate). The same candidate again does
 *   not notify, so a re-sent candidate does not re-render the hint.
 * - useCandidate(): the current candidate (useSyncExternalStore over a cached snapshot); pass it to
 *   core/shapes hintText() for the hint text.
 */
import { useSyncExternalStore } from 'react';
import { makeMutable } from 'react-native-reanimated';

import type { HoldSignal } from '@/notebook/contracts/canvas';
import type { SnapCandidate, SnapVariant } from '@/notebook/core/contracts/tools';

export type { HoldSignal } from '@/notebook/contracts/canvas';

const VARIANTS: readonly SnapVariant[] = ['line', 'arrow', 'rect', 'square', 'ellipse', 'circle', 'triangle', 'polygon'];

const progress = makeMutable(0);
const sx = makeMutable(0);
const sy = makeMutable(0);
const active = makeMutable(false);

let candidate: SnapCandidate | null = null;
const listeners = new Set<() => void>();

/** JS ONLY: sets (or clears with null) the shape the hold would snap to. */
export function setCandidate(c: SnapCandidate | null): void {
  let next: SnapCandidate | null = null;
  if (c && VARIANTS.includes(c.variant)) {
    const sides = Number.isFinite(c.sides) ? Math.max(0, Math.floor(c.sides)) : 0;
    next = Object.freeze({ variant: c.variant, sides });
  }
  if (next === candidate) return;
  if (next && candidate && next.variant === candidate.variant && next.sides === candidate.sides) return;
  candidate = next;
  for (const cb of [...listeners]) cb();
}

function getSnapshot(): SnapCandidate | null {
  return candidate;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const holdSignal: HoldSignal = {
  progress,
  sx,
  sy,
  active,
  setCandidate,
  getSnapshot,
  subscribe,
};

/** The current snap candidate, or null. */
export function useCandidate(): SnapCandidate | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Worklet: hides the ring and the hint on the UI runtime (the candidate is cleared separately on JS). */
export function resetHoldVisuals(): void {
  'worklet';
  active.set(false);
  progress.set(0);
}
