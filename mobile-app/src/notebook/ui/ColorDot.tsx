/**
 * Color swatch (Figma colorDot): a filled circle, with a 3 pt accent ring OUTSIDE it when selected.
 * The footprint is always size + 6 (the ring has its room even when off), so selecting never shifts
 * the row. Very light colors get a hairline so they show on white.
 *
 * variant 'current' is the small dot that shows a tool's current color (toolbar pen / highlighter):
 * default 8 pt (Figma toolButton dot), with a 1.5 pt white edge so it reads on any button.
 */
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';

const RING = 3;

/** Relative luminance check: very light colors (white, cream, yellow) need an edge on white. */
function isLight(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return false;
  return 0.299 * r + 0.587 * g + 0.114 * b > 225;
}

export interface ColorDotProps {
  color: string;
  selected?: boolean;
  variant?: 'swatch' | 'current';
  /** Dot diameter: 28 for swatches, 8 for 'current'. */
  size?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Screen-reader name, e.g. 'أزرق'. Defaults to 'لون' + the hex. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function ColorDot({ color, selected, variant = 'swatch', size, onPress, onLongPress, label, style }: ColorDotProps) {
  if (variant === 'current') {
    const d = size ?? 8;
    return (
      <View
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={[
          { width: d, height: d, borderRadius: d / 2, backgroundColor: color, borderWidth: 1.5, borderColor: '#FFFFFF' },
          isLight(color) && { borderColor: colors.borderStrong },
          style,
        ]}
      />
    );
  }
  const d = size ?? 28;
  const outer = d + RING * 2;
  const dot = (
    <View
      style={{
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        borderWidth: RING,
        borderColor: selected ? colors.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={[
          { width: d, height: d, borderRadius: d / 2, backgroundColor: color },
          isLight(color) && { borderWidth: 1, borderColor: colors.borderStrong },
        ]}
      />
    </View>
  );
  const name = label ?? tr('لون ', 'Color ') + color.toUpperCase();
  if (!onPress && !onLongPress) {
    return (
      <View style={style} accessible accessibilityLabel={name} accessibilityState={{ selected: !!selected }}>
        {dot}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={outer < 44 ? (44 - outer) / 2 : 0}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [pressed && { opacity: 0.8 }, style]}>
      {dot}
    </Pressable>
  );
}
