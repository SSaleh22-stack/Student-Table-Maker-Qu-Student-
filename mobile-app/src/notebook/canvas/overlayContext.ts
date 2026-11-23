/**
 * OverlayContext (P04, real): how overlays above the page canvas (selection handles, ruler, text
 * editor, snap hint) follow zoom and claim gestures. P22 PageCanvas provides the real value; outside
 * a canvas the null-safe default is used (identity transform, no pages, every lookup null).
 *
 * overlayBusy is ONE module-level shared value used by every canvas, so overlays and the canvas
 * agree even across providers:
 * - an overlay gesture calls claimOverlay() in onBegin and releaseOverlay() in onFinalize (both are
 *   worklets; they also work from JS);
 * - canvas gestures fail in onBegin while overlayBusy.get() > 0;
 * - the editor calls resetOverlayBusy() when it mounts, in case a gesture never finalized.
 */
import { createContext, useContext } from 'react';
import { makeMutable } from 'react-native-reanimated';

import type { OverlayContextValue, PageOrigin, PagePoint } from '@/notebook/contracts/canvas';
import type { Id } from '@/notebook/core/model';

export type { OverlayContextValue, PageOrigin } from '@/notebook/contracts/canvas';

/** Number of overlay gestures in progress. */
export const overlayBusy = makeMutable(0);

/** Worklet: one more overlay gesture in progress. */
export function claimOverlay(): void {
  'worklet';
  overlayBusy.set((v) => v + 1);
}

/** Worklet: one overlay gesture fewer (never below 0). */
export function releaseOverlay(): void {
  'worklet';
  overlayBusy.set((v) => (v > 1 ? v - 1 : 0));
}

/** JS: clears overlayBusy (editor mount). */
export function resetOverlayBusy(): void {
  overlayBusy.set(0);
}

/** Worklet: true while an overlay gesture is in progress. */
export function isOverlayBusy(): boolean {
  'worklet';
  return overlayBusy.get() > 0;
}

function noOrigin(_pageId: Id): PageOrigin | null {
  'worklet';
  return null;
}

function noScreen(_pageId: Id, _x: number, _y: number): { x: number; y: number } | null {
  'worklet';
  return null;
}

function noPage(_sx: number, _sy: number): PagePoint | null {
  'worklet';
  return null;
}

/** The value outside a canvas: identity transform, no pages. */
export const defaultOverlayValue: OverlayContextValue = {
  scale: makeMutable(1),
  tx: makeMutable(0),
  ty: makeMutable(0),
  pageOrigin: noOrigin,
  toScreen: noScreen,
  toPage: noPage,
  overlayBusy,
  claimOverlay,
  releaseOverlay,
};

export const OverlayContext = createContext<OverlayContextValue>(defaultOverlayValue);

export function useOverlay(): OverlayContextValue {
  return useContext(OverlayContext);
}
