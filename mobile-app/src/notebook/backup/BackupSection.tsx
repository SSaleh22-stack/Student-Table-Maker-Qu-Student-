/**
 * The backup group of the notebook settings (Figma 15, 'النسخ الاحتياطي'), used by P26:
 *
 *   [cloud]   النسخ الاحتياطي إلى iCloud Drive (Android: Google Drive)        [switch]
 *             مجلد "QU Student" يظهر في تطبيق الملفات
 *   [check]   آخر نسخة: اليوم 9:12 ص  /  12 مذكرة · 1.4 جيجابايت        (while on)
 *   [wifi]    عبر Wi-Fi فقط  /  لا تستخدم بيانات الجوال للنسخ               [switch]
 *   [restore] استعادة من النسخة الاحتياطية                                        ›
 *   [refresh] النسخ الآن                                                   (while on)
 *   [user]    the Google account, 'تسجيل الخروج'                     (Android, signed in)
 *
 * Under it: the current error (with 'تسجيل الدخول' after a temporary sign-out, the iCloud help when
 * iCloud Drive is off), and the note 'بعض المذكرات لها نسخة أحدث من جهاز آخر' when the last run
 * skipped notebooks another device changed. Turning the switch on runs the enable flow (remote check
 * and restore offer); 'استعادة الآن' opens the restore screen.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { tr, useLang } from '@/lib/i18n';
import { ltr } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { bytesLabel, countLabel, relativeTime } from '@/notebook/core/text/labels';
import type { BackupError } from '@/notebook/core/contracts/backup';
import { openRestore } from '@/notebook/nav';
import { PillButton } from '@/notebook/ui/CircleButton';
import { ConfirmDialog } from '@/notebook/ui/ConfirmDialog';
import { Group } from '@/notebook/ui/Group';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { ListRow } from '@/notebook/ui/ListRow';
import { ProgressBar } from '@/notebook/ui/ProgressBar';
import { ToggleRow } from '@/notebook/ui/ToggleRow';

import { backupErrorDetail, backupErrorMessage } from './service';
import { useBackup } from './useBackup';
import { useEnableBackupFlow } from './useEnableBackupFlow';

/**
 * Turning backup on (or signing in again) failed: backup did not start, so the texts that promise an
 * automatic retry do not fit here.
 */
function enableErrorMessage(code: BackupError, detail?: 'newer'): string {
  if (detail === 'newer') return backupErrorMessage(code, detail);
  if (code === 'network') return tr('تعذّر الاتصال بالإنترنت. تحقّق من الاتصال وحاول مرة أخرى.', "Couldn't connect. Check your connection and try again.");
  if (code === 'unknown') return tr('تعذّر تشغيل النسخ الاحتياطي. حاول مرة أخرى.', "Couldn't turn on backup. Try again.");
  return backupErrorMessage(code);
}

export interface BackupSectionProps {
  /** Hide the 'النسخ الاحتياطي' label above the card. */
  hideTitle?: boolean;
  /** Opens the restore screen (default nav.openRestore). */
  onOpenRestore?: () => void;
}

export function BackupSection({ hideTitle, onOpenRestore }: BackupSectionProps) {
  const lang = useLang();
  const backup = useBackup();
  const flow = useEnableBackupFlow();
  const s = backup.status;
  const drive = s.provider === 'gdrive';
  const [enabling, setEnabling] = useState(false);
  const [flowError, setFlowErrorCode] = useState<BackupError | null>(null);
  /** 'newer': turning backup on failed because the backup was written by a newer app version. */
  const [flowDetail, setFlowDetail] = useState<'newer' | undefined>(undefined);
  const setFlowError = (code: BackupError | null) => {
    setFlowErrorCode(code);
    setFlowDetail(code === 'unknown' ? backupErrorDetail() : undefined);
  };
  const [signingIn, setSigningIn] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const openRestoreScreen = onOpenRestore ?? openRestore;
  // 'اليوم 9:12 ص' needs today's date: refreshed every minute and whenever a backup finishes.
  const [now, setNow] = useState(() => Date.now());
  const lastAt = s.lastBackupAt;
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 60_000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [lastAt]);

  const onToggle = async (on: boolean) => {
    setFlowError(null);
    if (!on) {
      await backup.setEnabled(false);
      return;
    }
    setEnabling(true);
    try {
      const r = await flow.start();
      if (r === 'restore') openRestoreScreen();
      else if (r !== 'ok' && r !== 'cancelled') setFlowError(r);
    } catch {
      setFlowError('unknown');
    } finally {
      setEnabling(false);
    }
  };

  const onSignInAgain = async () => {
    setSigningIn(true);
    try {
      const r = await backup.signInAgain();
      if (r === 'ok') setFlowError(null);
      else if (r !== 'cancelled') setFlowError(r);
    } catch {
      setFlowError('unknown');
    } finally {
      setSigningIn(false);
    }
  };

  const toggleTitle = drive ? tr('النسخ الاحتياطي إلى Google Drive', 'Back up to Google Drive') : tr('النسخ الاحتياطي إلى iCloud Drive', 'Back up to iCloud Drive');
  const toggleSub = drive
    ? tr('مجلد "QU Student" يظهر في Google Drive', 'A "QU Student" folder you can see in Google Drive')
    : tr('مجلد "QU Student" يظهر في تطبيق الملفات', 'A "QU Student" folder you can see in the Files app');

  // ----- the status row
  let statusRow = null;
  if (s.enabled) {
    if (s.phase === 'running') {
      const p = s.progress;
      const frac = p && p.total > 0 ? p.done / p.total : 0;
      statusRow = (
        <ListRow
          key="status"
          icon="refresh"
          title={tr('جارٍ النسخ الاحتياطي…', 'Backing up…')}
          subtitle={p && p.total > 0 ? `${bytesLabel(p.done, lang)} / ${bytesLabel(p.total, lang)}` : undefined}
          trailing={
            p && p.total > 0 ? (
              <View style={styles.progress}>
                <ProgressBar value={frac} height={6} label={tr('تقدّم النسخ الاحتياطي', 'Backup progress')} />
              </View>
            ) : undefined
          }
        />
      );
    } else {
      const last = s.lastBackupAt
        ? tr('آخر نسخة: ', 'Last backup: ') + relativeTime(s.lastBackupAt, Math.max(now, Date.parse(s.lastBackupAt) || 0), lang)
        : tr('آخر نسخة: لم يتم النسخ بعد', 'Last backup: not yet');
      const parts: string[] = [];
      if (s.lastBackupAt && s.lastCount !== undefined) parts.push(countLabel(s.lastCount, 'notebook', lang));
      if (s.lastBackupAt && s.lastBytes !== undefined) parts.push(bytesLabel(s.lastBytes, lang));
      let sub = parts.join(' · ');
      if (s.phase === 'waiting-wifi') sub = tr('بانتظار الاتصال بشبكة Wi-Fi', 'Waiting for Wi-Fi');
      statusRow = (
        <ListRow
          key="status"
          icon={s.lastBackupAt ? 'check' : 'clock'}
          iconColor={s.lastBackupAt ? colors.success : undefined}
          iconFill={s.lastBackupAt ? colors.successSoft : undefined}
          title={last}
          subtitle={sub || undefined}
        />
      );
    }
  }

  const error: BackupError | null = flowError ?? s.error ?? null;
  const errorText = flowError ? enableErrorMessage(flowError, flowDetail) : error ? backupErrorMessage(error, s.detail) : null;
  const errorAction =
    error === 'signed-out' || (error === 'revoked' && drive)
      ? {
          label: tr('تسجيل الدخول', 'Sign in'),
          // Backup is off (revoked, or turning it on failed): sign in through the enable flow.
          onPress: () => void (error === 'revoked' || !s.enabled ? onToggle(true) : onSignInAgain()),
        }
      : undefined;

  return (
    <View style={styles.wrap}>
      <Group title={hideTitle ? undefined : tr('النسخ الاحتياطي', 'Backup')}>
        <ToggleRow
          key="toggle"
          icon="cloud"
          title={toggleTitle}
          subtitle={toggleSub}
          value={s.enabled}
          busy={enabling}
          onChange={(v) => void onToggle(v)}
        />
        {statusRow}
        <ToggleRow
          key="wifi"
          icon="wifi"
          title={tr('عبر Wi-Fi فقط', 'Wi-Fi only')}
          subtitle={tr('لا تستخدم بيانات الجوال للنسخ', "Don't use mobile data for backups")}
          value={s.wifiOnly}
          onChange={(v) => backup.setWifiOnly(v)}
        />
        <ListRow
          key="restore"
          icon="restore"
          title={tr('استعادة من النسخة الاحتياطية', 'Restore from backup')}
          chevron
          onPress={openRestoreScreen}
          disabled={s.restoring}
        />
        {s.enabled ? (
          <ListRow
            key="now"
            icon="refresh"
            title={tr('النسخ الآن', 'Back up now')}
            chevron={false}
            disabled={s.phase === 'running' || s.restoring}
            onPress={() => void backup.runNow()}
          />
        ) : null}
        {drive && s.account ? (
          <ListRow
            key="account"
            icon="user"
            title={ltr(s.account)}
            subtitle={tr('حساب Google', 'Google account')}
            trailing={<PillButton label={tr('تسجيل الخروج', 'Sign out')} variant="link" size="sm" onPress={() => setConfirmSignOut(true)} />}
          />
        ) : null}
      </Group>

      {errorText ? (
        <InfoBanner
          tone="warn"
          text={errorText}
          action={signingIn ? undefined : errorAction}
          onClose={flowError ? () => setFlowError(null) : undefined}
        />
      ) : null}
      {s.enabled && s.conflicts.length > 0 ? (
        <InfoBanner tone="info" text={tr('بعض المذكرات لها نسخة أحدث من جهاز آخر', 'Some notebooks have a newer copy from another device')} />
      ) : null}

      <ConfirmDialog
        visible={confirmSignOut}
        icon="user"
        title={tr('تسجيل الخروج من Google؟', 'Sign out of Google?')}
        message={tr(
          'سيتوقف النسخ الاحتياطي على هذا الجهاز. تبقى النسخ الموجودة في Google Drive.',
          'Backup stops on this device. The backups already in Google Drive stay there.',
        )}
        confirmLabel={tr('تسجيل الخروج', 'Sign out')}
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void backup.signOut();
        }}
      />
      {flow.ui}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  progress: { width: 90 },
});
