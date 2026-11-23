/**
 * Low free space (NB-36, NB-67): shown before an import or a recording starts when
 * store.isLowStorage() says so. The student can still go on ('متابعة', e.g. the recorder's
 * start(session, { ignoreLowStorage: true })) or stop ('إلغاء').
 *
 * LowStorageBanner is the library's inline form (Figma 17), with a 'عرض التخزين' link.
 */
import type { StyleProp, ViewStyle } from 'react-native';

import { getLang, tr } from '@/lib/i18n';
import { bytesLabel } from '@/notebook/core/text/labels';

import { DialogActions, DialogFrame } from './ConfirmDialog';
import { InfoBanner } from './InfoBanner';

export interface LowStorageWarningProps {
  freeBytes: number;
  kind: 'import' | 'record';
  onContinue: () => void;
  onCancel: () => void;
  /** Default true: the dialog shows while it is mounted. */
  visible?: boolean;
}

/** The title shared by the dialog and the banner. */
export function lowStorageTitle(): string {
  return tr('مساحة الجهاز منخفضة', 'Device storage is low');
}

/** The dialog body for an import or a recording. */
export function lowStorageBody(freeBytes: number, kind: 'import' | 'record'): string {
  const free = bytesLabel(freeBytes, getLang());
  return kind === 'import'
    ? tr('متاح ' + free + ' فقط. قد لا يكتمل استيراد هذا الملف.', 'Only ' + free + ' free. This import may not finish.')
    : tr('متاح ' + free + ' فقط. قد يتوقف التسجيل الطويل قبل نهايته.', 'Only ' + free + ' free. A long recording may stop before it ends.');
}

export function LowStorageWarning({ freeBytes, kind, onContinue, onCancel, visible = true }: LowStorageWarningProps) {
  return (
    <DialogFrame
      visible={visible}
      title={lowStorageTitle()}
      message={lowStorageBody(freeBytes, kind)}
      icon="alert"
      tone="warn"
      onDismiss={onCancel}
      actions={
        <DialogActions
          cancelLabel={tr('إلغاء', 'Cancel')}
          confirmLabel={tr('متابعة', 'Continue')}
          onCancel={onCancel}
          onConfirm={onContinue}
        />
      }
    />
  );
}

export interface LowStorageBannerProps {
  freeBytes: number;
  /** Opens the storage section of the notebook settings. */
  onShowStorage?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Figma 17: 'متاح 900 ميجابايت فقط. قد لا يكتمل استيراد ملفات PDF الكبيرة أو التسجيلات الطويلة.' */
export function LowStorageBanner({ freeBytes, onShowStorage, style }: LowStorageBannerProps) {
  const free = bytesLabel(freeBytes, getLang());
  return (
    <InfoBanner
      tone="warn"
      title={lowStorageTitle()}
      text={tr(
        'متاح ' + free + ' فقط. قد لا يكتمل استيراد ملفات PDF الكبيرة أو التسجيلات الطويلة.',
        'Only ' + free + ' free. Large PDF imports or long recordings may not finish.',
      )}
      action={onShowStorage ? { label: tr('عرض التخزين', 'View storage'), onPress: onShowStorage } : undefined}
      style={style}
    />
  );
}
