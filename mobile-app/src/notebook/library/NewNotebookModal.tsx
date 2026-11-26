/**
 * 'مذكرة جديدة' in two steps, so every way to start is in view at once (on phones the file sources
 * used to sit at the bottom of one long form, out of sight):
 *
 *   Step 1 'كيف تريد أن تبدأ؟': four choices, each going straight to step 2:
 *     'مذكرة فارغة' · 'استيراد PDF' · 'مسح بالكاميرا' · 'من الصور'
 *   Step 2, empty notebook: the name, where to save it ('الحفظ في' location chips) and the paper
 *     (type, color and size; it starts from the default paper in the settings), then 'إنشاء المذكرة'.
 *   Step 2, a file source: where to save it, then the button that opens the picker, the scanner or
 *     the photos (the import flow for that place).
 *   'رجوع' in step 2 goes back to the choices (the form keeps what was typed).
 *
 * NbModal: the 620 pt card on tablets, a full-height sheet with a sticky footer on phones. The form
 * starts fresh every time it opens. The modal closes before the editor or the import screen opens
 * (MODAL_SWAP_MS), because an open RN Modal would stay above the next screen.
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
type Start = 'blank' | Source;

interface StartOption {
  start: Start;
  icon: IconName;
  label: () => string;
  sub: () => string;
  /** The step 2 button that opens the source. */
  action?: () => string;
}

const STARTS: readonly StartOption[] = [
  {
    start: 'blank',
    icon: 'notebookPen',
    label: () => tr('مذكرة فارغة', 'Empty notebook'),
    sub: () => tr('اكتب على ورق مسطّر أو مربعات أو فارغ', 'Write on lined, grid or blank paper'),
  },
  {
    start: 'pdf',
    icon: 'fileText',
    label: () => tr('استيراد PDF', 'Import PDF'),
    sub: () => tr('من تطبيق الملفات، واكتب عليه', 'From the Files app, then write on it'),
    action: () => tr('اختيار ملف PDF', 'Choose a PDF'),
  },
  {
    start: 'scan',
    icon: 'scan',
    label: () => tr('مسح بالكاميرا', 'Scan with camera'),
    sub: () => tr('حواف وقص تلقائي', 'Auto edges and crop'),
    action: () => tr('فتح الكاميرا', 'Open the camera'),
  },
  {
    start: 'photos',
    icon: 'image',
    label: () => tr('من الصور', 'From photos'),
    sub: () => tr('صورة أو أكثر', 'One or more photos'),
    action: () => tr('اختيار الصور', 'Choose photos'),
  },
];

const optionOf = (s: Start) => STARTS.find((o) => o.start === s) ?? STARTS[0];

function FieldLabel({ text }: { text: string }) {
  return (
    <AppText size={14} weight="semibold" color={colors.muted}>
      {text}
    </AppText>
  );
}

function StartRow({ option, onPress, compact }: { option: StartOption; onPress: () => void; compact: boolean }) {
  const label = option.label();
  const sub = option.sub();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${tr('، ', ', ')}${sub}`}
      style={({ pressed }) => [styles.start, { flexDirection: row }, compact && styles.startCompact, pressed && styles.pressed]}>
      <View style={[styles.startIcon, compact && styles.startIconCompact]}>
        <Icon name={option.icon} size={compact ? 24 : 26} color={colors.accent} />
      </View>
      <View style={styles.startText}>
        <AppText size={compact ? 16 : 17} weight="bold">
          {label}
        </AppText>
        <AppText size={13} color={colors.faint}>
          {sub}
        </AppText>
      </View>
      <Icon name="forward" size={18} color={colors.placeholder} />
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
  const [choice, setChoice] = useState<Start | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState<LocationKey>(start);
  const [paper, setPaper] = useState<PaperSpec>(() => copyPaper(store.settings.defaultPaper));
  const [busy, setBusy] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    // Each opening starts a fresh form on the first step (state adjusted while rendering).
    setWasVisible(visible);
    if (visible) {
      setChoice(null);
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

  const back = () => {
    if (!busy) setChoice(null);
  };

  // ----- step 1: how to start
  if (choice === null) {
    return (
      <NbModal visible={visible} title={tr('مذكرة جديدة', 'New notebook')} subtitle={tr('كيف تريد أن تبدأ؟', 'How do you want to start?')} onClose={onClose}>
        <View style={styles.starts}>
          {STARTS.map((o) => (
            <StartRow key={o.start} option={o} compact={compact} onPress={() => setChoice(o.start)} />
          ))}
        </View>
      </NbModal>
    );
  }

  // ----- step 2: the details for that start
  const option = optionOf(choice);
  const blank = choice === 'blank';
  const backLink = <PillButton label={tr('رجوع', 'Back')} variant="link" onPress={back} disabled={busy} />;
  const primary = blank ? (
    <PillButton label={tr('إنشاء المذكرة', 'Create notebook')} icon="check" onPress={() => void create()} loading={busy} block={compact} style={compact ? undefined : styles.primary} />
  ) : (
    <PillButton label={option.action?.() ?? option.label()} icon={option.icon} onPress={() => fromSource(choice)} block={compact} style={compact ? undefined : styles.primary} />
  );

  return (
    <NbModal
      visible={visible}
      title={option.label()}
      subtitle={blank ? tr('الاسم ومكان الحفظ والورق', 'Name, where to save it, and paper') : tr('اختر مكان حفظ المذكرة', 'Choose where to save the notebook')}
      onClose={onClose}
      dismissable={!busy}
      footer={
        compact ? (
          <View style={styles.footerCompact}>
            {primary}
            <View style={styles.backCompact}>{backLink}</View>
          </View>
        ) : (
          <View style={[styles.footerRow, { flexDirection: row }]}>
            {backLink}
            <View style={styles.flex} />
            {primary}
          </View>
        )
      }>
      <View style={styles.body}>
        {blank ? (
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
        ) : null}
        <View style={styles.field}>
          <FieldLabel text={tr('الحفظ في', 'Save in')} />
          <LocationChips value={loc} onChange={setLocation} />
        </View>
        {blank ? <PaperPicker value={paper} onChange={setPaper} /> : null}
      </View>
    </NbModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  starts: { gap: 12 },
  start: {
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: nbRadius.choice,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  startCompact: { paddingVertical: 14, paddingHorizontal: 14, gap: 12 },
  startIcon: { backgroundColor: colors.accentTint, borderRadius: 14, padding: 12 },
  startIconCompact: { padding: 10 },
  startText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
  footerRow: { alignItems: 'center', gap: 12 },
  footerCompact: { gap: 6 },
  backCompact: { alignSelf: 'center' },
  primary: { minWidth: 220 },
});
