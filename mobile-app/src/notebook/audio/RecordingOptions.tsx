/**
 * The options of one recording (NB-63): a small menu with 'إعادة التسمية' (TextPromptDialog) and 'حذف'
 * (ConfirmDialog, then session.deleteRecording: one undoable change that also strips its marks from the
 * ink; the toast offers 'تراجع'). The recording in progress cannot be deleted.
 *
 * Used by the ⋮ of each row in RecordingsPanel and by the ⋮ of the PlayerBar (the loaded recording).
 * The caller says which recording and where its button is (`target`); this component owns the menu and
 * both dialogs, and calls onClose once the menu is dismissed.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { useSessionSnapshot } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { ConfirmDialog } from '@/notebook/ui/ConfirmDialog';
import { Popover, type AnchorRect } from '@/notebook/ui/Popover';
import { TextPromptDialog } from '@/notebook/ui/TextPromptDialog';
import { showToast } from '@/notebook/ui/toast';

import { player } from './player';
import { useRecordingSnapshot } from './useRecording';

/** iOS cannot present a dialog while the menu's Modal is still going away: wait this long first. */
const AFTER_CLOSE_MS = Platform.OS === 'ios' ? 350 : 60;

export interface RecordingOptionsTarget {
  id: Id;
  anchor: AnchorRect;
}

export interface RecordingOptionsProps {
  session: NotebookSession;
  /** The recording whose menu is open, or null. */
  target: RecordingOptionsTarget | null;
  /** The menu was dismissed (an option was picked, or a tap outside). */
  onClose: () => void;
}

export function RecordingOptions({ session, target, onClose }: RecordingOptionsProps) {
  const snap = useSessionSnapshot(session);
  const rec = useRecordingSnapshot();
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [deleting, setDeleting] = useState<Id | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /** Closes the menu, then opens a dialog once it has gone. */
  const then = (open: () => void) => {
    onClose();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      open();
    }, AFTER_CLOSE_MS);
  };

  const list = snap?.notebook.recordings ?? session.notebook.recordings;
  const byId = (id: Id | null) => (id ? list.find((r) => r.id === id) : undefined);
  const liveId = rec.notebookId === session.id && rec.state !== 'idle' ? rec.recordingId : null;
  const menuRec = byId(target?.id ?? null);
  const renameRec = byId(renaming);
  const deleteRec = byId(deleting);

  const remove = async (id: Id) => {
    setBusy(true);
    try {
      if (player.recordingId === id) player.unload();
      await session.deleteRecording(id);
      const entry = session.topEntryId();
      showToast({
        text: tr('حُذف التسجيل', 'Recording deleted'),
        tone: 'ok',
        id: 'nb-recording-deleted',
        actionLabel: tr('تراجع', 'Undo'),
        onAction: entry ? () => void session.undoIfTop(entry) : undefined,
      });
    } catch {
      showToast({ text: tr('تعذّر حذف التسجيل', 'Could not delete the recording'), tone: 'warn', id: 'nb-recording-deleted' });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <>
      <Popover
        visible={!!menuRec}
        anchor={target?.anchor ?? null}
        onClose={onClose}
        padding={6}
        gap={0}
        width={200}
        accessibilityLabel={tr('خيارات التسجيل', 'Recording options')}>
        <Pressable
          onPress={() => {
            const id = target?.id ?? null;
            then(() => setRenaming(id));
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.item, { flexDirection: row }, pressed && styles.pressed]}>
          <Icon name="pencilTip" size={18} color={nbColors.text} />
          <AppText size={15} weight="medium" color={nbColors.text}>
            {tr('إعادة التسمية', 'Rename')}
          </AppText>
        </Pressable>
        {menuRec && menuRec.id !== liveId ? (
          <Pressable
            onPress={() => {
              const id = target?.id ?? null;
              then(() => setDeleting(id));
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.item, { flexDirection: row }, pressed && styles.pressed]}>
            <Icon name="trash" size={18} color={nbColors.danger} />
            <AppText size={15} weight="medium" color={nbColors.danger}>
              {tr('حذف', 'Delete')}
            </AppText>
          </Pressable>
        ) : null}
      </Popover>

      <TextPromptDialog
        visible={!!renameRec}
        title={tr('إعادة تسمية التسجيل', 'Rename recording')}
        fieldLabel={tr('اسم التسجيل', 'Recording name')}
        initialValue={renameRec?.title ?? ''}
        requireChange
        onCancel={() => setRenaming(null)}
        onSubmit={(title) => {
          if (renameRec) session.updateRecording(renameRec.id, { title });
          setRenaming(null);
        }}
      />

      <ConfirmDialog
        visible={!!deleteRec}
        title={tr('حذف التسجيل؟', 'Delete recording?')}
        message={
          deleteRec
            ? tr(`يُحذف صوت «${deleteRec.title}»، وتبقى كتابتك كما هي.`, `The audio of “${deleteRec.title}” is deleted. Your writing stays as it is.`)
            : undefined
        }
        confirmLabel={tr('حذف', 'Delete')}
        cancelLabel={tr('إلغاء', 'Cancel')}
        destructive
        icon="trash"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleteRec) void remove(deleteRec.id);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  pressed: { backgroundColor: nbColors.surfaceMuted },
});
