/**
 * The notebook library (Figma 02, 17, 24-28; NB-4, NB-10..NB-15, NB-T1).
 *
 * SECTION RULES
 * - The empty state (Figma 17: 'لا توجد مذكرات بعد', 'مذكرة جديدة' and 'استيراد PDF') replaces the
 *   sections only when there are no notebooks (outside Recently deleted), no course folders and no
 *   folders of the student's own.
 * - Otherwise, in this order (NB-10): 'موادي' ('من جدولك') when there is at least one course folder
 *   (a timetable course with no notebooks reads 'لا توجد مذكرات'; an orphan course folder shows
 *   'لم تعد في جدولك'); 'مجلداتي' ALWAYS, with 'مجلد جديد' next to 'عرض الكل (n)' (a one-line hint
 *   when there are no folders yet); 'بدون مجلد' only when it has notebooks. Each section shows at
 *   most 4 cards, first card at the reading start (CardRow, 2 per row on phones), and 'عرض الكل (n)'
 *   when it holds more (NB-10a).
 * - A search shows the matching course folders and folders, then every matching notebook.
 * - Layout (every notebook screen): full width; the header is a fixed band at the top with the back
 *   button exactly where the editor has it (NB_EDGE from the edge, NB_HEADER_BAND tall, same size).
 * - First visit (settings.tours.library 'unseen'): the normal view is shown even on an empty library,
 *   and every empty section is filled with sample cards (tourSamples.ts: course folders, folders and
 *   notebooks that cannot be touched), so the tour starts on the first visit and has something to
 *   point at. The samples disappear when the tour ends or is skipped; an empty library then shows the
 *   empty state.
 * - <LibraryTour/> is mounted only in the normal (non-empty) view. Its targets: lib.headerActions
 *   (settings and sort), lib.search, lib.courses (the course folders row), lib.folders (the
 *   'مجلداتي' title and row together) and lib.new (the floating 'مذكرة جديدة' button).
 *
 * The screen does not run backup (useBackupAutoRun lives in NotebookServices only).
 *
 * Also exports NbScreenHeader, the round-back-button header the section and Recently deleted screens
 * share (Figma navBar).
 */
import { router } from 'expo-router';
import { useMemo, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { tr, useLang } from '@/lib/i18n';
import { fromEnd, row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { TOUR_TARGETS } from '@/notebook/contracts/tours';
import { encodeLoc, type IndexEntry } from '@/notebook/core/model';
import { countLabel, relativeTime } from '@/notebook/core/text/labels';
import { goBackOr, openDeleted, openImport, openNotebook, openNotebookSettings, openSection } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { LibraryTour } from '@/notebook/tours/LibraryTour';
import { BetaBadge } from '@/notebook/ui/BetaBadge';
import { CardRow } from '@/notebook/ui/CardRow';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { EmptyState } from '@/notebook/ui/EmptyState';
import { NB_EDGE, NB_HEADER_BAND, NB_HEADER_BUTTON, NB_HEADER_BUTTON_COMPACT, useWidthClass } from '@/notebook/ui/layout';
import type { AnchorRect } from '@/notebook/ui/Popover';
import { SectionTitle } from '@/notebook/ui/SectionTitle';
import { TextPromptDialog } from '@/notebook/ui/TextPromptDialog';
import { showToast } from '@/notebook/ui/toast';
import { useTourTarget } from '@/notebook/ui/tourTargets';

import { BetaFeedbackBanner } from './BetaFeedbackBanner';
import { courseTarget, FolderCard, type FolderTarget } from './FolderCard';
import { FolderActionsSheet } from './FolderActionsSheet';
import { LibraryLowStorageBanner } from './LowStorageBanner';
import { libraryErrorText } from './MoveSheet';
import { NewNotebookModal } from './NewNotebookModal';
import { NotebookActionsSheet, type NotebookActionsTarget } from './NotebookActionsSheet';
import { CardGrid, NotebookCard, useNow } from './NotebookCard';
import { SearchField } from './SearchField';
import { SortSheet } from './SortControl';
import { sampleCourses, sampleFolders, sampleNotebooks } from './tourSamples';

// ===== shared header

export interface NbScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Shown next to the title (the 'تجريبي' badge). */
  badge?: ReactNode;
  onBack: () => void;
  /** Round buttons (or a text action) at the end of the row. */
  actions?: ReactNode;
  /** Ref on the actions' wrapper (a tour target). */
  actionsRef?: Ref<ComponentRef<typeof View>>;
}

/**
 * The header band of every notebook screen: render it ABOVE the screen's ScrollView (it stays put).
 * The back button sits exactly where the editor's does (NB_EDGE from the edge, centered in the
 * NB_HEADER_BAND band, the same size); the title block follows it, the actions sit at the other end.
 */
export function NbScreenHeader({ title, subtitle, badge, onBack, actions, actionsRef }: NbScreenHeaderProps) {
  const compact = useWidthClass() === 'compact';
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <CircleButton icon="back" label={tr('رجوع', 'Back')} onPress={onBack} size={compact ? NB_HEADER_BUTTON_COMPACT : NB_HEADER_BUTTON} />
      <View style={styles.headerTexts}>
        <View style={[styles.titleLine, { flexDirection: row }]}>
          <AppText size={compact ? 20 : 24} weight="bold" numberOfLines={1} accessibilityRole="header" style={styles.shrink}>
            {title}
          </AppText>
          {badge}
        </View>
        {subtitle ? (
          <AppText size={13} color={colors.faint} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actions ? (
        <View ref={actionsRef} collapsable={false} style={[styles.headerActions, { flexDirection: row }]}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}

/** The floating 'مذكرة جديدة' button (Figma fab), at the reading-end bottom corner. */
export function NewNotebookFab({ label, onPress, targetRef, icon = 'plus' }: { label: string; onPress: () => void; targetRef?: Ref<ComponentRef<typeof View>>; icon?: 'plus' | 'folderPlus' }) {
  const insets = useSafeAreaInsets();
  const compact = useWidthClass() === 'compact';
  return (
    <View
      ref={targetRef}
      collapsable={false}
      pointerEvents="box-none"
      style={[styles.fabWrap, { bottom: insets.bottom + (compact ? 16 : 28) }, fromEnd(Math.max(insets.left, insets.right) + (compact ? 16 : 32))]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.fab, { flexDirection: row }, shadow, pressed && styles.pressed]}>
        <Icon name={icon} size={22} color={colors.surface} />
        <AppText size={17} weight="bold" color={colors.surface} numberOfLines={1}>
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}

export const goHome = () => goBackOr(() => router.replace('/'));

const noop = () => {};

/** Sample cards of the first-visit tour: shown like pictures (no touches, hidden from screen readers). */
function Sample({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </View>
  );
}

// ===== library

export default function LibraryScreen() {
  const store = useNotebooks();
  const lang = useLang();
  const now = useNow();
  const cls = useWidthClass();
  const compact = cls === 'compact';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [actions, setActions] = useState<NotebookActionsTarget | null>(null);
  const [folderActs, setFolderActs] = useState<FolderTarget | null>(null);

  const headerRef = useTourTarget(TOUR_TARGETS.libHeaderActions);
  const searchRef = useTourTarget(TOUR_TARGETS.libSearch);
  const coursesRef = useTourTarget(TOUR_TARGETS.libCourses);
  const foldersRef = useTourTarget(TOUR_TARGETS.libFolders);
  const newRef = useTourTarget(TOUR_TARGETS.libNew);

  const sort = store.settings.sort;
  const secs = useMemo(() => store.sections(sort, query), [store, sort, query]);
  const live = useMemo(() => store.entries.filter((e) => !e.deletedAt), [store.entries]);
  const deletedCount = store.entries.length - live.length;
  const latest = useMemo(() => live.reduce<string | null>((m, e) => (!m || Date.parse(e.updatedAt) > Date.parse(m) ? e.updatedAt : m), null), [live]);

  const searching = secs.query !== '';
  // First visit: the tour runs on the normal view, with sample cards in the empty sections.
  const touring = store.loaded && store.settings.tours.library === 'unseen' && !searching;
  const empty = !touring && store.loaded && live.length === 0 && store.courseFolders.length === 0 && store.folders.length === 0;
  const demoCourses = touring && secs.courses.total === 0;
  const demoFolders = touring && secs.mine.total === 0;
  const demoNotebooks = touring && secs.unfiled.total === 0 && live.length === 0;
  const pad = NB_EDGE;
  const modalOpen = newOpen || newFolderOpen || sortOpen || actions !== null || folderActs !== null;

  const openEntry = (e: IndexEntry) => openNotebook(e.id);
  const openActions = (e: IndexEntry, anchor: AnchorRect | null) => setActions({ entry: e, anchor });
  const openFolder = (t: FolderTarget) => openSection(t.kind === 'course' ? encodeLoc({ kind: 'course', code: t.code }) : encodeLoc({ kind: 'folder', id: t.id }));

  const createFolder = (name: string) => {
    setNewFolderOpen(false);
    try {
      const f = store.createFolder(name);
      showToast({ text: tr(`أُنشئ المجلد «${f.name}»`, `Folder “${f.name}” created`), tone: 'ok' });
    } catch (e) {
      showToast({ text: libraryErrorText(e), tone: 'warn' });
    }
  };

  const subtitle = empty
    ? tr('ابدأ أول مذكرة لك', 'Start your first notebook')
    : live.length > 0 && latest
      ? `${countLabel(live.length, 'notebook', lang)} · ${tr('آخر تعديل', 'Last edited')} ${relativeTime(latest, now, lang, { time: false })}`
      : countLabel(live.length, 'notebook', lang);

  const header = (
    <NbScreenHeader
      title={tr('المذكرات', 'Notebook')}
      subtitle={store.loaded ? subtitle : undefined}
      badge={<BetaBadge size={13} />}
      onBack={goHome}
      actionsRef={headerRef}
      actions={
        <>
          <CircleButton icon="sliders" label={tr('إعدادات المذكرات', 'Notebook settings')} onPress={openNotebookSettings} />
          {empty ? null : <CircleButton icon="sort" label={tr('ترتيب', 'Sort')} onPress={() => setSortOpen(true)} />}
        </>
      }
    />
  );

  const deletedRow = (
    <Pressable
      onPress={openDeleted}
      accessibilityRole="button"
      accessibilityLabel={tr(`المحذوفة مؤخراً، ${deletedCount}`, `Recently deleted, ${deletedCount}`)}
      style={({ pressed }) => [styles.deletedRow, { flexDirection: row }, pressed && styles.pressed]}>
      <Icon name="trash" size={18} color={colors.faint} />
      <AppText size={15} weight="medium" color={colors.faint} style={styles.flex}>
        {deletedCount > 0 ? tr(`المحذوفة مؤخراً (${deletedCount})`, `Recently deleted (${deletedCount})`) : tr('المحذوفة مؤخراً', 'Recently deleted')}
      </AppText>
      <Icon name="forward" size={18} color={colors.placeholder} />
    </Pressable>
  );

  const courseCards = demoCourses
    ? sampleCourses().map((t) => <FolderCard key={t.kind === 'course' ? t.code : t.id} target={t} onOpen={noop} />)
    : secs.courses.items.map((c) => <FolderCard key={c.code} target={courseTarget(c)} onOpen={openFolder} onActions={setFolderActs} />);
  const folderCards = demoFolders
    ? sampleFolders().map((t) => <FolderCard key={t.kind === 'folder' ? t.id : t.code} target={t} onOpen={noop} />)
    : secs.mine.items.map((f) => (
        <FolderCard key={f.id} target={{ kind: 'folder', id: f.id, name: f.name, count: f.count }} onOpen={openFolder} onActions={setFolderActs} />
      ));
  const notebookCards = (list: IndexEntry[]) =>
    list.map((e) => <NotebookCard key={e.id} entry={e} now={now} lang={lang} onOpen={openEntry} onActions={openActions} />);

  /** 'عرض الكل (n)' when a section holds more than the 4 cards it shows (NB-10a). */
  const showAll = (total: number, key: string) => (total > 4 ? { showAllCount: total, onShowAll: () => openSection(key) } : {});

  const coursesSection =
    secs.courses.total > 0 || demoCourses ? (
      <View style={styles.section}>
        <SectionTitle title={tr('موادي', 'My courses')} subtitle={tr('من جدولك', 'From your timetable')} {...showAll(secs.courses.total, 'courses')} />
        <View ref={coursesRef} collapsable={false}>
          <Sample on={demoCourses}>
            <CardRow>{courseCards}</CardRow>
          </Sample>
        </View>
      </View>
    ) : null;

  const newFolderAction = { label: tr('مجلد جديد', 'New folder'), icon: 'folderPlus' as const, onPress: () => setNewFolderOpen(true) };
  const foldersSection = (
    <View ref={foldersRef} collapsable={false} style={styles.section}>
      <SectionTitle
        title={tr('مجلداتي', 'My folders')}
        {...showAll(secs.mine.total, 'mine')}
        action={newFolderAction}
      />
      {secs.mine.total > 0 || demoFolders ? (
        <Sample on={demoFolders}>
          <CardRow>{folderCards}</CardRow>
        </Sample>
      ) : (
        <AppText size={14} color={colors.faint}>
          {tr('أنشئ مجلداً لتنظيم مذكراتك', 'Create a folder to organize your notebooks')}
        </AppText>
      )}
    </View>
  );

  const unfiledSection =
    secs.unfiled.total > 0 || demoNotebooks ? (
      <View style={styles.section}>
        <SectionTitle
          title={tr('بدون مجلد', 'No folder')}
          {...showAll(secs.unfiled.total, 'unfiled')}
        />
        <Sample on={demoNotebooks}>
          <CardRow gap={compact ? 12 : 24}>
            {demoNotebooks
              ? sampleNotebooks(now).map((e) => <NotebookCard key={e.id} entry={e} now={now} lang={lang} onOpen={noop} />)
              : notebookCards(secs.unfiled.items)}
          </CardRow>
        </Sample>
      </View>
    ) : null;

  let body: ReactNode;
  if (!store.loaded) {
    body = <ActivityIndicator color={colors.accent} style={styles.loading} />;
  } else if (empty) {
    body = (
      <View style={styles.emptyBody}>
        <EmptyState
          title={tr('لا توجد مذكرات بعد', 'No notebooks yet')}
          body={tr(
            'اكتب بالقلم أو الإصبع، استورد ملفات PDF وعلّق عليها،\nوسجّل المحاضرة وأنت تكتب. مجلد لكل مادة جاهز من جدولك.',
            'Write with a pen or your finger, import PDFs and mark them up,\nand record the lecture while you write. Every course in your timetable gets a folder.',
          )}
          primary={{ label: tr('مذكرة جديدة', 'New notebook'), icon: 'plus', onPress: () => setNewOpen(true) }}
          secondary={{ label: tr('استيراد PDF', 'Import PDF'), icon: 'fileText', onPress: () => openImport('pdf') }}
        />
        <LibraryLowStorageBanner />
        {deletedCount > 0 ? deletedRow : null}
      </View>
    );
  } else if (searching) {
    const nothing = secs.courses.total === 0 && secs.mine.total === 0 && secs.results.length === 0;
    body = (
      <>
        {coursesSection}
        {secs.mine.total > 0 ? (
          <View style={styles.section}>
            <SectionTitle title={tr('مجلداتي', 'My folders')} />
            <CardRow>{folderCards}</CardRow>
          </View>
        ) : null}
        {secs.results.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle title={tr('المذكرات', 'Notebooks')} subtitle={countLabel(secs.results.length, 'notebook', lang)} />
            <CardGrid columns={compact ? 2 : width < 1000 ? 4 : 5} gap={compact ? 12 : 24}>
              {notebookCards(secs.results)}
            </CardGrid>
          </View>
        ) : null}
        {nothing ? (
          <EmptyState
            icon="search"
            title={tr('لا توجد نتائج', 'No results')}
            body={tr('جرّب كلمة أخرى، أو ابحث باسم المادة أو رمزها.', 'Try another word, or search by course name or code.')}
          />
        ) : null}
      </>
    );
  } else {
    body = (
      <>
        {coursesSection}
        {foldersSection}
        {unfiledSection}
        {deletedRow}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingHorizontal: pad, paddingBottom: insets.bottom + (empty ? 32 : 120) }]}>
        <View style={styles.inner}>
          {store.loaded && !empty ? (
            <>
              <View ref={searchRef} collapsable={false}>
                <SearchField value={query} onChange={setQuery} />
              </View>
              <BetaFeedbackBanner />
              <LibraryLowStorageBanner />
            </>
          ) : null}
          {body}
        </View>
      </ScrollView>

      {store.loaded && !empty ? <NewNotebookFab label={tr('مذكرة جديدة', 'New notebook')} onPress={() => setNewOpen(true)} targetRef={newRef} /> : null}

      <NewNotebookModal visible={newOpen} onClose={() => setNewOpen(false)} />
      <NotebookActionsSheet target={actions} onClose={() => setActions(null)} />
      <FolderActionsSheet target={folderActs} onClose={() => setFolderActs(null)} />
      <SortSheet visible={sortOpen} value={sort} onChange={(k) => store.setSettings({ sort: k })} onClose={() => setSortOpen(false)} />
      <TextPromptDialog
        visible={newFolderOpen}
        title={tr('مجلد جديد', 'New folder')}
        fieldLabel={tr('اسم المجلد', 'Folder name')}
        placeholder={tr('مثال: مراجعة الاختبارات', 'For example: Exam review')}
        confirmLabel={tr('إنشاء', 'Create')}
        onCancel={() => setNewFolderOpen(false)}
        onSubmit={createFolder}
      />

      {store.loaded && !empty ? <LibraryTour enabled={!modalOpen && !searching} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 4 },
  inner: { width: '100%', gap: 22 },
  header: { alignItems: 'center', gap: 12, height: NB_HEADER_BAND, paddingHorizontal: NB_EDGE },
  headerTexts: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { alignItems: 'center', gap: 10 },
  shrink: { flexShrink: 1 },
  headerActions: { alignItems: 'center', gap: 10 },
  section: { gap: 14 },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  deletedRow: { alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 10 },
  loading: { marginTop: 60 },
  emptyBody: { gap: 28, paddingTop: 40 },
  fabWrap: { position: 'absolute' },
  fab: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
});
