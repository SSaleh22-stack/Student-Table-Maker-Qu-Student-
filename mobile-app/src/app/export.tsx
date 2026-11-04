import * as Clipboard from 'expo-clipboard';
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, Card, IconButton, ScreenHeader } from '@/components/ui';
import { WeekGrid } from '@/components/WeekGrid';
import { tr } from '@/lib/i18n';
import { courseHours, coursesLabel, groupCourses, hoursLabel } from '@/lib/courses';
import { addDays, arabicDate, sundayOf } from '@/lib/export/dates';
import { buildScheduleHtml } from '@/lib/export/html';
import { buildIcs } from '@/lib/export/ics';
import { printHtml, shareFile, shareImage, sharePdf } from '@/lib/export/save';
import { buildScheduleText, buildSectionNumbers } from '@/lib/export/text';
import { buildXlsx } from '@/lib/export/xlsx';
import { goBack } from '@/lib/nav';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { useAppData } from '@/store/AppData';

type Option = 'image' | 'pdf' | 'print' | 'calendar' | 'excel' | 'text' | 'numbers';

const FILE_BASE = 'qu-schedule';
const REMINDER_MINUTES = 15;

/** Export the timetable: image, PDF, print, calendar (.ics), Excel, text, section numbers. */
export default function ExportScreen() {
  const { chosen, absence } = useAppData();
  const { width, height } = useWindowDimensions();
  // Same rule as the timetable: side by side on iPad (or any big enough screen).
  const wide = width >= 700 && height >= 500;
  const previewRef = useRef<ComponentRef<typeof View>>(null);
  // The image frame's measured size: the gradient is drawn at exactly this size
  // ("100%" sizes are not reliable on Android and can leave part of the frame uncovered).
  const [frame, setFrame] = useState({ width: 0, height: 0 });

  const [busy, setBusy] = useState<Option | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [start, setStart] = useState(() => sundayOf(new Date()));
  const [weeks, setWeeks] = useState(() => Math.min(20, Math.max(1, absence.studyWeeks || 15)));
  const [reminder, setReminder] = useState(true);

  const groups = groupCourses(chosen);
  const hours = groups.reduce((n, g) => n + courseHours(g.sections), 0);
  const subtitle = `${coursesLabel(groups.length)} · ${hoursLabel(hours)}`;

  /** Runs one export; shows a short message when it finishes or fails. */
  const run = async (option: Option, action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(option);
    setMessage(null);
    try {
      const done = await action();
      if (done) setMessage({ text: done, ok: true });
    } catch {
      setMessage({ text: tr('تعذّر التصدير، حاول مرة أخرى.', 'Export failed, please try again.'), ok: false });
    } finally {
      setBusy(null);
    }
  };

  /** The preview as a PNG: phones get the bytes (base64), web a data URL to download. */
  const captureImage = () => {
    if (!previewRef.current) throw new Error('no preview');
    return captureRef(previewRef, {
      format: 'png',
      quality: 1,
      result: Platform.OS === 'web' ? 'data-uri' : 'base64',
      fileName: FILE_BASE,
    });
  };

  const exportImage = () =>
    run('image', async () => {
      await shareImage(await captureImage(), `${FILE_BASE}.png`);
    });

  const exportPdf = () =>
    run('pdf', async () => {
      const html = buildScheduleHtml(chosen);
      try {
        await sharePdf(html, `${FILE_BASE}.pdf`);
      } catch {
        // If the phone can't make or share the file, its print window can still save a PDF.
        await printHtml(html);
        return tr('اختر «حفظ كملف PDF» من نافذة الطباعة لحفظ الجدول.', 'Choose “Save as PDF” in the print window to save the timetable.');
      }
    });

  const print = () => run('print', () => printHtml(buildScheduleHtml(chosen)));

  const exportCalendar = () =>
    run('calendar', () =>
      shareFile({
        name: `${FILE_BASE}.ics`,
        mimeType: 'text/calendar',
        uti: 'com.apple.ical.ics',
        data: buildIcs(chosen, { start, weeks, reminderMinutes: reminder ? REMINDER_MINUTES : null }),
      }),
    );

  const exportExcel = () =>
    run('excel', () =>
      shareFile({
        name: `${FILE_BASE}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        uti: 'org.openxmlformats.spreadsheetml.sheet',
        data: buildXlsx(chosen),
      }),
    );

  const shareText = () =>
    run('text', async () => {
      const text = buildScheduleText(chosen);
      try {
        await Share.share({ message: text });
      } catch {
        // No share sheet (e.g. some browsers): copy instead.
        await Clipboard.setStringAsync(text);
        return tr('نُسخ الجدول كنص، الصقه في أي محادثة.', 'Timetable copied as text; paste it into any chat.');
      }
    });

  const copyNumbers = () =>
    run('numbers', async () => {
      await Clipboard.setStringAsync(buildSectionNumbers(chosen));
      return tr('نُسخت أرقام الشعب.', 'Section numbers copied.');
    });

  const lastDay = addDays(start, weeks * 7 - 1);

  // iPad: options on the start side (right in Arabic), the preview fills the rest.
  const sideW = Math.round(Math.min(420, Math.max(320, width * 0.36)));
  // Narrow phones: thinner teal edge and card padding, so the day columns keep their full width
  // (8 + 6 each side, the same room the grid had before the card).
  const slimFrame = !wide && width < 500;
  const framePad = slimFrame ? 28 : 52;
  const gridW = wide ? width - 32 - 16 - sideW - framePad : width - 32 - framePad;
  const largeGrid = gridW >= 560;

  const header = (
    <ScreenHeader
      title={tr('تصدير الجدول', 'Export timetable')}
      subtitle={chosen.length ? subtitle : undefined}
      leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />}
    />
  );

  if (chosen.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <Icon name="calendarPlus" size={30} color={colors.accent} />
            <AppText size={15} weight="bold" align="center">
              {tr('جدولك فارغ', 'Your timetable is empty')}
            </AppText>
            <AppText size={13} color={colors.muted} align="center">
              {tr('أضف مقرراتك إلى الجدول أولاً، ثم عد لتصديره.', 'Add your courses to the timetable first, then come back to export it.')}
            </AppText>
            <Button label={tr('العودة إلى الجدول', 'Back to the timetable')} variant="soft" onPress={goBack} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* What the image looks like; this view is captured for "صورة": a white card on a teal gradient. */
  const preview = (
    <View
      ref={previewRef}
      collapsable={false}
      style={[styles.preview, slimFrame && styles.previewSlim]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setFrame((f) => (f.width === w && f.height === h ? f : { width: w, height: h }));
      }}>
      <Svg style={styles.previewBg} width={frame.width} height={frame.height}>
        <Defs>
          <LinearGradient id="exportBg" x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#0E7490" />
            <Stop offset="1" stopColor="#08485B" />
          </LinearGradient>
        </Defs>
        <Rect width={frame.width} height={frame.height} fill="url(#exportBg)" />
      </Svg>
      <View style={[styles.previewHead, { flexDirection: row }, slimFrame && { paddingHorizontal: 6 }]}>
        <Logo size={largeGrid ? 44 : 38} onDark />
        <View style={{ flex: 1 }}>
          <AppText weight="bold" size={largeGrid ? 22 : 19} color="#FFFFFF">
            {tr('جدولي الدراسي', 'My class timetable')}
          </AppText>
          <AppText size={largeGrid ? 13 : 12} color="#D5EEF3">
            {subtitle}
          </AppText>
        </View>
      </View>
      <View style={[styles.previewCard, slimFrame && styles.previewCardSlim]}>
        <WeekGrid chosen={chosen} hourHeight={largeGrid ? 58 : 46} compact={gridW < 420} large={largeGrid} />
      </View>
      <AppText size={11} color="#CFEAF0" align="center">
        Qu Student · qustudent.net
      </AppText>
    </View>
  );

  const status = message ? (
    <View
      style={[styles.message, { flexDirection: row }, !message.ok && styles.messageError]}
      accessibilityLiveRegion="polite">
      <Icon name={message.ok ? 'check' : 'alert'} size={16} color={message.ok ? colors.success : colors.danger} />
      <AppText size={13} color={message.ok ? colors.success : colors.danger} style={{ flex: 1 }}>
        {message.text}
      </AppText>
    </View>
  ) : null;

  const options = (
    <>
      <AppText size={15} weight="bold">
        {tr('اختر طريقة التصدير', 'Choose how to export')}
      </AppText>
      <View style={styles.options}>
        <OptionCard
          icon="image"
          title={tr('صورة', 'Image')}
          text={
            wide
              ? tr('صورة PNG للجدول كما تراها بجانبك، احفظها أو شاركها.', 'A PNG image of the timetable as you see it beside you. Save or share it.')
              : tr('صورة PNG للجدول كما تراها بالأعلى، احفظها أو شاركها.', 'A PNG image of the timetable as you see it above. Save or share it.')
          }
          busy={busy === 'image'}
          onPress={exportImage}
        />
        <OptionCard
          icon="fileText"
          title={tr('ملف PDF', 'PDF file')}
          text={tr('الجدول الأسبوعي وملخص المقررات بحجم A4.', 'The weekly timetable and course summary on A4.')}
          busy={busy === 'pdf'}
          onPress={exportPdf}
        />
        <OptionCard
          icon="table"
          title={tr('ملف Excel', 'Excel file')}
          text={tr('المقررات والجدول الأسبوعي في جدول بيانات يفتح في Excel.', 'Courses and the weekly timetable in a spreadsheet that opens in Excel.')}
          busy={busy === 'excel'}
          onPress={exportExcel}
        />
        <OptionCard
          icon="printer"
          title={tr('طباعة', 'Print')}
          text={tr('اطبع الجدول مباشرة من جهازك.', 'Print the timetable straight from your device.')}
          busy={busy === 'print'}
          onPress={print}
        />
        <OptionCard
          icon="message"
          title={tr('مشاركة كنص', 'Share as text')}
          text={tr('رسالة جاهزة لواتساب أو تيليجرام بكل المواعيد.', 'A ready message for WhatsApp or Telegram with every class time.')}
          busy={busy === 'text'}
          onPress={shareText}
        />
        <OptionCard
          icon="hash"
          title={tr('نسخ أرقام الشعب', 'Copy section numbers')}
          text={tr('رموز المقررات وأرقام الشعب، لتسجيلها في البوابة بسرعة.', 'Course codes and section numbers, to register on the portal quickly.')}
          busy={busy === 'numbers'}
          onPress={copyNumbers}
        />
      </View>

      {/* Calendar: needs the semester dates, so it has its own card. */}
      <Card style={styles.calendar}>
        <View style={[styles.optionHead, { flexDirection: row }]}>
          <View style={styles.optionIcon}>
            <Icon name="calendarPlus" size={20} color={colors.accentDark} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText size={15} weight="bold">
              {tr('إضافة إلى التقويم', 'Add to calendar')}
            </AppText>
            <AppText size={12} color={colors.muted}>
              {tr('كل محاضرة موعد أسبوعي في تقويم iPhone أو Google أو Outlook.', 'Every class becomes a weekly event in your iPhone, Google or Outlook calendar.')}
            </AppText>
          </View>
        </View>

        <SettingRow label={tr('بداية الدراسة', 'Classes start')}>
          <Stepper
            value={arabicDate(start)}
            lessLabel={tr('الأسبوع السابق', 'Previous week')}
            moreLabel={tr('الأسبوع التالي', 'Next week')}
            onLess={() => setStart((d) => addDays(d, -7))}
            onMore={() => setStart((d) => addDays(d, 7))}
          />
        </SettingRow>
        <SettingRow label={tr('عدد الأسابيع', 'Number of weeks')}>
          <Stepper
            value={`${weeks}`}
            lessLabel={tr('أقل', 'Fewer')}
            moreLabel={tr('أكثر', 'More')}
            onLess={() => setWeeks((w) => Math.max(1, w - 1))}
            onMore={() => setWeeks((w) => Math.min(20, w + 1))}
            numeric
          />
        </SettingRow>
        <SettingRow label={tr(`تنبيه قبل المحاضرة بـ ${REMINDER_MINUTES} دقيقة`, `Reminder ${REMINDER_MINUTES} minutes before class`)}>
          <Switch
            value={reminder}
            onValueChange={setReminder}
            trackColor={{ true: colors.accent, false: '#CBD5E1' }}
            thumbColor="#FFFFFF"
            accessibilityLabel={tr('تنبيه قبل المحاضرة', 'Reminder before class')}
          />
        </SettingRow>
        <AppText size={12} color={colors.muted}>
          {tr(
            `تتكرر المواعيد حتى ${arabicDate(lastDay)}. افتح الملف بتطبيق التقويم، أو احفظه في «الملفات» ثم افتحه واختر «إضافة الكل».`,
            `Classes repeat until ${arabicDate(lastDay)}. Open the file with your calendar app, or save it to Files, open it and choose “Add All”.`,
          )}
        </AppText>
        <Button label={tr('إنشاء ملف التقويم', 'Create calendar file')} icon="calendarPlus" onPress={exportCalendar} loading={busy === 'calendar'} />
      </Card>
    </>
  );

  if (wide) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.wideTop}>{header}</View>
        <View style={[styles.wideBody, { flexDirection: row }]}>
          <ScrollView style={{ width: sideW, flexGrow: 0 }} contentContainerStyle={styles.sideContent}>
            {status}
            {options}
          </ScrollView>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sideContent}>
            {preview}
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}
        {preview}
        {status}
        {options}
      </ScrollView>
    </SafeAreaView>
  );
}

function OptionCard({
  icon,
  title,
  text,
  busy,
  onPress,
}: {
  icon: IconName;
  title: string;
  text: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={text}
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.option, { flexDirection: row }, pressed && { opacity: 0.85 }]}>
      <View style={styles.optionIcon}>
        <Icon name={icon} size={20} color={colors.accentDark} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText size={15} weight="bold">
          {title}
        </AppText>
        <AppText size={12} color={colors.muted}>
          {text}
        </AppText>
      </View>
      {busy ? <ActivityIndicator color={colors.accent} /> : <Icon name="forward" size={18} color={colors.faint} />}
    </Pressable>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={[styles.setting, { flexDirection: row }]}>
      <AppText size={13} style={{ flex: 1 }}>
        {label}
      </AppText>
      {children}
    </View>
  );
}

function Stepper({
  value,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
  numeric = false,
}: {
  value: string;
  lessLabel: string;
  moreLabel: string;
  onLess: () => void;
  onMore: () => void;
  numeric?: boolean;
}) {
  return (
    <View style={[styles.stepper, { flexDirection: row }]}>
      <Pressable
        onPress={onLess}
        accessibilityRole="button"
        accessibilityLabel={lessLabel}
        hitSlop={6}
        style={styles.stepBtn}>
        <Icon name={numeric ? 'minus' : 'back'} size={16} color={colors.accentDark} />
      </Pressable>
      <AppText size={13} weight="semibold" align="center" style={{ minWidth: numeric ? 28 : 112 }}>
        {value}
      </AppText>
      <Pressable
        onPress={onMore}
        accessibilityRole="button"
        accessibilityLabel={moreLabel}
        hitSlop={6}
        style={styles.stepBtn}>
        <Icon name={numeric ? 'plus' : 'forward'} size={16} color={colors.accentDark} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  wideTop: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  wideBody: { flex: 1, gap: 16, paddingHorizontal: 16 },
  sideContent: { gap: 12, paddingTop: 4, paddingBottom: 32 },
  // Solid teal under the gradient, so the frame is never left uncovered.
  preview: {
    backgroundColor: '#0B5F77',
    borderRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 14,
    gap: 14,
  },
  previewHead: { alignItems: 'center', gap: 12 },
  previewBg: { position: 'absolute', top: 0, left: 0 },
  previewSlim: { paddingHorizontal: 8, paddingTop: 18 },
  previewCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 10, paddingTop: 12 },
  previewCardSlim: { borderRadius: 16, padding: 6, paddingTop: 10 },
  message: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.successSoft,
  },
  messageError: { backgroundColor: colors.dangerSoft },
  options: { gap: 8 },
  option: {
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  optionHead: { alignItems: 'center', gap: 12 },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendar: { gap: 12, borderRadius: 18 },
  setting: { alignItems: 'center', gap: 10, paddingVertical: 2 },
  stepper: { alignItems: 'center', gap: 6, padding: 3, borderRadius: 12, backgroundColor: colors.bg },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
