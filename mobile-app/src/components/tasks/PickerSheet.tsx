/**
 * The bottom sheet frame shared by the task date, time and custom reminder pickers: dimmed
 * backdrop, white sheet with a grab bar, a title and a "Cancel" link. Plain React Native Modal,
 * so it works on web too.
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { padSides } from '@/lib/insets';
import { row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';

export function PickerSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // A landscape phone is shorter than the date or time picker: cap the sheet and let it scroll,
  // so the title, Cancel and the month buttons stay reachable.
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* The custom reminder sheet has a number field: the sheet moves up over the keyboard. Android
          too, since under edge-to-edge the dialog window no longer resizes for it. */}
      <KeyboardAvoidingView
        style={[styles.backdrop, padSides(insets.left, insets.right)]}
        behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr('إغلاق', 'Close')}
        />
        <View
          style={[
            styles.sheet,
            shadow,
            { maxHeight: height - insets.top - 12, paddingBottom: Math.max(16, insets.bottom + 8) },
          ]}
          accessibilityViewIsModal>
          <View style={styles.grab} />
          <View style={[styles.head, { flexDirection: row }]}>
            <AppText size={20} weight="bold" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </AppText>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
              <AppText size={15} weight="medium" color={colors.accentDark}>
                {tr('إلغاء', 'Cancel')}
              </AppText>
            </Pressable>
          </View>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Mounted only while open, so each opening starts from the current value. */}
            {visible ? children : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  // Shrinks to the room left above the keyboard, so the inner ScrollView scrolls instead of the
  // sheet running off the top of the screen.
  sheet: {
    flexShrink: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
  },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1', marginTop: 10 },
  head: { alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 8, minHeight: 36 },
});
