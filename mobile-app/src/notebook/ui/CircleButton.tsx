/**
 * Round icon button (Figma circleBtn): 40 pt on regular windows, 36 pt on compact ones, white with a
 * border by default. Also the Figma pill buttons (primaryBtn / secondaryBtn) as PillButton, which the
 * dialogs, sheets and empty states share.
 */
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

import { useWidthClass } from './layout';

export type CircleTone = 'surface' | 'muted' | 'accent' | 'soft' | 'danger' | 'clear';

const TONES: Record<CircleTone, { bg: string; fg: string; border?: string }> = {
  surface: { bg: colors.surface, fg: colors.text, border: colors.border },
  muted: { bg: colors.surfaceMuted, fg: colors.text },
  accent: { bg: colors.accent, fg: '#FFFFFF' },
  soft: { bg: colors.accentTint, fg: colors.accent },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  clear: { bg: 'transparent', fg: colors.text },
};

export interface CircleButtonProps {
  icon: IconName;
  /** Screen-reader name (the button has no visible text). */
  label: string;
  hint?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  tone?: CircleTone;
  /** Overrides the 40 / 36 pt size. */
  size?: number;
  iconSize?: number;
  /** Icon color override. */
  color?: string;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function CircleButton({
  icon,
  label,
  hint,
  onPress,
  onLongPress,
  tone = 'surface',
  size,
  iconSize,
  color,
  selected,
  disabled,
  style,
}: CircleButtonProps) {
  const compact = useWidthClass() === 'compact';
  const d = size ?? (compact ? 36 : 40);
  const t = selected ? TONES.accent : TONES[tone];
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={d < 44 ? (44 - d) / 2 : 0}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, selected: selected === undefined ? undefined : selected }}
      style={({ pressed }) => [
        styles.circle,
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: t.bg,
          borderColor: t.border ?? 'transparent',
          borderWidth: t.border ? 1 : 0,
        },
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.8 },
        style,
      ]}>
      <Icon name={icon} size={iconSize ?? Math.round(d * 0.45)} color={color ?? t.fg} />
    </Pressable>
  );
}

export type PillVariant = 'primary' | 'secondary' | 'neutral' | 'danger' | 'dangerSoft' | 'link';

const PILL: Record<PillVariant, { bg: string; fg: string }> = {
  primary: { bg: colors.accent, fg: '#FFFFFF' },
  secondary: { bg: colors.accentSoft, fg: colors.accentDark },
  /** The grey 'إلغاء' of Figma 05. */
  neutral: { bg: colors.surfaceMuted, fg: colors.muted },
  danger: { bg: colors.danger, fg: '#FFFFFF' },
  dangerSoft: { bg: colors.dangerSoft, fg: colors.danger },
  link: { bg: 'transparent', fg: colors.accent },
};

export interface PillButtonProps {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: PillVariant;
  /** 'md' = Figma primaryBtn (17 bold, 15 pt vertical padding); 'sm' = the compact 14 pt form. */
  size?: 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
  /** Fill the parent's width (sheet footers, compact dialogs). */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PillButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  hint,
  block,
  style,
}: PillButtonProps) {
  const c = PILL[variant];
  const sm = size === 'sm';
  const strong = variant === 'primary' || variant === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.pill,
        {
          flexDirection: row,
          backgroundColor: c.bg,
          paddingHorizontal: variant === 'link' ? 6 : sm ? 16 : 24,
          minHeight: sm ? 40 : 50,
        },
        block && styles.block,
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : icon ? (
        <Icon name={icon} size={sm ? 16 : 20} color={c.fg} />
      ) : null}
      <View style={styles.pillLabel}>
        <AppText size={sm ? 14 : strong ? 17 : 16} weight={strong ? 'bold' : 'semibold'} color={c.fg} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  pill: { alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999 },
  pillLabel: { flexShrink: 1 },
  block: { alignSelf: 'stretch' },
});
