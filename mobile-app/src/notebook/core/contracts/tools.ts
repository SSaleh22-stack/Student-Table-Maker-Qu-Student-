/**
 * Tool contract, pure part (P04). Tool state is implemented by P13 (src/notebook/toolbar/toolState.ts);
 * pointer handlers by P27 and P28; the canvas (P22) produces PagePoints and ShapeSnapEvents.
 * React-facing tool types (ToolContext, ToolPlugin) are in src/notebook/contracts/tools.ts.
 */
import type { Hex, Id, ShapeItem, ShapeKind } from '../model/index.ts';

/** 'image' is NOT a tool: it is an action (Toolbar.onImage -> useImageTool().openSource()). */
export type ToolId = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shapes' | 'text' | 'play';

export const TOOL_IDS: readonly ToolId[] = ['pen', 'highlighter', 'eraser', 'lasso', 'shapes', 'text', 'play'];

export function isToolId(v: unknown): v is ToolId {
  return typeof v === 'string' && (TOOL_IDS as readonly string[]).includes(v);
}

export type PointerKind = 'stylus' | 'touch' | 'mouse';

/** A pointer position on a page, in page points (top-left origin, y down). pressure is 0..1 (0.5 without one). */
export interface PagePoint {
  pageId: Id;
  x: number;
  y: number;
  pressure: number;
  pointer: PointerKind;
}

/**
 * JS-side pointer callbacks for the lasso, shapes and text tools. P22 calls them through scheduleOnRN
 * (about 60 Hz for updates); they are never worklets.
 */
export interface ToolPointerHandler {
  onBegin?(p: PagePoint): void;
  onUpdate?(p: PagePoint): void;
  onEnd?(p: PagePoint, cancelled: boolean): void;
  onTap?(p: PagePoint): void;
  onLongPress?(p: PagePoint): void;
}

/**
 * Sent on JS after a hold-to-snap fired (ruling (g)): the hand-drawn stroke was committed first
 * (strokeEntryId = its history entry); the receiver (P28 useShapeSnap) then replaces it with `shape`.
 */
export interface ShapeSnapEvent {
  pageId: Id;
  strokeId: Id;
  strokeEntryId: Id;
  shape: ShapeItem;
  name: { ar: string; en: string };
}

/** Same list as core/shapes/recognize.ts ShapeVariant (P06); repeated so wave 1 does not import wave 2. */
export type SnapVariant = 'line' | 'arrow' | 'rect' | 'square' | 'ellipse' | 'circle' | 'triangle' | 'polygon';

/**
 * The shape the hold would snap to, as holdSignal carries it (plain data, safe for scheduleOnRN). It is
 * a core/shapes Nameable, so hintText(candidate) and shapeName(candidate) accept it directly.
 */
export interface SnapCandidate {
  variant: SnapVariant;
  /** 2 for line and arrow, 0 for ellipse and circle, otherwise the number of vertices. */
  sides: number;
}

export interface ToolState {
  tool: ToolId;
  /** The tool before the current one (Pencil double tap 'lastTool', eraser toggle). */
  lastTool: ToolId;
  rulerOn: boolean;
  pen: { color: Hex; width: number; presetIndex: number | null };
  highlighter: { color: Hex; width: number; straight: boolean };
  eraser: { mode: 'stroke' | 'pixel'; highlighterOnly: boolean; size: number };
  shapeKind: Exclude<ShapeKind, 'polygon'>;
  shapeSnap: boolean;
  pressure: boolean;
}

export interface ToolActions {
  setTool(t: ToolId): void;
  /** 'eraser' switches to the eraser (or back when already on it); 'lastTool' swaps with lastTool. */
  toggleEraser(mode: 'eraser' | 'lastTool'): void;
  setPen(p: Partial<ToolState['pen']>): void;
  setHighlighter(p: Partial<ToolState['highlighter']>): void;
  setEraser(p: Partial<ToolState['eraser']>): void;
  setShapeKind(k: ToolState['shapeKind']): void;
  toggleRuler(): void;
  setShapeSnap(on: boolean): void;
}
