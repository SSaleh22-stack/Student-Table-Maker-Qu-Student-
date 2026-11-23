/**
 * Moving a notebook to another place (NB-13): the 'الحفظ في' location chips (course folders, the
 * student's folders, 'بدون مجلد') starting at where the notebook is now, and 'نقل'. A toast names
 * the new place ('نُقلت إلى CS102').
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import { entryLocation } from '@/notebook/core/library/derive';
import { sameLoc, type IndexEntry, type LocationKey } from '@/notebook/core/model';
import { useNotebooks, type NotebooksStore } from '@/notebook/store/hooks';
import { PillButton } from '@/notebook/ui/CircleButton';
import { LocationChips } from '@/notebook/ui/LocationChips';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { showToast } from '@/notebook/ui/toast';

import { notebookTitle } from './NotebookCard';

/** The name of a place: the course code and name, the folder name, or 'بدون مجلد'. */
export function locationName(loc: LocationKey, store: Pick<NotebooksStore, 'courseFolders' | 'folders'>): string {
  if (loc.kind === 'course') {
    const c = store.courseFolders.find((x) => x.code === loc.code);
    return c && c.name && c.name !== c.code ? `${c.code} — ${c.name}` : loc.code;
  }
  if (loc.kind === 'folder') return store.folders.find((f) => f.id === loc.id)?.name ?? tr('مجلد', 'Folder');
  return tr('بدون مجلد', 'No folder');
}

/** The toast and alert text for a failed library action. */
export function libraryErrorText(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  switch (code) {
    case 'read-only':
      return tr('حُفظت هذه المذكرة بإصدار أحدث من التطبيق. حدّث التطبيق لتعديلها.', 'This notebook was saved by a newer version of the app. Update the app to change it.');
    case 'missing':
      return tr('لم نجد هذه المذكرة على الجهاز.', 'This notebook is no longer on the device.');
    case 'unreadable':
      return tr('تعذّرت قراءة هذه المذكرة.', 'This notebook could not be read.');
    case 'no-folder':
      return tr('لم يعد هذا المجلد موجوداً.', 'That folder no longer exists.');
    case 'in-timetable':
      return tr('لا يمكن تعديل مجلد مادة ما زالت في جدولك.', 'A course folder still in your timetable cannot be changed.');
    case 'empty-name':
      return tr('اكتب اسماً أولاً.', 'Type a name first.');
    default:
      return tr('تعذّر إكمال العملية. حاول مرة أخرى.', 'That did not work. Please try again.');
  }
}

function MoveBody({ entry, onDone }: { entry: IndexEntry; onDone: () => void }) {
  const store = useNotebooks();
  const current = entryLocation(entry, store.folders);
  const [to, setTo] = useState<LocationKey>(current);
  const [busy, setBusy] = useState(false);
  const same = sameLoc(to, current);

  const move = async () => {
    if (same) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await store.moveNotebook(entry.id, to);
      showToast({ text: tr('نُقلت إلى ', 'Moved to ') + locationName(to, store), tone: 'ok' });
      onDone();
    } catch (e) {
      showToast({ text: libraryErrorText(e), tone: 'warn' });
      setBusy(false);
    }
  };

  return (
    <View style={styles.body}>
      <LocationChips value={to} onChange={setTo} />
      <PillButton
        label={tr('نقل', 'Move')}
        icon="folder"
        onPress={() => void move()}
        disabled={same}
        loading={busy}
        block
        style={styles.button}
      />
    </View>
  );
}

export interface MoveSheetProps {
  visible: boolean;
  entry: IndexEntry | null;
  onClose: () => void;
}

export function MoveSheet({ visible, entry, onClose }: MoveSheetProps) {
  return (
    <NbSheet
      visible={visible && !!entry}
      title={tr('نقل إلى', 'Move to')}
      subtitle={entry ? notebookTitle(entry) : undefined}
      onClose={onClose}>
      {entry ? <MoveBody entry={entry} onDone={onClose} /> : null}
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20, paddingTop: 8, paddingBottom: 4 },
  button: { marginTop: 4 },
});
