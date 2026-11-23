/**
 * The notebook's large modal (Figma 04 'مذكرة جديدة', 05 'استلام ملف PDF', 14 'مشاركة وتصدير').
 *
 * - regular (>= 600 pt window): the 620 pt centered card: radius 28, padding 28, gap 20, a header with
 *   the title (22 bold), an optional subtitle (14 faint) and a round close button; the body scrolls when
 *   the screen is short; the footer (the primary button) sits under the body.
 * - compact (< 600 pt): a full-height bottom sheet (it shrinks above the keyboard) with a top grabber, safe-area padding, the same
 *   header, a scrolling body and a sticky footer for the primary button above the home indicator.
 *
 * The scrolling body gets an EXPLICIT width (nbModalBodyWidth): on the iPad the body's content was
 * laid out at its own content width instead of the card's, which squashed rows whose children grow to
 * fill them (the setup's two choice cards). Rows can rely on the full width with this.
 *
 * Plain React Native Modal (transparent), so Android back closes it (unless dismissable is false).
 * The sheet moves up over the keyboard (the title field of Figma 04).
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
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { nbRadius } from '@/notebook/theme';

import { CircleButton } from './CircleButton';
import { MODAL_ORIENTATIONS, useWidthClass } from './layout';
import { physicalPadding } from './physical';

/** Figma modal width on tablets. */
export const NB_MODAL_WIDTH = 620;
/** Card padding on tablets and the sheet's side padding on phones. */
const CARD_PAD = 28;
const SHEET_PAD_X = 20;

/**
 * Width of the modal's content column (inside the padding): the card's inner width on regular windows,
 * the sheet's inner width on compact ones.
 */
export function nbModalBodyWidth(o: { compact: boolean; windowWidth: number; insetLeft: number; insetRight: number; width?: number }): number {
  if (o.compact) return Math.max(0, o.windowWidth - o.insetLeft - o.insetRight - 2 * SHEET_PAD_X);
  return Math.max(0, Math.min(o.width ?? NB_MODAL_WIDTH, o.windowWidth - 48) - 2 * CARD_PAD);
}

export interface NbModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** The primary action area (sticky at the bottom on compact). */
  footer?: ReactNode;
  /** Card width on regular windows (default 620). */
  width?: number;
  /** false: the backdrop, Android back and the close button do nothing (e.g. while importing). */
  dismissable?: boolean;
  /** Hides the round close button (the footer has its own cancel). */
  hideClose?: boolean;
  /** Wrap the body in a ScrollView (default true). */
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}

function Header({ title, subtitle, onClose, showClose }: { title: string; subtitle?: string; onClose: () => void; showClose: boolean }) {
  return (
    <View style={[styles.head, { flexDirection: row }]}>
      <View style={styles.headText}>
        <AppText size={22} weight="bold" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={14} color={colors.faint}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {showClose ? <CircleButton icon="x" label={tr('إغلاق', 'Close')} tone="muted" size={40} iconSize={18} onPress={onClose} /> : null}
    </View>
  );
}

export function NbModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = NB_MODAL_WIDTH,
  dismissable = true,
  hideClose,
  scroll = true,
  style,
}: NbModalProps) {
  const compact = useWidthClass() === 'compact';
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const close = () => {
    if (dismissable) onClose();
  };
  const showClose = !hideClose && dismissable;
  const bodyW = nbModalBodyWidth({ compact, windowWidth: win.width, insetLeft: insets.left, insetRight: insets.right, width });
  // The content column's full width, padding included (compact pads inside the scroll content).
  const contentW = compact ? bodyW + 2 * SHEET_PAD_X : bodyW;
  const body = scroll ? (
    <ScrollView
      style={compact ? styles.flex : styles.shrink}
      contentContainerStyle={[compact ? styles.bodyCompact : styles.bodyRegular, { width: contentW }]}
      bounces={false}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled">
      {visible ? children : null}
    </ScrollView>
  ) : (
    <View style={[compact ? [styles.flex, styles.bodyCompact] : [styles.shrink, styles.bodyRegular], { width: contentW }]}>{visible ? children : null}</View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={[styles.backdrop, compact ? styles.backdropCompact : styles.backdropRegular, physicalPadding(insets.left, insets.right)]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={tr('إغلاق', 'Close')}
          disabled={!dismissable}
        />
        {compact ? (
          <Animated.View
            entering={SlideInDown.duration(220)}
            accessibilityViewIsModal
            style={[styles.sheet, shadow, { marginTop: insets.top + 8 }, style]}>
            <View style={styles.grab} />
            <View style={styles.sheetHead}>
              <Header title={title} subtitle={subtitle} onClose={close} showClose={showClose} />
            </View>
            {body}
            {footer ? (
              <View style={[styles.footerCompact, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>{footer}</View>
            ) : (
              <View style={{ height: insets.bottom }} />
            )}
          </Animated.View>
        ) : (
          <View
            accessibilityViewIsModal
            style={[
              styles.card,
              shadow,
              { width: Math.min(width, win.width - 48), maxHeight: win.height - insets.top - insets.bottom - 48 },
              style,
            ]}>
            <Header title={title} subtitle={subtitle} onClose={close} showClose={showClose} />
            {body}
            {footer ? <View style={styles.footerRegular}>{footer}</View> : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  backdropRegular: { alignItems: 'center', justifyContent: 'center' },
  backdropCompact: { justifyContent: 'flex-end' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  // flexShrink: with the keyboard up (the title field of Figma 04) the card shrinks to the room left
  // and the body scrolls, instead of running off the top of the screen.
  card: { flexShrink: 1, backgroundColor: colors.surface, borderRadius: nbRadius.modal, padding: CARD_PAD, gap: 20 },
  bodyRegular: { gap: 20, alignItems: 'stretch' },
  footerRegular: { gap: 12 },
  sheet: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: nbRadius.modal,
    borderTopRightRadius: nbRadius.modal,
  },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1', marginTop: 10 },
  sheetHead: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  head: { alignItems: 'center', gap: 12 },
  headText: { flex: 1, gap: 2 },
  bodyCompact: { paddingHorizontal: SHEET_PAD_X, paddingBottom: 16, gap: 18, alignItems: 'stretch' },
  footerCompact: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
});
