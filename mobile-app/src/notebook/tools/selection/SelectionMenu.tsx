/**
 * The selection menu (P27, NB-43, Figma 08): a white pill above the selection with
 * 'نسخ' · 'قص' · [color dot] 'اللون' · 'تغيير الحجم' · 'حذف' (danger), plus 'قص الصورة' when one image is
 * selected. 'اللون' swaps the row for color swatches, 'تغيير الحجم' for the 50 / 75 / 125 / 150 / 200 %
 * presets; the back button returns to the main row.
 *
 * FloatingMenu places any such card next to an anchor rect (overlay coordinates, the same space as
 * OverlayContext.toScreen), above it when there is room, and shifted toward awayFromHand(hand)
 * (core/toolbar/hand.ts placePopover with a bottom-bar placement, which opens above). It follows zoom
 * and scroll on the UI thread and hides while the anchor is off screen. PasteMenu is the one-button
 * 'لصق' card shown on a tap or long press on empty space while the clipboard is filled.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import type { Hex } from '@/notebook/core/model';
import { HL_COLOR_NAMES, HL_PALETTE, PEN_COLOR_NAMES, PEN_PALETTE, sameColor } from '@/notebook/core/toolbar/colors';
import { placePopover, type Hand } from '@/notebook/core/toolbar/hand';
import { SIZE_PRESETS, presetLabel } from '@/notebook/core/tools/selection';
import { nbColors } from '@/notebook/theme';
import { ColorDot, PHYSICAL_ORIGIN } from '@/notebook/ui';

const OFF = -100000;

export interface FloatingMenuProps {
  /** [x, y, width, height] of what the menu is for, in overlay coordinates; [] hides the menu. */
  anchor: SharedValue<number[]>;
  /** The overlay's size. */
  screen: { width: number; height: number };
  hand: Hand;
  children: ReactNode;
  accessibilityLabel?: string;
}

/** A card placed above (else below) an anchor rect, shifted away from the writing hand. */
export function FloatingMenu({ anchor, screen, hand, children, accessibilityLabel }: FloatingMenuProps) {
  const size = useSharedValue<number[]>([0, 0]);
  const sw = screen.width;
  const sh = screen.height;

  const style = useAnimatedStyle(() => {
    const a = anchor.get();
    const s = size.get();
    if (a.length !== 4 || !(s[0] > 0) || !(sw > 0)) return { opacity: 0, transform: [{ translateX: OFF }, { translateY: 0 }] };
    // Off screen: hide rather than clamp onto an unrelated part of the page.
    if (a[0] + a[2] < 0 || a[0] > sw || a[1] + a[3] < 0 || a[1] > sh) {
      return { opacity: 0, transform: [{ translateX: OFF }, { translateY: 0 }] };
    }
    const p = placePopover({ x: a[0], y: a[1], width: a[2], height: a[3] }, { width: s[0], height: s[1] }, { width: sw, height: sh }, hand, 'bottom', {
      gap: 14,
      margin: 12,
    });
    return { opacity: 1, transform: [{ translateX: p.x }, { translateY: p.y }] };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.set([width, height]);
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.floating, PHYSICAL_ORIGIN, style]}
      accessibilityViewIsModal={false}
      accessibilityLabel={accessibilityLabel}>
      <View onLayout={onLayout} style={[styles.card, shadow, { flexDirection: row }]}>
        {children}
      </View>
    </Animated.View>
  );
}

function MenuItem({ icon, label, onPress, danger, disabled }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => [styles.item, { flexDirection: row }, pressed && styles.pressed, disabled && styles.disabled]}>
      <Icon name={icon} size={18} color={color} />
      <AppText size={14} weight="medium" color={color}>
        {label}
      </AppText>
    </Pressable>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr('رجوع', 'Back')}
      hitSlop={6}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Icon name="back" size={18} color={colors.muted} />
    </Pressable>
  );
}

export interface SelectionMenuProps {
  /** The common color of the selection (null: only images, no 'اللون'). */
  color: Hex | null;
  /** Every colored item is highlighter ink: offer the highlighter colors. */
  highlighter: boolean;
  /** Exactly one image is selected: offer 'قص الصورة'. */
  singleImage: boolean;
  /** Saved by a newer version: only 'نسخ'. */
  readOnly: boolean;
  /** A copy or cut is staging its files. */
  busy?: boolean;
  onCopy(): void;
  onCut(): void;
  onColor(c: Hex): void;
  onResize(pct: number): void;
  onDelete(): void;
  onCrop(): void;
}

type Mode = 'main' | 'color' | 'size';

/** The menu's rows (place it with FloatingMenu). */
export function SelectionMenu({ color, highlighter, singleImage, readOnly, busy, onCopy, onCut, onColor, onResize, onDelete, onCrop }: SelectionMenuProps) {
  const [mode, setMode] = useState<Mode>('main');

  if (mode === 'color' && color) {
    const palette = highlighter ? HL_PALETTE : PEN_PALETTE;
    const names = highlighter ? HL_COLOR_NAMES : PEN_COLOR_NAMES;
    return (
      <View style={[styles.subRow, { flexDirection: row }]}>
        <BackButton onPress={() => setMode('main')} />
        {palette.map((hex, i) => (
          <ColorDot
            key={hex}
            color={hex}
            size={24}
            selected={sameColor(hex, color)}
            label={tr(names[i]?.ar ?? hex, names[i]?.en ?? hex)}
            onPress={() => {
              onColor(hex);
              setMode('main');
            }}
          />
        ))}
      </View>
    );
  }

  if (mode === 'size') {
    return (
      <View style={[styles.subRow, { flexDirection: row }]}>
        <BackButton onPress={() => setMode('main')} />
        {SIZE_PRESETS.map((pct) => (
          <Pressable
            key={pct}
            onPress={() => onResize(pct)}
            accessibilityRole="button"
            accessibilityLabel={tr(`تغيير الحجم إلى ${pct}٪`, `Resize to ${pct}%`)}
            style={({ pressed }) => [styles.preset, pressed && styles.pressed]}>
            <AppText size={14} weight="semibold" color={colors.text}>
              {presetLabel(pct)}
            </AppText>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <>
      <MenuItem icon="copy" label={tr('نسخ', 'Copy')} onPress={onCopy} disabled={busy} />
      {readOnly ? null : (
        <>
          <MenuItem icon="scissors" label={tr('قص', 'Cut')} onPress={onCut} disabled={busy} />
          {color ? (
            <Pressable
              onPress={() => setMode('color')}
              accessibilityRole="button"
              accessibilityLabel={tr('اللون', 'Color')}
              style={({ pressed }) => [styles.item, styles.colorItem, { flexDirection: row }, pressed && styles.pressed]}>
              <ColorDot color={color} size={20} />
              <AppText size={14} weight="medium" color={colors.text}>
                {tr('اللون', 'Color')}
              </AppText>
            </Pressable>
          ) : null}
          <MenuItem icon="zoom" label={tr('تغيير الحجم', 'Resize')} onPress={() => setMode('size')} />
          {singleImage ? <MenuItem icon="crop" label={tr('قص الصورة', 'Crop image')} onPress={onCrop} /> : null}
          <MenuItem icon="trash" label={tr('حذف', 'Delete')} onPress={onDelete} danger />
        </>
      )}
    </>
  );
}

/** The 'لصق' card. */
export function PasteMenu({ onPaste, busy }: { onPaste(): void; busy?: boolean }) {
  return <MenuItem icon="clipboardCheck" label={tr('لصق', 'Paste')} onPress={onPaste} disabled={busy} />;
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute',
    top: 0,
  },
  card: {
    backgroundColor: nbColors.surface,
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  item: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  colorItem: {
    paddingVertical: 8,
  },
  subRow: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  back: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preset: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: nbColors.surfaceMuted,
  },
  pressed: {
    backgroundColor: nbColors.surfaceMuted,
  },
  disabled: {
    opacity: 0.5,
  },
});
