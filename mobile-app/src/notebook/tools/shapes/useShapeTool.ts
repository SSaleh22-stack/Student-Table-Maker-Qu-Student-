/**
 * Coordinates (checked by P30 against P22 useCanvasApi.ts): pageOrigin is in the canvas view's own
 * coordinates, which are also the OverlayHost's. This overlay's root (an absolute-fill child of
 * OverlayHost) shares them. The pointer handler only receives page points (PagePoint), so nothing
 * else here depends on screen coordinates.
 *
 * The shape tool (P28, NB-44 'There is also a shape tool for drawing shapes directly').
 *
 * useShapeTool(ctx) returns the 'shapes' ToolPlugin:
 * - handler (JS; the canvas calls it through scheduleOnRN while 'shapes' is the tool): drag from one
 *   corner (or end) of the shape to the other. toolState.shapeKind picks the shape (line, arrow, rect,
 *   ellipse, triangle). A rectangle becomes a square, an ellipse a circle, when the sides are within
 *   10 percent of each other. On release the shape is added in ONE history entry ('shape'), in the
 *   pen's color and width (the Shapes card says so), with the recording mark.
 * - overlay: the live preview while dragging (a Skia path in page points under the page transform, so
 *   it stays sharp at any zoom). It renders nothing unless 'shapes' is the current tool.
 *
 * The drag and its preview live in a small store per hook, so a 60 Hz drag re-renders only the
 * preview, never the editor.
 *
 * Color: the pen color as it shows on this page (core/toolbar/colors.ts effectivePenColor), so a black
 * pen on dark paper draws a visible light shape, like the pen's own ink.
 */
import { Canvas, Group, Path } from '@shopify/react-native-skia';
import { createElement, useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { useOverlay } from '@/notebook/canvas/overlayContext';
import type { PagePoint, ToolContext, ToolPlugin, ToolState, UseShapeTool } from '@/notebook/contracts/tools';
import { newId, type Hex, type Id, type Page, type PaperColor, type RecMark, type ShapeItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { shapeOutline } from '@/notebook/core/shapes/recognize';
import { effectivePenColor } from '@/notebook/core/toolbar/colors';
import { getToolState, useToolState } from '@/notebook/toolbar/toolState';

/** A drag shorter than this (page points, on both axes / along the line) adds nothing. */
export const SHAPE_MIN_DRAG = 4;

/** Sides within this fraction of the longer one make a square or a circle. */
export const SHAPE_EQUAL_RATIO = 0.1;

/** History label of a drawn shape. */
export const SHAPE_HISTORY_LABEL = 'shape';

type ShapeToolKind = ToolState['shapeKind'];

export interface ShapeStyleInput {
  color: Hex;
  width: number;
}

/**
 * The shape for a drag from (x0, y0) to (x1, y1) in page points, or null when the drag is too short.
 * - line, arrow: pts [x0, y0, x1, y1] (an arrow points at the release point).
 * - rect, ellipse: the dragged box (rot 0); within SHAPE_EQUAL_RATIO it becomes a square or circle
 *   whose side is the longer one, growing from the start corner in the drag direction.
 * - triangle: the dragged box's isosceles triangle (apex at the top middle) as 3 vertices.
 */
export function shapeFromDrag(kind: ShapeToolKind, x0: number, y0: number, x1: number, y1: number, style: ShapeStyleInput, id: Id): ShapeItem | null {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const base = { id, kind: 'shape' as const, color: style.color, width: style.width, fill: null };
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (kind === 'line' || kind === 'arrow') {
    if (Math.hypot(dx, dy) < SHAPE_MIN_DRAG) return null;
    return { ...base, shape: kind, pts: [x0, y0, x1, y1] };
  }
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (Math.max(w, h) < SHAPE_MIN_DRAG) return null;
  if (kind !== 'triangle') {
    const long = Math.max(w, h);
    if (long - Math.min(w, h) <= SHAPE_EQUAL_RATIO * long) {
      w = long;
      h = long;
    }
  }
  const x = dx >= 0 ? x0 : x0 - w;
  const y = dy >= 0 ? y0 : y0 - h;
  if (kind === 'triangle') {
    return { ...base, shape: 'triangle', pts: [x + w / 2, y, x + w, y + h, x, y + h] };
  }
  return { ...base, shape: kind, box: { x, y, w, h, rot: 0 } };
}

/** The paper color of a page (PDF pages count as white). */
export function paperColorOf(page: Page | undefined): PaperColor {
  if (!page) return 'white';
  const bg = page.background;
  return bg.kind === 'pdf' ? 'white' : bg.paper.color;
}

/** An SVG path (page points) that draws a shape's centerline, arrow head included. */
export function shapePathString(s: Pick<ShapeItem, 'shape' | 'pts' | 'box' | 'width'>): string {
  let d = '';
  for (const part of shapeOutline(s)) {
    const p = part.pts;
    if (p.length < 4) continue;
    d += `M${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
    for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i].toFixed(2)} ${p[i + 1].toFixed(2)}`;
    if (part.closed) d += 'Z';
  }
  return d;
}

// ===== drag and preview store (one per hook)

export interface ShapeDraft {
  pageId: Id;
  item: ShapeItem;
}

/**
 * The drag in progress (start and last point) and the preview it draws. It lives outside the handler,
 * so a handler rebuilt for a new recMark function keeps a drag that is under way.
 */
interface DraftStore {
  get(): ShapeDraft | null;
  set(d: ShapeDraft | null): void;
  subscribe(cb: () => void): () => void;
  /** Ends the drag in progress and clears the preview (a tool change). */
  reset(): void;
  drag: { start: PagePoint | null; last: PagePoint | null };
}

function createDraftStore(): DraftStore {
  let draft: ShapeDraft | null = null;
  const listeners = new Set<() => void>();
  const drag: DraftStore['drag'] = { start: null, last: null };
  const set = (d: ShapeDraft | null) => {
    if (d === draft) return;
    draft = d;
    for (const cb of [...listeners]) cb();
  };
  return {
    get: () => draft,
    set,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    reset() {
      drag.start = null;
      drag.last = null;
      set(null);
    },
    drag,
  };
}

// ===== handler

function makeHandler(session: NotebookSession, recMark: () => RecMark | undefined, store: DraftStore) {
  const drag = store.drag;

  const styleFor = (pageId: Id): ShapeStyleInput => {
    const pen = getToolState().state.pen;
    return { color: effectivePenColor(pen.color, paperColorOf(session.getPage(pageId))), width: pen.width };
  };

  const build = (id: Id): ShapeItem | null => {
    const { start, last } = drag;
    if (!start || !last) return null;
    const kind = getToolState().state.shapeKind;
    return shapeFromDrag(kind, start.x, start.y, last.x, last.y, styleFor(start.pageId), id);
  };

  return {
    onBegin(p: PagePoint) {
      drag.start = p;
      drag.last = p;
      store.set(null);
    },
    onUpdate(p: PagePoint) {
      const start = drag.start;
      if (!start || p.pageId !== start.pageId) return;
      drag.last = p;
      const item = build('preview');
      store.set(item ? { pageId: start.pageId, item } : null);
    },
    onEnd(p: PagePoint, cancelled: boolean) {
      if (drag.start && p.pageId === drag.start.pageId) drag.last = p;
      const pageId = drag.start?.pageId;
      const item = cancelled || session.readOnly ? null : build(newId());
      drag.start = null;
      drag.last = null;
      store.set(null);
      if (!item || !pageId) return;
      const rec = recMark();
      if (rec) item.rec = { recordingId: rec.recordingId, ms: rec.ms };
      item.at = Date.now();
      session.addItems(pageId, [item], SHAPE_HISTORY_LABEL);
    },
  };
}

// ===== preview overlay

interface ShapePreviewProps {
  store: DraftStore;
}

function PreviewPath({ draft }: { draft: ShapeDraft }) {
  const { scale, tx, ty, pageOrigin } = useOverlay();
  const pageId = draft.pageId;
  const transform = useDerivedValue(() => {
    // Read the view transform explicitly so the preview follows zoom and scroll.
    scale.get();
    tx.get();
    ty.get();
    const o = pageOrigin(pageId);
    if (!o) return [{ translateX: -100000 }, { translateY: -100000 }, { scale: 1 }];
    return [{ translateX: o.x }, { translateY: o.y }, { scale: o.k }];
  }, [pageId]);
  const d = shapePathString(draft.item);
  if (!d) return null;
  return createElement(
    Group,
    { transform },
    createElement(Path, {
      path: d,
      style: 'stroke',
      strokeWidth: draft.item.width,
      strokeCap: 'round',
      strokeJoin: 'round',
      color: draft.item.color,
    }),
  );
}

/** The live preview of the shape being dragged (only while 'shapes' is the tool). */
export function ShapePreview({ store }: ShapePreviewProps) {
  const { state } = useToolState();
  const draft = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (state.tool !== 'shapes') return null;
  return createElement(
    View,
    { pointerEvents: 'none', style: StyleSheet.absoluteFill },
    createElement(Canvas, { style: StyleSheet.absoluteFill }, draft ? createElement(PreviewPath, { draft }) : null),
  );
}

export const useShapeTool: UseShapeTool = (ctx: ToolContext): ToolPlugin => {
  const { session, recMark } = ctx;
  const store = useMemo(() => createDraftStore(), []);
  // The drag in progress lives in the store, so rebuilding the handler (a new recMark) keeps it.
  const handler = useMemo(() => makeHandler(session, recMark, store), [session, recMark, store]);
  const overlay = useMemo(() => createElement(ShapePreview, { store }), [store]);
  return {
    tool: 'shapes',
    handler,
    overlay,
    // A tool change ends any drag in progress: a late onUpdate / onEnd then finds no start and adds nothing.
    onDeactivate: () => store.reset(),
  };
};
