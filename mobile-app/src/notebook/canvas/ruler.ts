/**
 * The ruler store (P04, real), NB-45. One module-level set of shared values in SCREEN space, shared by
 * the ruler overlay (P28), the canvas (P22: ruler snapping, nav arbitration) and the toolbar mirror.
 *
 * - visible mirrors toolState.rulerOn; P28 useRulerTool is its SOLE writer.
 * - cx, cy, angle: written by the ruler gesture (P28) on the UI runtime; placeRuler() for the first show.
 * - hitTest(sx, sy) is a worklet: the ruler must be visible and the point on it. Nav and the undo/redo
 *   taps fail when both pointers start inside it; the ruler gesture needs both pointers inside.
 *
 * The canvas converts the ruler to page space (centre through toPage, angle unchanged, length and width
 * divided by the zoom) for core/ink/ruler.ts snapToRuler.
 */
import { makeMutable } from 'react-native-reanimated';

import type { RulerApi } from '@/notebook/contracts/canvas';
import { rulerContains } from '@/notebook/core/geom/rulerHit';

export type { RulerApi } from '@/notebook/contracts/canvas';

/** Ruler size in screen px. */
export const RULER_LENGTH = 600;
export const RULER_WIDTH = 60;

const visible = makeMutable(false);
const cx = makeMutable(0);
const cy = makeMutable(0);
const angle = makeMutable(0);
/** false until the ruler was placed once (placeRuler or a drag). */
const placed = makeMutable(false);

function hitTest(sx: number, sy: number): boolean {
  'worklet';
  if (!visible.get()) return false;
  return rulerContains(sx, sy, cx.get(), cy.get(), angle.get(), RULER_LENGTH, RULER_WIDTH);
}

const ruler: RulerApi = { visible, cx, cy, angle, length: RULER_LENGTH, width: RULER_WIDTH, hitTest };

/** The ruler (stable object; its shared values do not re-render). */
export function useRuler(): RulerApi {
  return ruler;
}

/** The same object outside React. */
export function getRuler(): RulerApi {
  return ruler;
}

/**
 * Puts the ruler in the middle of a view of the given size (screen px), level, unless it was already
 * placed (force: true moves it anyway). Worklet, so it also works from a gesture.
 */
export function placeRuler(viewW: number, viewH: number, o?: { force?: boolean }): void {
  'worklet';
  if (placed.get() && !o?.force) return;
  cx.set(viewW / 2);
  cy.set(viewH / 2);
  angle.set(0);
  placed.set(true);
}

/** Worklet: marks the ruler as placed (call after the first drag). */
export function markRulerPlaced(): void {
  'worklet';
  placed.set(true);
}
