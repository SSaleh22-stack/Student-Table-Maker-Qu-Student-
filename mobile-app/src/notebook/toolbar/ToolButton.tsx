/**
 * Toolbar building blocks (P13):
 * - ToolButton: the Figma toolButton (40 pt, radius 12, accent fill and white icon when active), with
 *   an optional current-color dot in the bottom corner (Figma 06: the pen and highlighter buttons).
 * - BarSeparator: the 1 pt rule between groups (vertical in a horizontal bar, horizontal in a vertical one).
 * - OptionsPopover: the white option card anchored to a toolbar button (Figma 07), placed AWAY FROM
 *   THE WRITING HAND by core/toolbar/hand.ts placePopover (vertical bars open inward, horizontal bars
 *   shift toward the side away from the hand). It renders in a transparent Modal: a tap outside or the
 *   Android back button closes it. Dialogs opened from inside a card are rendered inside its children,
 *   so they nest in this Modal instead of competing with it.
 * - measureAnchor(ref): the button's window rect (physical), for the popover anchor.
 */
import { useEffect, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';
import type { ToolbarPos } from '@/notebook/core/toolbar/dock';
import { placePopover, type Hand, type HandPlacement } from '@/notebook/core/toolbar/hand';
import { nbRadius } from '@/notebook/theme';
import { ColorDot, MODAL_ORIENTATIONS, physicalBox, physicalLeft, physicalRight, type AnchorRect } from '@/notebook/ui';

/** A mounted view (what refs to View, Pressable and ToolButton hold). */
export type ViewNode = ComponentRef<typeof View>;

export interface ToolButtonProps {
  icon: IconName;
  label: string;
  hint?: string;
  active?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Current-color dot in the corner (pen, highlighter). */
  dotColor?: string;
  /** Button size (default 40; the compact bar passes a fitted size). */
  size?: number;
  disabled?: boolean;
  /** For a toggle (ruler, calculator): announced as a switch-like checked state. */
  checked?: boolean;
  ref?: Ref<ViewNode>;
  style?: StyleProp<ViewStyle>;
}

export function ToolButton({
  icon,
  label,
  hint,
  active,
  onPress,
  onLongPress,
  dotColor,
  size = 40,
  disabled,
  checked,
  ref,
  style,
}: ToolButtonProps) {
  const on = !!active;
  const iconSize = Math.round(size * 0.55);
  const dot = Math.max(7, Math.round(size * 0.2));
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={size < 44 ? Math.ceil((44 - size) / 2) : 0}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{
        selected: checked === undefined ? on : undefined,
        checked: checked === undefined ? undefined : checked,
        disabled: !!disabled,
      }}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, backgroundColor: on ? colors.accent : 'transparent' },
        pressed && !on && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.4 },
        style,
      ]}>
      <Icon name={icon} size={iconSize} color={on ? '#FFFFFF' : colors.text} />
      {dotColor ? (
        <View pointerEvents="none" style={[styles.dot, { bottom: size * 0.1 - 1 }, physicalRight(size * 0.1 - 1)]}>
          <ColorDot color={dotColor} variant="current" size={dot} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function BarSeparator({ vertical, length = 28 }: { vertical: boolean; length?: number }) {
  return (
    <View
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={
        vertical
          ? { height: 1, width: length - 2, backgroundColor: colors.border }
          : { width: 1, height: length, backgroundColor: colors.border }
      }
    />
  );
}

/** The window rect of a mounted view (physical), or null when it has no size yet. */
export function measureAnchor(node: ViewNode | null): Promise<AnchorRect | null> {
  return new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, 600);
    node.measureInWindow((x, y, width, height) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

const CARET = 16;

const CARD_SHADOW = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 8 },
  default: { boxShadow: '0 8px 24px rgba(27, 37, 51, 0.14)' },
}) as object;

function caretStyle(p: HandPlacement, size: { width: number; height: number }): ViewStyle {
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

export interface OptionsPopoverProps {
  visible: boolean;
  /** The button's window rect (measureAnchor); nothing shows while null. */
  anchor: AnchorRect | null;
  /** The toolbar's position: decides the side the card opens on. */
  barPos: ToolbarPos;
  hand: Hand;
  onClose: () => void;
  children: ReactNode;
  /** Card width including padding (default 356 = Figma 07's 316 content + 2 x 20). */
  width?: number;
  padding?: number;
  /** Screen-reader name of the card, e.g. 'خيارات القلم'. */
  accessibilityLabel?: string;
  /**
   * Called once the card is gone after closing. Open another Modal (an image sheet) from here, not
   * in the same tick as onClose: iOS cannot present a Modal while another one is still dismissing.
   */
  onDismiss?: () => void;
}

export function OptionsPopover({
  visible,
  anchor,
  barPos,
  hand,
  onClose,
  children,
  width = 356,
  padding = 20,
  accessibilityLabel,
  onDismiss,
}: OptionsPopoverProps) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const shown = visible && !!anchor;
  const wasShown = useRef(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  // iOS reports the end of the dismissal through Modal.onDismiss; Android has no such event and can
  // show the next dialog right away.
  useEffect(() => {
    if (shown) {
      wasShown.current = true;
      return;
    }
    if (wasShown.current) {
      wasShown.current = false;
      // Measure again on the next open (the content may have changed), so the card never jumps.
      setSize(null);
      if (Platform.OS !== 'ios') dismissRef.current?.();
    }
  }, [shown]);

  const margin = 12;
  const cardWidth = Math.min(width, win.width - insets.left - insets.right - margin * 2);
  const maxHeight = win.height - insets.top - insets.bottom - margin * 2;
  const placed = size && anchor ? placePopover(anchor, size, win, hand, barPos, { gap: 14, margin, insets }) : null;

  return (
    <Modal
      visible={shown}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={Platform.OS === 'ios' ? () => dismissRef.current?.() : undefined}
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('إغلاق', 'Close')} />
      <View
        onLayout={(e) => {
          if (!shown) return;
          const { width: w, height: h } = e.nativeEvent.layout;
          if (!size || Math.abs(size.width - w) > 0.5 || Math.abs(size.height - h) > 0.5) setSize({ width: w, height: h });
        }}
        accessibilityViewIsModal
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.card,
          CARD_SHADOW,
          { padding, width: cardWidth, maxHeight, top: placed ? placed.y : 0 },
          physicalLeft(placed ? placed.x : 0),
          !placed && styles.measuring,
        ]}>
        {placed && size ? <View pointerEvents="none" style={[styles.caret, caretStyle(placed, size)]} /> : null}
        {/* Short screens (landscape phones): the card keeps its max height and its content scrolls. */}
        <ScrollView style={styles.scroll} bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {shown ? children : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: nbRadius.tool, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute' },
  card: { position: 'absolute', backgroundColor: colors.surface, borderRadius: nbRadius.card },
  caret: { backgroundColor: colors.surface, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  measuring: { opacity: 0 },
  // flexShrink lets the scroll view shrink to the card's maxHeight (RN's default flexShrink is 0).
  scroll: { flexGrow: 0, flexShrink: 1 },
});
