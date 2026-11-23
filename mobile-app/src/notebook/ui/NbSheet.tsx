/**
 * A smaller picker / action sheet: a bottom sheet on compact windows, a centered card on regular
 * ones. Modeled on src/components/tasks/PickerSheet.tsx (copied, not imported): dimmed backdrop,
 * white sheet with a grab bar, a title and a 'إلغاء' link; the content scrolls when the screen is
 * short (landscape phones) and moves up over the keyboard. Children mount only while open, so each
 * opening starts from the current value.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { nbRadius } from '@/notebook/theme';

import { MODAL_ORIENTATIONS, useWidthClass } from './layout';
import { physicalPadding } from './physical';

export interface NbSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling content (e.g. a primary button). */
  footer?: ReactNode;
  /** The header link (default 'إلغاء'); null hides it. */
  cancelLabel?: string | null;
  /** Card width on regular windows (default 480). */
  width?: number;
  /** Wrap the content in a ScrollView (default true). Turn off for content that scrolls itself. */
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function NbSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  cancelLabel,
  width = 480,
  scroll = true,
  style,
}: NbSheetProps) {
  const compact = useWidthClass() === 'compact';
  const insets = useSafeAreaInsets();
  const { height, width: winW } = useWindowDimensions();
  const cancel = cancelLabel === undefined ? tr('إلغاء', 'Cancel') : cancelLabel;
  const content = visible ? children : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.backdrop, compact ? styles.atBottom : styles.centered, physicalPadding(insets.left, insets.right)]}
        behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr('إغلاق', 'Close')}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            shadow,
            compact
              ? [styles.sheetCompact, { maxHeight: height - insets.top - 12, paddingBottom: Math.max(16, insets.bottom + 8) }]
              : [styles.sheetRegular, { width: Math.min(width, winW - 48), maxHeight: height - insets.top - insets.bottom - 48 }],
            style,
          ]}>
          {compact ? <View style={styles.grab} /> : null}
          <View style={[styles.head, { flexDirection: row }]}>
            <View style={styles.headText}>
              <AppText size={20} weight="bold" accessibilityRole="header">
                {title}
              </AppText>
              {subtitle ? (
                <AppText size={13} color={colors.faint}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            {cancel ? (
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={cancel} hitSlop={10}>
                <AppText size={15} weight="medium" color={colors.accentDark}>
                  {cancel}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {scroll ? (
            <ScrollView
              style={styles.shrink}
              bounces={false}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">
              {content}
            </ScrollView>
          ) : (
            <View style={styles.shrink}>{content}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  atBottom: { justifyContent: 'flex-end' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  sheet: { flexShrink: 1, backgroundColor: colors.surface, paddingHorizontal: 18 },
  sheetCompact: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  sheetRegular: { borderRadius: nbRadius.modal, paddingHorizontal: 22, paddingVertical: 18 },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1', marginTop: 10 },
  head: { alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 8, minHeight: 36 },
  headText: { flex: 1, gap: 2 },
  shrink: { flexShrink: 1 },
  footer: { paddingTop: 12, gap: 10 },
});
