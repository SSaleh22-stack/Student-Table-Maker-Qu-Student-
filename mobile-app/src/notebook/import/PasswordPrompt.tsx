/**
 * The password prompt for a protected PDF (NB-35, ruling (b)): asked once on import; after a wrong
 * password it asks again with 'كلمة المرور غير صحيحة، حاول مرة أخرى'. The body tells the student
 * that an unprotected copy is kept inside the app on this device only.
 *
 * An NbModal (a full sheet on phones), with 'إلغاء' at the reading start and 'فتح' at the end.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { inputDir } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import { DialogActions } from '@/notebook/ui/ConfirmDialog';
import { NbModal } from '@/notebook/ui/NbModal';

export interface PasswordPromptProps {
  visible: boolean;
  /** The file name, shown under the title. */
  name?: string;
  /** The last password was wrong. */
  wrong: boolean;
  /** Changes with every ask: the field starts empty again. */
  attempt?: number;
  /** The typed password is being checked: the buttons are busy and the prompt cannot close. */
  checking?: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function passwordPromptTitle(): string {
  return tr('هذا الملف محمي بكلمة مرور', 'This file is password protected');
}

export function passwordPromptBody(): string {
  return tr(
    'أدخل كلمة المرور مرة واحدة. ستحفظ نسخة غير محمية داخل التطبيق على جهازك فقط.',
    'Enter the password once. An unprotected copy is kept inside the app, on your device only.',
  );
}

export function wrongPasswordText(): string {
  return tr('كلمة المرور غير صحيحة، حاول مرة أخرى', 'Wrong password, try again');
}

function Field({ wrong, checking, onSubmit, onCancel }: Pick<PasswordPromptProps, 'wrong' | 'checking' | 'onSubmit' | 'onCancel'>) {
  const [text, setText] = useState('');
  const submit = () => {
    if (text.length > 0 && !checking) onSubmit(text);
  };
  return (
    <View style={styles.body}>
      <AppText size={15} color={colors.muted}>
        {passwordPromptBody()}
      </AppText>
      <TextInput
        value={text}
        onChangeText={setText}
        editable={!checking}
        secureTextEntry
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={submit}
        submitBehavior="submit"
        placeholder={tr('كلمة المرور', 'Password')}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={tr('كلمة المرور', 'Password')}
        style={[styles.input, inputDir(), wrong ? styles.inputError : null]}
      />
      {wrong && !checking ? (
        <AppText size={13} color={colors.danger} accessibilityLiveRegion="polite">
          {wrongPasswordText()}
        </AppText>
      ) : null}
      <DialogActions
        cancelLabel={tr('إلغاء', 'Cancel')}
        confirmLabel={tr('فتح', 'Open')}
        confirmIcon="lock"
        onCancel={onCancel}
        onConfirm={submit}
        confirmDisabled={text.length === 0 || !!checking}
        busy={!!checking}
      />
    </View>
  );
}

export function PasswordPrompt({ visible, name, wrong, attempt = 0, checking = false, onSubmit, onCancel }: PasswordPromptProps) {
  // Each ask starts with an empty field: the key remounts it (a wrong password asks again in place).
  return (
    <NbModal visible={visible} title={passwordPromptTitle()} subtitle={name} onClose={checking ? () => {} : onCancel} dismissable={!checking} width={520}>
      <Field key={attempt} wrong={wrong} checking={checking} onSubmit={onSubmit} onCancel={onCancel} />
    </NbModal>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
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
  },
  inputError: { borderColor: colors.danger },
});
