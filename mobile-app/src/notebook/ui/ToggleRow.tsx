/**
 * A settings row with a switch at the end (Figma 15: 'عبر Wi-Fi فقط'). The whole row is the switch
 * for screen readers (role 'switch' with its checked state) and toggles on a tap anywhere.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

import { Toggle } from './Toggle';

export interface ToggleRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  iconFill?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** While a change is being applied (e.g. signing in to turn backup on): taps are ignored. */
  busy?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function ToggleRow({
  title,
  subtitle,
  icon,
  iconColor,
  iconFill,
  value,
  onChange,
  disabled,
  busy,
  accessibilityHint,
  style,
}: ToggleRowProps) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled || busy}
      accessibilityRole="switch"
      accessibilityLabel={subtitle ? `${title}، ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        styles.row,
        { flexDirection: row },
        pressed && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.5 },
        style,
      ]}>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: iconFill ?? colors.accentTint }]}>
          <Icon name={icon} size={20} color={iconColor ?? colors.accent} />
        </View>
      ) : null}
      <View style={styles.labels}>
        <AppText size={16} weight="medium">
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={13} color={colors.faint}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Toggle value={value} disabled={disabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 11, minHeight: 56 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1, gap: 2 },
});
