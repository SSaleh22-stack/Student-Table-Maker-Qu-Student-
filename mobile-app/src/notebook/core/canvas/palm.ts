/**
 * Which pointer draws (P22, NB-50 / NB-51), and the palm rules around a stylus.
 *
 * - shouldDraw: a stylus (Apple Pencil, S Pen) and a mouse always draw. A finger draws when 'draw
 *   with finger' is on, or when the student chose finger input and no stylus has been seen on this
 *   canvas yet (once a stylus shows up, fingers scroll and zoom: that is the palm rejection).
 * - Palm zone: right after a stylus lifts, the side of the writing hand rests on the screen. For
 *   PALM_MS, touches inside the PALM_W x PALM_H rectangle beside and below the last pen point, on the
 *   hand's side, are ignored (they neither draw nor scroll).
 * - Finger yield: in finger mode a second finger that lands within NAV_YIELD_MS of the first, before
 *   the first moved NAV_YIELD_PX, means "two-finger scroll / zoom": the draw is cancelled (nothing is
 *   committed) and navigation takes over. A later second touch is ignored by the stroke.
 *
 * Every function is a worklet (the draw gesture runs them on the UI runtime). Units are screen px.
 */

export type PointerName = 'stylus' | 'touch' | 'mouse';

/** The palm rectangle: across (beside the pen) and down. */
export const PALM_W = 150;
export const PALM_H = 220;
/** How far the palm rectangle reaches ABOVE the pen point (the side of the hand is level with the tip). */
export const PALM_ABOVE = 40;
/** How far it reaches to the OTHER side of the pen point (the wrist sits under the tip). */
export const PALM_BEHIND = 16;
/** How long after a stylus lift the palm zone ignores touches. */
export const PALM_MS = 300;

/** A second finger within this time of the first... */
export const NAV_YIELD_MS = 120;
/** ...and before the first moved this far cancels a finger stroke. */
export const NAV_YIELD_PX = 4;

export interface PalmRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** RNGH PointerType (TOUCH 0, STYLUS 1, MOUSE 2, KEY 3, OTHER 4) to a pointer name. */
export function pointerName(pointerType: number): PointerName {
  'worklet';
  if (pointerType === 1) return 'stylus';
  if (pointerType === 2) return 'mouse';
  return 'touch';
}

/** True when this pointer draws with the drawing tools (pen, highlighter, eraser, lasso, shapes, text). */
export function shouldDraw(pointer: PointerName, input: 'pen' | 'finger', fingerDraws: boolean, stylusSeen: boolean): boolean {
  'worklet';
  if (pointer === 'stylus' || pointer === 'mouse') return true;
  if (fingerDraws) return true;
  return input === 'finger' && !stylusSeen;
}

/** The rectangle the writing hand rests on after a stylus lifts at (x, y). */
export function palmZone(lastPenPoint: { x: number; y: number }, hand: 'right' | 'left'): PalmRect {
  'worklet';
  const y = lastPenPoint.y - PALM_ABOVE;
  if (hand === 'left') return { x: lastPenPoint.x - PALM_W + PALM_BEHIND, y, w: PALM_W, h: PALM_H };
  return { x: lastPenPoint.x - PALM_BEHIND, y, w: PALM_W, h: PALM_H };
}

export function inPalmRect(point: { x: number; y: number }, zone: PalmRect): boolean {
  'worklet';
  return point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h;
}

/**
 * True when a touch must be ignored: it lands inside the palm zone less than PALM_MS after the stylus
 * lifted (msSinceLift < 0 means "no stylus lift yet").
 */
export function ignoreTouch(point: { x: number; y: number }, zone: PalmRect | null, msSinceLift: number): boolean {
  'worklet';
  if (!zone || !(msSinceLift >= 0) || msSinceLift >= PALM_MS) return false;
  return inPalmRect(point, zone);
}

/**
 * True when a second touch should cancel the finger stroke in progress and hand over to navigation:
 * the stroke is a finger's, the second touch came within NAV_YIELD_MS and the first finger has not
 * moved NAV_YIELD_PX yet.
 */
export function yieldsToNav(lockedPointer: PointerName, msSinceDown: number, movedPx: number): boolean {
  'worklet';
  return lockedPointer === 'touch' && msSinceDown >= 0 && msSinceDown <= NAV_YIELD_MS && movedPx < NAV_YIELD_PX;
}
