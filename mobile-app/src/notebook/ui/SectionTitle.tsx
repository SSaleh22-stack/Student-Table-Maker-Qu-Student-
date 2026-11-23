/**
 * A library section title (Figma sectionTitle / showAll): the title (18 bold) and an optional
 * subtitle ('من جدولك') at the reading start; at the end the 'عرض الكل (n)' link and an optional
 * action ('مجلد جديد') separated by a thin bar (NB-10a: "New folder" sits next to "Show all").
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

export interface SectionAction {
  label: string;
  icon?: IconName;
  onPress: () => void;
  hint?: string;
}

export interface SectionTitleProps {
  title: string;
  subtitle?: string;
  /** Total items in the section; the 'عرض الكل (n)' link shows when this and onShowAll are given. */
  showAllCount?: number;
  onShowAll?: () => void;
  action?: SectionAction;
  /** Any other control at the end (after the action). */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 'عرض الكل (6)' / 'Show all (6)'. */
export function showAllLabel(n: number): string {
  return tr('عرض الكل (' + n + ')', 'Show all (' + n + ')');
}

export function SectionTitle({ title, subtitle, showAllCount, onShowAll, action, trailing, style }: SectionTitleProps) {
  const showAll = showAllCount !== undefined && onShowAll ? (
    <Pressable
      onPress={onShowAll}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={tr(`عرض الكل، ${showAllCount} في ${title}`, `Show all ${showAllCount} in ${title}`)}
      style={({ pressed }) => [styles.link, { flexDirection: row }, pressed && styles.pressed]}>
      <AppText size={14} weight="bold" color={colors.accent}>
        {showAllLabel(showAllCount)}
      </AppText>
      <Icon name="forward" size={16} color={colors.accent} />
    </Pressable>
  ) : null;
  const act = action ? (
    <Pressable
      onPress={action.onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityHint={action.hint}
      style={({ pressed }) => [styles.link, { flexDirection: row }, pressed && styles.pressed]}>
      {action.icon ? <Icon name={action.icon} size={18} color={colors.accent} /> : null}
      <AppText size={14} weight="bold" color={colors.accent}>
        {action.label}
      </AppText>
    </Pressable>
  ) : null;
  return (
    <View style={[styles.row, { flexDirection: row }, style]}>
      <View style={[styles.titles, { flexDirection: row }]}>
        <AppText size={18} weight="bold" accessibilityRole="header" style={styles.shrink}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={13} color={colors.faint} numberOfLines={1} style={styles.shrink}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.end, { flexDirection: row }]}>
        {showAll}
        {showAll && act ? <View style={styles.bar} /> : null}
        {act}
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: 10, minHeight: 32 },
  titles: { flex: 1, alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
  end: { alignItems: 'center', gap: 14 },
  link: { alignItems: 'center', gap: 4 },
  bar: { width: 1, height: 16, backgroundColor: colors.border },
  pressed: { opacity: 0.7 },
});
