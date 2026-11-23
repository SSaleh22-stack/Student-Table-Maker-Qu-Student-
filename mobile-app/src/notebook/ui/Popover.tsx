/**
 * A popover anchored to a measured rect (window coordinates, from measureInWindow), with a caret
 * pointing at the anchor (Figma 07 pen options: white card, radius 22, padding 20, a 16 pt caret).
 *
 * prefer picks the side the card opens on; when it does not fit, the opposite side is tried, then the
 * remaining ones; when nothing fits the preferred side is used and the card is clamped on screen.
 * - 'below' (default) / 'above'
 * - 'start' / 'end': beside the anchor on the reading-start / reading-end side
 * - { awayFrom: 'left' | 'right' }: beside the anchor, on the side away from that PHYSICAL edge (pass
 *   the writing hand, so the card never opens under the hand)
 *
 * By default it renders in a transparent Modal (tapping outside or Android back calls onClose).
 * modal={false} renders an absolute overlay instead: the parent must then fill the window (window
 * coordinates = parent coordinates) and close it itself; the overlay passes touches through.
 * Every position goes through physical.ts (measured rects are physical).
 */
import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tr } from '@/lib/i18n';
import { isRTL } from '@/lib/rtl';
import { colors } from '@/lib/theme';

import { MODAL_ORIENTATIONS } from './layout';
import { physicalBox, physicalLeft } from './physical';

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PopoverPrefer = 'start' | 'end' | 'above' | 'below' | { awayFrom: 'left' | 'right' };

/** The physical side of the anchor the card sits on. */
export type PopoverSide = 'above' | 'below' | 'left' | 'right';

export interface PopoverPlacement {
  /** Card position from the window's physical left / top. */
  x: number;
  y: number;
  side: PopoverSide;
  /** Caret center along the card edge facing the anchor (x for above/below, y for left/right). */
  caret: number;
}

export interface PlaceOptions {
  /** Distance between the anchor and the card. */
  gap: number;
  /** Minimum distance from the window edges (added to the safe-area insets). */
  margin: number;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Reading direction, for 'start' / 'end'. */
  rtl: boolean;
}

const CARET = 16;
/** Keeps the caret clear of the card's rounded corners. */
const CARET_EDGE = 26;

function sideOrder(prefer: PopoverPrefer, rtl: boolean): PopoverSide[] {
  if (prefer === 'below') return ['below', 'above', 'left', 'right'];
  if (prefer === 'above') return ['above', 'below', 'left', 'right'];
  let first: PopoverSide;
  if (prefer === 'start') first = rtl ? 'right' : 'left';
  else if (prefer === 'end') first = rtl ? 'left' : 'right';
  else first = prefer.awayFrom === 'right' ? 'left' : 'right';
  const second: PopoverSide = first === 'left' ? 'right' : 'left';
  return [first, second, 'below', 'above'];
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

/** Pure placement: where a card of `size` opens next to `anchor` inside a `win` window. */
export function placePopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
  win: { width: number; height: number },
  prefer: PopoverPrefer,
  o: PlaceOptions,
): PopoverPlacement {
  const minX = o.insets.left + o.margin;
  const maxX = win.width - o.insets.right - o.margin - size.width;
  const minY = o.insets.top + o.margin;
  const maxY = win.height - o.insets.bottom - o.margin - size.height;
  const fits: Record<PopoverSide, boolean> = {
    above: anchor.y - o.gap - size.height >= minY,
    below: anchor.y + anchor.height + o.gap <= maxY,
    left: anchor.x - o.gap - size.width >= minX,
    right: anchor.x + anchor.width + o.gap <= maxX,
  };
  const order = sideOrder(prefer, o.rtl);
  const side = order.find((s) => fits[s]) ?? order[0];
  const cx = anchor.x + anchor.width / 2;
  const cy = anchor.y + anchor.height / 2;
  if (side === 'above' || side === 'below') {
    const x = clamp(cx - size.width / 2, minX, maxX);
    const y = side === 'below' ? clamp(anchor.y + anchor.height + o.gap, minY, maxY) : clamp(anchor.y - o.gap - size.height, minY, maxY);
    return { x, y, side, caret: clamp(cx - x, CARET_EDGE, size.width - CARET_EDGE) };
  }
  const y = clamp(cy - size.height / 2, minY, maxY);
  const x = side === 'right' ? clamp(anchor.x + anchor.width + o.gap, minX, maxX) : clamp(anchor.x - o.gap - size.width, minX, maxX);
  return { x, y, side, caret: clamp(cy - y, CARET_EDGE, size.height - CARET_EDGE) };
}

/** The caret square's position inside the card (physical), half outside the edge facing the anchor. */
function caretStyle(p: PopoverPlacement, size: { width: number; height: number }): ViewStyle {
  const half = CARET / 2;
  const out = -6;
  switch (p.side) {
    case 'below':
      return physicalBox(p.caret - half, out, CARET, CARET);
    case 'above':
      return physicalBox(p.caret - half, size.height - CARET - out, CARET, CARET);
    case 'right':
      return physicalBox(out, p.caret - half, CARET, CARET);
    case 'left':
      return physicalBox(size.width - CARET - out, p.caret - half, CARET, CARET);
  }
}

const CARD_SHADOW = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 8 },
  default: { boxShadow: '0 8px 24px rgba(27, 37, 51, 0.14)' },
}) as object;

export interface PopoverProps {
  visible: boolean;
  /** The anchor in window coordinates; nothing shows while null. */
  anchor: AnchorRect | null;
  onClose: () => void;
  children: ReactNode;
  prefer?: PopoverPrefer;
  /** Fixed card width (default: the content's own width). */
  width?: number;
  /** Inner padding (default 20). */
  padding?: number;
  gap?: number;
  margin?: number;
  caret?: boolean;
  modal?: boolean;
  /** Dim the screen behind (modal only). */
  dim?: boolean;
  /** Screen-reader name of the card, e.g. 'خيارات القلم'. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Popover({
  visible,
  anchor,
  onClose,
  children,
  prefer = 'below',
  width,
  padding = 20,
  gap = 10,
  margin = 12,
  caret = true,
  modal = true,
  dim = false,
  accessibilityLabel,
  style,
}: PopoverProps) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  if (!visible || !anchor) return null;

  const placed = size
    ? placePopover(anchor, size, win, prefer, { gap: gap + (caret ? 4 : 0), margin, insets, rtl: isRTL })
    : null;

  const card = (
    <View
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (!size || Math.abs(size.width - w) > 0.5 || Math.abs(size.height - h) > 0.5) setSize({ width: w, height: h });
      }}
      accessibilityViewIsModal={modal}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        CARD_SHADOW,
        { padding },
        width !== undefined ? { width } : { maxWidth: win.width - insets.left - insets.right - margin * 2 },
        { top: placed ? placed.y : 0 },
        physicalLeft(placed ? placed.x : 0),
        !placed && styles.measuring,
        style,
      ]}>
      {caret && placed && size ? <View style={[styles.caret, caretStyle(placed, size)]} /> : null}
      {children}
    </View>
  );

  if (!modal) {
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {card}
      </View>
    );
  }
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent>
      <Pressable
        style={[StyleSheet.absoluteFill, dim && styles.dim]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={tr('إغلاق', 'Close')}
      />
      {card}
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', backgroundColor: colors.surface, borderRadius: 22 },
  caret: { backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  measuring: { opacity: 0 },
  dim: { backgroundColor: colors.overlay },
});
