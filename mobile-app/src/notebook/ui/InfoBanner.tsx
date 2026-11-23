/**
 * An inline banner.
 * - tone 'info' (Figma 16 'تُحذف المذكرات نهائياً بعد 30 يوماً…'): accent tint, a plain 18 pt info icon
 *   and 14 pt regular accent-dark text, gap 8. With `bordered` it is the Figma 02 Beta feedback banner:
 *   accent border, the icon in a small white tile (radius 10, padding 7) and medium text.
 * - tone 'warn' (Figma 17 low storage, Figma 12 continue recording): warning soft, warning border and
 *   text, an alert icon in a white tile (radius 12, padding 9).
 * An optional action link sits at the end ('أرسل ملاحظة', 'عرض التخزين'), and an optional close button.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { nbColors } from '@/notebook/theme';

export interface InfoBannerProps {
  tone?: 'info' | 'warn';
  text: string;
  title?: string;
  icon?: IconName;
  bordered?: boolean;
  action?: { label: string; onPress: () => void; hint?: string };
  onClose?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function InfoBanner({ tone = 'info', text, title, icon, bordered, action, onClose, style }: InfoBannerProps) {
  const warn = tone === 'warn';
  const fg = warn ? colors.warning : colors.accentDark;
  const linkColor = warn ? colors.warning : colors.accent;
  return (
    <View
      style={[
        styles.box,
        { flexDirection: row, backgroundColor: warn ? colors.warningSoft : colors.accentTint },
        warn ? styles.warnBox : bordered ? styles.infoBorder : null,
        style,
      ]}>
      <View
        style={[styles.content, { flexDirection: row, gap: warn || title ? 12 : bordered ? 10 : 8 }]}
        accessible
        accessibilityRole={warn ? 'alert' : 'text'}
        accessibilityLabel={title ? `${title}. ${text}` : text}>
        {warn || title ? (
          <View style={styles.tile}>
            <Icon name={icon ?? (warn ? 'alert' : 'info')} size={warn ? 22 : 18} color={fg} />
          </View>
        ) : bordered ? (
          <View style={styles.tileSmall}>
            <Icon name={icon ?? 'info'} size={18} color={fg} />
          </View>
        ) : (
          <Icon name={icon ?? 'info'} size={18} color={fg} />
        )}
        <View style={styles.texts}>
          {title ? (
            <AppText size={16} weight="bold" color={fg}>
              {title}
            </AppText>
          ) : null}
          <AppText size={14} weight={!title && bordered ? 'medium' : 'regular'} color={fg}>
            {text}
          </AppText>
        </View>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.hint}
          style={({ pressed }) => pressed && { opacity: 0.7 }}>
          <AppText size={14} weight="bold" color={linkColor}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('إغلاق', 'Close')}>
          <Icon name="x" size={16} color={fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  warnBox: { borderWidth: 1, borderColor: nbColors.warningBorder, borderRadius: 18, paddingVertical: 14 },
  infoBorder: { borderWidth: 1, borderColor: colors.accentBorder, paddingHorizontal: 14, paddingVertical: 10 },
  content: { flex: 1, alignItems: 'center' },
  tile: { backgroundColor: colors.surface, borderRadius: 12, padding: 9 },
  tileSmall: { backgroundColor: colors.surface, borderRadius: 10, padding: 7 },
  texts: { flex: 1, gap: 2 },
});
