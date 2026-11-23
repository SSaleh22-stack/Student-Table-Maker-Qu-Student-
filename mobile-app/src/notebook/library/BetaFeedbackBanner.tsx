/**
 * The Beta feedback banner of the library (Figma 02 'beta-feedback', NB-4): the message icon in a
 * white tile, 'المذكرات ميزة تجريبية — شاركنا رأيك أو أبلغ عن مشكلة', and 'أرسل ملاحظة' at the end,
 * which opens the existing /feedback screen with the Notebook topic. The whole banner is one button.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { openNotebookFeedback } from '@/notebook/nav';
import { nbRadius } from '@/notebook/theme';

export function BetaFeedbackBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const text = tr('المذكرات ميزة تجريبية — شاركنا رأيك أو أبلغ عن مشكلة', 'The notebook is in beta. Share your thoughts or report a problem');
  const action = tr('أرسل ملاحظة', 'Send feedback');
  return (
    <Pressable
      onPress={openNotebookFeedback}
      accessibilityRole="button"
      accessibilityLabel={`${text}. ${action}`}
      style={({ pressed }) => [styles.box, { flexDirection: row }, pressed && styles.pressed, style]}>
      <View style={styles.tile}>
        <Icon name="message" size={18} color={colors.accentDark} />
      </View>
      <AppText size={14} weight="medium" color={colors.accentDark} style={styles.text}>
        {text}
      </AppText>
      <AppText size={14} weight="bold" color={colors.accent}>
        {action}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: nbRadius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.85 },
  tile: { backgroundColor: colors.surface, borderRadius: 10, padding: 7 },
  text: { flex: 1 },
});
