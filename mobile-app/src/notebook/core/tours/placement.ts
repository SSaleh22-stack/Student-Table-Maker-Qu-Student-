/**
 * Tour geometry (Figma 24-35 spotlight + tour card), pure.
 *
 * Every rect is in WINDOW coordinates measured from the physical left/top (measureInWindow is
 * physical), so the UI places the results with physicalBox / physicalLeft, never with a bare left.
 *
 * - unionRect / unionAll: one spotlight around several targets (lib.search + lib.headerActions).
 * - padRect: the hole is the target grown by the step's padding (Figma spotlight pad, default 10).
 * - clipRect / intersects: a target scrolled off screen is not shown.
 * - placeCard: the card goes below or above the hole (the step's preference first, then the other
 *   side, then beside it for tall targets such as a vertical toolbar), centred on the hole and clamped
 *   20 pt from the window edges (plus the safe-area insets). The pointer stays 30 pt clear of the
 *   card's rounded corners (Figma tourTip).
 * - holePath: the SVG path of the dim layer: the window rect plus a rounded hole, drawn with
 *   fillRule evenodd.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size2 {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The physical side of the hole the card sits on. */
export type CardSide = 'above' | 'below' | 'left' | 'right';

export interface CardPlacement {
  /** Card position from the window's physical left and top. */
  x: number;
  y: number;
  side: CardSide;
  /**
   * Centre of the pointer along the card edge that faces the hole, in window coordinates: an x for
   * 'above' / 'below', a y for 'left' / 'right'.
   */
  pointer: number;
}

export interface PlaceCardOptions {
  /** The side tried first (Figma: 'below' except the floating new-notebook button). */
  prefer?: 'above' | 'below';
  /** Distance between the hole and the card (Figma 16). */
  gap?: number;
  /** Minimum distance from the window edges (Figma 20), added to the insets. */
  margin?: number;
  insets?: Insets;
  /** How close the pointer may come to the card's corners (Figma 30). */
  pointerInset?: number;
}

export const CARD_MARGIN = 20;
export const CARD_GAP = 16;
export const POINTER_INSET = 30;
/** Figma tour card width. */
export const TOUR_CARD_WIDTH = 352;

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/** lo..hi, or lo when the range is empty (a card wider than the room sticks to the start edge). */
export function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** The smallest rect holding a and b. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** The union of every non-null rect; null when there is none. */
export function unionAll(rects: readonly (Rect | null | undefined)[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) if (r) out = out ? unionRect(out, r) : { x: r.x, y: r.y, width: r.width, height: r.height };
  return out;
}

/** r grown by pad on every side (a negative pad shrinks it, never below zero size). */
export function padRect(r: Rect, pad: number): Rect {
  const p = finite(pad);
  const width = Math.max(0, r.width + 2 * p);
  const height = Math.max(0, r.height + 2 * p);
  return { x: r.x + r.width / 2 - width / 2, y: r.y + r.height / 2 - height / 2, width, height };
}

/** Whether a has a non-empty overlap with b. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The part of r inside bounds, or null when nothing of it is inside. */
export function clipRect(r: Rect, bounds: Rect): Rect | null {
  if (!intersects(r, bounds)) return null;
  const x = Math.max(r.x, bounds.x);
  const y = Math.max(r.y, bounds.y);
  const x2 = Math.min(r.x + r.width, bounds.x + bounds.width);
  const y2 = Math.min(r.y + r.height, bounds.y + bounds.height);
  return { x, y, width: x2 - x, height: y2 - y };
}

/** A usable measured rect: finite numbers and a positive size. */
export function isValidRect(r: Rect | null | undefined): r is Rect {
  return !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
}

/**
 * Where the tour card of `card` size goes next to `hole` inside a `win` window.
 *
 * Order: the preferred vertical side, the other vertical side, then beside the hole (the physical
 * side with more room). A side "fits" when the card and the gap fit between the hole and the margin.
 * When nothing fits (a hole covering most of the window), the preferred side is used and the card is
 * clamped inside the margins, over the hole.
 */
export function placeCard(hole: Rect, card: Size2, win: Size2, o: PlaceCardOptions = {}): CardPlacement {
  const gap = o.gap ?? CARD_GAP;
  const margin = o.margin ?? CARD_MARGIN;
  const ins = o.insets ?? NO_INSETS;
  const inset = o.pointerInset ?? POINTER_INSET;
  const prefer = o.prefer ?? 'below';

  const minX = ins.left + margin;
  const maxX = win.width - ins.right - margin - card.width;
  const minY = ins.top + margin;
  const maxY = win.height - ins.bottom - margin - card.height;

  const room = {
    below: win.height - ins.bottom - margin - (hole.y + hole.height + gap),
    above: hole.y - gap - (ins.top + margin),
    right: win.width - ins.right - margin - (hole.x + hole.width + gap),
    left: hole.x - gap - (ins.left + margin),
  };
  const fits: Record<CardSide, boolean> = {
    below: room.below >= card.height,
    above: room.above >= card.height,
    right: room.right >= card.width && maxY >= minY,
    left: room.left >= card.width && maxY >= minY,
  };

  const other = prefer === 'below' ? 'above' : 'below';
  const beside: CardSide[] = room.right >= room.left ? ['right', 'left'] : ['left', 'right'];
  const order: CardSide[] = [prefer, other, ...beside];
  const side = order.find((s) => fits[s]) ?? prefer;

  const cx = hole.x + hole.width / 2;
  const cy = hole.y + hole.height / 2;

  if (side === 'above' || side === 'below') {
    const x = clamp(cx - card.width / 2, minX, maxX);
    const rawY = side === 'below' ? hole.y + hole.height + gap : hole.y - gap - card.height;
    const y = clamp(rawY, minY, maxY);
    const pointer = clamp(cx, x + inset, x + card.width - inset);
    return { x, y, side, pointer };
  }
  const rawX = side === 'right' ? hole.x + hole.width + gap : hole.x - gap - card.width;
  const x = clamp(rawX, minX, maxX);
  const y = clamp(cy - card.height / 2, minY, maxY);
  const pointer = clamp(cy, y + inset, y + card.height - inset);
  return { x, y, side, pointer };
}

/** The corner radius actually drawn: never more than half the hole's shorter side (999 = a pill). */
export function holeRadius(hole: Rect, radius: number): number {
  return Math.max(0, Math.min(finite(radius), hole.width / 2, hole.height / 2));
}

const n = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * SVG path for the dim layer: the whole window plus the rounded hole. Fill it with
 * fillRule="evenodd" so the hole stays clear.
 */
export function holePath(win: Size2, hole: Rect, radius: number): string {
  const outer = `M0 0H${n(win.width)}V${n(win.height)}H0Z`;
  if (!isValidRect(hole)) return outer;
  const r = holeRadius(hole, radius);
  const { x, y, width: w, height: h } = hole;
  if (r === 0) return `${outer}M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  return (
    `${outer}M${n(x + r)} ${n(y)}H${n(x + w - r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
  );
}
