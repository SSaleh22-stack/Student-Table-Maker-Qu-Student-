/**
 * Shown by the enable flow (useEnableBackupFlow) when turning backup on finds an earlier backup made
 * on another device, or this device has no notebooks while the backup has some (S6: a new phone).
 *
 * 'وجدنا نسخة احتياطية سابقة (n مذكرة)' with 'متابعة النسخ' at the reading start and 'استعادة الآن'
 * at the end. Tapping outside (or Android back) cancels: backup stays off.
 */
import { tr, useLang } from '@/lib/i18n';
import { ltr } from '@/lib/rtl';
import { countLabel } from '@/notebook/core/text/labels';
import { DialogActions, DialogFrame } from '@/notebook/ui/ConfirmDialog';

export interface RemoteFoundDialogProps {
  visible: boolean;
  /** Notebooks in the backup (trashed ones not counted). */
  count: number;
  /** Names of the other devices that backed up (may be empty). */
  devices: string[];
  onRestore: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

/** 'وجدنا نسخة احتياطية سابقة (12 مذكرة)' (the count agrees in Arabic: مذكرتان, 3 مذكرات…). */
export function remoteFoundTitle(count: number, lang: 'ar' | 'en'): string {
  return lang === 'en'
    ? `We found an earlier backup (${countLabel(count, 'notebook', 'en')})`
    : `وجدنا نسخة احتياطية سابقة (${countLabel(count, 'notebook', 'ar')})`;
}

export function RemoteFoundDialog({ visible, count, devices, onRestore, onContinue, onCancel }: RemoteFoundDialogProps) {
  const lang = useLang();
  // Device names are usually Latin: isolate them so they do not reorder the Arabic sentence.
  const from = devices.length > 0 ? devices.map((d) => ltr(d)).join('، ') : '';
  const message = from
    ? tr(
        `من: ${from}. استعد مذكراتك إلى هذا الجهاز الآن، أو تابع النسخ واستعدها لاحقاً من الإعدادات.`,
        `From: ${devices.join(', ')}. Restore your notebooks to this device now, or continue backing up and restore them later from Settings.`,
      )
    : tr(
        'استعد مذكراتك إلى هذا الجهاز الآن، أو تابع النسخ واستعدها لاحقاً من الإعدادات.',
        'Restore your notebooks to this device now, or continue backing up and restore them later from Settings.',
      );
  return (
    <DialogFrame
      visible={visible}
      icon="restore"
      title={remoteFoundTitle(count, lang)}
      message={message}
      onDismiss={onCancel}
      actions={
        <DialogActions
          cancelLabel={tr('متابعة النسخ', 'Continue backup')}
          confirmLabel={tr('استعادة الآن', 'Restore now')}
          confirmIcon="restore"
          onCancel={onContinue}
          onConfirm={onRestore}
        />
      }
    />
  );
}
