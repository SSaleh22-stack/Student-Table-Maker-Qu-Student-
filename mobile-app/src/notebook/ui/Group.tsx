/**
 * A settings group (Figma group): a white card (radius 22, border) holding rows separated by 1 pt
 * dividers, with an optional label above it (Figma 15: 'النسخ الاحتياطي', 'الكتابة', 'التخزين').
 * null / false children are skipped, so rows can be conditional.
 */
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors } from '@/lib/theme';

export interface GroupProps {
  /** The small label above the card. */
  title?: string;
  /** A line under the card (footnote). */
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Group({ title, footer, children, style }: GroupProps) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.wrap, style]}>
      {title ? (
        <AppText size={14} weight="semibold" color={colors.faint} style={styles.title} accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      <View style={styles.card}>
        {rows.map((r, i) => (
          <Fragment key={r.key ?? i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {r}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <AppText size={13} color={colors.faint} style={styles.footer}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { paddingHorizontal: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.divider },
  footer: { paddingHorizontal: 8 },
});
