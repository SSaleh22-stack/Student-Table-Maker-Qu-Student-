/**
 * Choosing several notebooks at once (the library and every section screen).
 *
 * - A long press on a notebook card starts selecting with that notebook; a tap then selects or
 *   unselects, and unselecting the last one ends it. ✕, Android back or leaving the screen end it too.
 * - While selecting, the header band shows '3 محددة' with 'تحديد الكل', and the floating button gives
 *   way to a bar with the actions for all of them: نقل (one place for all), تكرار, مشاركة (.qunote files,
 *   one share sheet) and حذف (to Recently deleted, with 'تراجع').
 * - Only the notebooks the screen shows count (one that left the screen meanwhile drops out).
 *
 * The screen keeps the selection with useNotebookSelection, renders <SelectionHeader/> instead of its
 * header and <SelectionActions/> instead of its floating button, and passes `selecting`, `selected`
 * and the handlers to NotebookCard.
 */
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { getLang, tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { QUNOTE_MIME, QUNOTE_UTI } from '@/notebook/contracts/export';
import { entryLocation } from '@/notebook/core/library/derive';
import { sameLoc, type Id, type IndexEntry, type LocationKey } from '@/notebook/core/model';
import { countLabel } from '@/notebook/core/text/labels';
import { exportQunote } from '@/notebook/qunote';
import { useNotebooks, type NotebookSession, type NotebooksStore } from '@/notebook/store/hooks';
import { CircleButton, PillButton } from '@/notebook/ui/CircleButton';
import { Group } from '@/notebook/ui/Group';
import { NB_EDGE, NB_HEADER_BAND, NB_HEADER_BUTTON, NB_HEADER_BUTTON_COMPACT, useWidthClass } from '@/notebook/ui/layout';
import { LocationChips } from '@/notebook/ui/LocationChips';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { shareFiles } from '@/notebook/ui/shareFile';
import { showToast } from '@/notebook/ui/toast';
import { ToggleRow } from '@/notebook/ui/ToggleRow';

import { libraryErrorText, locationName } from './MoveSheet';
import { afterModal, qunoteErrorText } from './NotebookActionsSheet';

// ===== state

export interface NotebookSelection {
  selecting: boolean;
  /** The selected notebooks the screen still shows, in screen order. */
  picked: Id[];
  allPicked: boolean;
  isSelected(id: Id): boolean;
  start(id: Id): void;
  toggle(id: Id): void;
  toggleAll(): void;
  clear(): void;
}

export function useNotebookSelection(visibleIds: readonly Id[]): NotebookSelection {
  const [selected, setSelected] = useState<ReadonlySet<Id> | null>(null);
  const selecting = selected !== null;
  const clear = useCallback(() => setSelected(null), []);

  // Leaving the screen (or opening a notebook) ends the selection.
  useFocusEffect(useCallback(() => () => setSelected(null), []));

  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  const picked = selected ? visibleIds.filter((id) => selected.has(id)) : [];
  const allPicked = selecting && visibleIds.length > 0 && picked.length === visibleIds.length;

  return {
    selecting,
    picked,
    allPicked,
    isSelected: (id) => !!selected?.has(id),
    start: (id) => {
      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
      setSelected(new Set([id]));
    },
    toggle: (id) =>
      setSelected((prev) => {
        if (!prev) return prev;
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next.size ? next : null;
      }),
    toggleAll: () => setSelected(allPicked ? null : new Set(visibleIds)),
    clear,
  };
}

// ===== header

/** Takes the header band's place while selecting: ✕, '3 محددة', 'تحديد الكل'. */
export function SelectionHeader({ selection }: { selection: NotebookSelection }) {
  const compact = useWidthClass() === 'compact';
  const n = selection.picked.length;
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <CircleButton icon="x" label={tr('إلغاء التحديد', 'Cancel selection')} onPress={selection.clear} size={compact ? NB_HEADER_BUTTON_COMPACT : NB_HEADER_BUTTON} />
      <AppText size={compact ? 20 : 24} weight="bold" numberOfLines={1} style={styles.flex} accessibilityRole="header" accessibilityLiveRegion="polite">
        {tr(`${ltr(n)} محددة`, `${n} selected`)}
      </AppText>
      <PillButton
        label={selection.allPicked ? tr('إلغاء تحديد الكل', 'Select none') : tr('تحديد الكل', 'Select all')}
        variant="secondary"
        size="sm"
        onPress={selection.toggleAll}
      />
    </View>
  );
}

// ===== actions

function deleteNow(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // The cache is the system's to clean as well.
  }
}

/** '3 مذكرات', 'مذكرتان', '1 notebook' (the library's own plural rules). */
const count = (n: number) => countLabel(n, 'notebook', getLang());

/** Runs fn for each id in turn; resolves to the ids it worked for and the first error. */
async function eachIn(ids: readonly Id[], fn: (id: Id) => Promise<unknown>): Promise<{ done: Id[]; error: unknown }> {
  const done: Id[] = [];
  for (const id of ids) {
    try {
      await fn(id);
      done.push(id);
    } catch (e) {
      return { done, error: e };
    }
  }
  return { done, error: null };
}

async function deleteMany(store: NotebooksStore, ids: readonly Id[]): Promise<void> {
  const { done, error } = await eachIn(ids, (id) => store.trashNotebook(id));
  if (error) showToast({ text: libraryErrorText(error), tone: 'warn' });
  if (!done.length) return;
  showToast({
    text:
      done.length === 1
        ? tr('نُقلت المذكرة إلى المحذوفة مؤخراً', 'The notebook moved to Recently deleted')
        : tr(`نُقلت ${count(done.length)} إلى المحذوفة مؤخراً`, `${count(done.length)} moved to Recently deleted`),
    tone: 'ok',
    onAction: () => {
      void eachIn(done, (id) => store.restoreNotebook(id)).then(({ error: e }) => {
        if (e) showToast({ text: libraryErrorText(e), tone: 'warn' });
      });
    },
  });
}

async function duplicateMany(store: NotebooksStore, ids: readonly Id[]): Promise<void> {
  const hide = ids.length > 1 ? showToast({ text: tr('جارٍ التكرار…', 'Duplicating…'), tone: 'info', durationMs: 0, id: 'nb-bulk' }) : () => {};
  const { done, error } = await eachIn(ids, (id) => store.duplicateNotebook(id));
  hide();
  if (error) {
    showToast({ text: libraryErrorText(error), tone: 'warn' });
    return;
  }
  showToast({
    text: done.length === 1 ? tr('أُنشئت نسخة من المذكرة', 'A copy of the notebook was made') : tr(`أُنشئت نسخ من ${count(done.length)}`, `Copies of ${count(done.length)} were made`),
    tone: 'ok',
  });
}

/** Packs each notebook as .qunote, then shares them all together. */
async function shareMany(store: NotebooksStore, entries: readonly IndexEntry[], includeRecordings: boolean): Promise<void> {
  const uris: string[] = [];
  const progress = (i: number) =>
    showToast({
      text: tr(`جارٍ تجهيز ملفات المذكرات… ${ltr(i)} من ${ltr(entries.length)}`, `Preparing the notebook files… ${i} of ${entries.length}`),
      tone: 'info',
      durationMs: 0,
      id: 'nb-qunote',
    });
  let hide = progress(1);
  try {
    for (let i = 0; i < entries.length; i++) {
      hide = progress(i + 1);
      const id = entries[i].id;
      let session: NotebookSession | null = null;
      try {
        session = await store.openSession(id);
        const { uri } = await exportQunote(session, { includeRecordings: includeRecordings && entries[i].recordingCount > 0 });
        uris.push(uri);
      } finally {
        if (session) store.releaseSession(id);
      }
    }
  } catch (e) {
    hide();
    for (const uri of uris) deleteNow(uri);
    showToast({ text: qunoteErrorText(e), tone: 'warn' });
    return;
  }
  hide();
  try {
    await shareFiles(uris, { mimeType: QUNOTE_MIME, UTI: QUNOTE_UTI, dialogTitle: tr('مشاركة المذكرات', 'Share notebooks') });
  } catch (e) {
    showToast({ text: qunoteErrorText(e), tone: 'warn' });
  }
}

function ActionButton({ icon, label, onPress, disabled, danger }: { icon: IconName; label: string; onPress: () => void; disabled: boolean; danger?: boolean }) {
  const color = danger ? colors.danger : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed, disabled && styles.disabled]}>
      <Icon name={icon} size={22} color={color} />
      <AppText size={13} weight="semibold" color={color} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

type Sheet = 'move' | 'share' | null;

/** The bar at the bottom while selecting, and the sheets its actions open. */
export function SelectionActions({ selection }: { selection: NotebookSelection }) {
  const store = useNotebooks();
  const insets = useSafeAreaInsets();
  const compact = useWidthClass() === 'compact';
  const [sheet, setSheet] = useState<Sheet>(null);
  const [moveTo, setMoveTo] = useState<LocationKey>({ kind: 'unfiled' });
  const [withRecordings, setWithRecordings] = useState(true);
  const [busy, setBusy] = useState(false);

  const ids = selection.picked;
  const entries = ids.map((id) => store.entries.find((e) => e.id === id)).filter((e): e is IndexEntry => !!e);
  const none = ids.length === 0 || busy;

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((e) => showToast({ text: libraryErrorText(e), tone: 'warn' }))
      .finally(() => {
        setBusy(false);
        selection.clear();
      });
  };

  const openMove = () => {
    // Starts at the place they share, else 'بدون مجلد'.
    const locs = entries.map((e) => entryLocation(e, store.folders));
    setMoveTo(locs.length && locs.every((l) => sameLoc(l, locs[0])) ? locs[0] : { kind: 'unfiled' });
    setSheet('move');
  };

  const move = () => {
    const to = moveTo;
    const list = entries.filter((e) => !sameLoc(entryLocation(e, store.folders), to)).map((e) => e.id);
    setSheet(null);
    run(async () => {
      const { done, error } = await eachIn(list, (id) => store.moveNotebook(id, to));
      const where = locationName(to, store);
      if (error) showToast({ text: libraryErrorText(error), tone: 'warn' });
      else if (done.length === 0) showToast({ text: tr(`المذكرات موجودة في ${where} بالفعل`, `They are already in ${where}`), tone: 'ok' });
      else showToast({ text: tr(`نُقلت ${count(done.length)} إلى ${where}`, `${count(done.length)} moved to ${where}`), tone: 'ok' });
    });
  };

  const share = () => {
    if (entries.some((e) => e.recordingCount > 0)) {
      setWithRecordings(true);
      setSheet('share');
      return;
    }
    const list = entries;
    run(() => shareMany(store, list, false));
  };

  const shareNow = () => {
    const list = entries;
    const rec = withRecordings;
    setSheet(null);
    // The native share sheet waits for this sheet to close (iOS).
    run(() => new Promise<void>((resolve) => afterModal(() => void shareMany(store, list, rec).finally(resolve))));
  };

  return (
    <>
      <View pointerEvents="box-none" style={[styles.barWrap, { bottom: insets.bottom + (compact ? 12 : 24), paddingHorizontal: NB_EDGE }]}>
        <View style={[styles.bar, shadow, { flexDirection: row }, !compact && styles.barRegular]}>
          <ActionButton icon="folder" label={tr('نقل', 'Move')} onPress={openMove} disabled={none} />
          <ActionButton icon="copy" label={tr('تكرار', 'Duplicate')} onPress={() => run(() => duplicateMany(store, ids))} disabled={none} />
          <ActionButton icon="share" label={tr('مشاركة', 'Share')} onPress={share} disabled={none} />
          <ActionButton icon="trash" label={tr('حذف', 'Delete')} onPress={() => run(() => deleteMany(store, ids))} disabled={none} danger />
        </View>
      </View>

      <NbSheet visible={sheet === 'move'} title={tr('نقل إلى', 'Move to')} subtitle={count(entries.length)} onClose={() => setSheet(null)}>
        <View style={styles.sheetBody}>
          <LocationChips value={moveTo} onChange={setMoveTo} />
          <PillButton label={tr('نقل', 'Move')} icon="folder" onPress={move} block />
        </View>
      </NbSheet>

      <NbSheet visible={sheet === 'share'} title={tr('مشاركة المذكرات', 'Share notebooks')} subtitle={count(entries.length)} onClose={() => setSheet(null)}>
        <View style={styles.sheetBody}>
          <AppText size={14} color={colors.faint}>
            {tr('بصيغة qunote — يفتحها زميلك في تطبيق QU Student ويكمل الكتابة', 'As .qunote files: a classmate opens them in QU Student and keeps writing')}
          </AppText>
          <Group>
            <ToggleRow
              title={tr('تضمين التسجيلات', 'Include recordings')}
              subtitle={tr('الملفات أكبر مع التسجيلات', 'The files are bigger with recordings')}
              value={withRecordings}
              onChange={setWithRecordings}
            />
          </Group>
          <PillButton label={tr('مشاركة', 'Share')} icon="share" onPress={shareNow} block />
        </View>
      </NbSheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { alignItems: 'center', gap: 12, height: NB_HEADER_BAND, paddingHorizontal: NB_EDGE },
  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  barRegular: { alignSelf: 'center', minWidth: 480, gap: 12 },
  action: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6, borderRadius: 14, minWidth: 64 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  sheetBody: { gap: 18, paddingTop: 8, paddingBottom: 4 },
});
