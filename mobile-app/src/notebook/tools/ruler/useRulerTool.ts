/**
 * The ruler (P28, NB-45, Figma 09).
 *
 * useRulerTool(ctx, o?) returns the 'ruler' ToolPlugin. The ruler is not a drawing tool: the toolbar's
 * ruler button toggles toolState.rulerOn (P13), and the pen and highlighter keep drawing while it is
 * shown (the canvas snaps ink along its edges, P22 with core/ink/ruler.ts).
 *
 * - This hook is the SOLE writer of ruler.visible (canvas/ruler.ts): a useEffect mirrors
 *   toolState.rulerOn into the shared value, so the canvas (UI runtime) sees it without JS. When the
 *   editor unmounts the ruler is hidden.
 * - overlay: <RulerOverlay/> (the ruler, its two-finger move and rotate gesture, the angle pill and the
 *   first-use hint). Render it with the other canvas overlays, always (it draws nothing while off).
 * - No onActivate / onDeactivate: 'ruler' is never the current tool, and a tool change must not hide
 *   it. setRulerOn(on) is exported for code that wants to show or hide it.
 *
 * o.hintTop: where the first-use hint sits from the top of the canvas area (px, default 12); pass the
 * canvas's top content inset (header or top toolbar) plus a margin so the hint clears them.
 */
import { createElement, useEffect, useMemo } from 'react';

import { getRuler } from '@/notebook/canvas/ruler';
import type { ToolContext, ToolPlugin, UseRulerTool } from '@/notebook/contracts/tools';
import { getToolState, toolActions, useToolState } from '@/notebook/toolbar/toolState';

import { RulerOverlay } from './RulerOverlay';

export interface RulerToolOptions {
  hintTop?: number;
}

/** Shows or hides the ruler (through toolState, which this hook mirrors). */
export function setRulerOn(on: boolean): void {
  if (getToolState().state.rulerOn !== on) toolActions.toggleRuler();
}

export const useRulerTool = ((_ctx: ToolContext, o?: RulerToolOptions): ToolPlugin => {
  const { state } = useToolState();
  const on = state.rulerOn;
  const hintTop = o?.hintTop;

  // The one place ruler.visible is written.
  useEffect(() => {
    getRuler().visible.set(on);
  }, [on]);
  useEffect(
    () => () => {
      getRuler().visible.set(false);
    },
    [],
  );

  const overlay = useMemo(() => createElement(RulerOverlay, { visible: on, hintTop }), [on, hintTop]);

  return {
    tool: 'ruler',
    overlay,
  };
}) satisfies UseRulerTool;
