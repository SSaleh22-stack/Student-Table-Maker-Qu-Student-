/**
 * Placement away from the writing hand (P13), pure. Used by the toolbar option popovers (P13), the
 * lasso selection menu (P27) and the shape-snap hint (P28).
 *
 * Every coordinate is PHYSICAL (from the window's real left edge, as measureInWindow reports it);
 * place the result with ui/physical.ts physicalLeft / physicalBox.
 *
 * Rules for placePopover(anchor, size, screen, hand, barPos):
 * - Vertical bars (barPos 'left' / 'right'): the card opens INWARD, beside the button (a left bar opens
 *   to the right, a right bar to the left), vertically centered on the button and clamped on screen; the
 *   caret points at the button's center. This holds whether the bar is on the hand side or the far side.
 * - Horizontal bars ('top' opens below the button, 'bottom' opens above): the card is not centered on
 *   the button; it is shifted horizontally toward awayFromHand(hand), so its hand-side edge sits just past
 *   the button (the caret stays CARET_EDGE from that edge, pointing at the button). A right-hander's card
 *   therefore extends to the left of the button and never covers the page under the hand; a
 *   left-hander's extends to the right. When the shifted card would leave the screen it is clamped,
 *   and the caret follows the button.
 * - When the preferred side has no room (a short landscape phone), the opposite side is used, then the
 *   card is clamped on screen.
 */

export type Hand = 'right' | 'left';
export type BarPos = 'top' | 'bottom' | 'left' | 'right';
export type PhysicalSide = 'left' | 'right';
/** The side of the anchor the card is on (same values as ui/Popover PopoverSide). */
export type CardSide = 'above' | 'below' | 'left' | 'right';

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

export interface HandPlacement {
  /** Card position from the window's physical left and top. */
  x: number;
  y: number;
  side: CardSide;
  /** Caret center along the card edge facing the anchor (x for above/below, y for left/right). */
  caret: number;
}

export interface HandPlaceOptions {
  /** Distance between the anchor and the card (include the caret). Default 14. */
  gap?: number;
  /** Minimum distance from the window edges, added to the insets. Default 12. */
  margin?: number;
  /** Safe-area insets (physical). Default 0. */
  insets?: Insets;
  /** Distance from the card's corner to the caret's center (keeps it off the rounded corner). Default 26. */
  caretEdge?: number;
}

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

/** The physical side away from the writing hand: a right-hander gets 'left'. */
export function awayFromHand(hand: Hand): PhysicalSide {
  'worklet';
  return hand === 'left' ? 'right' : 'left';
}

/** The side a card opens on for a bar position (before the room check). */
export function preferredSide(barPos: BarPos): CardSide {
  'worklet';
  if (barPos === 'top') return 'below';
  if (barPos === 'bottom') return 'above';
  return barPos === 'left' ? 'right' : 'left';
}

const opposite = (s: CardSide): CardSide => {
  'worklet';
  return s === 'above' ? 'below' : s === 'below' ? 'above' : s === 'left' ? 'right' : 'left';
};

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
};

/**
 * The x of a card of width `w` beside a point `cx`, shifted away from the hand: its hand-side edge is
 * caretEdge past cx. Clamped to [minX, maxX].
 */
export function shiftAwayFromHand(cx: number, w: number, hand: Hand, minX: number, maxX: number, caretEdge = 26): number {
  'worklet';
  const x = awayFromHand(hand) === 'left' ? cx + caretEdge - w : cx - caretEdge;
  return clamp(x, minX, maxX);
}

/** Where an option card of `size` opens next to the toolbar button `anchor`. */
export function placePopover(anchor: Rect, size: Size, screen: Size, hand: Hand, barPos: BarPos, o: HandPlaceOptions = {}): HandPlacement {
  'worklet';
  const gap = o.gap ?? 14;
  const margin = o.margin ?? 12;
  const insets = o.insets ?? ZERO;
  const caretEdge = o.caretEdge ?? 26;
  const minX = insets.left + margin;
  const maxX = screen.width - insets.right - margin - size.width;
  const minY = insets.top + margin;
  const maxY = screen.height - insets.bottom - margin - size.height;
  const fits = (s: CardSide): boolean => {
    if (s === 'above') return anchor.y - gap - size.height >= minY;
    if (s === 'below') return anchor.y + anchor.height + gap <= maxY;
    if (s === 'left') return anchor.x - gap - size.width >= minX;
    return anchor.x + anchor.width + gap <= maxX;
  };
  const first = preferredSide(barPos);
  const side = fits(first) ? first : fits(opposite(first)) ? opposite(first) : first;
  const cx = anchor.x + anchor.width / 2;
  const cy = anchor.y + anchor.height / 2;
  if (side === 'above' || side === 'below') {
    const x = shiftAwayFromHand(cx, size.width, hand, minX, maxX, caretEdge);
    const y = side === 'below' ? clamp(anchor.y + anchor.height + gap, minY, maxY) : clamp(anchor.y - gap - size.height, minY, maxY);
    return { x, y, side, caret: clamp(cx - x, caretEdge, size.width - caretEdge) };
  }
  const y = clamp(cy - size.height / 2, minY, maxY);
  const x = side === 'right' ? clamp(anchor.x + anchor.width + gap, minX, maxX) : clamp(anchor.x - gap - size.width, minX, maxX);
  return { x, y, side, caret: clamp(cy - y, caretEdge, size.height - caretEdge) };
}

/**
 * A small card (menu, hint) above or below a point on the page, shifted away from the hand
 * (P27 selection menu, P28 snap hint). prefer 'above' falls back to 'below' when there is no room.
 */
export function placeNearPoint(
  point: { x: number; y: number },
  size: Size,
  screen: Size,
  hand: Hand,
  o: HandPlaceOptions & { prefer?: 'above' | 'below' } = {},
): HandPlacement {
  'worklet';
  return placePopover(
    { x: point.x, y: point.y, width: 0, height: 0 },
    size,
    screen,
    hand,
    (o.prefer ?? 'above') === 'above' ? 'bottom' : 'top',
    o,
  );
}

/** True when a rect overlaps the hand-side half of the screen (the page area under the writing hand). */
export function coversHandSide(r: Rect, screen: Size, hand: Hand): boolean {
  'worklet';
  const mid = screen.width / 2;
  return hand === 'right' ? r.x + r.width > mid : r.x < mid;
}
