/**
 * 'الحفظ في' location chips (Figma 04, 05): the course folders' codes first (store.courseFolders:
 * timetable courses, then orphan course folders), then the student's folders, then 'بدون مجلد'.
 * The chips wrap onto more lines when they do not fit (always on phones).
 *
 * Also the kit's chip (NbChip, Figma chip) and a single-choice chip group (ChipGroup), which the
 * paper size picker, the toolbar-position choice and the page-range choice use.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { encodeLoc, type LocationKey } from '@/notebook/core/model';
import { useNotebooks } from '@/notebook/store/hooks';

export interface NbChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** 14 by default; the page-size chips use 13. */
  size?: number;
  disabled?: boolean;
  /** Spoken name when it differs from the label (e.g. 'CS102، البرمجة 2'). */
  accessibilityLabel?: string;
  /** 'radio' inside single-choice groups (default), 'button' for plain actions. */
  role?: 'radio' | 'button';
  style?: StyleProp<ViewStyle>;
}

export function NbChip({ label, selected, onPress, icon, size = 14, disabled, accessibilityLabel, role = 'radio', style }: NbChipProps) {
  const on = !!selected;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === 'radio' ? { checked: on, disabled: !!disabled } : { selected: on, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        { flexDirection: row, paddingHorizontal: size < 14 ? 12 : 16 },
        on ? styles.chipOn : styles.chipOff,
        pressed && !on && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.5 },
        style,
      ]}>
      {icon ? <Icon name={icon} size={16} color={on ? '#FFFFFF' : colors.muted} /> : null}
      <AppText size={size} weight={on ? 'semibold' : 'medium'} color={on ? '#FFFFFF' : colors.muted} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export interface ChipGroupProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  /** Screen-reader name of the group, e.g. 'الحفظ في'. */
  label?: string;
  size?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/** Single-choice chips that wrap, first chip at the reading start. */
export function ChipGroup<T extends string>({ options, value, onChange, label, size, gap = 8, style }: ChipGroupProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.group, { flexDirection: row, gap }, style]}>
      {options.map((o) => (
        <NbChip
          key={o.value}
          label={o.label}
          icon={o.icon}
          size={size}
          disabled={o.disabled}
          accessibilityLabel={o.accessibilityLabel}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

export interface LocationChipsProps {
  value: LocationKey;
  onChange: (l: LocationKey) => void;
  /** Hide 'بدون مجلد' (default shown). */
  hideUnfiled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LocationChips({ value, onChange, hideUnfiled, style }: LocationChipsProps) {
  const store = useNotebooks();
  const options: (ChipOption<string> & { loc: LocationKey })[] = [];
  for (const c of store.courseFolders) {
    const loc: LocationKey = { kind: 'course', code: c.code };
    options.push({
      value: encodeLoc(loc),
      loc,
      label: c.code,
      icon: 'notebookPen',
      accessibilityLabel: c.name && c.name !== c.code ? `${c.code}، ${c.name}` : c.code,
    });
  }
  for (const f of [...store.folders].sort((a, b) => a.order - b.order)) {
    const loc: LocationKey = { kind: 'folder', id: f.id };
    options.push({ value: encodeLoc(loc), loc, label: f.name, icon: 'folder' });
  }
  if (!hideUnfiled) {
    const loc: LocationKey = { kind: 'unfiled' };
    options.push({ value: encodeLoc(loc), loc, label: tr('بدون مجلد', 'No folder') });
  }
  const byValue = new Map(options.map((o) => [o.value, o.loc]));
  return (
    <ChipGroup
      options={options}
      value={encodeLoc(value)}
      label={tr('الحفظ في', 'Save in')}
      onChange={(v) => {
        const loc = byValue.get(v);
        if (loc) onChange(loc);
      }}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', gap: 6, minHeight: 38, paddingVertical: 8, borderRadius: 999 },
  chipOn: { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  group: { flexWrap: 'wrap', alignItems: 'center' },
});
