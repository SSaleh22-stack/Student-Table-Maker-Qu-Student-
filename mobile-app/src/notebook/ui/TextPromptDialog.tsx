/**
 * A dialog with one text field (rename a notebook, a folder or a recording; new folder). The field
 * starts with `initialValue` each time the dialog opens, selects it, and submits on the keyboard's
 * Done. The confirm button stays disabled while the trimmed text is empty or unchanged (when
 * requireChange), or when validate() returns an error, which shows under the field.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { inputDir } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';

import { DialogActions, DialogFrame } from './ConfirmDialog';

export interface TextPromptDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  /** The field's accessibility label (and visible label above it). */
  fieldLabel?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called with the trimmed text. */
  onSubmit: (text: string) => void;
  onCancel: () => void;
  /** Default 200 (the model's title limit). */
  maxLength?: number;
  /** Disable confirm while the text equals initialValue. */
  requireChange?: boolean;
  /** An error message for the trimmed text, or null when it is fine. */
  validate?: (text: string) => string | null;
  icon?: IconName;
  busy?: boolean;
}

function PromptBody({
  initialValue,
  placeholder,
  fieldLabel,
  maxLength,
  requireChange,
  validate,
  confirmLabel,
  cancelLabel,
  onSubmit,
  onCancel,
  busy,
}: Omit<TextPromptDialogProps, 'visible' | 'title' | 'message' | 'icon'>) {
  const [text, setText] = useState(initialValue ?? '');
  const trimmed = text.trim();
  const error = trimmed && validate ? validate(trimmed) : null;
  const unchanged = !!requireChange && trimmed === (initialValue ?? '').trim();
  const disabled = !trimmed || !!error || unchanged || !!busy;
  const submit = () => {
    if (!disabled) onSubmit(trimmed);
  };
  return (
    <View style={styles.body}>
      {fieldLabel ? (
        <AppText size={14} weight="semibold" color={colors.muted}>
          {fieldLabel}
        </AppText>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        autoFocus
        selectTextOnFocus
        maxLength={maxLength ?? 200}
        returnKeyType="done"
        onSubmitEditing={submit}
        submitBehavior="blurAndSubmit"
        editable={!busy}
        accessibilityLabel={fieldLabel ?? placeholder}
        style={[styles.input, inputDir(), error ? styles.inputError : null]}
      />
      {error ? (
        <AppText size={13} color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <DialogActions
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel ?? tr('حفظ', 'Save')}
        onCancel={onCancel}
        onConfirm={submit}
        confirmDisabled={disabled}
        busy={busy}
      />
    </View>
  );
}

export function TextPromptDialog({ visible, title, message, icon, onCancel, busy, ...rest }: TextPromptDialogProps) {
  return (
    <DialogFrame
      visible={visible}
      title={title}
      message={message}
      icon={icon}
      onDismiss={() => {
        if (!busy) onCancel();
      }}
      actions={null}>
      <PromptBody onCancel={onCancel} busy={busy} {...rest} />
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.inputBg,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 6,
  },
  inputError: { borderColor: colors.danger },
});
