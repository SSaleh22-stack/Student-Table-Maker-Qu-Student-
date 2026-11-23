/**
 * The canvas's shared view state and the two APIs built on it (P22):
 * - useCanvasCore(): the shared values the gestures write on the UI runtime and everything else reads
 *   (zoom, pan, page layout, page ids, view size, insets, motion flags).
 * - useOverlayValue(core): the OverlayContextValue the canvas provides to its overlays (P27, P28).
 *   pageOrigin / toScreen / toPage are worklets, in the canvas view's own coordinates, which are also
 *   the OverlayHost's coordinates (it is an absolute-fill sibling of the canvas in the same box).
 * - useCanvasHandle(ref, core, ...): the PageCanvasHandle (scrollToPage, zoomTo, currentPageIndex,
 *   visiblePageIds, visiblePageCenter).
 *
 * THREADS: every function marked 'worklet' may run on the UI runtime. JS callers read shared values
 * with .get() (a synchronous read), and write the view with scheduleOnUI so the gestures and the
 * animation stay on one runtime.
 */
import { useImperativeHandle, useMemo, type Ref } from 'react';
import { cancelAnimation, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import type { OverlayContextValue, PageCanvasHandle, PageOrigin, PagePoint } from '@/notebook/contracts/canvas';
import { claimOverlay, overlayBusy, releaseOverlay } from '@/notebook/canvas/overlayContext';
import { LAYOUT_HEADER, layoutCount, layoutScale, nearestPageIndex, remapContentPoint, sameLayout } from '@/notebook/core/canvas/layout';
import {
  clampViewport,
  pageOriginOnScreen,
  screenToContent,
  screenToPage,
  scrollToPage as scrollTarget,
  zoomToCenter,
  type Viewport,
} from '@/notebook/core/canvas/viewport';
import type { Id } from '@/notebook/core/model';

/** Animated scroll / zoom duration of the handle (ms). */
export const NAV_ANIM_MS = 280;

export interface CanvasCore {
  /** Zoom 1..4. */
  scale: SharedValue<number>;
  /** Pan: screen = content x scale + (tx, ty). */
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  /** core/canvas/layout.ts flat layout. */
  layout: SharedValue<number[]>;
  /** Page ids in layout order. */
  pageIds: SharedValue<string[]>;
  /** The canvas view size (screen px). */
  viewW: SharedValue<number>;
  viewH: SharedValue<number>;
  /** Physical content insets [top, bottom, left, right]. */
  insets: SharedValue<number[]>;
  /** True while a pan / pinch / fling / animated scroll moves the view (tiles wait for the settle). */
  moving: SharedValue<boolean>;
  /** True while a navigation gesture is active (a new finger stroke does not start). */
  navActive: SharedValue<boolean>;
  /** False until the first layout was applied (the initial scroll position is set then). */
  placed: SharedValue<boolean>;
}

export function useCanvasCore(): CanvasCore {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const layout = useSharedValue<number[]>([1, 0, 0, 0]);
  const pageIds = useSharedValue<string[]>([]);
  const viewW = useSharedValue(0);
  const viewH = useSharedValue(0);
  const insets = useSharedValue<number[]>([0, 0, 0, 0]);
  const moving = useSharedValue(false);
  const navActive = useSharedValue(false);
  const placed = useSharedValue(false);
  return useMemo(
    () => ({ scale, tx, ty, layout, pageIds, viewW, viewH, insets, moving, navActive, placed }),
    [scale, tx, ty, layout, pageIds, viewW, viewH, insets, moving, navActive, placed],
  );
}

// ===== worklet helpers over the core

export function viewportOf(c: CanvasCore): Viewport {
  'worklet';
  return { scale: c.scale.get(), tx: c.tx.get(), ty: c.ty.get() };
}

export function viewOf(c: CanvasCore): { w: number; h: number } {
  'worklet';
  return { w: c.viewW.get(), h: c.viewH.get() };
}

export function insetsOf(c: CanvasCore): { top: number; bottom: number; left: number; right: number } {
  'worklet';
  const i = c.insets.get();
  return { top: i[0] ?? 0, bottom: i[1] ?? 0, left: i[2] ?? 0, right: i[3] ?? 0 };
}

/** Writes a viewport (no animation). */
export function setViewport(c: CanvasCore, vp: Viewport): void {
  'worklet';
  c.scale.set(vp.scale);
  c.tx.set(vp.tx);
  c.ty.set(vp.ty);
}

/** Clamps the current viewport into the bounds. */
export function clampCurrent(c: CanvasCore): void {
  'worklet';
  setViewport(c, clampViewport(viewportOf(c), c.layout.get(), viewOf(c), insetsOf(c)));
}

/**
 * Stops a fling or an animated scroll. A cancelled animation's callback reports done = false and so
 * leaves `moving` alone, which is why it is cleared here (the caller sets it again when it moves).
 */
export function stopMotion(c: CanvasCore): void {
  'worklet';
  cancelAnimation(c.scale);
  cancelAnimation(c.tx);
  cancelAnimation(c.ty);
  c.moving.set(false);
}

/**
 * Applies a new layout (UI runtime). The content point under the middle of the view stays put, so a
 * page above that loads its real size, or a dock that narrows the band, does not move what the student
 * is looking at. The first layout scrolls to the top of the first page.
 */
export function applyLayout(c: CanvasCore, next: number[], ids: string[], viewW: number, viewH: number, insets: number[]): void {
  'worklet';
  const prev = c.layout.get();
  const prevIds = c.pageIds.get();
  c.viewW.set(viewW);
  c.viewH.set(viewH);
  c.insets.set(insets);
  c.pageIds.set(ids);
  if (!c.placed.get() || layoutCount(prev) === 0) {
    c.layout.set(next);
    if (layoutCount(next) > 0 && viewW > 0) {
      setViewport(c, clampViewport({ scale: 1, tx: 0, ty: Number.POSITIVE_INFINITY }, next, { w: viewW, h: viewH }, insetsOf(c)));
      c.placed.set(true);
    }
    return;
  }
  if (sameLayout(prev, next)) {
    clampCurrent(c);
    return;
  }
  // Keep the middle of the view on the same page point. When the page list changed (add, delete,
  // move), anchor on the same page id instead of the same index.
  const vp = viewportOf(c);
  const mid = screenToContent(vp, viewW / 2, viewH / 2);
  let target = remapContentPoint(prev, next, mid[0], mid[1]);
  const i = nearestPageIndex(prev, mid[1]);
  if (i >= 0 && prevIds[i] !== undefined && ids[i] !== prevIds[i]) {
    const j = ids.indexOf(prevIds[i]);
    if (j >= 0) {
      const bf = LAYOUT_HEADER + i * 4;
      const bt = LAYOUT_HEADER + j * 4;
      const kf = layoutScale(prev);
      const kt = layoutScale(next);
      target = [next[bt] + ((mid[0] - prev[bf]) / kf) * kt, next[bt + 1] + ((mid[1] - prev[bf + 1]) / kf) * kt];
    }
  }
  c.layout.set(next);
  setViewport(c, clampViewport({ scale: vp.scale, tx: viewW / 2 - target[0] * vp.scale, ty: viewH / 2 - target[1] * vp.scale }, next, { w: viewW, h: viewH }, insetsOf(c)));
}

// ===== overlay context

export function useOverlayValue(c: CanvasCore): OverlayContextValue {
  return useMemo(() => {
    const pageOrigin = (pageId: Id): PageOrigin | null => {
      'worklet';
      const i = c.pageIds.get().indexOf(pageId);
      const o = pageOriginOnScreen(c.layout.get(), viewportOf(c), i);
      return o ? { x: o[0], y: o[1], k: o[2] } : null;
    };
    const toScreen = (pageId: Id, x: number, y: number): { x: number; y: number } | null => {
      'worklet';
      const i = c.pageIds.get().indexOf(pageId);
      const o = pageOriginOnScreen(c.layout.get(), viewportOf(c), i);
      return o ? { x: o[0] + x * o[2], y: o[1] + y * o[2] } : null;
    };
    const toPage = (sx: number, sy: number): PagePoint | null => {
      'worklet';
      const hit = screenToPage(c.layout.get(), viewportOf(c), sx, sy);
      if (!hit) return null;
      const id = c.pageIds.get()[hit.index];
      return id === undefined ? null : { pageId: id, x: hit.x, y: hit.y, pressure: 0.5, pointer: 'touch' };
    };
    return { scale: c.scale, tx: c.tx, ty: c.ty, pageOrigin, toScreen, toPage, overlayBusy, claimOverlay, releaseOverlay };
  }, [c]);
}

// ===== handle

export interface CanvasHandleDeps {
  /** The current page index as last reported by the canvas (JS). */
  currentIndex(): number;
  /** The visible page range [first, last] as last reported (JS). */
  visibleRange(): readonly number[];
}

function scrollWorklet(c: CanvasCore, index: number, animated: boolean): void {
  'worklet';
  stopMotion(c);
  const t = scrollTarget(c.layout.get(), viewportOf(c), index, viewOf(c), insetsOf(c));
  if (animated) {
    c.moving.set(true);
    c.tx.set(withTiming(t.tx, { duration: NAV_ANIM_MS }));
    c.ty.set(
      withTiming(t.ty, { duration: NAV_ANIM_MS }, (done) => {
        'worklet';
        if (done) c.moving.set(false);
      }),
    );
  } else {
    setViewport(c, t);
  }
}

function zoomWorklet(c: CanvasCore, s: number): void {
  'worklet';
  stopMotion(c);
  const t = zoomToCenter(viewportOf(c), s, c.layout.get(), viewOf(c), insetsOf(c));
  c.moving.set(true);
  c.scale.set(withTiming(t.scale, { duration: NAV_ANIM_MS }));
  c.tx.set(withTiming(t.tx, { duration: NAV_ANIM_MS }));
  c.ty.set(
    withTiming(t.ty, { duration: NAV_ANIM_MS }, (done) => {
      'worklet';
      if (done) c.moving.set(false);
    }),
  );
}

/** Scrolls to page index on the UI runtime (JS entry point). */
export function scrollCanvasToPage(c: CanvasCore, index: number, animated: boolean): void {
  scheduleOnUI(scrollWorklet, c, index, animated);
}

/** The page point at the middle of the visible band (JS), clamped onto the nearest page. */
export function visibleCenterPoint(c: CanvasCore): PagePoint | null {
  const layout = c.layout.get();
  const ids = c.pageIds.get();
  if (layoutCount(layout) === 0) return null;
  const ins = c.insets.get();
  const w = c.viewW.get();
  const h = c.viewH.get();
  const vp = { scale: c.scale.get(), tx: c.tx.get(), ty: c.ty.get() };
  const sx = ((ins[2] ?? 0) + w - (ins[3] ?? 0)) / 2;
  const sy = ((ins[0] ?? 0) + h - (ins[1] ?? 0)) / 2;
  const cpt = screenToContent(vp, sx, sy);
  const i = nearestPageIndex(layout, cpt[1]);
  const id = ids[i];
  if (i < 0 || id === undefined) return null;
  const b = LAYOUT_HEADER + i * 4;
  const k = layoutScale(layout);
  const pw = layout[b + 2] / k;
  const ph = layout[b + 3] / k;
  const x = Math.min(pw, Math.max(0, (cpt[0] - layout[b]) / k));
  const y = Math.min(ph, Math.max(0, (cpt[1] - layout[b + 1]) / k));
  return { pageId: id, x, y, pressure: 0.5, pointer: 'touch' };
}

export function useCanvasHandle(ref: Ref<PageCanvasHandle> | undefined, c: CanvasCore, deps: CanvasHandleDeps): void {
  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(index: number, animated: boolean = true) {
        scrollCanvasToPage(c, index, animated);
      },
      zoomTo(scale: number) {
        scheduleOnUI(zoomWorklet, c, scale);
      },
      currentPageIndex() {
        return deps.currentIndex();
      },
      visiblePageIds() {
        const r = deps.visibleRange();
        const ids = c.pageIds.get();
        if (r[0] < 0 || r[1] < r[0]) return [];
        return ids.slice(r[0], r[1] + 1);
      },
      visiblePageCenter() {
        return visibleCenterPoint(c);
      },
    }),
    [c, deps],
  );
}
