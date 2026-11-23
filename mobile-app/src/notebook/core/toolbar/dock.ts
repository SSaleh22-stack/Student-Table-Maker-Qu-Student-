/**
 * Toolbar and dock geometry (P13), pure. Every rect and inset is PHYSICAL (x from the window's real
 * left edge), in the editor container's coordinates; place results with ui/physical.ts.
 *
 * editorFrames({ screen, insets, toolbarPos, barThickness, dock }) resolves where the toolbar slot, the
 * docked calculator and the page area go (ruling (f)):
 * - the dock takes its side, full height (x 0 for a left dock, screen.width - width for a right dock);
 * - a vertical toolbar on the dock's side sits at the dock's inner edge (x = dock.width for a left dock,
 *   screen.width - dock.width - thickness for a right dock), between the dock and the page;
 * - a vertical toolbar on the other side sits EDGE from that screen edge (inside the safe area);
 * - top and bottom toolbars span the canvas width only: from the dock's inner edge (or the safe inset)
 *   to the opposite edge, so they never run under the dock;
 * - with headerReserve (tablets), a TOP toolbar sits in the header band itself, in the same row as the
 *   back button and the actions pill: between the reserved room on each side (measured from the
 *   dock's inner edge on the dock's side), centered on the band, and the page starts right under the
 *   header band (it gains the bar's height). When that row is too short for even the phone bar (a
 *   docked calculator on a portrait iPad), the bar keeps its own row under the header instead;
 * - canvasInsets is what the page area must keep clear on each side: the dock width on the dock's side,
 *   the bar (and its edge gap) on the bar's side, the header band on top, the safe insets elsewhere.
 *
 * The toolbar rect is the bar's SLOT: its cross size is the bar thickness and its main size is the room
 * the bar may use. The bar is centered in the slot; when the full bar is longer than the slot
 * (fitsInline false) the editor uses the compact layout (or smaller buttons, fitButtonSize).
 *
 * Phones in portrait: vertical positions are not offered (allowedPositions) and a saved left / right
 * position falls back to 'top' (effectiveToolbarPos; editorFrames applies it and returns the used pos).
 * "Phone portrait" means a window narrower than COMPACT_WIDTH that is taller than wide, the same width
 * class as ui/layout.ts, so an iPad in narrow Split View follows the phone rule too.
 */

export type ToolbarPos = 'top' | 'bottom' | 'left' | 'right';
export const TOOLBAR_POSITIONS: readonly ToolbarPos[] = ['top', 'bottom', 'left', 'right'];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DockSpec {
  side: 'left' | 'right';
  width: number;
}

/** Bar metrics (Figma editorToolbar): 40 pt buttons, 3 pt gap, 10 pt end padding, 7 pt side padding. */
export const BAR = {
  button: 40,
  /** Button size of the compact (phone) bar before fitting. */
  compactButton: 36,
  /** Smallest button fitButtonSize goes down to. */
  minButton: 30,
  gap: 3,
  /** Padding at both ends of the bar (main axis). */
  padMain: 10,
  /** Padding on both sides of the bar (cross axis). */
  padCross: 7,
  /** Grip length along the bar. */
  grip: 20,
  separator: 1,
  /** A 24 pt color dot with its 3 pt ring room. */
  swatch: 30,
  /** Default length of the record slot when idle (P12 RecordButton). */
  record: 44,
} as const;

/** Editor chrome around the bar (Figma 06, 19-21). */
export const FRAME = {
  /** Gap between a vertical bar and the screen edge. */
  edge: 14,
  /** Height of the floating icon header under the top safe inset. */
  header: 60,
  /** Height of the page counter band above the bottom safe inset. */
  footer: 48,
} as const;

/** Windows narrower than this are compact (ui/layout.ts COMPACT_BELOW). */
export const COMPACT_WIDTH = 600;

/**
 * - full: every tool, the five pen colors, undo / redo, record.
 * - medium: every tool, no color dots (the pen options hold the colors), undo / redo, record. Used
 *   where the full bar does not fit but all tools still do (a top bar in a portrait iPad's header row).
 * - compact: the phone bar (pen, highlighter, eraser, lasso, more).
 */
export type BarLayout = 'full' | 'medium' | 'compact';
/** Smallest button the medium bar may shrink to before the compact bar is used instead. */
export const MEDIUM_MIN_BUTTON = 34;

export interface BarLengthOptions {
  /** Button size (default 40 for full, 36 for compact). */
  button?: number;
  /** Length of the record slot along the bar (default 44; a running recording is wider). */
  recordSlot?: number;
}

export interface FrameOptions {
  edge?: number;
  header?: number;
  footer?: number;
}

export interface EditorFramesInput {
  screen: Size;
  insets: Insets;
  toolbarPos: ToolbarPos;
  barThickness: number;
  dock: DockSpec | null;
  /**
   * Tablets: room the header buttons take on each PHYSICAL side of the header band (edge gap, button
   * and the gap to the bar). Given, a top toolbar goes into the header row between them.
   */
  headerReserve?: { left: number; right: number } | null;
}

export interface EditorFrames {
  /** The position actually used (left / right fall back to top on a portrait phone). */
  pos: ToolbarPos;
  /** The toolbar slot. */
  toolbar: Rect;
  /** The docked calculator, or null. */
  dock: Rect | null;
  /** Physical insets the page area keeps clear (PageCanvas contentInsets). */
  canvasInsets: Insets;
}

export function isVertical(pos: ToolbarPos): boolean {
  'worklet';
  return pos === 'left' || pos === 'right';
}

/** Cross size of a bar with this button size. */
export function barThickness(button: number = BAR.button): number {
  return button + 2 * BAR.padCross;
}

/**
 * Main-axis length of the bar.
 * - full: grip, 9 tools (pen … calculator), separator, 5 colors, separator, undo, redo, separator, record
 * - medium: grip, 9 tools, separator, undo, redo, separator, record
 * - compact: grip, pen, highlighter, eraser, lasso, more, separator, undo, redo, separator, record
 */
export function barLength(layout: BarLayout, o: BarLengthOptions = {}): number {
  const button = o.button ?? (layout === 'compact' ? BAR.compactButton : BAR.button);
  const record = o.recordSlot ?? BAR.record;
  const buttons = layout === 'compact' ? 7 : 11;
  const swatches = layout === 'full' ? 5 : 0;
  const separators = layout === 'full' ? 3 : 2;
  const items = 1 + buttons + swatches + separators + 1;
  return (
    2 * BAR.padMain + BAR.grip + buttons * button + swatches * BAR.swatch + separators * BAR.separator + record + (items - 1) * BAR.gap
  );
}

/** Whether the full (tablet) bar fits in `available` points along its axis. */
export function fitsInline(available: number, o: { recordSlot?: number } = {}): boolean {
  return barLength('full', { recordSlot: o.recordSlot }) <= available;
}

/**
 * The layout for a bar with `available` points along its axis: full when it fits, else medium when it
 * fits with buttons of at least MEDIUM_MIN_BUTTON, else compact. `phone` forces compact.
 */
export function chooseBarLayout(available: number, phone: boolean, o: { recordSlot?: number } = {}): BarLayout {
  if (phone) return 'compact';
  if (fitsInline(available, o)) return 'full';
  if (barLength('medium', { button: MEDIUM_MIN_BUTTON, recordSlot: o.recordSlot }) <= available) return 'medium';
  return 'compact';
}

/** The largest whole button size (BAR.minButton … the layout's default) whose bar fits; minButton if none does. */
export function fitButtonSize(available: number, layout: BarLayout, o: { recordSlot?: number } = {}): number {
  const top = layout === 'compact' ? BAR.compactButton : BAR.button;
  for (let b = top; b > BAR.minButton; b--) {
    if (barLength(layout, { button: b, recordSlot: o.recordSlot }) <= available) return b;
  }
  return BAR.minButton;
}

/** Vertical bars are allowed except on a portrait phone (compact width and taller than wide). */
export function verticalAllowed(screen: Size): boolean {
  return !(screen.width < COMPACT_WIDTH && screen.height > screen.width);
}

export function allowedPositions(screen: Size): ToolbarPos[] {
  return verticalAllowed(screen) ? ['top', 'bottom', 'left', 'right'] : ['top', 'bottom'];
}

/** The position used on this screen: a vertical one falls back to 'top' where it is not allowed. */
export function effectiveToolbarPos(pos: ToolbarPos, screen: Size): ToolbarPos {
  return isVertical(pos) && !verticalAllowed(screen) ? 'top' : pos;
}

interface Bands {
  /** Physical x where the free area starts (after a left dock or the left inset). */
  left: number;
  /** Physical x where the free area ends. */
  right: number;
  /** y of the band under the header. */
  top: number;
  /** y of the bottom of the free band (above the footer). */
  bottom: number;
  dockLeft: boolean;
  dockRight: boolean;
}

function bands(screen: Size, insets: Insets, dock: DockSpec | null, o: FrameOptions): Bands {
  const header = o.header ?? FRAME.header;
  const footer = o.footer ?? FRAME.footer;
  const dw = dock ? Math.max(0, Math.min(dock.width, screen.width)) : 0;
  const dockLeft = !!dock && dock.side === 'left' && dw > 0;
  const dockRight = !!dock && dock.side === 'right' && dw > 0;
  return {
    left: dockLeft ? dw : Math.max(0, insets.left),
    right: dockRight ? screen.width - dw : screen.width - Math.max(0, insets.right),
    top: Math.max(0, insets.top) + header,
    bottom: screen.height - Math.max(0, insets.bottom) - footer,
    dockLeft,
    dockRight,
  };
}

/** The toolbar slot for a position (no phone fallback; see editorFrames). */
export function barFrame(
  pos: ToolbarPos,
  i: { screen: Size; insets: Insets; barThickness: number; dock: DockSpec | null },
  o: FrameOptions = {},
): Rect {
  const edge = o.edge ?? FRAME.edge;
  const t = Math.max(0, i.barThickness);
  const b = bands(i.screen, i.insets, i.dock, o);
  const spanH = Math.max(0, b.right - b.left);
  const spanV = Math.max(0, b.bottom - b.top);
  if (pos === 'top') return { x: b.left, y: b.top, width: spanH, height: t };
  if (pos === 'bottom') return { x: b.left, y: b.bottom - t, width: spanH, height: t };
  if (pos === 'left') return { x: b.dockLeft ? b.left : b.left + edge, y: b.top, width: t, height: spanV };
  return { x: b.dockRight ? b.right - t : b.right - edge - t, y: b.top, width: t, height: spanV };
}

/**
 * A top bar's slot inside the header band, between the header buttons' reserved room (from the dock's
 * inner edge on its side), or null when that room is shorter than the phone bar.
 */
function headerRowFrame(i: EditorFramesInput, reserve: { left: number; right: number }, o: FrameOptions): Rect | null {
  const header = o.header ?? FRAME.header;
  const t = Math.max(0, i.barThickness);
  const b = bands(i.screen, i.insets, i.dock, o);
  const x = b.left + Math.max(0, reserve.left);
  const width = b.right - Math.max(0, reserve.right) - x;
  if (width < barLength('compact')) return null;
  return { x, y: Math.max(0, i.insets.top) + (header - t) / 2, width, height: t };
}

/** Toolbar slot, dock rect and page insets for the editor (see the file header). */
export function editorFrames(i: EditorFramesInput, o: FrameOptions = {}): EditorFrames {
  const pos = effectiveToolbarPos(i.toolbarPos, i.screen);
  const b = bands(i.screen, i.insets, i.dock, o);
  const headerSlot = pos === 'top' && i.headerReserve ? headerRowFrame(i, i.headerReserve, o) : null;
  const inHeader = headerSlot !== null;
  const toolbar = headerSlot ?? barFrame(pos, i, o);
  const W = i.screen.width;
  const H = i.screen.height;
  let dock: Rect | null = null;
  if (i.dock && (b.dockLeft || b.dockRight)) {
    const dw = b.dockLeft ? b.left : W - b.right;
    dock = { x: b.dockLeft ? 0 : W - dw, y: 0, width: dw, height: H };
  }
  const canvasInsets: Insets = {
    top: pos === 'top' && !inHeader ? toolbar.y + toolbar.height : b.top,
    bottom: pos === 'bottom' ? H - toolbar.y : Math.max(0, i.insets.bottom),
    left: pos === 'left' ? toolbar.x + toolbar.width : b.left,
    right: pos === 'right' ? W - toolbar.x : W - b.right,
  };
  return { pos, toolbar, dock, canvasInsets };
}

/** Drop-zone metrics (Figma 18). */
export const ZONE = { thickness: 68, sideWidth: 70, inset: 16, sideInset: 12, gap: 10 } as const;

export type DropZoneRects = Partial<Record<ToolbarPos, Rect>>;

/**
 * The drop zones shown while the bar is lifted (Figma 18): wide bands at the top and bottom, tall
 * bands at the left and right (only where vertical bars are allowed). A dock's side starts at the
 * dock's inner edge.
 */
export function dropZones(
  screen: Size,
  insets: Insets,
  o: FrameOptions & { dock?: DockSpec | null; allowed?: readonly ToolbarPos[] } = {},
): DropZoneRects {
  const allowed = o.allowed ?? allowedPositions(screen);
  const b = bands(screen, insets, o.dock ?? null, o);
  const left = b.left + ZONE.inset;
  const width = Math.max(0, b.right - b.left - 2 * ZONE.inset);
  const top: Rect = { x: left, y: b.top - 2, width, height: ZONE.thickness };
  const bottom: Rect = { x: left, y: b.bottom - ZONE.thickness + 2, width, height: ZONE.thickness };
  const sideY = top.y + top.height + ZONE.gap;
  const sideH = Math.max(0, bottom.y - ZONE.gap - sideY);
  const out: DropZoneRects = {};
  if (allowed.includes('top')) out.top = top;
  if (allowed.includes('bottom')) out.bottom = bottom;
  if (allowed.includes('left')) out.left = { x: b.left + ZONE.sideInset, y: sideY, width: ZONE.sideWidth, height: sideH };
  if (allowed.includes('right'))
    out.right = { x: b.right - ZONE.sideInset - ZONE.sideWidth, y: sideY, width: ZONE.sideWidth, height: sideH };
  return out;
}

function distanceToRect(px: number, py: number, r: Rect): number {
  'worklet';
  const dx = px < r.x ? r.x - px : px > r.x + r.width ? px - (r.x + r.width) : 0;
  const dy = py < r.y ? r.y - py : py > r.y + r.height ? py - (r.y + r.height) : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The zone a drop at (x, y) lands in: the zone containing the point, else the nearest one, so a drop
 * always snaps to an edge. Ties go in TOOLBAR_POSITIONS order. With no zones it returns `fallback`.
 */
export function zoneAt(point: { x: number; y: number }, zones: DropZoneRects, fallback: ToolbarPos = 'top'): ToolbarPos {
  'worklet';
  const order: ToolbarPos[] = ['top', 'bottom', 'left', 'right'];
  let best: ToolbarPos = fallback;
  let bestD = Infinity;
  for (let k = 0; k < order.length; k++) {
    const pos = order[k];
    const r = zones[pos];
    if (!r) continue;
    const d = distanceToRect(point.x, point.y, r);
    if (d < bestD) {
      bestD = d;
      best = pos;
    }
  }
  return best;
}

/** Index of a position in TOOLBAR_POSITIONS (for shared values); -1 for none. */
export function posIndex(pos: ToolbarPos | null): number {
  'worklet';
  return pos === 'top' ? 0 : pos === 'bottom' ? 1 : pos === 'left' ? 2 : pos === 'right' ? 3 : -1;
}
