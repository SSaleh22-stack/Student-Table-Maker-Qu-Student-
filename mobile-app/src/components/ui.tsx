/**
 * Small shared building blocks: buttons, cards, chips and the screen header.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors, radius } from '@/lib/theme';

type ButtonVariant = 'primary' | 'soft' | 'outline' | 'danger' | 'ghost';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.accent, fg: '#FFFFFF' },
  soft: { bg: colors.accentSoft, fg: colors.accentDark },
  outline: { bg: colors.surface, fg: colors.text, border: '#CBD8E3' },
  danger: { bg: colors.surface, fg: colors.danger, border: colors.dangerBorder },
  ghost: { bg: 'transparent', fg: colors.accentDark },
};

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const c = BUTTON_COLORS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : null,
        { backgroundColor: c.bg, borderColor: c.border ?? 'transparent', borderWidth: c.border ? 1 : 0 },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 15 : 18} color={c.fg} />
      ) : null}
      <AppText weight="semibold" size={size === 'sm' ? 13 : 15} color={c.fg}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  tone = 'surface',
  size = 40,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  tone?: 'surface' | 'muted' | 'soft';
  size?: number;
}) {
  const bg = tone === 'surface' ? colors.surface : tone === 'soft' ? colors.accentSoft : colors.bg;
  const fg = tone === 'soft' ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: 14,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && { opacity: 0.8 },
      ]}>
      <Icon name={icon} size={Math.round(size * 0.46)} color={fg} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && styles.chipOn]}>
      <AppText size={12} weight={selected ? 'semibold' : 'medium'} color={selected ? '#FFFFFF' : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Small colored tag, e.g. "✓ 02" or "تعارض". */
export function Tag({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'muted' | 'accent' | 'danger' }) {
  const t = {
    ok: { bg: colors.successSoft, fg: colors.success },
    warn: { bg: colors.clashSoft, fg: colors.clash },
    muted: { bg: colors.surfaceMuted, fg: colors.muted },
    accent: { bg: colors.accentSoft, fg: colors.accentDark },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
      <AppText size={11} weight="semibold" color={t.fg}>
        {label}
      </AppText>
    </View>
  );
}

/** Course code badge in the course's color. `large` is for tablets. */
export function CodeBadge({ code, bg, fg, large }: { code: string; bg: string; fg: string; large?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: large ? 9 : 7,
        paddingHorizontal: large ? 10 : 7,
        paddingVertical: large ? 3 : 1,
        minWidth: large ? 84 : 60,
      }}>
      <AppText size={large ? 14 : 11} weight="bold" color={fg} align="center">
        {code}
      </AppText>
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {leading}
      <View style={{ flex: 1 }}>
        <AppText weight="bold" size={22}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={12} color={colors.muted}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    flexDirection: row,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 16,
  },
  buttonSm: { minHeight: 34, paddingHorizontal: 12, borderRadius: 999, gap: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 14 },
  chip: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  header: { flexDirection: row, alignItems: 'center', gap: 10, minHeight: 44 },
});
