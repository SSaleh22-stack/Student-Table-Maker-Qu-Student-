/**
 * Tool contract (P04): re-exports the pure tool types and adds the React-facing ones.
 *
 * Implementers (each exports a function with the name of its type, minus the leading capital):
 * - P13 src/notebook/toolbar/toolState.ts: `useToolState: UseToolState`, `getToolState: GetToolState`
 * - P27 src/notebook/tools/selection/useSelectionTool.ts: `useSelectionTool: UseSelectionTool`
 * - P27 src/notebook/tools/image/useImageTool.ts: `useImageTool: UseImageTool`
 * - P28 src/notebook/tools/shapes/useShapeTool.ts: `useShapeTool: UseShapeTool`
 * - P28 src/notebook/tools/shapes/useShapeSnap.ts: `useShapeSnap: UseShapeSnap`
 * - P28 src/notebook/tools/ruler/useRulerTool.ts: `useRulerTool: UseRulerTool` (the SOLE writer of
 *   ruler.visible, mirroring toolState.rulerOn)
 * - P28 src/notebook/tools/text/useTextTool.ts: `useTextTool: UseTextTool`
 * - P29 src/notebook/editor/useToolPlugins.ts builds the ToolContext and collects the plugins.
 */
import type { ReactNode } from 'react';

import type { RecMark } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import type { ShapeSnapEvent, ToolActions, ToolId, ToolPointerHandler, ToolState } from '@/notebook/core/contracts/tools';

import type { PageCanvasHandle } from './canvas';

export type {
  PagePoint,
  PointerKind,
  ShapeSnapEvent,
  SnapCandidate,
  SnapVariant,
  ToolActions,
  ToolId,
  ToolPointerHandler,
  ToolState,
} from '@/notebook/core/contracts/tools';
export { TOOL_IDS, isToolId } from '@/notebook/core/contracts/tools';

/** What every tool hook gets from the editor. */
export interface ToolContext {
  session: NotebookSession;
  /** undefined unless the recorder is recording THIS notebook (recorder.mark(session.id)). */
  recMark(): RecMark | undefined;
  canvas(): PageCanvasHandle | null;
  hand: 'right' | 'left';
}

export interface ToolPlugin {
  tool: ToolId | 'ruler' | 'snap';
  /** Pointer handler forwarded by the canvas while `tool` is the current tool. */
  handler?: ToolPointerHandler;
  /** Rendered as a sibling overlay above the canvas (see contracts/canvas.ts arbitration rules). */
  overlay?: ReactNode;
  onActivate?(): void;
  onDeactivate?(): void;
}

/** Tool state plus its actions. `state` is a new object on every change; `actions` is stable. */
export interface ToolStateHandle {
  state: ToolState;
  actions: ToolActions;
}

export type UseToolState = () => ToolStateHandle;
/** Outside React (latest values). */
export type GetToolState = () => ToolStateHandle;

export type UseSelectionTool = (ctx: ToolContext) => ToolPlugin;
export type UseImageTool = (ctx: ToolContext) => ToolPlugin & { openSource(): void; sheets: ReactNode };
export type UseShapeTool = (ctx: ToolContext) => ToolPlugin;
export type UseRulerTool = (ctx: ToolContext) => ToolPlugin;
export type UseTextTool = (ctx: ToolContext) => ToolPlugin;
export type UseShapeSnap = (ctx: ToolContext) => { onShapeSnap(e: ShapeSnapEvent): void; overlay: ReactNode };
