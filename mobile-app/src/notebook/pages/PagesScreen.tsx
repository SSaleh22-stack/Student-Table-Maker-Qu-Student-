/**
 * The pages view (Figma 13; NB-23, NB-24, NB-25, NB-49a): every page of the open notebook as a small
 * PNG thumbnail, one per row, to jump to, reorder (long press and drag) or add (the dashed tile last).
 *
 * Each page has a round ⋮ on its corner with that page's options: add a page after it, duplicate,
 * change the paper, insert a PDF after it, delete (one undo step each). There is no action bar.
 *
 * Two ways it shows (PagesPanel is the same list in both):
 * - Tablets: DOCKED beside the page in the editor (EditorScreen, settings.pagesPinned), the same width
 *   as the sidebar, so the student keeps writing with it open. The editor's pages button toggles it.
 *   A tap jumps to the page and the panel stays; it follows the page on screen; thumbnails refresh a
 *   moment after the last edit (DOCK_REFRESH_MS), never on every stroke.
 * - Phones: this route, a SIDEBAR on the physical right edge over the dimmed notebook (a transparent
 *   modal, src/app/notebook/_layout.tsx); a tap jumps and closes it, as does a tap on the notebook.
 *
 * - It uses the SAME session object the editor holds (the registry shares it), so edits here are the
 *   editor's edits and every action is one undo step there.
 * - The route's current page comes from ?current=<pageId>; without it the first page is current.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
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
  paperPlan,
  type PageActionId,
  type PagesView,
} from '@/notebook/core/pages/pageSelection';
import { gridMetrics } from '@/notebook/core/pages/reorder';
import type { NotebookSession } from '@/notebook/core/session/types';
import { countLabel } from '@/notebook/core/text/labels';
import { ImportProgress, importingPagesText, useImportUi } from '@/notebook/import/ImportProgress';
import { importFailureText } from '@/notebook/import/importPdf';
import { insertPdfInto } from '@/notebook/import/insertPdf';
import { getJobs, jobOf, subscribeJobs } from '@/notebook/import/jobs';
import { goBackOr, openLibrary, openNotebook } from '@/notebook/nav';
import { useNotebookSession } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { ConfirmDialog } from '@/notebook/ui/ConfirmDialog';
import { EmptyState } from '@/notebook/ui/EmptyState';
import { useWidthClass } from '@/notebook/ui/layout';
import { physicalPadding, physicalRight } from '@/notebook/ui/physical';
import { Popover, type AnchorRect } from '@/notebook/ui/Popover';
import { showToast } from '@/notebook/ui/toast';

import { PagePaperSheet, pdfPaperSkippedText } from './PagePaperSheet';
import { ReorderGrid } from './ReorderGrid';

export interface PagesScreenProps {
  notebookId: string | null;
  /** The editor's current page id (route param ?current=). */
  currentPageId?: string | null;
}

/** How long a paper change may wait for pages that had to be loaded before the undo group closes. */
const GROUP_WAIT_MS = 8000;
/** Sidebar width on tablets (also the docked panel); phones use part of the screen (at most 260). */
export const PANEL_W = 300;
const PHONE_PANEL_SHARE = 0.62;
/** Grid padding inside the panel. */
const PANEL_PAD_X = 16;
/** One page per row. */
const GRID_COLUMNS = 1;
/** A docked panel refreshes its thumbnails this long after the last edit (ms). */
const DOCK_REFRESH_MS = 1200;
/** Time for the ⋮ menu's Modal to go away before an option that opens a dialog runs. */
const AFTER_MENU_MS = Platform.OS === 'ios' ? 350 : 60;
/** Widest thumbnail in the one-column list (pt), so pages stay small. */
const THUMB_MAX_W = 200;

/** The width of the pages panel (safe-area inset not included). */
export function usePanelWidth(): number {
  const { width } = useWindowDimensions();
  const compact = useWidthClass() === 'compact';
  return Math.round(compact ? Math.min(width * PHONE_PANEL_SHARE, 260) : Math.min(PANEL_W, width * 0.6));
}

/** The dimmed notebook (tap to close) and the panel on the physical right edge. */
function SidePanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const width = usePanelWidth();
  return (
    <View style={styles.overlay}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={tr('إغلاق الصفحات', 'Close pages')}
      />
      <Animated.View
        entering={SlideInRight.duration(240)}
        accessibilityViewIsModal
        style={[styles.panel, { width, paddingTop: insets.top }, physicalPadding(0, insets.right), physicalRight(0)]}>
        {children}
      </Animated.View>
    </View>
  );
}

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

function Header({ subtitle, onDone }: { subtitle: string; onDone: () => void }) {
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <View style={styles.headerTexts}>
        <AppText size={18} weight="bold" numberOfLines={1} accessibilityRole="header">
          {tr('الصفحات', 'Pages')}
        </AppText>
        {subtitle ? (
          <AppText size={13} color={nbColors.faint} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <CircleButton icon="x" label={tr('إغلاق الصفحات', 'Close pages')} tone="muted" onPress={onDone} size={34} iconSize={17} />
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
      <SidePanel onClose={close}>
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
      </SidePanel>
    );
  }
  if (!session) {
    return (
      <SidePanel onClose={close}>
        <Centered>
          <ActivityIndicator color={nbColors.accent} accessibilityLabel={tr('جارٍ التحميل', 'Loading')} />
        </Centered>
      </SidePanel>
    );
  }
  return (
    <SidePanel onClose={close}>
      <PagesPanel session={session} currentId={currentPageId ?? null} onClose={close} />
    </SidePanel>
  );
}

interface PaperSheetState {
  apply: Id[];
  skippedPdf: number;
  initial: PaperSpec;
}

/** The page options menu, in this order (the ⋮ on each page). */
const MENU_ITEMS: { id: PageActionId; icon: IconName; label: () => string }[] = [
  { id: 'add', icon: 'plus', label: () => tr('إضافة صفحة بعدها', 'Add a page after') },
  { id: 'duplicate', icon: 'copy', label: () => tr('تكرار', 'Duplicate') },
  { id: 'paper', icon: 'grid', label: () => tr('تغيير الورق', 'Change paper') },
  { id: 'insertPdf', icon: 'fileText', label: () => tr('إدراج PDF بعدها', 'Insert a PDF after') },
  { id: 'delete', icon: 'trash', label: () => tr('حذف الصفحة', 'Delete page') },
];

const NO_SELECTION: ReadonlySet<Id> = new Set();

/** The view of one page's options: that page alone is the target. */
function viewFor(pageIds: readonly Id[], id: Id): PagesView {
  return { pageIds, current: id, mode: 'normal', selected: [] };
}

/**
 * The notebook's snapshot, refreshed on every change, or (calm) DOCK_REFRESH_MS after the last change
 * so a docked list never re-renders its thumbnails on every pen stroke. Adding or removing pages
 * refreshes at once either way.
 */
function useCalmSnapshot(session: NotebookSession, calm: boolean) {
  const [snap, setSnap] = useState(() => session.getSnapshot());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let count = session.notebook.pageIds.length;
    const unsub = session.subscribe(() => {
      const n = session.notebook.pageIds.length;
      if (!calm || n !== count) {
        count = n;
        if (timer) clearTimeout(timer);
        timer = null;
        setSnap(session.getSnapshot());
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setSnap(session.getSnapshot());
      }, DOCK_REFRESH_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [session, calm]);
  return snap;
}

export interface PagesPanelProps {
  session: NotebookSession;
  /** The editor's current page (the docked panel follows it). */
  currentId: Id | null;
  onClose: () => void;
  /** Docked beside the page in the editor: a tap jumps without closing, thumbnails refresh calmly. */
  docked?: boolean;
}

/** The pages list with its header, the ⋮ menu of each page and the dialogs. */
export function PagesPanel({ session, currentId, onClose, docked = false }: PagesPanelProps) {
  const lang = useLang();
  const snap = useCalmSnapshot(session, docked);
  const notebook = snap?.notebook ?? session.notebook;
  const pageIds = notebook.pageIds;
  const readOnly = session.readOnly;
  const insets = useSafeAreaInsets();
  const panelW = usePanelWidth();
  const imp = useImportUi();
  const job = useJobOf(session.id);

  const [rawCurrent, setCurrent] = useState<Id | null>(currentId);
  // The docked panel follows the page on screen.
  const [seenCurrent, setSeenCurrent] = useState(currentId);
  if (seenCurrent !== currentId) {
    setSeenCurrent(currentId);
    setCurrent(currentId);
  }
  const current = effectiveCurrent(pageIds, rawCurrent);

  const [menu, setMenu] = useState<{ id: Id; anchor: AnchorRect } | null>(null);
  const [paperSheet, setPaperSheet] = useState<PaperSheetState | null>(null);
  const [paperKey, setPaperKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<Id[] | null>(null);
  const [inserting, setInserting] = useState(false);
  const busyRef = useRef(false);
  const insertingRef = useRef(false);
  const menuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (menuTimer.current) clearTimeout(menuTimer.current);
    },
    [],
  );

  // ----- layout (one small page per row, centred)

  const gridW = Math.min(THUMB_MAX_W, Math.max(120, panelW - PANEL_PAD_X * 2));
  const padX = Math.max(PANEL_PAD_X, (panelW - gridW) / 2);
  const metrics = useMemo(() => gridMetrics({ width: gridW, columns: GRID_COLUMNS, compact: true }), [gridW]);
  const bottomGap = Math.max(insets.bottom, 12) + 8;

  // ----- actions (each on the pages of a view: one page from its ⋮)

  const onTap = useCallback(
    (id: Id) => {
      setCurrent(id);
      session.requestJump(id);
      if (!docked) onClose();
    },
    [session, docked, onClose],
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
    const ids = session.notebook.pageIds;
    const v = viewFor(ids, current ?? ids[0]);
    const plan = addPagePlan(v, bgOfSession(session), session.notebook.defaults, 'end');
    session.addPage(plan.after, { background: plan.background });
  }, [readOnly, session, current]);

  const addAfter = useCallback(
    async (v: PagesView) => {
      const targets = actionTargets(v);
      const last = targets.length ? targets[targets.length - 1] : null;
      // The new page copies the page's paper: make sure its background is known.
      if (last) await ensureLoaded(session, [last]);
      const plan = addPagePlan(v, bgOfSession(session), session.notebook.defaults, 'after');
      session.addPage(plan.after, { background: plan.background });
    },
    [session],
  );

  const openPaper = useCallback(
    async (targets: Id[]) => {
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
    },
    [session],
  );

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
      const edit = () => session.setPageBackground(sheet.apply, (p) => (want.has(p.id) ? toBg(p) : null));
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

  const insertPdf = useCallback(
    async (targets: Id[]) => {
      // A ref, not the state: two quick taps run before the state re-renders.
      if (insertingRef.current || readOnly) return;
      const at = insertIndexAfter(session.notebook.pageIds, targets);
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
    },
    [readOnly, session, imp],
  );

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
    showToast({
      text: deletedPagesText(doomed.length, getLang()),
      tone: 'ok',
      id: 'nb-pages-deleted',
      actionLabel: tr('تراجع', 'Undo'),
      onAction: entry ? () => session.undoIfTop(entry) : undefined,
    });
  }, [confirmDelete, readOnly, session, current]);

  /** Runs one option of a page's ⋮ menu. */
  const runFor = useCallback(
    (id: Id, action: PageActionId) => {
      const v = viewFor(session.notebook.pageIds, id);
      if (!actionStates(v, readOnly)[action].enabled || busyRef.current) return;
      const targets = actionTargets(v);
      const once = (p: Promise<void>) => {
        busyRef.current = true;
        p.catch(() => undefined).finally(() => {
          busyRef.current = false;
        });
      };
      switch (action) {
        case 'add':
          once(addAfter(v));
          break;
        case 'duplicate':
          // One call = one undo step (the copy goes right after its page).
          session.duplicatePages(targets);
          break;
        case 'paper':
          once(openPaper(targets));
          break;
        case 'insertPdf':
          void insertPdf(targets);
          break;
        case 'delete':
          setConfirmDelete(targets);
          break;
      }
    },
    [session, readOnly, addAfter, openPaper, insertPdf],
  );

  /** Closes the menu, then runs the option once its Modal has gone (iOS cannot stack Modals). */
  const pick = (action: PageActionId) => {
    const id = menu?.id;
    setMenu(null);
    if (!id) return;
    if (menuTimer.current) clearTimeout(menuTimer.current);
    menuTimer.current = setTimeout(() => {
      menuTimer.current = null;
      runFor(id, action);
    }, AFTER_MENU_MS);
  };

  const menuStates = menu ? actionStates(viewFor(pageIds, menu.id), readOnly) : null;
  const menuIndex = menu ? pageIds.indexOf(menu.id) : -1;

  // ----- text

  const subtitle = [notebook.title, countLabel(pageIds.length, 'page', lang)].filter(Boolean).join(' · ');
  const importing = job && job.state === 'running' ? importingPagesText(job.done, job.total) : null;

  return (
    <View style={styles.body}>
      <View style={[styles.top, { paddingHorizontal: PANEL_PAD_X }]}>
        <Header subtitle={subtitle} onDone={onClose} />
      </View>

      <ReorderGrid
        session={session}
        pageIds={pageIds}
        metrics={metrics}
        current={current}
        selectMode={false}
        selected={NO_SELECTION}
        defaults={notebook.defaults}
        readOnly={readOnly}
        onTap={onTap}
        onMove={onMove}
        onAddEnd={addAtEnd}
        onMenu={readOnly ? undefined : (id, anchor) => setMenu({ id, anchor })}
        padX={padX}
        bottomInset={bottomGap + 16}
        initialPageId={current}
      />

      {(inserting && imp.progress) || importing ? (
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: bottomGap, paddingHorizontal: 12 }]}>
          {inserting && imp.progress ? (
            <View style={styles.progressCard}>
              <ImportProgress info={imp.progress} hint={false} />
            </View>
          ) : null}
          {importing ? (
            <AppText size={13} color={nbColors.faint} align="center" style={styles.hint} accessibilityLiveRegion="polite">
              {importing}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <Popover
        visible={menu !== null}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        prefer="below"
        padding={6}
        gap={4}
        width={230}
        accessibilityLabel={menuIndex >= 0 ? tr(`خيارات الصفحة ${menuIndex + 1}`, `Page ${menuIndex + 1} options`) : tr('خيارات الصفحة', 'Page options')}>
        {MENU_ITEMS.map((it) => {
          const enabled = !!menuStates?.[it.id].enabled;
          const color = !enabled ? nbColors.placeholder : it.id === 'delete' ? nbColors.danger : nbColors.text;
          return (
            <Pressable
              key={it.id}
              onPress={() => pick(it.id)}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: !enabled }}
              style={({ pressed }) => [styles.menuRow, { flexDirection: row }, pressed && styles.menuPressed]}>
              <Icon name={it.icon} size={18} color={color} />
              <AppText size={15} weight="medium" color={color}>
                {it.label()}
              </AppText>
            </Pressable>
          );
        })}
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
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(27, 37, 51, 0.28)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: nbColors.bg,
    shadowColor: '#1B2533',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  body: { flex: 1 },
  top: { paddingTop: 12, paddingBottom: 8 },
  header: { alignItems: 'center', gap: 10, width: '100%', maxWidth: 1180, alignSelf: 'center' },
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
  menuRow: { alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12 },
  menuPressed: { backgroundColor: nbColors.surfaceMuted },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: nbColors.divider, marginHorizontal: 8 },
});
