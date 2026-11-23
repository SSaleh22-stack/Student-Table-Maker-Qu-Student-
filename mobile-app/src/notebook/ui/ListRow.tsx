/**
 * A settings row (Figma listRow): icon tile, title and subtitle at the reading start; a value, a
 * trailing control or a chevron at the end. With onPress the whole row is one button.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Icon color (default accent) and its tile fill (default accent tint). */
  iconColor?: string;
  iconFill?: string;
  /** Text at the end, e.g. 'اليمنى' or '3'. */
  value?: string;
  /** A control at the end (a Toggle, a badge). */
  trailing?: ReactNode;
  /** Shows the forward chevron at the end (default: true when onPress is set and nothing else trails). */
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Title in the danger color ('حذف المجلد'). */
  destructive?: boolean;
  /** Overrides the spoken name (default: title, subtitle and value). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  iconFill,
  value,
  trailing,
  chevron,
  onPress,
  disabled,
  destructive,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ListRowProps) {
  const showChevron = chevron ?? (!!onPress && !trailing);
  const body = (
    <>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: iconFill ?? (destructive ? colors.dangerSoft : colors.accentTint) }]}>
          <Icon name={icon} size={20} color={iconColor ?? (destructive ? colors.danger : colors.accent)} />
        </View>
      ) : null}
      <View style={styles.labels}>
        <AppText size={16} weight="medium" color={destructive ? colors.danger : colors.text}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={13} color={colors.faint}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText size={15} color={colors.faint} numberOfLines={1} style={styles.value}>
          {value}
        </AppText>
      ) : null}
      {trailing}
      {showChevron ? <Icon name="forward" size={18} color={colors.placeholder} /> : null}
    </>
  );
  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join('، ');
  if (!onPress) {
    return (
      <View
        style={[styles.row, { flexDirection: row }, style]}
        accessible={!trailing}
        accessibilityLabel={trailing ? undefined : label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.row,
        { flexDirection: row },
        pressed && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.5 },
        style,
      ]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 11, minHeight: 56 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1, gap: 2 },
  value: { flexShrink: 1, maxWidth: '45%' },
});
