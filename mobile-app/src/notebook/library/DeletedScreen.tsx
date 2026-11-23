/**
 * Recently deleted (Figma 16, NB-13): deleted notebooks stay 30 days, then they are removed for good
 * (the library boot purges them). Each card shows the days left ('يتبقى 27 يوماً'), 'استعادة', and a
 * red bin that deletes it for good after a confirm. 'حذف الكل' in the header empties the trash after
 * a confirm. The newest deletion comes first.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { tr, useLang, type Lang } from '@/lib/i18n';
import { alignStart, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { IndexEntry } from '@/notebook/core/model';
import { countLabel, daysLeft } from '@/notebook/core/text/labels';
import { goBackOr, openLibrary } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { CircleButton, PillButton } from '@/notebook/ui/CircleButton';
import { ConfirmDialog } from '@/notebook/ui/ConfirmDialog';
import { EmptyState } from '@/notebook/ui/EmptyState';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { NB_EDGE, useWidthClass } from '@/notebook/ui/layout';
import { showToast } from '@/notebook/ui/toast';

import { NbScreenHeader } from './LibraryScreen';
import { libraryErrorText } from './MoveSheet';
import { CardGrid, gridColumns, notebookTitle, useNow } from './NotebookCard';
import { Thumb } from './Thumb';

const back = () => goBackOr(openLibrary);

function DeletedCard({
  entry,
  now,
  lang,
  busy,
  onRestore,
  onPurge,
}: {
  entry: IndexEntry;
  now: number;
  lang: Lang;
  busy: boolean;
  onRestore: (e: IndexEntry) => void;
  onPurge: (e: IndexEntry) => void;
}) {
  const title = notebookTitle(entry);
  const left = entry.deletedAt ? daysLeft(entry.deletedAt, now, lang) : '';
  return (
    <View style={styles.card}>
      <View accessible accessibilityLabel={`${title}، ${left}`}>
        <Thumb entry={entry} plain />
      </View>
      <AppText size={15} weight="semibold" numberOfLines={2}>
        {title}
      </AppText>
      {left ? (
        <View style={[styles.left, { flexDirection: row, alignSelf: alignStart }]}>
          <Icon name="clock" size={12} color={colors.warning} />
          <AppText size={12} weight="semibold" color={colors.warning}>
            {left}
          </AppText>
        </View>
      ) : null}
      <View style={[styles.actions, { flexDirection: row }]}>
        <PillButton
          label={tr('استعادة', 'Restore')}
          icon="restore"
          variant="secondary"
          size="sm"
          disabled={busy}
          onPress={() => onRestore(entry)}
          hint={tr(`يعيد ${title} إلى مكانها`, `Puts ${title} back`)}
          style={styles.restore}
        />
        <CircleButton
          icon="trash"
          tone="danger"
          label={tr(`حذف ${title} نهائياً`, `Delete ${title} for good`)}
          disabled={busy}
          onPress={() => onPurge(entry)}
        />
      </View>
    </View>
  );
}

export default function DeletedScreen() {
  const store = useNotebooks();
  const lang = useLang();
  const now = useNow();
  const compact = useWidthClass() === 'compact';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [purge, setPurge] = useState<IndexEntry | null>(null);
  const [emptyAsk, setEmptyAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = store.list('deleted', 'updated');
  const fail = (e: unknown) => showToast({ text: libraryErrorText(e), tone: 'warn' });

  const restore = (e: IndexEntry) => {
    store.restoreNotebook(e.id).then(
      () => showToast({ text: tr('استُعيدت المذكرة', 'Notebook restored'), detail: notebookTitle(e), tone: 'ok' }),
      fail,
    );
  };

  const confirmPurge = () => {
    if (!purge) return;
    const id = purge.id;
    setBusy(true);
    store.purgeNotebook(id).then(
      () => {
        setBusy(false);
        setPurge(null);
        showToast({ text: tr('حُذفت المذكرة نهائياً', 'Notebook deleted for good'), tone: 'ok' });
      },
      (e) => {
        setBusy(false);
        setPurge(null);
        fail(e);
      },
    );
  };

  const confirmEmpty = () => {
    setBusy(true);
    store.emptyTrash().then(
      () => {
        setBusy(false);
        setEmptyAsk(false);
        showToast({ text: tr('حُذفت كل المذكرات المحذوفة نهائياً', 'Recently deleted is now empty'), tone: 'ok' });
      },
      (e) => {
        setBusy(false);
        setEmptyAsk(false);
        fail(e);
      },
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <NbScreenHeader
        title={tr('المحذوفة مؤخراً', 'Recently deleted')}
        subtitle={countLabel(list.length, 'notebook', lang)}
        onBack={back}
        actions={
          list.length > 0 ? (
            <Pressable
              onPress={() => setEmptyAsk(true)}
              disabled={busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={tr('حذف الكل نهائياً', 'Delete all for good')}
              style={({ pressed }) => pressed && styles.pressed}>
              <AppText size={16} weight="bold" color={colors.danger}>
                {tr('حذف الكل', 'Delete all')}
              </AppText>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: NB_EDGE, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.inner}>
          <InfoBanner
            text={tr(
              'تُحذف المذكرات نهائياً بعد 30 يوماً من حذفها. يمكنك استعادتها قبل ذلك.',
              'Notebooks are deleted for good 30 days after you delete them. You can restore them before then.',
            )}
          />
          {list.length > 0 ? (
            <CardGrid columns={gridColumns(width)} gap={compact ? 12 : 32} rowGap={compact ? 20 : 32}>
              {list.map((e) => (
                <DeletedCard key={e.id} entry={e} now={now} lang={lang} busy={busy} onRestore={restore} onPurge={setPurge} />
              ))}
            </CardGrid>
          ) : (
            <EmptyState icon="trash" title={tr('لا توجد مذكرات محذوفة', 'Nothing in Recently deleted')} />
          )}
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={purge !== null}
        title={tr('حذف المذكرة نهائياً؟', 'Delete the notebook for good?')}
        message={
          purge
            ? tr(`ستُحذف «${notebookTitle(purge)}» مع صفحاتها وتسجيلاتها، ولا يمكن استعادتها.`, `“${notebookTitle(purge)}” and its pages and recordings will be removed. This cannot be undone.`)
            : undefined
        }
        confirmLabel={tr('حذف نهائياً', 'Delete for good')}
        destructive
        busy={busy}
        onCancel={() => setPurge(null)}
        onConfirm={confirmPurge}
      />
      <ConfirmDialog
        visible={emptyAsk}
        title={tr('حذف كل المذكرات نهائياً؟', 'Delete everything for good?')}
        message={tr(
          `ستُحذف ${countLabel(list.length, 'notebook', 'ar')} نهائياً، ولا يمكن استعادتها.`,
          `${countLabel(list.length, 'notebook', 'en')} will be removed. This cannot be undone.`,
        )}
        confirmLabel={tr('حذف الكل', 'Delete all')}
        destructive
        busy={busy}
        onCancel={() => setEmptyAsk(false)}
        onConfirm={confirmEmpty}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 4 },
  inner: { width: '100%', gap: 22 },
  card: { gap: 10 },
  left: {
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  actions: { alignItems: 'center', gap: 8 },
  restore: { flexShrink: 1 },
  pressed: { opacity: 0.7 },
});
