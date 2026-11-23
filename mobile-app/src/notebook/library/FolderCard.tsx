/**
 * A folder card (Figma folderCard): a code pill at the reading start and the folder icon at the
 * end, the name, and the notebook count ('4 مذكرات', 'لا توجد مذكرات' for an empty course folder,
 * Figma 02 ARAB101).
 *
 * - Course folders (NB-11) show the course code in an accent pill and the notebook-pen icon. A
 *   course folder whose course left the timetable (an ORPHAN) also shows 'لم تعد في جدولك' and has
 *   actions (rename turns it into a user folder; delete), opened by a long press.
 * - The student's own folders (NB-12) show 'مجلد' in a grey pill and the folder icon, and always
 *   have actions.
 * - Course folders still in the timetable have no actions (NB-12).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { getLang, tr } from '@/lib/i18n';
import { alignStart, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { CourseFolder, Id } from '@/notebook/core/model';
import { countLabel } from '@/notebook/core/text/labels';
import { nbRadius } from '@/notebook/theme';

/** What a folder card or a folder section stands for. */
export type FolderTarget =
  | { kind: 'folder'; id: Id; name: string; count: number }
  | { kind: 'course'; code: string; name: string; count: number; inTimetable: boolean };

export function courseTarget(c: CourseFolder): FolderTarget {
  return { kind: 'course', code: c.code, name: c.name, count: c.count, inTimetable: c.inTimetable };
}

/** User folders and orphan course folders have actions; timetable course folders do not (NB-12). */
export function hasFolderActions(t: FolderTarget | null | undefined): boolean {
  if (!t) return false;
  return t.kind === 'folder' || !t.inTimetable;
}

/** 'لم تعد في جدولك'. */
export function orphanLabel(): string {
  return tr('لم تعد في جدولك', 'No longer in your timetable');
}

export interface FolderCardProps {
  target: FolderTarget;
  onOpen: (t: FolderTarget) => void;
  onActions?: (t: FolderTarget) => void;
}

export function FolderCard({ target, onOpen, onActions }: FolderCardProps) {
  const course = target.kind === 'course';
  const orphan = target.kind === 'course' && !target.inTimetable;
  const pill = course ? target.code : tr('مجلد', 'Folder');
  const count = countLabel(target.count, 'notebook', getLang());
  const canAct = !!onActions && hasFolderActions(target);
  const act = () => {
    if (canAct) onActions?.(target);
  };
  const spoken = [course ? `${target.code}، ${target.name}` : target.name, count, orphan ? orphanLabel() : ''].filter(Boolean).join('، ');

  return (
    <Pressable
      onPress={() => onOpen(target)}
      onLongPress={canAct ? act : undefined}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={course ? tr('يعرض مذكرات المادة', 'Shows the course notebooks') : tr('يعرض مذكرات المجلد', 'Shows the folder notebooks')}
      accessibilityActions={canAct ? [{ name: 'activate' }, { name: 'longpress', label: tr('خيارات المجلد', 'Folder options') }] : undefined}
      onAccessibilityAction={(ev) => {
        if (ev.nativeEvent.actionName === 'longpress') act();
        else onOpen(target);
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.top, { flexDirection: row }]}>
        <View style={[styles.pill, { backgroundColor: course ? colors.accentSoft : colors.surfaceMuted }]}>
          <AppText size={12} weight="semibold" color={course ? colors.accentDark : colors.muted} numberOfLines={1}>
            {pill}
          </AppText>
        </View>
        <View style={styles.flex} />
        <Icon name={course ? 'notebookPen' : 'folder'} size={22} color={course ? colors.accent : colors.faint} />
      </View>
      <AppText size={16} weight="bold" numberOfLines={2}>
        {target.name}
      </AppText>
      <AppText size={13} color={colors.faint} numberOfLines={1}>
        {count}
      </AppText>
      {orphan ? (
        <View style={[styles.orphan, { alignSelf: alignStart }]}>
          <AppText size={11} weight="semibold" color={colors.warning} numberOfLines={1}>
            {orphanLabel()}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: nbRadius.folder,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  pressed: { opacity: 0.85 },
  top: { alignItems: 'center', gap: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 1 },
  flex: { flex: 1 },
  orphan: {
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
