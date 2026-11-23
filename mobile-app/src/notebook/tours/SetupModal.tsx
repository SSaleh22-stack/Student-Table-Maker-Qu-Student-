/**
 * First-time writing setup (NB-T2, Figma 29-30), shown the first time any notebook opens, before the
 * notebook tour.
 *
 * Step 1 'قبل أن تبدأ': 'كيف تكتب؟' (two choice cards: Pen / Finger; 272 pt side by side on regular
 *   windows, STACKED full width on compact) and 'بأي يد تكتب؟' (right / left chips).
 * Step 2 'إعدادات مهمة': the Apple Pencil double tap (only with Pen, only on iOS), the default paper
 *   (the four small paper tiles), the toolbar position (chips that wrap on compact) and the backup row
 *   (iCloud Drive on iOS, Google Drive on Android), OFF until the student switches it on. Switching it
 *   on awaits the injected enableBackup flow and shows the result inline. 'restore' (the student
 *   chose 'استعادة الآن' in the flow's 'backup found' dialog) saves the choices and opens the restore
 *   screen, as the flow's contract asks of its caller.
 *
 * 'تخطي الإعداد' keeps the current settings, which on first run are the device defaults (tablets
 * Pen, phones Finger with finger drawing; right hand; double tap to eraser; lined paper; toolbar on
 * top; backup off) and marks the setup 'skipped'. 'ابدأ الكتابة' writes ONLY
 * {input, fingerDraws, hand, pencilDoubleTap, pencilSqueeze, defaultPaper, toolbarPos, tours.setup}
 * through the store's deep merge. Backup is written only by the backup flow itself.
 *
 * It renders nothing until the store is loaded; when settings.tours.setup is no longer 'unseen' it
 * calls onDone right away and renders nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { EnableBackupResult } from '@/notebook/core/contracts/backup';
import type { NotebookSettings, PaperStyle } from '@/notebook/core/model';
import type { SetupModalProps } from '@/notebook/contracts/tours';
import { openRestore } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { nbRadius } from '@/notebook/theme';
import { PillButton } from '@/notebook/ui/CircleButton';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { useWidthClass } from '@/notebook/ui/layout';
import { ChipGroup } from '@/notebook/ui/LocationChips';
import { NbModal } from '@/notebook/ui/NbModal';
import { PAPER_STYLE_ORDER, PaperTileArt, paperStyleLabel } from '@/notebook/ui/PaperPicker';
import { ToggleRow } from '@/notebook/ui/ToggleRow';

export interface SetupModalFullProps extends SetupModalProps {
  /**
   * The enable flow's own dialogs (useEnableBackupFlow().ui: the 'backup found' dialog). They are
   * rendered inside this modal so they open on top of it.
   */
  backupUi?: ReactNode;
}

type Input = NotebookSettings['input'];
type Hand = NotebookSettings['hand'];
type PencilAction = NotebookSettings['pencilDoubleTap'];
type ToolbarPos = NotebookSettings['toolbarPos'];
/** What the backup row says under it after the student touched the switch. */
type BackupNote = EnableBackupResult | 'off-later' | null;

/** Figma choice card width on regular windows (two of them + the 20 pt gap fill the 564 pt body). */
const CHOICE_W = 272;
const PRIMARY_W = 220;

export function SetupModal(props: SetupModalFullProps) {
  const store = useNotebooks();
  const doneSent = useRef(false);
  const onDoneRef = useRef(props.onDone);
  useEffect(() => {
    onDoneRef.current = props.onDone;
  });

  const notNeeded = store.loaded && store.settings.tours.setup !== 'unseen';
  const [finished, setFinished] = useState(false);

  // Already done or skipped (or done just now): let the editor go on, once.
  useEffect(() => {
    if (!notNeeded || doneSent.current) return;
    doneSent.current = true;
    onDoneRef.current();
  }, [notNeeded]);

  if (!store.loaded || notNeeded || finished) return null;

  return (
    <SetupBody
      {...props}
      settings={store.settings}
      setSettings={store.setSettings}
      onFinished={() => {
        setFinished(true);
        if (doneSent.current) return;
        doneSent.current = true;
        onDoneRef.current();
      }}
    />
  );
}

interface SetupBodyProps extends SetupModalFullProps {
  settings: NotebookSettings;
  setSettings: ReturnType<typeof useNotebooks>['setSettings'];
  onFinished: () => void;
}

function SetupBody({ enableBackup, isTablet, backupUi, settings, setSettings, onFinished }: SetupBodyProps) {
  const compact = useWidthClass() === 'compact';
  const [step, setStep] = useState<1 | 2>(1);
  // Start from the current settings: the device defaults on first run, the student's own choices on
  // a replay. isTablet only matters if the store could not tell the device class.
  const [input, setInput] = useState<Input>(settings.input ?? (isTablet ? 'pen' : 'finger'));
  const [hand, setHand] = useState<Hand>(settings.hand);
  const [doubleTap, setDoubleTap] = useState<PencilAction>(settings.pencilDoubleTap);
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(settings.defaultPaper.style);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPos>(settings.toolbarPos);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<BackupNote>(null);
  const [enabledHere, setEnabledHere] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const showPencil = input === 'pen' && Platform.OS === 'ios';
  const backupOn = settings.backup.enabled || enabledHere;
  const drive = Platform.OS === 'android' ? 'Google Drive' : 'iCloud Drive';

  const skip = () => {
    setSettings({ tours: { setup: 'skipped' } });
    onFinished();
  };

  const finish = () => {
    setSettings({
      input,
      fingerDraws: input === 'finger',
      hand,
      pencilDoubleTap: doubleTap,
      // Squeeze (Pencil Pro) follows double tap (NB-52); untouched when the row was not shown.
      pencilSqueeze: showPencil ? doubleTap : settings.pencilSqueeze,
      defaultPaper: { style: paperStyle, color: settings.defaultPaper.color, size: settings.defaultPaper.size },
      toolbarPos,
      tours: { setup: 'done' },
    });
    onFinished();
  };
  // The latest finish (the choices may change while the backup flow is running).
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  // A ref, not the busy state: a second tap before the re-render must not start a second flow (the
  // flow answers 'cancelled' to it at once, which would clear busy while the first is still running).
  const running = useRef(false);

  const onBackup = async (next: boolean) => {
    if (running.current) return;
    if (!next) {
      // Turning it off is the backup service's job (it may sign out); point to the settings.
      if (backupOn) setNote('off-later');
      return;
    }
    if (backupOn) return;
    running.current = true;
    setBusy(true);
    setNote(null);
    let result: EnableBackupResult;
    try {
      result = await enableBackup();
    } catch {
      result = 'unknown';
    } finally {
      running.current = false;
    }
    if (!alive.current) return;
    setBusy(false);
    if (result === 'restore') {
      // Backup is on and the student asked to restore: keep the choices, then open the restore screen.
      setEnabledHere(true);
      finishRef.current();
      openRestore();
      return;
    }
    setNote(result);
    if (result === 'ok') setEnabledHere(true);
  };

  const title = step === 1 ? tr('قبل أن تبدأ', 'Before you start') : tr('إعدادات مهمة', 'Important settings');
  const subtitle = tr(`إعداد سريع للكتابة · ${step} من 2`, `Quick writing setup · ${step} of 2`);

  const footer =
    step === 1 ? (
      compact ? (
        <View style={styles.footerCompact}>
          <PillButton label={tr('التالي', 'Next')} onPress={() => setStep(2)} block />
          <LinkButton label={tr('تخطي الإعداد', 'Skip setup')} onPress={skip} center />
        </View>
      ) : (
        <View style={[styles.footerRow, { flexDirection: row }]}>
          <LinkButton label={tr('تخطي الإعداد', 'Skip setup')} onPress={skip} />
          <View style={styles.flex} />
          <PillButton label={tr('التالي', 'Next')} onPress={() => setStep(2)} style={styles.primary} />
        </View>
      )
    ) : compact ? (
      <View style={styles.footerCompact}>
        <PillButton label={tr('ابدأ الكتابة', 'Start writing')} icon="pen" onPress={finish} disabled={busy} block />
        <View style={[styles.footerRow, { flexDirection: row }]}>
          <LinkButton label={tr('رجوع', 'Back')} onPress={() => setStep(1)} disabled={busy} />
          <AppText size={13} color={colors.faint} style={styles.flex}>
            {tr('تجدها كلها لاحقاً في إعدادات المذكرات', 'You can change all of these later in the notebook settings')}
          </AppText>
        </View>
      </View>
    ) : (
      <View style={[styles.footerRow, { flexDirection: row }]}>
        <LinkButton label={tr('رجوع', 'Back')} onPress={() => setStep(1)} disabled={busy} />
        <AppText size={13} color={colors.faint} style={styles.flex}>
          {tr('تجدها كلها لاحقاً في إعدادات المذكرات', 'You can change all of these later in the notebook settings')}
        </AppText>
        <PillButton label={tr('ابدأ الكتابة', 'Start writing')} icon="pen" onPress={finish} disabled={busy} style={styles.primary} />
      </View>
    );

  return (
    <NbModal visible title={title} subtitle={subtitle} onClose={() => {}} footer={footer} hideClose dismissable={false}>
      {step === 1 ? (
        <>
          <SetupRow label={tr('كيف تكتب؟', 'How do you write?')}>
            <View accessibilityRole="radiogroup" style={compact ? styles.choicesCompact : [styles.choices, { flexDirection: row }]}>
              <ChoiceCard
                icon="pencilTip"
                title={tr('بالقلم', 'With a pen')}
                sub={tr(
                  'تكتب بقلم آبل أو قلم سامسونج، والإصبع للتمرير والتكبير فقط.',
                  'You write with an Apple Pencil or an S Pen; your finger only scrolls and zooms.',
                )}
                selected={input === 'pen'}
                onPress={() => setInput('pen')}
                compact={compact}
              />
              <ChoiceCard
                icon="hand"
                title={tr('بالإصبع', 'With your finger')}
                sub={tr(
                  'إذا لم يكن معك قلم. اكتب بإصبع واحد وحرّك الصفحة بإصبعين.',
                  'If you have no pen. Write with one finger and move the page with two.',
                )}
                selected={input === 'finger'}
                onPress={() => setInput('finger')}
                compact={compact}
              />
            </View>
          </SetupRow>
          <SetupRow
            label={tr('بأي يد تكتب؟', 'Which hand do you write with?')}
            sub={tr(
              'نستخدمها لتجاهل راحة يدك على الشاشة، ولإبعاد شريط الأدوات عن يدك.',
              'We use it to ignore your palm on the screen and to keep the toolbar away from your hand.',
            )}>
            <ChipGroup<Hand>
              label={tr('بأي يد تكتب؟', 'Which hand do you write with?')}
              options={[
                { value: 'right', label: tr('اليد اليمنى', 'Right hand'), icon: 'hand' },
                { value: 'left', label: tr('اليد اليسرى', 'Left hand'), icon: 'hand' },
              ]}
              value={hand}
              onChange={setHand}
              gap={10}
            />
          </SetupRow>
        </>
      ) : (
        <>
          {showPencil ? (
            <SetupRow
              label={tr('النقر المزدوج على القلم', 'Double tap on the pen')}
              sub={tr('ماذا يحدث عند النقر مرتين على Apple Pencil؟', 'What happens when you double-tap the Apple Pencil?')}>
              <ChipGroup<PencilAction>
                label={tr('النقر المزدوج على القلم', 'Double tap on the pen')}
                options={[
                  { value: 'eraser', label: tr('التبديل إلى الممحاة', 'Switch to the eraser') },
                  { value: 'lastTool', label: tr('آخر أداة', 'Last tool') },
                  { value: 'off', label: tr('لا شيء', 'Nothing') },
                ]}
                value={doubleTap}
                onChange={setDoubleTap}
              />
            </SetupRow>
          ) : null}

          <SetupRow
            label={tr('الورق الافتراضي', 'Default paper')}
            sub={tr('للمذكرات الجديدة، وتستطيع تغييره لكل مذكرة.', 'For new notebooks. You can change it for each notebook.')}>
            <View accessibilityRole="radiogroup" accessibilityLabel={tr('الورق الافتراضي', 'Default paper')} style={[styles.papers, { flexDirection: row }]}>
              {PAPER_STYLE_ORDER.map((s) => {
                const on = paperStyle === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setPaperStyle(s)}
                    accessibilityRole="radio"
                    accessibilityLabel={paperStyleLabel(s)}
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [styles.paper, pressed && styles.pressed]}>
                    <PaperTileArt style={s} color={settings.defaultPaper.color} width={64} height={82} zoom={4} selected={on} />
                    <AppText size={13} weight={on ? 'bold' : 'medium'} color={on ? colors.accent : colors.muted} align="center">
                      {paperStyleLabel(s)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </SetupRow>

          <SetupRow
            label={tr('مكان شريط الأدوات', 'Toolbar position')}
            sub={tr('تستطيع نقله لاحقاً بالضغط المطوّل عليه.', 'You can move it later by pressing and holding it.')}>
            <ChipGroup<ToolbarPos>
              label={tr('مكان شريط الأدوات', 'Toolbar position')}
              options={[
                { value: 'top', label: tr('أعلى', 'Top') },
                { value: 'bottom', label: tr('أسفل', 'Bottom') },
                { value: 'right', label: tr('يمين', 'Right') },
                { value: 'left', label: tr('يسار', 'Left') },
              ]}
              value={toolbarPos}
              onChange={setToolbarPos}
            />
          </SetupRow>

          <View style={styles.backup}>
            <ToggleRow
              title={tr(`النسخ الاحتياطي إلى ${drive}`, `Back up to ${drive}`)}
              subtitle={backupSubtitle(backupOn, busy, settings.backup.wifiOnly)}
              value={backupOn}
              busy={busy}
              onChange={(v) => void onBackup(v)}
              style={styles.backupRow}
            />
            <BackupMessage note={note} />
          </View>
          <View style={styles.divider} />
        </>
      )}
      {backupUi ?? null}
    </NbModal>
  );
}

function backupSubtitle(on: boolean, busy: boolean, wifiOnly: boolean): string {
  if (busy) return tr('جارٍ التفعيل…', 'Turning on…');
  if (on) return wifiOnly ? tr('مفعّل — يُنسخ تلقائياً عبر Wi-Fi', 'On. Backs up automatically over Wi-Fi') : tr('مفعّل — يُنسخ تلقائياً', 'On. Backs up automatically');
  return tr('مغلق الآن — فعّله ليُنسخ تلقائياً عبر Wi-Fi', 'Off for now. Turn it on to back up automatically over Wi-Fi');
}

function backupErrorText(e: Exclude<EnableBackupResult, 'ok' | 'cancelled' | 'restore'>): string {
  switch (e) {
    case 'icloud-off':
      return tr('iCloud Drive غير مفعّل على هذا الجهاز. فعّله من إعدادات الجهاز ثم حاول مرة أخرى.', 'iCloud Drive is off on this device. Turn it on in the device settings, then try again.');
    case 'signed-out':
      return tr('لم يتم تسجيل الدخول إلى حساب Google. حاول مرة أخرى.', 'You are not signed in to Google. Try again.');
    case 'revoked':
      return tr('انتهى إذن الوصول إلى Google Drive. سجّل الدخول مرة أخرى.', 'Access to Google Drive was removed. Sign in again.');
    case 'no-play-services':
      return tr('خدمات Google Play غير متوفرة على هذا الجهاز.', 'Google Play services are not available on this device.');
    case 'unavailable':
      return tr('النسخ الاحتياطي غير متاح على هذا الجهاز الآن.', 'Backup is not available on this device right now.');
    case 'quota':
      return tr('لا توجد مساحة كافية في التخزين السحابي.', 'There is not enough cloud storage.');
    case 'network':
      return tr('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.', 'Could not connect. Check the internet and try again.');
    default:
      return tr('تعذّر تفعيل النسخ الاحتياطي. حاول مرة أخرى.', 'Could not turn on backup. Try again.');
  }
}

function BackupMessage({ note }: { note: BackupNote }) {
  // 'restore' never gets here: it closes the setup and opens the restore screen.
  if (!note || note === 'cancelled' || note === 'restore') return null;
  if (note === 'ok') return <InfoBanner tone="info" icon="check" text={tr('تم تفعيل النسخ الاحتياطي.', 'Backup is on.')} />;
  if (note === 'off-later') {
    return <InfoBanner tone="info" text={tr('تستطيع إيقاف النسخ الاحتياطي من إعدادات المذكرات.', 'You can turn backup off in the notebook settings.')} />;
  }
  return <InfoBanner tone="warn" icon="alert" text={backupErrorText(note)} />;
}

function SetupRow({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <View style={styles.setupRow}>
      <View style={styles.rowText}>
        <AppText size={16} weight="bold" accessibilityRole="header">
          {label}
        </AppText>
        {sub ? (
          <AppText size={13} color={colors.faint}>
            {sub}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function ChoiceCard({
  icon,
  title,
  sub,
  selected,
  onPress,
  compact,
}: {
  icon: IconName;
  title: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
  compact: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`${title}${tr('، ', ', ')}${sub}`}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.choice,
        compact ? styles.choiceCompact : styles.choiceRegular,
        selected ? styles.choiceOn : styles.choiceOff,
        pressed && !selected && { backgroundColor: colors.surfaceMuted },
      ]}>
      <View style={[styles.choiceTop, { flexDirection: row }]}>
        <View style={[styles.choiceTile, { backgroundColor: selected ? colors.accent : colors.accentTint }]}>
          <Icon name={icon} size={30} color={selected ? '#FFFFFF' : colors.accent} />
        </View>
        <View style={styles.flex} />
        {selected ? (
          <View style={styles.checkOn}>
            <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.5} />
          </View>
        ) : (
          <View style={styles.checkOff} />
        )}
      </View>
      <AppText size={18} weight="bold">
        {title}
      </AppText>
      <AppText size={13} color={colors.faint} style={styles.choiceSub}>
        {sub}
      </AppText>
    </Pressable>
  );
}

function LinkButton({ label, onPress, center, disabled }: { label: string; onPress: () => void; center?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.link, center && styles.linkCenter, (pressed || disabled) && styles.pressed]}>
      <AppText size={15} weight="semibold" color={colors.faint} align={center ? 'center' : 'start'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  setupRow: { gap: 10 },
  rowText: { gap: 2 },
  choices: { gap: 20 },
  choicesCompact: { gap: 12 },
  choice: { padding: 18, gap: 10, borderRadius: nbRadius.folder },
  choiceCompact: { alignSelf: 'stretch' },
  // 272 pt side by side; both shrink together on a window just over 600 pt where the modal is narrower.
  choiceRegular: { flex: 1, maxWidth: CHOICE_W },
  choiceOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentTint },
  choiceOff: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceTop: { alignItems: 'flex-start' },
  choiceTile: { borderRadius: 18, padding: 14 },
  checkOn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  checkOff: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong },
  choiceSub: { lineHeight: 20 },
  papers: { flexWrap: 'wrap', gap: 16 },
  paper: { alignItems: 'center', gap: 6 },
  backup: { gap: 10 },
  backupRow: { paddingHorizontal: 0, paddingVertical: 4 },
  divider: { height: 1, backgroundColor: colors.divider },
  footerRow: { alignItems: 'center', gap: 12 },
  footerCompact: { gap: 10 },
  primary: { width: PRIMARY_W },
  link: { paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  linkCenter: { alignSelf: 'center' },
  pressed: { opacity: 0.6 },
});
