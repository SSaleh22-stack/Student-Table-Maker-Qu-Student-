/**
 * The pages view (Figma 13; NB-23, NB-24, NB-25, NB-49a): every page of the open notebook as a PNG
 * thumbnail, to jump to, reorder, add, duplicate, re-paper, insert a PDF into, or delete.
 *
 *   (back)  صفحات المذكرة                                  تحديد   تم
 *           <notebook title> · 8 صفحات
 *   [grid of pages, 3 / 4 / 6 columns; 'الحالية' under the current page; dashed 'صفحة جديدة' last]
 *                    اسحب الصفحة لتغيير ترتيبها
 *   [ إضافة صفحة | تكرار | تغيير الورق | إدراج PDF | حذف ]
 *
 * - The screen uses useNotebookSession(id): the SAME session object the editor below holds (the
 *   registry shares it), so edits here are the editor's edits and every action is one undo step there.
 *   The editor stays mounted under this screen, so a recording keeps going.
 * - The current page comes from the route (?current=<pageId>, see the route file); without it the
 *   first page is current.
 * - Normal mode: a tap jumps (session.requestJump, then back); a long press lifts a page to reorder.
 *   'تحديد' switches to select mode (taps toggle pages, no reordering); 'إلغاء التحديد' leaves it.
 *   'تم' (and back) close the view. The action rules (targets for 0, 1 and n selected pages) are in
 *   core/pages/pageSelection.ts.
 * - Thumbnails refresh after any edit: the screen re-renders on every session change and each cell
 *   requests the thumbnail of the page's new version.
 */
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { SafeAreaView } from '@/components/SafeAreaView';
import { getLang, tr, useLang } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import type { Id, PageBackground, PaperSpec } from '@/notebook/core/model';
import {
  actionStates,
  actionTargets,
  addPagePlan,
  backgroundWithPaper,
  currentAfterDelete,
  deletePagesTitle,
  deletedPagesText,
  effectiveCurrent,
  initialPaper,
  insertIndexAfter,
  pagesHint,
  paperPlan,
  pruneSelection,
  selectionChanged,
  tapAction,
  toggleSelected,
  type PageActionId,
  type PagesView,
} from '@/notebook/core/pages/pageSelection';
import { gridColumns, gridMetrics } from '@/notebook/core/pages/reorder';
import type { NotebookSession } from '@/notebook/core/session/types';
import { countLabel } from '@/notebook/core/text/labels';
import { ImportProgress, importingPagesText, useImportUi } from '@/notebook/import/ImportProgress';
import { importFailureText } from '@/notebook/import/importPdf';
import { insertPdfInto } from '@/notebook/import/insertPdf';
import { getJobs, jobOf, subscribeJobs } from '@/notebook/import/jobs';
import { goBackOr, openLibrary, openNotebook } from '@/notebook/nav';
import { useNotebookSession, useSessionSnapshot } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { ConfirmDialog } from '@/notebook/ui/ConfirmDialog';
import { EmptyState } from '@/notebook/ui/EmptyState';
import { useWidthClass } from '@/notebook/ui/layout';
import { Popover, type AnchorRect } from '@/notebook/ui/Popover';
import { showToast } from '@/notebook/ui/toast';

import { PageActionsBar } from './PageActionsBar';
import { PagePaperSheet, pdfPaperSkippedText } from './PagePaperSheet';
import { ReorderGrid } from './ReorderGrid';

export interface PagesScreenProps {
  notebookId: string | null;
  /** The editor's current page id (route param ?current=). */
  currentPageId?: string | null;
}

/** How long a paper change may wait for pages that had to be loaded before the undo group closes. */
const GROUP_WAIT_MS = 8000;

function closeTo(notebookId: string | null) {
  goBackOr(() => (notebookId ? openNotebook(notebookId, { replace: true }) : openLibrary()));
}

/** Loads pages (errors ignored: a missing page reads as a blank page anyway). */
async function ensureLoaded(s: NotebookSession, ids: readonly Id[]): Promise<void> {
  await Promise.all(ids.map((id) => s.loadPage(id).catch(() => undefined)));
}

const noop = () => {};

/**
 * Loads pages and keeps them in memory until the returned unpin() runs. The session keeps only 12
 * pages (its LRU) and drops older ones after every load, but never a page with a subscriber, so a
 * selection of more than 12 pages would otherwise come back with most backgrounds unknown.
 */
async function loadPinned(s: NotebookSession, ids: readonly Id[]): Promise<() => void> {
  const unsubs = [...new Set(ids)].map((id) => s.subscribePage(id, noop));
  const unpin = () => {
    for (const u of unsubs.splice(0)) u();
  };
  try {
    await ensureLoaded(s, ids);
  } catch {
    // ensureLoaded never rejects; keep the pins consistent anyway.
  }
  return unpin;
}

const bgOfSession =
  (s: NotebookSession) =>
  (id: Id): PageBackground | undefined =>
    s.getPage(id)?.background;

/**
 * Runs `edit` inside one undo group with `then`, which must run after the edit LANDED. Page edits on
 * pages that are not in memory land after their pages load (session.withPages), so the group stays
 * open until `landed()` is true after a session change, or GROUP_WAIT_MS passed. `cleanup` runs once
 * the group is closed. With every page pinned in memory (loadPinned) the edit lands at once and the
 * whole group is synchronous; the wait is only a fallback.
 */
function groupedEdit(
  s: NotebookSession,
  label: string,
  edit: () => void,
  landed: () => boolean,
  then: () => void,
  cleanup: () => void,
): void {
  s.beginGroup(label);
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsub: (() => void) | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    unsub?.();
    if (timer) clearTimeout(timer);
    try {
      then();
    } finally {
      s.endGroup();
      cleanup();
    }
  };
  try {
    edit();
  } catch (e) {
    done = true;
    s.endGroup();
    cleanup();
    throw e;
  }
  if (landed()) {
    finish();
    return;
  }
  unsub = s.subscribe(() => {
    if (landed()) finish();
  });
  timer = setTimeout(finish, GROUP_WAIT_MS);
}

function useJobOf(notebookId: string | null) {
  const jobs = useSyncExternalStore(subscribeJobs, getJobs, getJobs);
  return useMemo(() => (notebookId && jobs.length ? jobOf(notebookId) : null), [jobs, notebookId]);
}

function Header({
  subtitle,
  selectMode,
  onToggleSelect,
  onDone,
  selectDisabled,
}: {
  subtitle: string;
  selectMode: boolean;
  onToggleSelect: () => void;
  onDone: () => void;
  selectDisabled: boolean;
}) {
  const compact = useWidthClass() === 'compact';
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <CircleButton icon="back" label={tr('رجوع', 'Back')} onPress={onDone} size={compact ? 40 : 44} />
      <View style={styles.headerTexts}>
        <AppText size={compact ? 22 : 28} weight="bold" numberOfLines={1} accessibilityRole="header">
          {tr('صفحات المذكرة', 'Notebook pages')}
        </AppText>
        {subtitle ? (
          <AppText size={compact ? 13 : 14} color={nbColors.faint} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Pressable
        onPress={onToggleSelect}
        disabled={selectDisabled}
        accessibilityRole="button"
        accessibilityState={{ selected: selectMode, disabled: selectDisabled }}
        hitSlop={8}
        style={({ pressed }) => [styles.textBtn, { opacity: selectDisabled ? 0.4 : pressed ? 0.6 : 1 }]}>
        <AppText size={compact ? 15 : 17} weight="semibold" color={nbColors.accent}>
          {selectMode ? tr('إلغاء التحديد', 'Cancel selection') : tr('تحديد', 'Select')}
        </AppText>
      </Pressable>
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.textBtn, { opacity: pressed ? 0.6 : 1 }]}>
        <AppText size={compact ? 15 : 17} weight="bold" color={nbColors.accent}>
          {tr('تم', 'Done')}
        </AppText>
      </Pressable>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function PagesScreen({ notebookId, currentPageId }: PagesScreenProps) {
  const { session, error } = useNotebookSession(notebookId);
  const close = useCallback(() => closeTo(notebookId), [notebookId]);

  if (!notebookId || error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
        <Centered>
          <EmptyState
            icon="alert"
            title={tr('تعذّر فتح المذكرة', 'The notebook could not be opened')}
            body={
              error === 'missing'
                ? tr('ربما حُذفت هذه المذكرة.', 'This notebook may have been deleted.')
                : tr('حاول مرة أخرى بعد قليل.', 'Please try again in a moment.')
            }
            primary={{ label: tr('رجوع', 'Back'), icon: 'back', onPress: close }}
          />
        </Centered>
      </SafeAreaView>
    );
  }
  if (!session) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
        <Centered>
          <ActivityIndicator color={nbColors.accent} accessibilityLabel={tr('جارٍ التحميل', 'Loading')} />
        </Centered>
      </SafeAreaView>
    );
  }
  return <PagesBody session={session} initialCurrent={currentPageId ?? null} onClose={close} />;
}

interface PaperSheetState {
  apply: Id[];
  skippedPdf: number;
  initial: PaperSpec;
}

function PagesBody({ session, initialCurrent, onClose }: { session: NotebookSession; initialCurrent: Id | null; onClose: () => void }) {
  const lang = useLang();
  const snap = useSessionSnapshot(session);
  const notebook = snap?.notebook ?? session.notebook;
  const pageIds = notebook.pageIds;
  const readOnly = session.readOnly;
  const { width: winW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = useWidthClass() === 'compact';
  const imp = useImportUi();
  const job = useJobOf(session.id);

  const [mode, setMode] = useState<'normal' | 'select'>('normal');
  const [rawSelected, setSelected] = useState<Id[]>([]);
  const [rawCurrent, setCurrent] = useState<Id | null>(initialCurrent);
  const [paperSheet, setPaperSheet] = useState<PaperSheetState | null>(null);
  const [paperKey, setPaperKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<Id[] | null>(null);
  const [addAnchor, setAddAnchor] = useState<AnchorRect | null>(null);
  const [inserting, setInserting] = useState(false);
  const [barH, setBarH] = useState(0);
  const busyRef = useRef(false);
  const insertingRef = useRef(false);

  // Pages removed elsewhere (undo, an import, a delete) leave the selection; a removed current page
  // falls back to the first page.
  const selected = useMemo(
    () => (selectionChanged(rawSelected, pageIds) ? pruneSelection(rawSelected, pageIds) : rawSelected),
    [rawSelected, pageIds],
  );
  const current = effectiveCurrent(pageIds, rawCurrent);

  const view: PagesView = useMemo(() => ({ pageIds, current, mode, selected }), [pageIds, current, mode, selected]);
  const states = useMemo(() => actionStates(view, readOnly), [view, readOnly]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const targets = useMemo(() => actionTargets(view), [view]);

  // ----- layout

  const padX = compact ? 16 : 52;
  const gridW = Math.max(120, winW - insets.left - insets.right - padX * 2);
  const metrics = useMemo(
    () => gridMetrics({ width: gridW, columns: gridColumns(winW), compact }),
    [gridW, winW, compact],
  );
  const bottomGap = Math.max(insets.bottom, 12) + (compact ? 8 : 24);
  const hintH = 34;

  // ----- actions

  const toggleSelect = useCallback(() => {
    setMode((m) => (m === 'select' ? 'normal' : 'select'));
    setSelected([]);
  }, []);

  const onTap = useCallback(
    (id: Id) => {
      if (tapAction(mode) === 'toggle') {
        setSelected((s) => toggleSelected(s, id));
        return;
      }
      session.requestJump(id);
      onClose();
    },
    [mode, session, onClose],
  );

  const onMove = useCallback(
    (id: Id, toIndex: number) => {
      if (readOnly) return;
      const n = session.notebook.pageIds.length;
      if (!(toIndex >= 0 && toIndex < n)) return;
      session.movePage(id, toIndex);
    },
    [session, readOnly],
  );

  const addAtEnd = useCallback(() => {
    if (readOnly) return;
    const plan = addPagePlan(view, bgOfSession(session), session.notebook.defaults, 'end');
    session.addPage(plan.after, { background: plan.background });
  }, [readOnly, view, session]);

  const addAfterTargets = useCallback(async () => {
    const last = targets.length ? targets[targets.length - 1] : null;
    // The new page copies the last target's paper: make sure its background is known.
    if (last) await ensureLoaded(session, [last]);
    const plan = addPagePlan(view, bgOfSession(session), session.notebook.defaults, 'after');
    session.addPage(plan.after, { background: plan.background });
  }, [targets, session, view]);

  const duplicate = useCallback(() => {
    if (!targets.length) return;
    // One call = one undo step (each copy goes right after its page).
    session.duplicatePages(targets);
  }, [targets, session]);

  const openPaper = useCallback(async () => {
    if (!targets.length) return;
    const unpin = await loadPinned(session, targets);
    let plan: ReturnType<typeof paperPlan>;
    let initial: PaperSpec;
    try {
      plan = paperPlan(targets, bgOfSession(session));
      initial = initialPaper(plan.apply, bgOfSession(session), session.notebook.defaults);
    } finally {
      unpin();
    }
    if (plan.apply.length === 0) {
      if (plan.skippedPdf > 0) showToast({ text: pdfPaperSkippedText(), tone: 'info', id: 'nb-pages-paper-pdf' });
      return;
    }
    setPaperKey((k) => k + 1);
    setPaperSheet({ apply: plan.apply, skippedPdf: plan.skippedPdf, initial });
  }, [targets, session]);

  const applyPaper = useCallback(
    async (paper: PaperSpec, applyToNew: boolean) => {
      const sheet = paperSheet;
      setPaperSheet(null);
      if (!sheet || readOnly) return;
      // Pinned and loaded: setPageBackground then runs at once on pages in memory (one history
      // entry), so with the switch on it and setDefaults close in the same undo group right away.
      const unpin = await loadPinned(session, sheet.apply);
      const toBg = (p: { background: PageBackground }) => backgroundWithPaper(p.background, paper);
      const want = new Set(sheet.apply);
      // A page not in memory (it left the notebook meanwhile) is not waited for.
      const landed = () =>
        sheet.apply.every((id) => {
          const p = session.getPage(id);
          if (!p) return true;
          const bg = p.background;
          return bg.kind === 'pdf' || (bg.paper.style === paper.style && bg.paper.color === paper.color && bg.paper.size === paper.size);
        });
      const edit = () =>
        session.setPageBackground(sheet.apply, (p) => (want.has(p.id) ? toBg(p) : null));
      if (applyToNew) {
        groupedEdit(session, 'changePaper', edit, landed, () => session.setDefaults(paper), unpin);
      } else {
        try {
          edit();
        } finally {
          unpin();
        }
      }
      if (sheet.skippedPdf > 0) showToast({ text: pdfPaperSkippedText(), tone: 'info', id: 'nb-pages-paper-pdf' });
    },
    [paperSheet, readOnly, session],
  );

  const insertPdf = useCallback(async () => {
    // A ref, not the state: two quick taps run before the state re-renders.
    if (insertingRef.current || readOnly) return;
    const at = insertIndexAfter(pageIds, targets);
    insertingRef.current = true;
    setInserting(true);
    try {
      const r = await insertPdfInto(session, at, imp.ui);
      if (!r.ok) {
        const text = importFailureText(r.reason);
        if (text) showToast({ text, tone: 'warn', id: 'nb-pages-insert-pdf' });
      }
    } catch {
      const text = importFailureText('io');
      if (text) showToast({ text, tone: 'warn', id: 'nb-pages-insert-pdf' });
    } finally {
      insertingRef.current = false;
      setInserting(false);
      imp.resetProgress();
    }
  }, [readOnly, pageIds, targets, session, imp]);

  const askDelete = useCallback(() => {
    if (!states.delete.enabled) return;
    setConfirmDelete(targets);
  }, [states.delete.enabled, targets]);

  const doDelete = useCallback(() => {
    const ids = confirmDelete;
    setConfirmDelete(null);
    if (!ids || readOnly) return;
    const live = session.notebook.pageIds;
    const doomed = ids.filter((id) => live.includes(id));
    // Never every page (the dialog was opened while that was not the case, but pages may have gone).
    if (!doomed.length || doomed.length >= live.length) return;
    const nextCurrent = currentAfterDelete(live, doomed, current);
    session.deletePages(doomed);
    const entry = session.topEntryId();
    setCurrent(nextCurrent);
    setSelected((s) => s.filter((id) => !doomed.includes(id)));
    showToast({
      text: deletedPagesText(doomed.length, getLang()),
      tone: 'ok',
      id: 'nb-pages-deleted',
      actionLabel: tr('تراجع', 'Undo'),
      onAction: entry ? () => session.undoIfTop(entry) : undefined,
    });
  }, [confirmDelete, readOnly, session, current]);

  const run = useCallback(
    (id: PageActionId) => {
      if (!states[id].enabled || busyRef.current) return;
      const once = (p: Promise<void> | void) => {
        if (!p) return;
        busyRef.current = true;
        p.catch(() => undefined).finally(() => {
          busyRef.current = false;
        });
      };
      switch (id) {
        case 'add':
          once(addAfterTargets());
          break;
        case 'duplicate':
          duplicate();
          break;
        case 'paper':
          once(openPaper());
          break;
        case 'insertPdf':
          void insertPdf();
          break;
        case 'delete':
          askDelete();
          break;
      }
    },
    [states, addAfterTargets, duplicate, openPaper, insertPdf, askDelete],
  );

  // ----- text

  const subtitle = [notebook.title, countLabel(pageIds.length, 'page', lang)].filter(Boolean).join(' · ');
  const hint =
    job && job.state === 'running' ? importingPagesText(job.done, job.total) : pagesHint(view, lang, readOnly);
  const targetsLabel =
    mode === 'select' && selected.length ? countLabel(targets.length, 'page', lang) : tr('الصفحة الحالية', 'The current page');
  const addAfterLabel =
    mode === 'select' && selected.length ? tr('بعد الصفحات المحددة', 'After the selected pages') : tr('بعد الصفحة الحالية', 'After the current page');

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={[styles.top, { paddingHorizontal: compact ? 16 : 32 }]}>
        <Header
          subtitle={subtitle}
          selectMode={mode === 'select'}
          onToggleSelect={toggleSelect}
          onDone={onClose}
          selectDisabled={readOnly}
        />
      </View>

      <ReorderGrid
        session={session}
        pageIds={pageIds}
        metrics={metrics}
        current={current}
        selectMode={mode === 'select'}
        selected={selectedSet}
        defaults={notebook.defaults}
        readOnly={readOnly}
        onTap={onTap}
        onMove={onMove}
        onAddEnd={addAtEnd}
        padX={padX}
        bottomInset={barH + hintH + bottomGap + 16}
        initialPageId={current}
      />

      <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: bottomGap, paddingHorizontal: compact ? 12 : 32 }]}>
        {inserting && imp.progress ? (
          <View style={styles.progressCard}>
            <ImportProgress info={imp.progress} hint={false} />
          </View>
        ) : null}
        <AppText size={13} color={nbColors.faint} align="center" style={styles.hint} accessibilityLiveRegion="polite">
          {hint}
        </AppText>
        <View onLayout={(e) => setBarH(e.nativeEvent.layout.height)}>
          <PageActionsBar
            states={states}
            onAction={run}
            onAddLongPress={(a) => {
              if (states.add.enabled) setAddAnchor(a ?? { x: winW / 2, y: 0, width: 1, height: 1 });
            }}
            compact={compact}
            targetsLabel={targetsLabel}
          />
        </View>
      </View>

      <Popover
        visible={addAnchor !== null}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        prefer="above"
        padding={8}
        gap={0}
        accessibilityLabel={tr('إضافة صفحة', 'Add page')}>
        <Pressable
          onPress={() => {
            setAddAnchor(null);
            run('add');
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.menuRow, { opacity: pressed ? 0.6 : 1 }]}>
          <AppText size={16} weight="medium">
            {addAfterLabel}
          </AppText>
        </Pressable>
        <View style={styles.menuDivider} />
        <Pressable
          onPress={() => {
            setAddAnchor(null);
            addAtEnd();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.menuRow, { opacity: pressed ? 0.6 : 1 }]}>
          <AppText size={16} weight="medium">
            {tr('في النهاية', 'At the end')}
          </AppText>
        </Pressable>
      </Popover>

      <PagePaperSheet
        key={paperKey}
        visible={paperSheet !== null}
        initial={paperSheet?.initial ?? notebook.defaults}
        count={paperSheet?.apply.length ?? 0}
        skippedPdf={paperSheet?.skippedPdf ?? 0}
        onApply={(p, n) => {
          void applyPaper(p, n);
        }}
        onClose={() => setPaperSheet(null)}
      />

      <ConfirmDialog
        visible={confirmDelete !== null}
        title={deletePagesTitle(confirmDelete?.length ?? 0, lang)}
        message={tr('يمكنك التراجع عن الحذف من المذكرة.', 'You can undo this in the notebook.')}
        confirmLabel={tr('حذف', 'Delete')}
        destructive
        icon="trash"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {imp.dialogs}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: nbColors.bg },
  top: { paddingTop: 12, paddingBottom: 8 },
  header: { alignItems: 'center', gap: 14, width: '100%', maxWidth: 1180, alignSelf: 'center' },
  headerTexts: { flex: 1, gap: 2 },
  textBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'stretch', gap: 10 },
  hint: { alignSelf: 'center', paddingHorizontal: 16 },
  progressCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    backgroundColor: nbColors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: nbColors.border,
  },
  menuRow: { paddingHorizontal: 14, paddingVertical: 12, minWidth: 200 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: nbColors.divider, marginHorizontal: 8 },
});
