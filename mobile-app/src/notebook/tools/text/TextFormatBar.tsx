/**
 * The text box format bar (P28, NB-46, Figma 09 'text-format-bar'): 'Aa' with the font size and a
 * chevron, a divider, the text color dot, bold, a divider, and delete (danger). A white bar, 14 pt
 * corners, a soft shadow.
 *
 * - 'Aa 18 ▾' opens a row of sizes (TEXT_SIZES, 12 to 48).
 * - The color dot opens a row of the pen colors (and the student's saved custom colors).
 * - Bold toggles 500 / 700 (the only two weights the editor and the painter share).
 * - Delete removes the box.
 * The row of choices opens on the side away from the box (`panelBelow`). None of the buttons take the
 * keyboard focus, so the text keeps its caret while formatting.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { fonts, shadow } from '@/lib/theme';
import { sameColor } from '@/notebook/core/toolbar/colors';
import type { Hex } from '@/notebook/core/model';
import { useNotebookSettings } from '@/notebook/store/hooks';
import { nbColors, PEN_COLORS } from '@/notebook/theme';
import { ColorDot } from '@/notebook/ui/ColorDot';

/** Font sizes offered by 'Aa' (Figma 09), points. */
export const TEXT_SIZES: readonly number[] = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48];
export const TEXT_MIN_SIZE = 12;
export const TEXT_MAX_SIZE = 48;

/** Custom colors shown after the pen colors. */
const CUSTOM_SHOWN = 5;

export interface TextFormatBarProps {
  size: number;
  color: Hex;
  bold: boolean;
  onSize(size: number): void;
  onColor(color: Hex): void;
  onToggleBold(): void;
  onDelete(): void;
  /** true: the choices open under the bar (the bar is below the box); false: above it. */
  panelBelow: boolean;
}

type Panel = 'size' | 'color' | null;

export function TextFormatBar({ size, color, bold, onSize, onColor, onToggleBold, onDelete, panelBelow }: TextFormatBarProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [settings] = useNotebookSettings();
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  const palette: Hex[] = [...PEN_COLORS];
  for (const c of settings.customColors.slice(-CUSTOM_SHOWN)) if (!palette.some((p) => sameColor(p, c))) palette.push(c);
  if (!palette.some((p) => sameColor(p, color))) palette.push(color);

  const bar = (
    <View style={[styles.bar, { flexDirection: row }]}>
      <Pressable
        onPress={() => toggle('size')}
        accessibilityRole="button"
        accessibilityLabel={tr(`حجم الخط ${size}`, `Font size ${size}`)}
        accessibilityState={{ expanded: panel === 'size' }}
        style={({ pressed }) => [styles.sizeBtn, { flexDirection: row }, (pressed || panel === 'size') && styles.pressed]}>
        <Text style={styles.aa}>Aa</Text>
        <Text style={styles.sizeText}>{String(Math.round(size))}</Text>
        <Icon name="chevronDown" size={14} color={nbColors.muted} />
      </Pressable>
      <View style={styles.sep} />
      <ColorDot color={color} selected size={22} onPress={() => toggle('color')} label={tr('لون النص', 'Text color')} />
      <Pressable
        onPress={onToggleBold}
        accessibilityRole="button"
        accessibilityLabel={tr('عريض', 'Bold')}
        accessibilityState={{ selected: bold }}
        hitSlop={6}
        style={({ pressed }) => [styles.iconBtn, (bold || pressed) && styles.on]}>
        <Icon name="bold" size={18} color={bold ? nbColors.accent : nbColors.text} strokeWidth={bold ? 2.6 : 2} />
      </Pressable>
      <View style={styles.sep} />
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={tr('حذف النص', 'Delete text')}
        hitSlop={6}
        style={({ pressed }) => [styles.iconBtn, pressed && styles.dangerOn]}>
        <Icon name="trash" size={18} color={nbColors.danger} />
      </Pressable>
    </View>
  );

  const choices =
    panel === 'size' ? (
      <View style={[styles.panel, { flexDirection: row }]} accessibilityRole="radiogroup">
        {TEXT_SIZES.map((s) => {
          const on = Math.round(size) === s;
          return (
            <Pressable
              key={s}
              onPress={() => {
                onSize(s);
                setPanel(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={tr(`حجم ${s}`, `Size ${s}`)}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{String(s)}</Text>
            </Pressable>
          );
        })}
      </View>
    ) : panel === 'color' ? (
      <View style={[styles.panel, { flexDirection: row }]} accessibilityRole="radiogroup">
        {palette.map((c) => (
          <ColorDot
            key={c}
            color={c}
            size={26}
            selected={sameColor(c, color)}
            onPress={() => {
              onColor(c);
              setPanel(null);
            }}
          />
        ))}
      </View>
    ) : null;

  return (
    <View style={styles.wrap}>
      {panelBelow ? null : choices}
      {bar}
      {panelBelow ? choices : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    alignItems: 'stretch',
  },
  bar: {
    alignItems: 'center',
    gap: 10,
    backgroundColor: nbColors.surface,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    ...shadow,
  },
  sizeBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  aa: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: nbColors.text,
  },
  sizeText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: nbColors.muted,
  },
  sep: {
    width: 1,
    height: 20,
    backgroundColor: nbColors.border,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: {
    backgroundColor: nbColors.accentTint,
  },
  dangerOn: {
    backgroundColor: nbColors.dangerSoft,
  },
  pressed: {
    backgroundColor: nbColors.surfaceMuted,
  },
  panel: {
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    backgroundColor: nbColors.surface,
    borderRadius: 14,
    padding: 8,
    maxWidth: 360,
    ...shadow,
  },
  chip: {
    minWidth: 40,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: nbColors.surfaceMuted,
  },
  chipOn: {
    backgroundColor: nbColors.accentSoft,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: nbColors.text,
  },
  chipTextOn: {
    color: nbColors.accentDark,
  },
});
