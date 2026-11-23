/**
 * Canvas contract (P04): the page canvas, its handle, and the shared canvas stores' types.
 *
 * Implementers:
 * - PageCanvas: P22 src/notebook/canvas/PageCanvas.tsx exports `PageCanvas: PageCanvasComponent`
 *   (React 19: the handle arrives through the `ref` prop).
 * - OverlayContext, overlayBusy, claimOverlay, releaseOverlay: P04 src/notebook/canvas/overlayContext.ts
 *   (P22 provides the real value; overlays read it with useOverlay()).
 * - Selection store: P04 src/notebook/canvas/selection.ts (useSelection, getSelection).
 * - Ruler store: P04 src/notebook/canvas/ruler.ts (useRuler, getRuler).
 * - Hold signal: P04 src/notebook/canvas/holdSignal.ts (holdSignal, setCandidate, useCandidate).
 *
 * Gesture arbitration (ruling (p)): overlays are SIBLING views above the canvas (pointerEvents
 * 'box-none', real hit areas only). An overlay gesture calls claimOverlay() in onBegin and
 * releaseOverlay() in onFinalize; canvas gestures fail in onBegin while overlayBusy > 0. Nav and the
 * undo/redo taps fail when both pointers start inside RulerApi.hitTest.
 *
 * "Screen px" everywhere in this file (OverlayContext pageOrigin / toScreen / toPage, RulerApi cx / cy,
 * HoldSignal sx / sy) means the canvas view's OWN coordinates: origin at the top-left of the PageCanvas
 * box, physical (never mirrored in RTL), in layout points. OverlayHost is an absolute-fill sibling of
 * the canvas in the same box, so an absolute-fill overlay root shares this space. They are NOT window
 * coordinates: an RNGH event's x / y are relative to the view the gesture is attached to, and
 * absoluteX / absoluteY are window coordinates, so a gesture on another view converts first.
 */
import type { ComponentType, ReactNode, Ref } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import type { Id, NotebookSettings, RecMark } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import type { PagePoint, ShapeSnapEvent, SnapCandidate, ToolId, ToolPointerHandler, ToolState } from '@/notebook/core/contracts/tools';

export type { PagePoint, ShapeSnapEvent, SnapCandidate } from '@/notebook/core/contracts/tools';

/** Content insets in PHYSICAL edges (left is always the screen's left), e.g. toolbar and dock. */
export interface PhysicalInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type CanvasInput = Pick<NotebookSettings, 'input' | 'fingerDraws' | 'hand' | 'pencilDoubleTap' | 'pencilSqueeze' | 'shapeSnap'>;

export interface PageCanvasProps {
  session: NotebookSession;
  tools: ToolState;
  input: CanvasInput;
  /** undefined unless the recorder is recording THIS notebook (ruling (o)). */
  recMark?: () => RecMark | undefined;
  /** Playback dimming: ink after `ms` of that recording is drawn dimmed. */
  playback?: { recordingId: Id; ms: SharedValue<number> } | null;
  /** JS-side handlers for lasso, shapes and text (pen, highlighter, eraser and play are the canvas's own). */
  toolHandlers?: Partial<Record<ToolId, ToolPointerHandler>>;
  onShapeSnap?(e: ShapeSnapEvent): void;
  onPlayFrom?(mark: RecMark): void;
  /** 2-finger tap. */
  onUndo(): void;
  /** 3-finger tap. */
  onRedo(): void;
  onPageChange?(index: number, pageId: Id): void;
  onZoomChange?(scale: number): void;
  onPencilAction?(a: 'eraser' | 'lastTool'): void;
  /** Rendered in OverlayHost as sibling views above the canvas, inside the OverlayContext provider. */
  overlays?: ReactNode;
  contentInsets: PhysicalInsets;
}

export interface PageCanvasHandle {
  scrollToPage(index: number, animated?: boolean): void;
  zoomTo(scale: number): void;
  currentPageIndex(): number;
  visiblePageIds(): Id[];
  /** The centre of the visible area as a page point (where pasted or inserted things go). */
  visiblePageCenter(): PagePoint | null;
}

export type PageCanvasComponent = ComponentType<PageCanvasProps & { ref?: Ref<PageCanvasHandle> }>;

// ===== OverlayContext (canvas/overlayContext.ts)

/**
 * Where a page sits on screen: its top-left corner in screen px (canvas view coordinates) and
 * k = screen px per page point. It already includes scale / tx / ty, so an animated style that uses it
 * should also read scale, tx and ty to re-run on zoom and scroll.
 */
export interface PageOrigin {
  x: number;
  y: number;
  k: number;
}

export interface OverlayContextValue {
  /** The view transform (zoom and pan), written by the canvas on the UI runtime. */
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  /** Worklets (callable on both runtimes). null for a page that is not laid out / not visible. */
  pageOrigin(pageId: Id): PageOrigin | null;
  toScreen(pageId: Id, x: number, y: number): { x: number; y: number } | null;
  /** The page under a screen point (pressure 0.5, pointer 'touch'), or null between pages. */
  toPage(sx: number, sy: number): PagePoint | null;
  /** Number of overlay gestures in progress; canvas gestures fail while it is > 0. */
  overlayBusy: SharedValue<number>;
  /** Worklet: overlayBusy + 1. Call in the overlay gesture's onBegin. */
  claimOverlay(): void;
  /** Worklet: overlayBusy - 1 (never below 0). Call in onFinalize, so a cancelled gesture releases too. */
  releaseOverlay(): void;
}

// ===== selection (canvas/selection.ts)

/** Cached: the same object until the selection changes. */
export interface SelectionSnapshot {
  readonly pageId: Id | null;
  readonly ids: readonly Id[];
  /** Increases on every change. */
  readonly version: number;
}

export interface SelectionApi extends SelectionSnapshot {
  /** Selects ids on one page (an empty list clears). Same page and same ids: no change, no notify. */
  select(pageId: Id, ids: readonly Id[]): void;
  clear(): void;
  subscribe(cb: () => void): () => void;
  getSnapshot(): SelectionSnapshot;
  /**
   * The live drag/resize/rotate transform of the selection while a handle is held, as a flat
   * [a, b, c, d, e, f] page-space matrix (core/ink/matrix.ts); [] when nothing is being dragged.
   * Written on the UI runtime by P27; read by the canvas painter.
   */
  drag: SharedValue<number[]>;
  /** Item ids the canvas skips while they are drawn elsewhere (dragged, erased live, edited as text). */
  hidden: SharedValue<string[]>;
}

// ===== ruler (canvas/ruler.ts)

export interface RulerApi {
  /** Mirrors toolState.rulerOn; written ONLY by P28 useRulerTool. */
  visible: SharedValue<boolean>;
  /** Centre in screen px and angle in radians (screen space, y down). */
  cx: SharedValue<number>;
  cy: SharedValue<number>;
  angle: SharedValue<number>;
  /** Screen px. */
  readonly length: number;
  readonly width: number;
  /** Worklet: true when the ruler is visible and (sx, sy) is on it (core/geom/rulerHit.ts rulerContains). */
  hitTest(sx: number, sy: number): boolean;
}

// ===== hold signal (canvas/holdSignal.ts)

export interface HoldSignal {
  /** Hold ring progress 0..1 (UI-written by P22). */
  progress: SharedValue<number>;
  /** The pen point in screen px (UI-written), where the hint is placed. */
  sx: SharedValue<number>;
  sy: SharedValue<number>;
  /** true while the hold is running with a candidate on screen (UI-written). */
  active: SharedValue<boolean>;
  /** JS ONLY (from a worklet: scheduleOnRN(setCandidate, candidate)). Same candidate again: no notify. */
  setCandidate(c: SnapCandidate | null): void;
  /** Cached: the same object (or null) until the candidate changes. */
  getSnapshot(): SnapCandidate | null;
  subscribe(cb: () => void): () => void;
}
