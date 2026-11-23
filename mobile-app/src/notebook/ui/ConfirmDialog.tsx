/**
 * A small centered dialog (both width classes): optional icon tile, title, message, then 'إلغاء' at
 * the reading start and the confirm button at the end (Figma 05 button order). The buttons share the
 * row on compact windows.
 *
 * DialogFrame is the shared shell (TextPromptDialog and LowStorageWarning use it too).
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
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { alignStart, row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { nbRadius } from '@/notebook/theme';

import { PillButton, type PillVariant } from './CircleButton';
import { MODAL_ORIENTATIONS, useWidthClass } from './layout';

export interface DialogFrameProps {
  visible: boolean;
  title: string;
  message?: string;
  icon?: IconName;
  /** 'info' accent tile, 'warn' warning tile, 'danger' red tile. */
  tone?: 'info' | 'warn' | 'danger';
  /** Backdrop tap and Android back. */
  onDismiss: () => void;
  children?: ReactNode;
  /** The buttons row. */
  actions: ReactNode;
}

const TILE = {
  info: { bg: colors.accentTint, fg: colors.accent },
  warn: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function DialogFrame({ visible, title, message, icon, tone = 'info', onDismiss, children, actions }: DialogFrameProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const t = TILE[tone];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}
        behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={tr('إغلاق', 'Close')}
        />
        <View accessibilityViewIsModal style={[styles.card, shadow, { width: Math.min(440, width - 32) }]}>
          {/* Shrinks and scrolls when the room above the keyboard is short (a rename on a landscape
              phone), so the field and the buttons stay on screen. */}
          <ScrollView
            style={styles.shrink}
            contentContainerStyle={styles.body}
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {icon ? (
              <View style={[styles.tile, { backgroundColor: t.bg, alignSelf: alignStart }]}>
                <Icon name={icon} size={24} color={t.fg} />
              </View>
            ) : null}
            <View style={styles.texts}>
              <AppText size={19} weight="bold" color={tone === 'warn' ? colors.warning : colors.text} accessibilityRole="header">
                {title}
              </AppText>
              {message ? (
                <AppText size={15} color={colors.muted} style={styles.message}>
                  {message}
                </AppText>
              ) : null}
            </View>
            {visible ? children : null}
          </ScrollView>
          {actions}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface DialogActionsProps {
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmVariant?: PillVariant;
  confirmIcon?: IconName;
  confirmDisabled?: boolean;
  busy?: boolean;
}

/** 'إلغاء' at the reading start, the confirm button at the end. */
export function DialogActions({
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmVariant = 'primary',
  confirmIcon,
  confirmDisabled,
  busy,
}: DialogActionsProps) {
  const compact = useWidthClass() === 'compact';
  return (
    <View style={[styles.actions, { flexDirection: row }]}>
      <PillButton
        label={cancelLabel ?? tr('إلغاء', 'Cancel')}
        variant="neutral"
        size="sm"
        onPress={onCancel}
        disabled={busy}
        style={compact ? styles.flex : styles.cancel}
      />
      <PillButton
        label={confirmLabel}
        variant={confirmVariant}
        icon={confirmIcon}
        size="sm"
        onPress={onConfirm}
        disabled={confirmDisabled}
        loading={busy}
        style={styles.flex}
      />
    </View>
  );
}

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Red confirm button and icon tile (delete, empty trash). */
  destructive?: boolean;
  icon?: IconName;
  busy?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive,
  icon,
  busy,
  children,
}: ConfirmDialogProps) {
  return (
    <DialogFrame
      visible={visible}
      title={title}
      message={message}
      icon={icon ?? (destructive ? 'trash' : undefined)}
      tone={destructive ? 'danger' : 'info'}
      onDismiss={() => {
        if (!busy) onCancel();
      }}
      actions={
        <DialogActions
          cancelLabel={cancelLabel}
          confirmLabel={confirmLabel}
          onCancel={onCancel}
          onConfirm={onConfirm}
          confirmVariant={destructive ? 'danger' : 'primary'}
          busy={busy}
        />
      }>
      {children}
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  card: { flexShrink: 1, backgroundColor: colors.surface, borderRadius: nbRadius.modal, padding: 24, gap: 16 },
  shrink: { flexShrink: 1 },
  body: { gap: 16 },
  tile: { borderRadius: 14, padding: 11 },
  texts: { gap: 6 },
  message: { lineHeight: 23 },
  actions: { gap: 10, alignItems: 'center' },
  flex: { flex: 1 },
  cancel: { minWidth: 120 },
});
