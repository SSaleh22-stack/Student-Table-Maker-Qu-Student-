/**
 * 'استعادة من النسخة الاحتياطية' (NB-85, S6): the notebooks in the backup, newest first, with a
 * multi-select and a restore button with progress.
 *
 * - The list comes from the remote manifest (backupService.listRemote). New notebooks (not on this
 *   device, not in the backup's Recently deleted) are selected at first.
 * - Restore (backupService.restoreDetailed) downloads each notebook into a staging folder, checks it
 *   (notebook.json, every page, asset sizes), and adopts it into the library. The planRestore policy
 *   decides per notebook: restored as is, replacing an unchanged older copy on this device, or kept
 *   next to a changed local copy as a copy titled '… (نسخة احتياطية)'. Folders and course names
 *   that are missing on this device come back from library.json first.
 * - Low free space shows the shared LowStorageWarning before anything is downloaded.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { IconButton, ScreenHeader } from '@/components/ui';
import { tr, useLang } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { ltr, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { BackupError, RemoteNotebook } from '@/notebook/core/contracts/backup';
import type { Id } from '@/notebook/core/model';
import { bytesLabel, countLabel, relativeTime } from '@/notebook/core/text/labels';
import { goBackOr, openLibrary } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { nbColors, nbRadius } from '@/notebook/theme';
import { PillButton } from '@/notebook/ui/CircleButton';
import { EmptyState } from '@/notebook/ui/EmptyState';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { LowStorageWarning } from '@/notebook/ui/LowStorageWarning';
import { ProgressBar } from '@/notebook/ui/ProgressBar';
import { showToast } from '@/notebook/ui/toast';

import { icloudHelp } from './icloudProvider';
import { backupErrorDetail, backupErrorFrom, backupErrorMessage, type RestoreReport } from './service';
import { useBackup } from './useBackup';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; error: BackupError; detail?: 'newer' }
  | { kind: 'list'; rows: RemoteNotebook[] };

function failText(code: RestoreReport['failed'][number]['error']): string {
  if (code === 'no-space') return tr('المساحة على الجهاز لا تكفي', 'Not enough space on this device');
  if (code === 'damaged') return tr('الملفات في النسخة الاحتياطية تالفة', 'The backup files are damaged');
  if (code === 'newer') return tr('حُفظت بإصدار أحدث من التطبيق', 'Saved by a newer version of the app');
  return backupErrorMessage(code);
}

export default function RestoreScreen() {
  const lang = useLang();
  const tablet = useIsTablet();
  const backup = useBackup();
  const store = useNotebooks();
  const drive = backup.status.provider === 'gdrive';

  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Set<Id>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [lowFree, setLowFree] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  const listRemote = backup.listRemote;

  /** Fetches the list; the state is set only when it arrives (alive() false: the screen is gone). */
  const fetchList = useCallback(
    (alive: () => boolean) =>
      listRemote().then(
        (rows) => {
          if (!alive()) return;
          setNow(Date.now());
          setList({ kind: 'list', rows });
          setSelected(new Set(rows.filter((r) => !r.existsLocally && !r.deletedAt).map((r) => r.id)));
        },
        (e: unknown) => {
          if (alive()) setList({ kind: 'error', error: backupErrorFrom(e), detail: backupErrorDetail() });
        },
      ),
    [listRemote],
  );

  const load = useCallback(async () => {
    setList({ kind: 'loading' });
    await fetchList(() => true);
  }, [fetchList]);

  // The local library decides "on this device": wait until it was read, then load once.
  const loaded = store.loaded;
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void fetchList(() => alive);
    return () => {
      alive = false;
    };
  }, [loaded, fetchList]);

  const rows = useMemo(() => (list.kind === 'list' ? list.rows : []), [list]);
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const chosenBytes = chosen.reduce((n, r) => n + r.bytes, 0);
  const allSelected = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: Id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async () => {
    setLowFree(null);
    setBusy(true);
    setProg({ done: 0, total: chosenBytes });
    try {
      const r = await backup.restoreDetailed(
        chosen.map((c) => c.id),
        (done, total) => setProg({ done, total }),
      );
      setReport(r);
      if (r.restored.length > 0) {
        showToast({ text: tr(`تمت استعادة ${countLabel(r.restored.length, 'notebook', 'ar')}`, `Restored ${countLabel(r.restored.length, 'notebook', 'en')}`), tone: 'ok' });
      }
    } catch (e) {
      setList({ kind: 'error', error: backupErrorFrom(e), detail: backupErrorDetail() });
    } finally {
      setBusy(false);
    }
  };

  const onRestore = () => {
    if (chosen.length === 0 || busy) return;
    const low = store.isLowStorage(chosenBytes);
    if (low.low) {
      setLowFree(low.freeBytes);
      return;
    }
    void run();
  };

  const onSignIn = async () => {
    setSigningIn(true);
    try {
      const r = await backup.signInAgain();
      if (r === 'ok') await load();
      else if (r !== 'cancelled') setList({ kind: 'error', error: r });
    } finally {
      setSigningIn(false);
    }
  };

  const back = () => goBackOr(openLibrary);
  const titleById = new Map(rows.map((r) => [r.id, r.title]));

  let body = null;
  if (report) {
    const failedTitles = report.failed.map((f) => `${titleById.get(f.id) ?? f.id} (${failText(f.error)})`);
    body = (
      <View style={styles.card}>
        <View style={[styles.doneIcon, { backgroundColor: report.restored.length > 0 ? colors.successSoft : colors.warningSoft }]}>
          <Icon name={report.restored.length > 0 ? 'check' : 'alert'} size={30} color={report.restored.length > 0 ? colors.success : colors.warning} strokeWidth={2.5} />
        </View>
        <AppText size={18} weight="bold" align="center">
          {report.restored.length > 0
            ? tr(`تمت استعادة ${countLabel(report.restored.length, 'notebook', 'ar')}`, `Restored ${countLabel(report.restored.length, 'notebook', 'en')}`)
            : tr('لم تتم استعادة أي مذكرة', 'No notebooks were restored')}
        </AppText>
        {report.skipped.length > 0 ? (
          <AppText size={14} color={colors.muted} align="center">
            {tr(
              `${countLabel(report.skipped.length, 'notebook', 'ar')} موجودة على هذا الجهاز كما هي`,
              `${countLabel(report.skipped.length, 'notebook', 'en')} already on this device`,
            )}
          </AppText>
        ) : null}
        {failedTitles.length > 0 ? (
          <InfoBanner tone="warn" title={tr('تعذّرت استعادة:', "Couldn't restore:")} text={failedTitles.join('\n')} style={styles.stretch} />
        ) : null}
        <View style={styles.doneActions}>
          <PillButton label={tr('فتح المذكرات', 'Open notebooks')} icon="notebookPen" onPress={openLibrary} block />
          {failedTitles.length > 0 ? (
            <PillButton
              label={tr('إعادة المحاولة', 'Try again')}
              variant="secondary"
              block
              onPress={() => {
                setReport(null);
                void load();
              }}
            />
          ) : null}
        </View>
      </View>
    );
  } else if (list.kind === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <AppText size={14} color={colors.muted} align="center">
          {tr('جارٍ البحث عن النسخة الاحتياطية…', 'Looking for your backup…')}
        </AppText>
      </View>
    );
  } else if (list.kind === 'error') {
    const needsSignIn = (drive || backup.status.provider === 'onedrive') && (list.error === 'signed-out' || list.error === 'revoked');
    const text = needsSignIn
      ? tr('سجّل الدخول إلى Google لعرض نسخك الاحتياطية في Google Drive', 'Sign in to Google to see your backups in Google Drive')
      : list.error === 'icloud-off'
        ? icloudHelp()
        : backupErrorMessage(list.error, list.detail);
    body = (
      <InfoBanner
        tone="warn"
        text={text}
        action={
          signingIn
            ? undefined
            : needsSignIn
              ? { label: tr('تسجيل الدخول', 'Sign in'), onPress: () => void onSignIn() }
              : { label: tr('إعادة المحاولة', 'Try again'), onPress: () => void load() }
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="cloud"
        title={tr('لا توجد نسخة احتياطية بعد', 'No backup yet')}
        body={tr(
          'فعّل النسخ الاحتياطي من إعدادات المذكرات، وستظهر مذكراتك هنا لتستعيدها على أي جهاز.',
          'Turn on backup in the notebook settings, and your notebooks show up here to restore on any device.',
        )}
      />
    );
  } else {
    body = (
      <>
        <View style={[styles.listHead, { flexDirection: row }]}>
          <AppText size={14} weight="semibold" color={colors.faint} style={styles.flex}>
            {countLabel(rows.length, 'notebook', lang)}
          </AppText>
          <Pressable
            onPress={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button">
            <AppText size={14} weight="bold" color={colors.accent}>
              {allSelected ? tr('إلغاء التحديد', 'Select none') : tr('تحديد الكل', 'Select all')}
            </AppText>
          </Pressable>
        </View>
        <View style={styles.listCard}>
          {rows.map((r, i) => {
            const on = selected.has(r.id);
            const meta = [relativeTime(r.updatedAt, now, lang), countLabel(r.pageCount, 'page', lang), bytesLabel(r.bytes, lang)].filter(Boolean).join(' · ');
            const tags: string[] = [];
            if (r.existsLocally) tags.push(tr('على هذا الجهاز', 'On this device'));
            if (r.deletedAt) tags.push(tr('في المحذوفة مؤخراً', 'In Recently deleted'));
            if (r.deviceName) tags.push(tr('من: ', 'From: ') + ltr(r.deviceName));
            return (
              <View key={r.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={() => toggle(r.id)}
                  disabled={busy}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: busy }}
                  accessibilityLabel={`${r.title}، ${meta}`}
                  style={({ pressed }) => [styles.row, { flexDirection: row }, pressed && { backgroundColor: colors.surfaceMuted }]}>
                  <View style={[styles.check, on ? styles.checkOn : styles.checkOff]}>{on ? <Icon name="check" size={16} color={colors.surface} strokeWidth={3} /> : null}</View>
                  <View style={styles.flex}>
                    <AppText size={16} weight="semibold" numberOfLines={2}>
                      {r.title || tr('مذكرة', 'Notebook')}
                    </AppText>
                    <AppText size={13} color={colors.faint}>
                      {meta}
                    </AppText>
                    {tags.length > 0 ? (
                      <AppText size={13} color={colors.accentDark}>
                        {tags.join(' · ')}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </>
    );
  }

  const showFooter = !report && list.kind === 'list' && rows.length > 0;
  const frac = prog.total > 0 ? prog.done / prog.total : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, tablet && styles.contentTablet]}>
        <ScreenHeader
          title={tr('استعادة من النسخة الاحتياطية', 'Restore from backup')}
          subtitle={drive ? 'Google Drive' : backup.status.provider === 'onedrive' ? 'OneDrive' : 'iCloud Drive'}
          leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={busy ? undefined : back} />}
        />
        {body}
      </ScrollView>
      {showFooter ? (
        <View style={[styles.footer, tablet && styles.footerTablet]}>
          {busy ? (
            <View style={styles.progressBox}>
              <AppText size={14} weight="semibold">
                {tr('جارٍ الاستعادة…', 'Restoring…')}
                {prog.total > 0 ? ` ${bytesLabel(prog.done, lang)} / ${bytesLabel(prog.total, lang)}` : ''}
              </AppText>
              <ProgressBar value={frac} label={tr('تقدّم الاستعادة', 'Restore progress')} />
            </View>
          ) : (
            <PillButton
              label={
                chosen.length > 0
                  ? tr(`استعادة (${countLabel(chosen.length, 'notebook', 'ar')})`, `Restore (${countLabel(chosen.length, 'notebook', 'en')})`)
                  : tr('اختر مذكرات لاستعادتها', 'Choose notebooks to restore')
              }
              icon="restore"
              disabled={chosen.length === 0}
              onPress={onRestore}
              block
            />
          )}
        </View>
      ) : null}
      <LowStorageWarning
        visible={lowFree !== null}
        freeBytes={lowFree ?? 0}
        kind="import"
        onContinue={() => void run()}
        onCancel={() => setLowFree(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: nbColors.bg },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  contentTablet: { maxWidth: 720, width: '100%', alignSelf: 'center', padding: 24 },
  center: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: nbRadius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
    alignItems: 'center',
  },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  doneActions: { alignSelf: 'stretch', gap: 10, marginTop: 4 },
  stretch: { alignSelf: 'stretch' },
  listHead: { alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  listCard: { backgroundColor: colors.surface, borderRadius: nbRadius.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: colors.divider },
  row: { alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 12, minHeight: 64 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent },
  checkOff: { borderWidth: 2, borderColor: colors.borderStrong },
  flex: { flex: 1, gap: 2 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerTablet: { paddingHorizontal: 24 },
  progressBox: { gap: 10 },
});
