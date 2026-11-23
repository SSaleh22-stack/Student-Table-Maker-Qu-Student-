/**
 * The actions of a notebook card (NB-13, NB-72): rename, duplicate, move (MoveSheet), share the
 * editable notebook file (.qunote) and delete. Delete moves the notebook to Recently deleted and
 * shows a toast whose 'تراجع' restores it (restoreNotebook).
 *
 * Share: the notebook is opened (store.openSession, always paired with releaseSession), packed with
 * exportQunote into the cache, and handed to the system share sheet (shareFile with the .qunote MIME
 * type and UTI), which deletes the file afterwards. When the notebook has recordings a small sheet
 * asks first, with the 'تضمين التسجيلات' switch and both sizes (NB-74); otherwise it shares at once.
 *
 * Every step is its own modal. iOS cannot present a modal while another one is still closing, so a
 * step change closes the current modal and opens the next one MODAL_SWAP_MS later (useModalSteps),
 * and anything that leaves the screen (the share sheet, navigation) waits the same delay.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { getLang, tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';
import { QUNOTE_MIME, QUNOTE_UTI } from '@/notebook/contracts/export';
import { entryLocation } from '@/notebook/core/library/derive';
import type { IndexEntry } from '@/notebook/core/model';
import { bytesLabel } from '@/notebook/core/text/labels';
import { estimateQunoteForSession, exportQunote, isQunoteError } from '@/notebook/qunote';
import { useNotebooks, type NotebookSession, type NotebooksStore } from '@/notebook/store/hooks';
import { PillButton } from '@/notebook/ui/CircleButton';
import { Group } from '@/notebook/ui/Group';
import { ListRow } from '@/notebook/ui/ListRow';
import { NbSheet } from '@/notebook/ui/NbSheet';
import type { AnchorRect } from '@/notebook/ui/Popover';
import { shareFile } from '@/notebook/ui/shareFile';
import { TextPromptDialog } from '@/notebook/ui/TextPromptDialog';
import { showToast } from '@/notebook/ui/toast';
import { ToggleRow } from '@/notebook/ui/ToggleRow';

import { libraryErrorText, locationName, MoveSheet } from './MoveSheet';
import { notebookTitle } from './NotebookCard';

/** How long a closing modal needs before the next one (or a share sheet) can be presented. */
export const MODAL_SWAP_MS = Platform.OS === 'ios' ? 380 : 60;

/** Runs fn once the modal that is closing now is gone. */
export function afterModal(fn: () => void): void {
  setTimeout(fn, MODAL_SWAP_MS);
}

/**
 * One modal at a time: `step` is the modal showing (null: none). go(next) closes the current one and
 * opens `next` MODAL_SWAP_MS later; set(next) switches at once (the first open, or closing). A later
 * go or set cancels a pending switch. set may be called while rendering (derived state).
 */
export function useModalSteps<S extends string>(initial: S | null = null) {
  const [state, setState] = useState<{ step: S | null; pending: S | null; seq: number }>({ step: initial, pending: null, seq: 0 });
  const { pending, seq } = state;
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => {
      setState((s) => (s.seq === seq ? { step: s.pending, pending: null, seq: s.seq } : s));
    }, MODAL_SWAP_MS);
    return () => clearTimeout(t);
  }, [pending, seq]);
  const set = (next: S | null) => setState((s) => ({ step: next, pending: null, seq: s.seq + 1 }));
  const go = (next: S | null) => setState((s) => ({ step: null, pending: next, seq: s.seq + 1 }));
  return { step: state.step, set, go };
}

/** The toast text for a failed .qunote export. */
export function qunoteErrorText(e: unknown): string {
  if (e instanceof Error && e.message === 'sharing-unavailable') {
    return tr('المشاركة غير متاحة على هذا الجهاز.', 'Sharing is not available on this device.');
  }
  if (isQunoteError(e)) {
    if (e.code === 'read-only') {
      return tr('حُفظت هذه المذكرة بإصدار أحدث من التطبيق. حدّث التطبيق لمشاركتها.', 'This notebook was saved by a newer version of the app. Update the app to share it.');
    }
    if (e.code === 'too-large') {
      return tr('المذكرة أكبر من أن تُرسل في ملف واحد.', 'This notebook is too large to send as one file.');
    }
  }
  if (e && typeof e === 'object' && 'code' in e) return libraryErrorText(e);
  return tr('تعذّر تجهيز ملف المذكرة. حاول مرة أخرى.', 'The notebook file could not be prepared. Please try again.');
}

const shareTitle = () => tr('مشاركة المذكرة', 'Share notebook');
const preparingText = () => tr('جارٍ تجهيز ملف المذكرة…', 'Preparing the notebook file…');

function shareUri(uri: string, anchor: AnchorRect | null): void {
  afterModal(() => {
    shareFile(uri, { mimeType: QUNOTE_MIME, UTI: QUNOTE_UTI, dialogTitle: shareTitle(), anchor: anchor ?? undefined }).catch((e) =>
      showToast({ text: qunoteErrorText(e), tone: 'warn' }),
    );
  });
}

/** Opens the notebook, packs it and shares it (no questions: the notebook has no recordings). */
async function shareNow(store: NotebooksStore, entry: IndexEntry, anchor: AnchorRect | null): Promise<void> {
  const hide = showToast({ text: preparingText(), tone: 'info', durationMs: 0, id: 'nb-qunote' });
  let session: NotebookSession | null = null;
  try {
    session = await store.openSession(entry.id);
    const { uri } = await exportQunote(session, { includeRecordings: false });
    hide();
    shareUri(uri, anchor);
  } catch (e) {
    hide();
    showToast({ text: qunoteErrorText(e), tone: 'warn' });
  } finally {
    if (session) store.releaseSession(entry.id);
  }
}

/** The 'تضمين التسجيلات' sheet body: holds the notebook open while it shows. */
function ShareBody({ entry, anchor, onClose }: { entry: IndexEntry; anchor: AnchorRect | null; onClose: () => void }) {
  // The store's methods are stable functions (the snapshot object changes with every index write,
  // which would reopen the notebook if the effect depended on it).
  const { openSession, releaseSession } = useNotebooks();
  const lang = getLang();
  const [session, setSession] = useState<NotebookSession | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [sizes, setSizes] = useState<{ withRecordings: number; withoutRecordings: number } | null>(null);
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * The export running now. If the sheet is dismissed mid-export, the session is released only once
   * the export settles (a long export with recordings can outlast the session's 5 s grace).
   */
  const exporting = useRef<Promise<unknown> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    let alive = true;
    let opened = false;
    mounted.current = true;
    const id = entry.id;
    openSession(id).then(
      (s) => {
        opened = true;
        if (!alive) {
          releaseSession(id);
          return;
        }
        setSession(s);
        estimateQunoteForSession(s).then(
          (r) => {
            if (alive) setSizes(r);
          },
          (e) => {
            // Without the sizes the sheet cannot offer the choice: say so instead of spinning.
            if (alive) setFailed(e ?? new Error('estimate'));
          },
        );
      },
      (e) => {
        if (alive) setFailed(e ?? new Error('open'));
      },
    );
    return () => {
      alive = false;
      mounted.current = false;
      if (!opened) return;
      const job = exporting.current;
      if (job) {
        const release = () => releaseSession(id);
        job.then(release, release);
      } else {
        releaseSession(id);
      }
    };
  }, [openSession, releaseSession, entry.id]);

  const hasAudio = !!sizes && sizes.withRecordings !== sizes.withoutRecordings;

  const share = async () => {
    if (!session || exporting.current) return;
    setBusy(true);
    const job = exportQunote(session, { includeRecordings: hasAudio && include });
    exporting.current = job;
    try {
      const { uri } = await job;
      onClose();
      shareUri(uri, anchor);
    } catch (e) {
      if (mounted.current) setBusy(false);
      showToast({ text: qunoteErrorText(e), tone: 'warn' });
    } finally {
      exporting.current = null;
    }
  };

  if (failed) {
    return (
      <AppText size={15} color={colors.danger} style={styles.pad}>
        {qunoteErrorText(failed)}
      </AppText>
    );
  }

  return (
    <View style={styles.shareBody}>
      <AppText size={14} color={colors.faint}>
        {tr('بصيغة qunote — يفتحه زميلك في تطبيق QU Student ويكمل الكتابة', 'As a .qunote file: a classmate opens it in QU Student and keeps writing')}
      </AppText>
      {!session || !sizes ? (
        <ActivityIndicator color={colors.accent} style={styles.pad} />
      ) : hasAudio ? (
        <Group>
          <ToggleRow
            title={tr('تضمين التسجيلات', 'Include recordings')}
            subtitle={tr(
              `مع التسجيلات ${bytesLabel(sizes.withRecordings, lang)} · بدونها ${bytesLabel(sizes.withoutRecordings, lang)}`,
              `With recordings ${bytesLabel(sizes.withRecordings, lang)} · without ${bytesLabel(sizes.withoutRecordings, lang)}`,
            )}
            value={include}
            onChange={setInclude}
            disabled={busy}
          />
        </Group>
      ) : (
        <AppText size={14} color={colors.muted}>
          {tr('الحجم ', 'Size ') + bytesLabel(sizes.withoutRecordings, lang)}
        </AppText>
      )}
      <PillButton
        label={busy ? preparingText() : tr('مشاركة', 'Share')}
        icon="share"
        onPress={() => void share()}
        disabled={!session || !sizes}
        loading={busy}
        block
      />
    </View>
  );
}

type Step = 'menu' | 'rename' | 'move' | 'share';

export interface NotebookActionsTarget {
  entry: IndexEntry;
  /** The card in window coordinates (iPad share popover). */
  anchor: AnchorRect | null;
}

export interface NotebookActionsSheetProps {
  /** A new object opens the actions for that notebook. */
  target: NotebookActionsTarget | null;
  /** Called once the actions are finished (the parent clears target). */
  onClose: () => void;
}

export function NotebookActionsSheet({ target, onClose }: NotebookActionsSheetProps) {
  const store = useNotebooks();
  const steps = useModalSteps<Step>(target ? 'menu' : null);
  const [held, setHeld] = useState<NotebookActionsTarget | null>(target);
  const [prev, setPrev] = useState<NotebookActionsTarget | null>(target);
  if (prev !== target) {
    // A new target opens the menu (state adjusted while rendering, React's derived-state pattern).
    setPrev(target);
    if (target) {
      setHeld(target);
      steps.set('menu');
    }
  }

  // The live entry (a rename while the sheet is open shows at once); the held copy while closing.
  const entry = held ? (store.entries.find((e) => e.id === held.entry.id) ?? held.entry) : null;
  const anchor = held?.anchor ?? null;
  const title = entry ? notebookTitle(entry) : '';

  const finish = () => {
    steps.set(null);
    onClose();
  };

  const run = (fn: () => Promise<void>) => {
    finish();
    fn().catch((e) => showToast({ text: libraryErrorText(e), tone: 'warn' }));
  };

  const onDuplicate = () => {
    if (!entry) return;
    run(async () => {
      await store.duplicateNotebook(entry.id);
      showToast({ text: tr('أُنشئت نسخة من المذكرة', 'A copy of the notebook was made'), tone: 'ok' });
    });
  };

  const onDelete = () => {
    if (!entry) return;
    const id = entry.id;
    run(async () => {
      await store.trashNotebook(id);
      showToast({
        text: tr('نُقلت المذكرة إلى المحذوفة مؤخراً', 'The notebook moved to Recently deleted'),
        detail: title,
        tone: 'ok',
        onAction: () => {
          store.restoreNotebook(id).catch((e) => showToast({ text: libraryErrorText(e), tone: 'warn' }));
        },
      });
    });
  };

  const onShare = () => {
    if (!entry) return;
    if (entry.recordingCount > 0) {
      steps.go('share');
      return;
    }
    const e = entry;
    finish();
    void shareNow(store, e, anchor);
  };

  const where = entry ? locationName(entryLocation(entry, store.folders), store) : undefined;

  return (
    <>
      <NbSheet visible={steps.step === 'menu' && !!entry} title={title} subtitle={where} onClose={finish}>
        <Group style={styles.menu}>
          <ListRow title={tr('إعادة التسمية', 'Rename')} icon="pen" onPress={() => steps.go('rename')} chevron={false} />
          <ListRow title={tr('تكرار', 'Duplicate')} icon="copy" onPress={onDuplicate} chevron={false} />
          <ListRow title={tr('نقل إلى…', 'Move to…')} icon="folder" onPress={() => steps.go('move')} chevron={false} />
          <ListRow
            title={tr('مشاركة ملف المذكرة', 'Share notebook file')}
            subtitle={tr('ملف qunote قابل للتعديل', 'An editable .qunote file')}
            icon="share"
            onPress={onShare}
            chevron={false}
          />
          <ListRow
            title={tr('حذف', 'Delete')}
            subtitle={tr('تبقى في المحذوفة مؤخراً 30 يوماً', 'Kept in Recently deleted for 30 days')}
            icon="trash"
            iconColor={colors.danger}
            iconFill={colors.dangerSoft}
            destructive
            onPress={onDelete}
            chevron={false}
          />
        </Group>
      </NbSheet>

      <TextPromptDialog
        visible={steps.step === 'rename' && !!entry}
        title={tr('إعادة تسمية المذكرة', 'Rename notebook')}
        fieldLabel={tr('اسم المذكرة', 'Notebook name')}
        initialValue={entry?.title ?? ''}
        requireChange
        onCancel={finish}
        onSubmit={(t) => {
          if (!entry) return;
          const id = entry.id;
          run(() => store.renameNotebook(id, t));
        }}
      />

      <MoveSheet visible={steps.step === 'move'} entry={entry} onClose={finish} />

      <NbSheet visible={steps.step === 'share' && !!entry} title={shareTitle()} subtitle={title} onClose={finish}>
        {entry ? <ShareBody entry={entry} anchor={anchor} onClose={finish} /> : null}
      </NbSheet>
    </>
  );
}

const styles = StyleSheet.create({
  menu: { marginTop: 4, marginBottom: 4 },
  shareBody: { gap: 16, paddingTop: 4, paddingBottom: 4 },
  pad: { paddingVertical: 16 },
});
