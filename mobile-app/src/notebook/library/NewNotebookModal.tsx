/**
 * 'مذكرة جديدة' (Figma 04, NB-20..NB-22): the name, where to save it ('الحفظ في' location chips),
 * the paper (type, color and size; it starts from the default paper in the settings), then 'أو ابدأ
 * من ملف' with three source tiles that open the import flow for that place instead ('استيراد PDF',
 * 'مسح بالكاميرا', 'من الصور'), and 'إنشاء المذكرة'.
 *
 * NbModal: the 620 pt card on tablets, a full-height sheet with a sticky 'إنشاء المذكرة' on phones.
 * The form starts fresh every time it opens. The modal closes before the editor or the import
 * screen opens (MODAL_SWAP_MS), because an open RN Modal would stay above the next screen.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { inputDir, row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import { copyPaper, encodeLoc, TITLE_MAX, type LocationKey, type PaperSpec } from '@/notebook/core/model';
import { openImport, openNotebook } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { nbRadius } from '@/notebook/theme';
import { PillButton } from '@/notebook/ui/CircleButton';
import { LocationChips } from '@/notebook/ui/LocationChips';
import { useWidthClass } from '@/notebook/ui/layout';
import { NbModal } from '@/notebook/ui/NbModal';
import { PaperPicker } from '@/notebook/ui/PaperPicker';
import { showToast } from '@/notebook/ui/toast';

import { libraryErrorText } from './MoveSheet';
import { afterModal } from './NotebookActionsSheet';

type Source = 'pdf' | 'scan' | 'photos';

const SOURCES: { source: Source; icon: IconName; label: () => string; sub: () => string }[] = [
  { source: 'pdf', icon: 'fileText', label: () => tr('استيراد PDF', 'Import PDF'), sub: () => tr('من تطبيق الملفات', 'From the Files app') },
  { source: 'scan', icon: 'scan', label: () => tr('مسح بالكاميرا', 'Scan with camera'), sub: () => tr('حواف وقص تلقائي', 'Auto edges and crop') },
  { source: 'photos', icon: 'image', label: () => tr('من الصور', 'From photos'), sub: () => tr('صورة أو أكثر', 'One or more photos') },
];

function FieldLabel({ text }: { text: string }) {
  return (
    <AppText size={14} weight="semibold" color={colors.muted}>
      {text}
    </AppText>
  );
}

function SourceTile({ icon, label, sub, onPress, compact }: { icon: IconName; label: string; sub: string; onPress: () => void; compact: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}، ${sub}`}
      style={({ pressed }) => [styles.source, compact && styles.sourceCompact, pressed && styles.pressed]}>
      <View style={styles.sourceIcon}>
        <Icon name={icon} size={compact ? 22 : 24} color={colors.accent} />
      </View>
      <AppText size={compact ? 14 : 15} weight="bold" align="center" numberOfLines={2}>
        {label}
      </AppText>
      <AppText size={12} color={colors.faint} align="center" numberOfLines={2}>
        {sub}
      </AppText>
    </Pressable>
  );
}

export interface NewNotebookModalProps {
  visible: boolean;
  onClose: () => void;
  /** Where the notebook goes at first (a section's course or folder); default 'بدون مجلد'. */
  initialLocation?: LocationKey;
}

export function NewNotebookModal({ visible, onClose, initialLocation }: NewNotebookModalProps) {
  const store = useNotebooks();
  const compact = useWidthClass() === 'compact';
  const start = (): LocationKey => initialLocation ?? { kind: 'unfiled' };
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState<LocationKey>(start);
  const [paper, setPaper] = useState<PaperSpec>(() => copyPaper(store.settings.defaultPaper));
  const [busy, setBusy] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    // Each opening starts a fresh form (state adjusted while rendering).
    setWasVisible(visible);
    if (visible) {
      setTitle('');
      setLocation(start());
      setPaper(copyPaper(store.settings.defaultPaper));
      setBusy(false);
    }
  }

  // A folder deleted while the modal is open falls back to 'بدون مجلد'.
  const loc: LocationKey = location.kind === 'folder' && !store.folders.some((f) => f.id === location.id) ? { kind: 'unfiled' } : location;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const name = title.trim() || tr('مذكرة بدون عنوان', 'Untitled notebook');
      const id = await store.createNotebook({ title: name, location: loc, paper });
      onClose();
      afterModal(() => openNotebook(id));
    } catch (e) {
      setBusy(false);
      showToast({ text: libraryErrorText(e), tone: 'warn' });
    }
  };

  const fromSource = (source: Source) => {
    if (busy) return;
    const where = encodeLoc(loc);
    onClose();
    afterModal(() => openImport(source, where));
  };

  return (
    <NbModal
      visible={visible}
      title={tr('مذكرة جديدة', 'New notebook')}
      onClose={onClose}
      dismissable={!busy}
      footer={
        <PillButton
          label={tr('إنشاء المذكرة', 'Create notebook')}
          icon="check"
          onPress={() => void create()}
          loading={busy}
          block
        />
      }>
      <View style={styles.body}>
        <View style={styles.field}>
          <FieldLabel text={tr('اسم المذكرة', 'Notebook name')} />
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={tr('مثال: محاضرة 6 — المحددات', 'For example: Lecture 6 — Determinants')}
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={tr('اسم المذكرة', 'Notebook name')}
            maxLength={TITLE_MAX}
            returnKeyType="done"
            editable={!busy}
            style={[styles.input, inputDir()]}
          />
        </View>
        <View style={styles.field}>
          <FieldLabel text={tr('الحفظ في', 'Save in')} />
          <LocationChips value={loc} onChange={setLocation} />
        </View>
        <PaperPicker value={paper} onChange={setPaper} />
        <View style={[styles.or, { flexDirection: row }]}>
          <View style={styles.rule} />
          <AppText size={13} weight="medium" color={colors.faint}>
            {tr('أو ابدأ من ملف', 'Or start from a file')}
          </AppText>
          <View style={styles.rule} />
        </View>
        <View style={[styles.sources, { flexDirection: row, gap: compact ? 10 : 18 }]}>
          {SOURCES.map((s) => (
            <SourceTile key={s.source} icon={s.icon} label={s.label()} sub={s.sub()} compact={compact} onPress={() => fromSource(s.source)} />
          ))}
        </View>
      </View>
    </NbModal>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20 },
  field: { gap: 8 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: nbRadius.input,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  or: { alignItems: 'center', gap: 12 },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  sources: { alignItems: 'stretch' },
  source: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: nbRadius.choice,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  sourceCompact: { paddingVertical: 12, paddingHorizontal: 6 },
  sourceIcon: { backgroundColor: colors.accentTint, borderRadius: 14, padding: 11 },
  pressed: { opacity: 0.85 },
});
