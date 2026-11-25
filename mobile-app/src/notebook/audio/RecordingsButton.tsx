/**
 * The button beside the mic in the toolbar that opens the notebook's recordings (NB-63): a play icon
 * with the number of recordings. It shows only once the notebook has a recording, and it toggles the
 * recordings panel (the panel's own × closes it too).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { ltr } from '@/lib/rtl';
import { nbColors } from '@/notebook/theme';
import { useIsCompact } from '@/notebook/ui/layout';

/** Gap between the mic and this button, and the room the button adds to the record slot (pt). */
export const RECORDINGS_GAP = 4;
export const RECORDINGS_BUTTON_ROOM = 40 + RECORDINGS_GAP;

export interface RecordingsButtonProps {
  count: number;
  open: boolean;
  onPress: () => void;
}

export function RecordingsButton({ count, open, onPress }: RecordingsButtonProps) {
  const compact = useIsCompact();
  const d = compact ? 36 : 40;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={(44 - d) / 2}
      accessibilityRole="button"
      accessibilityLabel={tr(`التسجيلات (${count})`, `Recordings (${count})`)}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [
        styles.btn,
        { width: d, height: d, borderRadius: d / 2 },
        open && styles.open,
        pressed && styles.pressed,
      ]}>
      <Icon name="playSolid" size={compact ? 15 : 16} color={open ? nbColors.white : nbColors.accent} filled />
      <View style={styles.badge} pointerEvents="none">
        <AppText size={10} weight="bold" color={nbColors.white}>
          {ltr(count)}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { backgroundColor: nbColors.accentTint, alignItems: 'center', justifyContent: 'center' },
  open: { backgroundColor: nbColors.accent },
  pressed: { opacity: 0.75 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: nbColors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
