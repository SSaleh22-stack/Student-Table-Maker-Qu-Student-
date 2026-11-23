/**
 * The actions of a folder (NB-12):
 * - the student's own folder: 'إعادة التسمية'; 'حذف المجلد' with the choice 'إبقاء المذكرات (بدون مجلد)'
 *   or 'نقلها إلى المحذوفة' (an empty folder is deleted after a plain confirm);
 * - an ORPHAN course folder (its course left the timetable, badge 'لم تعد في جدولك'):
 *   'إعادة التسمية' turns it into one of the student's folders with that name
 *   (store.convertCourseFolder, explained by 'سيصبح مجلداً من مجلداتك'); 'حذف' offers the same two
 *   choices (store.deleteCourseFolder);
 * - a course folder still in the timetable has no actions: nothing opens (hasFolderActions).
 *
 * Steps are separate modals switched with useModalSteps (see NotebookActionsSheet).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getLang, tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';
import type { Folder } from '@/notebook/core/model';
import { countLabel } from '@/notebook/core/text/labels';
import { useNotebooks } from '@/notebook/store/hooks';
import { PillButton } from '@/notebook/ui/CircleButton';
import { ConfirmDialog, DialogFrame } from '@/notebook/ui/ConfirmDialog';
import { Group } from '@/notebook/ui/Group';
import { ListRow } from '@/notebook/ui/ListRow';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { TextPromptDialog } from '@/notebook/ui/TextPromptDialog';
import { showToast } from '@/notebook/ui/toast';

import { hasFolderActions, orphanLabel, type FolderTarget } from './FolderCard';
import { libraryErrorText } from './MoveSheet';
import { useModalSteps } from './NotebookActionsSheet';

type Step = 'menu' | 'rename' | 'delete';

export interface FolderActionsSheetProps {
  /** A new object opens the actions for that folder (ignored for timetable course folders). */
  target: FolderTarget | null;
  onClose: () => void;
  /** An orphan course folder became this user folder (a section screen moves to it). */
  onConverted?: (f: Folder) => void;
  /** The folder was deleted (a section screen goes back). */
  onDeleted?: () => void;
}

export function FolderActionsSheet({ target, onClose, onConverted, onDeleted }: FolderActionsSheetProps) {
  const store = useNotebooks();
  const open = hasFolderActions(target) ? target : null;
  const steps = useModalSteps<Step>(open ? 'menu' : null);
  const [held, setHeld] = useState<FolderTarget | null>(open);
  const [prev, setPrev] = useState<FolderTarget | null>(target);
  const [busy, setBusy] = useState(false);
  /**
   * The notebook count when 'حذف' was chosen. Frozen so the dialog does not swap (two choices to a
   * plain confirm) while the delete empties the folder.
   */
  const [delCount, setDelCount] = useState(0);
  if (prev !== target) {
    setPrev(target);
    if (open) {
      setHeld(open);
      setBusy(false);
      steps.set('menu');
    }
  }

  // The live count and name (the folder may change while the sheet is open).
  let t = held;
  if (held?.kind === 'folder') {
    const f = store.folders.find((x) => x.id === held.id);
    const count = store.entries.filter((e) => !e.deletedAt && e.folderId === held.id).length;
    t = { ...held, name: f?.name ?? held.name, count };
  } else if (held?.kind === 'course') {
    const c = store.courseFolders.find((x) => x.code === held.code);
    if (c) t = { ...held, name: c.name, count: c.count, inTimetable: c.inTimetable };
  }

  const finish = () => {
    steps.set(null);
    onClose();
  };

  const fail = (e: unknown) => showToast({ text: libraryErrorText(e), tone: 'warn' });

  const rename = (name: string) => {
    if (!t) return;
    if (t.kind === 'folder') {
      try {
        store.renameFolder(t.id, name);
      } catch (e) {
        fail(e);
      }
      finish();
      return;
    }
    const code = t.code;
    setBusy(true);
    store.convertCourseFolder(code, name).then(
      (folder) => {
        finish();
        showToast({ text: tr(`أصبح «${folder.name}» مجلداً من مجلداتك`, `“${folder.name}” is now one of your folders`), tone: 'ok' });
        onConverted?.(folder);
      },
      (e) => {
        setBusy(false);
        fail(e);
      },
    );
  };

  const remove = (mode: 'unfile' | 'trash') => {
    if (!t) return;
    const hadNotebooks = delCount > 0;
    setBusy(true);
    const job = t.kind === 'folder' ? store.deleteFolder(t.id, mode) : store.deleteCourseFolder(t.code, mode);
    job.then(
      () => {
        finish();
        showToast({
          text: !hadNotebooks
            ? tr('حُذف المجلد', 'Folder deleted')
            : mode === 'trash'
              ? tr('حُذف المجلد ونُقلت مذكراته إلى المحذوفة مؤخراً', 'Folder deleted; its notebooks moved to Recently deleted')
              : tr('حُذف المجلد وبقيت مذكراته بدون مجلد', 'Folder deleted; its notebooks are now in No folder'),
          tone: 'ok',
        });
        onDeleted?.();
      },
      (e) => {
        setBusy(false);
        fail(e);
      },
    );
  };

  const orphan = t?.kind === 'course';
  const name = t?.name ?? '';
  const count = t?.count ?? 0;
  const lang = getLang();
  const subtitle = t ? (orphan ? `${t.kind === 'course' ? t.code : ''} · ${orphanLabel()}` : countLabel(count, 'notebook', lang)) : undefined;

  return (
    <>
      <NbSheet visible={steps.step === 'menu' && !!t} title={name} subtitle={subtitle} onClose={finish}>
        <Group style={styles.menu}>
          <ListRow
            title={tr('إعادة التسمية', 'Rename')}
            subtitle={orphan ? tr('سيصبح مجلداً من مجلداتك', 'It becomes one of your folders') : undefined}
            icon="pen"
            onPress={() => steps.go('rename')}
            chevron={false}
          />
          <ListRow
            title={orphan ? tr('حذف', 'Delete') : tr('حذف المجلد', 'Delete folder')}
            icon="trash"
            iconColor={colors.danger}
            iconFill={colors.dangerSoft}
            destructive
            onPress={() => {
              setDelCount(count);
              steps.go('delete');
            }}
            chevron={false}
          />
        </Group>
      </NbSheet>

      <TextPromptDialog
        visible={steps.step === 'rename' && !!t}
        title={orphan ? tr('إعادة تسمية مجلد المادة', 'Rename course folder') : tr('إعادة تسمية المجلد', 'Rename folder')}
        message={orphan ? tr('سيصبح مجلداً من مجلداتك', 'It becomes one of your folders') : undefined}
        fieldLabel={tr('اسم المجلد', 'Folder name')}
        initialValue={name}
        requireChange={!orphan}
        busy={busy}
        onCancel={finish}
        onSubmit={rename}
      />

      {delCount === 0 ? (
        <ConfirmDialog
          visible={steps.step === 'delete' && !!t}
          title={tr(`حذف «${name}»؟`, `Delete “${name}”?`)}
          message={tr('المجلد فارغ.', 'The folder is empty.')}
          confirmLabel={tr('حذف', 'Delete')}
          destructive
          busy={busy}
          onCancel={finish}
          onConfirm={() => remove('unfile')}
        />
      ) : (
        <DialogFrame
          visible={steps.step === 'delete' && !!t}
          title={tr(`حذف «${name}»؟`, `Delete “${name}”?`)}
          message={tr(
            `في المجلد ${countLabel(delCount, 'notebook', 'ar')}. ماذا نفعل بها؟`,
            `The folder holds ${countLabel(delCount, 'notebook', 'en')}. What should happen to them?`,
          )}
          icon="trash"
          tone="danger"
          onDismiss={() => {
            if (!busy) finish();
          }}
          actions={
            <View style={styles.choices}>
              <PillButton
                label={tr('إبقاء المذكرات (بدون مجلد)', 'Keep the notebooks (No folder)')}
                variant="secondary"
                size="sm"
                block
                disabled={busy}
                onPress={() => remove('unfile')}
              />
              <PillButton
                label={tr('نقلها إلى المحذوفة', 'Move them to Recently deleted')}
                variant="danger"
                size="sm"
                block
                disabled={busy}
                loading={busy}
                onPress={() => remove('trash')}
              />
              <PillButton label={tr('إلغاء', 'Cancel')} variant="neutral" size="sm" block disabled={busy} onPress={finish} />
            </View>
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  menu: { marginTop: 4, marginBottom: 4 },
  choices: { gap: 10 },
});
