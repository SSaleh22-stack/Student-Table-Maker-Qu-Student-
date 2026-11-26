/**
 * One library section, full list (Figma 03; NB-10a 'عرض الكل', NB-11..NB-15). The route key is
 * 'courses' (every course folder), 'mine' (every folder of the student's own), 'unfiled',
 * 'course:CODE' or 'folder:ID'.
 *
 * - Header: the name and a subtitle such as 'CS102 · 4 مذكرات · مجلد من جدولك' (an orphan course
 *   folder says 'لم تعد في جدولك'). Course folders that left the timetable and the student's own
 *   folders get a 'more' button with the folder actions; timetable course folders have none (NB-12).
 * - Sort chips ('آخر تعديل', 'الاسم', 'تاريخ الإنشاء'), saved with setSettings({ sort }) and shared
 *   with the library.
 * - The grid: 2 columns on phones, 3 under 1000 pt, else 4; first card at the reading start.
 * - The floating button: 'مذكرة جديدة في CS102' (the new notebook starts in this place), or
 *   'مجلد جديد' in 'mine'.
 * - Multi-select (NotebookSelection.tsx): a long press on a notebook starts it; the header and the
 *   floating button give way to the selection header and the actions bar.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { SafeAreaView } from '@/components/SafeAreaView';
import { tr, useLang } from '@/lib/i18n';
import { colors } from '@/lib/theme';
import { folderInfos } from '@/notebook/core/library/derive';
import { decodeLoc, encodeLoc, type CourseFolder, type IndexEntry, type IndexFile, type LocationKey } from '@/notebook/core/model';
import { countLabel } from '@/notebook/core/text/labels';
import { goBackOr, openLibrary, openNotebook, openSection } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { EmptyState } from '@/notebook/ui/EmptyState';
import { NB_EDGE, useWidthClass } from '@/notebook/ui/layout';
import type { AnchorRect } from '@/notebook/ui/Popover';
import { TextPromptDialog } from '@/notebook/ui/TextPromptDialog';
import { showToast } from '@/notebook/ui/toast';

import { courseTarget, FolderCard, hasFolderActions, orphanLabel, type FolderTarget } from './FolderCard';
import { FolderActionsSheet } from './FolderActionsSheet';
import { NbScreenHeader, NewNotebookFab } from './LibraryScreen';
import { libraryErrorText } from './MoveSheet';
import { NewNotebookModal } from './NewNotebookModal';
import { afterModal, NotebookActionsSheet, type NotebookActionsTarget } from './NotebookActionsSheet';
import { CardGrid, gridColumns, NotebookCard, useNow } from './NotebookCard';
import { SelectionActions, SelectionHeader, useNotebookSelection } from './NotebookSelection';
import { SortChips } from './SortControl';

type Parsed = { kind: 'courses' } | { kind: 'mine' } | { kind: 'place'; loc: LocationKey } | { kind: 'bad' };

function parseKey(raw: string): Parsed {
  if (raw === 'courses') return { kind: 'courses' };
  if (raw === 'mine') return { kind: 'mine' };
  const loc = decodeLoc(raw);
  return loc ? { kind: 'place', loc } : { kind: 'bad' };
}

const back = () => goBackOr(openLibrary);

export default function SectionScreen() {
  const params = useLocalSearchParams<{ key?: string | string[] }>();
  const raw = Array.isArray(params.key) ? (params.key[0] ?? '') : (params.key ?? '');
  const parsed = parseKey(raw);

  const store = useNotebooks();
  const lang = useLang();
  const now = useNow();
  const compact = useWidthClass() === 'compact';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sort = store.settings.sort;

  const [newOpen, setNewOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [actions, setActions] = useState<NotebookActionsTarget | null>(null);
  const [folderActs, setFolderActs] = useState<FolderTarget | null>(null);

  const place = parsed.kind === 'place' ? parsed.loc : null;
  const entries: IndexEntry[] = place ? store.list(place, sort) : [];
  const sel = useNotebookSelection(entries.map((e) => e.id));

  const courses = useMemo<CourseFolder[]>(() => {
    const list = store.courseFolders.slice();
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ar', { sensitivity: 'base', numeric: true }));
    return list;
  }, [store.courseFolders, sort]);

  const folders = useMemo(() => {
    const f: IndexFile = { version: 1, entries: store.entries, folders: store.folders, courseNames: {}, purged: [] };
    return folderInfos(f, sort);
  }, [store.entries, store.folders, sort]);

  // ===== what this section is
  let title = '';
  let subtitle: string | undefined;
  let target: FolderTarget | null = null;
  let missing = false;
  if (parsed.kind === 'courses') {
    title = tr('موادي', 'My courses');
    subtitle = `${countLabel(courses.length, 'folder', lang)} · ${tr('من جدولك', 'From your timetable')}`;
  } else if (parsed.kind === 'mine') {
    title = tr('مجلداتي', 'My folders');
    subtitle = countLabel(folders.length, 'folder', lang);
  } else if (place?.kind === 'unfiled') {
    title = tr('بدون مجلد', 'No folder');
    subtitle = countLabel(entries.length, 'notebook', lang);
  } else if (place?.kind === 'course') {
    const c = store.courseFolders.find((x) => x.code === place.code);
    title = c?.name ?? place.code;
    const where = c && !c.inTimetable ? orphanLabel() : c ? tr('مجلد من جدولك', 'Folder from your timetable') : '';
    subtitle = [place.code, countLabel(entries.length, 'notebook', lang), where].filter(Boolean).join(' · ');
    if (c) target = courseTarget(c);
  } else if (place?.kind === 'folder') {
    const f = store.folders.find((x) => x.id === place.id);
    if (f) {
      title = f.name;
      subtitle = countLabel(entries.length, 'notebook', lang);
      target = { kind: 'folder', id: f.id, name: f.name, count: entries.length };
    } else {
      missing = true;
      title = tr('مجلد', 'Folder');
    }
  } else {
    missing = true;
    title = tr('المذكرات', 'Notebook');
  }

  const columns = gridColumns(width);
  const pad = NB_EDGE;
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

  let fab: { label: string; onPress: () => void; icon?: 'plus' | 'folderPlus' } | null = null;
  if (!missing && place) {
    const inName = place.kind === 'course' ? place.code : place.kind === 'folder' ? title : '';
    fab = {
      label: inName ? tr(`مذكرة جديدة في ${inName}`, `New notebook in ${inName}`) : tr('مذكرة جديدة', 'New notebook'),
      onPress: () => setNewOpen(true),
    };
  } else if (parsed.kind === 'mine') {
    fab = { label: tr('مجلد جديد', 'New folder'), onPress: () => setNewFolderOpen(true), icon: 'folderPlus' };
  }

  // ===== body
  let body;
  if (!store.loaded) {
    body = <ActivityIndicator color={colors.accent} style={styles.loading} />;
  } else if (missing) {
    body = (
      <EmptyState
        icon="folder"
        title={tr('لم يعد هذا المجلد موجوداً', 'This folder no longer exists')}
        primary={{ label: tr('العودة إلى المذكرات', 'Back to the notebooks'), icon: 'back', onPress: back }}
      />
    );
  } else if (parsed.kind === 'courses') {
    body =
      courses.length > 0 ? (
        <CardGrid columns={columns} gap={compact ? 12 : 16} rowGap={compact ? 12 : 16}>
          {courses.map((c) => (
            <FolderCard key={c.code} target={courseTarget(c)} onOpen={openFolder} onActions={setFolderActs} />
          ))}
        </CardGrid>
      ) : (
        <EmptyState
          icon="notebookPen"
          title={tr('لا توجد مواد بعد', 'No courses yet')}
          body={tr('اختر موادك في الجدول، وسيظهر لكل مادة مجلد هنا.', 'Choose your courses in the timetable, and each one gets a folder here.')}
        />
      );
  } else if (parsed.kind === 'mine') {
    body =
      folders.length > 0 ? (
        <CardGrid columns={columns} gap={compact ? 12 : 16} rowGap={compact ? 12 : 16}>
          {folders.map((f) => (
            <FolderCard key={f.id} target={{ kind: 'folder', id: f.id, name: f.name, count: f.count }} onOpen={openFolder} onActions={setFolderActs} />
          ))}
        </CardGrid>
      ) : (
        <EmptyState icon="folder" title={tr('لا توجد مجلدات بعد', 'No folders yet')} body={tr('أنشئ مجلداً لتنظيم مذكراتك', 'Create a folder to organize your notebooks')} />
      );
  } else {
    body =
      entries.length > 0 ? (
        <CardGrid columns={columns} gap={compact ? 12 : 32} rowGap={compact ? 20 : 32}>
          {entries.map((e) => (
            <NotebookCard
              key={e.id}
              entry={e}
              now={now}
              lang={lang}
              onOpen={openEntry}
              onActions={openActions}
              onSelectStart={(x) => sel.start(x.id)}
              onSelect={(x) => sel.toggle(x.id)}
              selecting={sel.selecting}
              selected={sel.isSelected(e.id)}
            />
          ))}
        </CardGrid>
      ) : (
        <EmptyState
          title={tr('لا توجد مذكرات هنا بعد', 'No notebooks here yet')}
          body={tr('أنشئ مذكرة جديدة أو استورد ملف PDF.', 'Create a notebook or import a PDF.')}
        />
      );
  }

  const showMore = !missing && hasFolderActions(target);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {sel.selecting ? (
        <SelectionHeader selection={sel} />
      ) : (
        <NbScreenHeader
          title={title}
          subtitle={store.loaded ? subtitle : undefined}
          onBack={back}
          actions={
            showMore && target ? (
              <CircleButton icon="more" label={tr('خيارات المجلد', 'Folder options')} onPress={() => setFolderActs({ ...target })} />
            ) : undefined
          }
        />
      )}
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: pad, paddingBottom: insets.bottom + (fab ? 120 : 32) }]}>
        <View style={styles.inner}>
          {store.loaded && !missing && parsed.kind !== 'courses' ? (
            <SortChips value={sort} onChange={(k) => store.setSettings({ sort: k })} />
          ) : null}
          {target?.kind === 'course' && !target.inTimetable ? (
            <AppText size={13} color={colors.faint}>
              {tr(
                'هذه المادة لم تعد في جدولك. تبقى مذكراتها هنا، ويمكنك إعادة تسميته ليصبح مجلداً من مجلداتك.',
                'This course is no longer in your timetable. Its notebooks stay here, and you can rename it to make it one of your folders.',
              )}
            </AppText>
          ) : null}
          {body}
        </View>
      </ScrollView>

      {sel.selecting ? (
        <SelectionActions selection={sel} />
      ) : store.loaded && fab ? (
        <NewNotebookFab label={fab.label} onPress={fab.onPress} icon={fab.icon} />
      ) : null}

      <NewNotebookModal visible={newOpen} onClose={() => setNewOpen(false)} initialLocation={place && place.kind !== 'unfiled' ? place : undefined} />
      <NotebookActionsSheet target={actions} onClose={() => setActions(null)} />
      <FolderActionsSheet
        target={folderActs}
        onClose={() => setFolderActs(null)}
        onConverted={(f) => {
          // Only this section's own folder moves the screen; a card in 'courses' stays put. The move
          // waits for the closing dialog (iOS).
          if (place?.kind === 'course') {
            const href = `/notebook/section/${encodeURIComponent(encodeLoc({ kind: 'folder', id: f.id }))}` as Href;
            afterModal(() => router.replace(href));
          }
        }}
        onDeleted={() => {
          if (place && place.kind !== 'unfiled') afterModal(back);
        }}
      />
      <TextPromptDialog
        visible={newFolderOpen}
        title={tr('مجلد جديد', 'New folder')}
        fieldLabel={tr('اسم المجلد', 'Folder name')}
        placeholder={tr('مثال: مراجعة الاختبارات', 'For example: Exam review')}
        confirmLabel={tr('إنشاء', 'Create')}
        onCancel={() => setNewFolderOpen(false)}
        onSubmit={createFolder}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 4 },
  inner: { width: '100%', gap: 22 },
  loading: { marginTop: 60 },
});
