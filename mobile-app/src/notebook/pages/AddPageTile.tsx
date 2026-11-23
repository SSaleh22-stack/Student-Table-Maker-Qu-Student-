/**
 * The dashed 'صفحة جديدة' tile at the end of the pages grid (Figma 13): a plus and the label in the
 * accent color inside a dashed accent-border box the size of a thumbnail. A tap appends a page with
 * the notebook's default paper (NB-23, NB-24).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { nbColors } from '@/notebook/theme';

export interface AddPageTileProps {
  boxW: number;
  boxH: number;
  onPress: () => void;
  disabled?: boolean;
}

export function addPageTileLabel(): string {
  return tr('صفحة جديدة', 'New page');
}

export function AddPageTile({ boxW, boxH, onPress, disabled }: AddPageTileProps) {
  const compact = boxW < 120;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={addPageTileLabel()}
      accessibilityHint={tr('تُضاف صفحة في نهاية المذكرة', 'Adds a page at the end of the notebook')}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.tile, { width: boxW, height: boxH, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <View style={styles.inner}>
        <Icon name="plus" size={compact ? 22 : 26} color={nbColors.accent} />
        <AppText size={compact ? 12 : 14} weight="semibold" color={nbColors.accent} align="center">
          {addPageTileLabel()}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: nbColors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { alignItems: 'center', gap: 6, paddingHorizontal: 6 },
});
