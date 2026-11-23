/**
 * The zoom pill (Figma 06 pageFooter: '100%' and the zoom icon, the reading-end bottom corner).
 * It shows the canvas zoom (PageCanvas onZoomChange: from "the whole page fits" up to 400 %, NB-49). A tap goes back to
 * 100 % when zoomed in or out.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import { shadow } from '@/lib/theme';
import { nbColors } from '@/notebook/theme';

export interface ZoomPillProps {
  /** Canvas scale (1 = 100 %). */
  scale: number;
  /** Back to 100 %. */
  onReset?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function zoomPercent(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? Math.round(scale * 100) : 100;
}

export function ZoomPill({ scale, onReset, style }: ZoomPillProps) {
  const pct = zoomPercent(scale);
  const canReset = !!onReset && pct !== 100;
  return (
    <View style={style} pointerEvents="box-none">
      <Pressable
        onPress={canReset ? onReset : undefined}
        disabled={!canReset}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={tr(`التكبير ${pct}%`, `Zoom ${pct}%`)}
        accessibilityHint={canReset ? tr('يعيد التكبير إلى 100%', 'Goes back to 100%') : undefined}
        accessibilityState={{ disabled: !canReset }}
        style={({ pressed }) => [styles.pill, { flexDirection: row }, pressed && styles.pressed]}>
        <AppText size={14} weight="semibold" color={nbColors.muted} style={styles.num}>
          {ltr(`${pct}%`)}
        </AppText>
        <Icon name="zoom" size={16} color={nbColors.muted} />
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
