/**
 * The editor's tools (P29): builds the ToolContext and collects the tool plugins of P27 and P28 into
 * what PageCanvas and the toolbar take.
 *
 * ToolContext = { session, recMark: () => recorder.mark(session.id) (undefined unless this notebook is
 * recording, ruling (o)), canvas: the PageCanvas handle getter, hand }.
 *
 * Plugins:
 * - P27 useSelectionTool (the lasso: handler + SelectionOverlay, mounted for every tool) and
 *   useImageTool (an ACTION: openSource for the toolbar's onImage, plus its sheets to render).
 * - P28 useShapeTool (handler + live preview). (Hold-to-snap was removed: a pen stroke stays as drawn.)
 *   useRulerTool (exactly one per editor; the sole writer of ruler.visible) and useTextTool (handler +
 *   the text editor overlay).
 * Every overlay is rendered all the time, in OverlayHost (absolute fill, box-none); each one draws
 * nothing while it is not needed.
 *
 * toolHandlers: lasso, shapes and text (pen, highlighter, eraser and play are the canvas's own). A
 * read-only notebook gets none, and no snap: the canvas has no tools there (it ignores drawing too).
 *
 * onActivate / onDeactivate: called here when toolState.tool changes (the plugins' contract), and the
 * current tool's onDeactivate when the editor goes (the text tool writes the box being edited).
 *
 * onPencilAction: the Pencil double tap / squeeze (already mapped by the canvas from the settings)
 * toggles the eraser or the last tool through toolState.toggleEraser.
 */
import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { recorder } from '@/notebook/audio/recorder';
import type { PageCanvasHandle } from '@/notebook/contracts/canvas';
import type { ToolContext, ToolId, ToolPlugin, ToolPointerHandler } from '@/notebook/contracts/tools';
import type { RecMark } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { getToolState, subscribeToolState, toolActions } from '@/notebook/toolbar/toolState';
import { useImageTool } from '@/notebook/tools/image/useImageTool';
import { useRulerTool } from '@/notebook/tools/ruler/useRulerTool';
import { useSelectionTool } from '@/notebook/tools/selection/useSelectionTool';
import { useShapeTool } from '@/notebook/tools/shapes/useShapeTool';
import { useTextTool } from '@/notebook/tools/text/useTextTool';

export interface ToolPluginsOptions {
  /** Where the ruler's first-use hint sits from the top of the canvas (below the header / top bar). */
  rulerHintTop?: number;
}

export interface EditorTools {
  ctx: ToolContext;
  recMark: () => RecMark | undefined;
  toolHandlers: Partial<Record<ToolId, ToolPointerHandler>>;
  /** Every tool overlay, for PageCanvas `overlays`. */
  overlays: ReactNode;
  onPencilAction: (a: 'eraser' | 'lastTool') => void;
  /** The toolbar's image button. */
  openImage: () => void;
  /** The image source and crop sheets (render once, outside the canvas). */
  sheets: ReactNode;
}

export function useToolPlugins(
  session: NotebookSession,
  canvas: () => PageCanvasHandle | null,
  hand: 'right' | 'left',
  o: ToolPluginsOptions = {},
): EditorTools {
  const recMark = useCallback(() => recorder.mark(session.id), [session]);
  // The getter is read late (when a tool needs the canvas), so a new function each render is fine,
  // but the context object must stay the same between renders.
  const canvasGetter = useRef(canvas);
  useEffect(() => {
    canvasGetter.current = canvas;
  });
  const getCanvas = useCallback(() => canvasGetter.current(), []);
  const ctx = useMemo<ToolContext>(() => ({ session, recMark, canvas: getCanvas, hand }), [session, recMark, getCanvas, hand]);

  const selection = useSelectionTool(ctx);
  const image = useImageTool(ctx);
  const shapes = useShapeTool(ctx);
  const ruler = useRulerTool(ctx, { hintTop: o.rulerHintTop });
  const text = useTextTool(ctx);

  const readOnly = session.readOnly;

  // The pointer tools and their activation hooks, by ToolId.
  const byTool = useMemo<Partial<Record<ToolId, ToolPlugin>>>(
    () => ({ lasso: selection, shapes, text }),
    [selection, shapes, text],
  );
  const byToolRef = useRef(byTool);
  useEffect(() => {
    byToolRef.current = byTool;
  });

  useEffect(() => {
    let current = getToolState().state.tool;
    byToolRef.current[current]?.onActivate?.();
    const unsub = subscribeToolState(() => {
      const next = getToolState().state.tool;
      if (next === current) return;
      const prev = current;
      current = next;
      byToolRef.current[prev]?.onDeactivate?.();
      byToolRef.current[next]?.onActivate?.();
    });
    return () => {
      unsub();
      byToolRef.current[current]?.onDeactivate?.();
    };
  }, [session]);

  const toolHandlers = useMemo<Partial<Record<ToolId, ToolPointerHandler>>>(() => {
    if (readOnly) return {};
    const h: Partial<Record<ToolId, ToolPointerHandler>> = {};
    if (selection.handler) h.lasso = selection.handler;
    if (shapes.handler) h.shapes = shapes.handler;
    if (text.handler) h.text = text.handler;
    return h;
  }, [readOnly, selection.handler, shapes.handler, text.handler]);

  // Bottom to top: shape preview, ruler, selection (handles and menu), text editor.
  const overlays = useMemo(
    () =>
      createElement(
        Fragment,
        null,
        createElement(Fragment, { key: 'shapes' }, shapes.overlay),
        createElement(Fragment, { key: 'ruler' }, ruler.overlay),
        createElement(Fragment, { key: 'selection' }, selection.overlay),
        createElement(Fragment, { key: 'text' }, text.overlay),
      ),
    [shapes.overlay, ruler.overlay, selection.overlay, text.overlay],
  );

  const onPencilAction = useCallback((a: 'eraser' | 'lastTool') => toolActions.toggleEraser(a), []);

  return {
    ctx,
    recMark,
    toolHandlers,
    overlays,
    onPencilAction,
    openImage: image.openSource,
    sheets: image.sheets,
  };
}
