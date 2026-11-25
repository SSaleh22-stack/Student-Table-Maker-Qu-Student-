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
 * - The live preview while dragging is drawn by the canvas itself, on the UI runtime, from the same
 *   geometry (core/shapes/drag.ts; canvas/gestures.ts previewShape), in the pen's colour and width, so
 *   it follows the pencil with no delay. It stays until the added shape is on screen.
 *
 * The drag lives in a small store per hook, so a handler rebuilt for a new recMark keeps it.
 *
 * Color: the pen color as it shows on this page (core/toolbar/colors.ts effectivePenColor), so a black
 * pen on dark paper draws a visible light shape, like the pen's own ink.
 */
import { useMemo } from 'react';

import type { PagePoint, ToolContext, ToolPlugin, UseShapeTool } from '@/notebook/contracts/tools';
import { newId, type Id, type Page, type PaperColor, type RecMark, type ShapeItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { shapeFromDrag, type ShapeStyleInput } from '@/notebook/core/shapes/drag';
import { shapeOutline } from '@/notebook/core/shapes/recognize';
import { effectivePenColor } from '@/notebook/core/toolbar/colors';
import { getToolState } from '@/notebook/toolbar/toolState';

export { SHAPE_EQUAL_RATIO, SHAPE_MIN_DRAG, shapeFromDrag, type ShapeStyleInput } from '@/notebook/core/shapes/drag';

/** History label of a drawn shape. */
export const SHAPE_HISTORY_LABEL = 'shape';

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
      // The live preview is drawn by the canvas gesture on the UI runtime (wetInk setShapePreview).
      drag.last = p;
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

export const useShapeTool: UseShapeTool = (ctx: ToolContext): ToolPlugin => {
  const { session, recMark } = ctx;
  const store = useMemo(() => createDraftStore(), []);
  // The drag in progress lives in the store, so rebuilding the handler (a new recMark) keeps it.
  const handler = useMemo(() => makeHandler(session, recMark, store), [session, recMark, store]);
  return {
    tool: 'shapes',
    handler,
    // A tool change ends any drag in progress: a late onUpdate / onEnd then finds no start and adds nothing.
    onDeactivate: () => store.reset(),
  };
};
