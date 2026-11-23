/**
 * A radio choice (Figma 05 'مذكرة جديدة' / 'إضافة إلى مذكرة موجودة'): a 24 pt ring with a 12 pt dot,
 * a label and an optional subtitle, in a bordered card that turns accent-tinted when selected.
 * Text wraps freely, so long labels never clip on phones.
 *
 * RadioGroup lays several out: stacked by default (Figma 05), or side by side with
 * direction 'row', which wraps to a column on compact windows.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

import { useWidthClass } from './layout';

export interface RadioRowProps {
  label: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** Extra content under the labels while selected (e.g. a picker for the chosen option). */
  children?: ReactNode;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function RadioRow({ label, subtitle, selected, onPress, icon, disabled, children, accessibilityHint, style }: RadioRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={subtitle ? `${label}، ${subtitle}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.card,
        selected ? styles.cardOn : null,
        pressed && !selected && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.5 },
        style,
      ]}>
      <View style={[styles.line, { flexDirection: row }]}>
        <View style={[styles.ring, { borderColor: selected ? colors.accent : colors.borderStrong }]}>
          {selected ? <View style={styles.dot} /> : null}
        </View>
        {icon ? <Icon name={icon} size={20} color={selected ? colors.accent : colors.muted} /> : null}
        <View style={styles.labels}>
          <AppText size={16} weight={selected ? 'bold' : 'medium'}>
            {label}
          </AppText>
          {subtitle ? (
            <AppText size={13} color={colors.faint}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>
      {selected && children ? <View style={styles.extra}>{children}</View> : null}
    </Pressable>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  subtitle?: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** 'column' (default) stacks them; 'row' puts them side by side and wraps on compact windows. */
  direction?: 'column' | 'row';
  /** Screen-reader name of the whole group. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function RadioGroup<T extends string>({ options, value, onChange, direction = 'column', label, style }: RadioGroupProps<T>) {
  const compact = useWidthClass() === 'compact';
  const side = direction === 'row';
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        styles.group,
        side ? { flexDirection: row, flexWrap: compact ? 'wrap' : 'nowrap' } : null,
        style,
      ]}>
      {options.map((o) => (
        <RadioRow
          key={o.value}
          label={o.label}
          subtitle={o.subtitle}
          icon={o.icon}
          disabled={o.disabled}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
          style={side ? (compact ? styles.fullWidth : styles.flexCell) : null}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentTint, paddingHorizontal: 15, paddingVertical: 13 },
  line: { alignItems: 'center', gap: 12 },
  ring: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  labels: { flex: 1, gap: 2 },
  extra: { marginTop: 12 },
  group: { gap: 10 },
  flexCell: { flex: 1 },
  fullWidth: { width: '100%' },
});
