/**
 * The page counter pill (Figma 06 pageFooter: the layers icon and '3 / 8', 14 semibold muted, white
 * pill with a small shadow). NB-49a: the page number lives here, not in a title bar.
 *
 * The editor places it (the reading-start bottom corner, in the footer band that editorFrames keeps
 * under the page area, so a bottom toolbar sits above it). A tap opens the pages view.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import { shadow } from '@/lib/theme';
import { nbColors } from '@/notebook/theme';

export interface PageCounterProps {
  /** 0-based index of the page on screen. */
  index: number;
  count: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** '3 / 8' (numbers kept left to right inside Arabic text). */
export function pageCounterText(index: number, count: number): string {
  const n = count > 0 ? Math.min(Math.max(index, 0), count - 1) + 1 : 0;
  return ltr(`${n} / ${count}`);
}

export function PageCounter({ index, count, onPress, style }: PageCounterProps) {
  const n = count > 0 ? Math.min(Math.max(index, 0), count - 1) + 1 : 0;
  return (
    <View style={style} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={tr(`الصفحة ${n} من ${count}`, `Page ${n} of ${count}`)}
        accessibilityHint={onPress ? tr('يفتح صفحات المذكرة', 'Opens the notebook pages') : undefined}
        style={({ pressed }) => [styles.pill, { flexDirection: row }, pressed && styles.pressed]}>
        <Icon name="layers" size={16} color={nbColors.muted} />
        <AppText size={14} weight="semibold" color={nbColors.muted} style={styles.num}>
          {pageCounterText(index, count)}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: nbColors.surface,
    ...shadow,
  },
  num: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.8 },
});
