import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ClashNotes } from '@/components/ClashNotes';
import { CourseDock } from '@/components/CourseDock';
import { CoursePanel } from '@/components/CoursePanel';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { SafeAreaView } from '@/components/SafeAreaView';
import { SectionDetails } from '@/components/SectionDetails';
import { Toast, type ToastData } from '@/components/Toast';
import { Button, Card, IconButton } from '@/components/ui';
import { WeekGrid } from '@/components/WeekGrid';
import { isEnglish, tr } from '@/lib/i18n';
import { activityLabel, courseHours, coursesLabel, groupCourses, hoursLabel, slotsOf } from '@/lib/courses';
import { pushToEnd, row } from '@/lib/rtl';
import { clashingCodes, clashPairs, examClashes, findClash, gridHours } from '@/lib/schedule';
import { colors, shadow } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { useAppData } from '@/store/AppData';

/** Day names row above the timetable (phone). */
const GRID_HEAD = 22;
const MIN_HOUR = 18;
const MAX_HOUR = 64;
/** iPad (or any screen at least this big): course list and timetable side by side. */
const WIDE_MIN_W = 700;
const WIDE_MIN_H = 500;
/** Day names row above the large timetable. */
const WIDE_GRID_HEAD = 26;
/** High enough that the timetable reaches the bottom of the card on a tall iPad held upright. */
const WIDE_MAX_HOUR = 180;
/** Timetable width from which the iPad uses bigger text in the blocks (about 100pt per day). */
const LARGE_GRID_W = 560;
const TOAST_MS = 5000;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** "CS101 · الشعبة 51 (عملي)" */
const sectionName = (s: Course) => {
  const a = activityLabel(s);
  return `${s.code} · ${tr('الشعبة', 'section')} ${s.section}${a ? ` (${a})` : ''}`;
};

export default function TimetableScreen() {
  const { ready, groups, chosen, chooseSection, removeSection } = useAppData();
  const [toast, setToast] = useState<ToastData | null>(null);
  // The section added last (red border while it clashes) and whether it was just added (teal outline).
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  // Section shown in the details card (kept while the card fades out).
  const [detail, setDetail] = useState<Course | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);
  const { width: winW, height: winH } = useWindowDimensions();
  // Side by side on iPad, and on a phone held sideways (too short for the timetable above the
  // course cards). Only a real tablet gets the bigger header.
  const landscape = winW > winH;
  const wide = winW >= WIDE_MIN_W && (winH >= WIDE_MIN_H || landscape);
  const tablet = Math.min(winW, winH) >= 600;
  const [wideGrid, setWideGrid] = useState({ w: 0, h: 0 });

  // Phone: the course whose section cards are shown, and the section previewed on the timetable.
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [phoneGridH, setPhoneGridH] = useState(0);

  const clashCodes = useMemo(() => clashingCodes(chosen), [chosen]);
  const pairs = useMemo(() => clashPairs(chosen), [chosen]);
  const exams = useMemo(() => examClashes(chosen), [chosen]);
  const chosenCourses = useMemo(() => groupCourses(chosen), [chosen]);
  const totalHours = chosenCourses.reduce((n, g) => n + courseHours(g.sections), 0);
  const noTime = chosen.filter((c) => slotsOf(c).length === 0);

  // First open: start on the first course that has nothing added yet.
  const chosenIds = new Set(chosen.map((c) => c.id));
  const active =
    groups.find((g) => g.code === activeCode) ??
    groups.find((g) => !g.sections.some((s) => chosenIds.has(s.id))) ??
    groups[0] ??
    null;
  const preview = active?.sections.find((s) => s.id === previewId && !chosenIds.has(s.id)) ?? null;

  const { from, to } = gridHours(preview ? [...chosen, preview] : chosen);
  const hourCount = Math.max(1, to - from);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    setFlash(false);
  };

  const showToast = (t: Omit<ToastData, 'id'>) => {
    toastId.current += 1;
    setToast({ ...t, id: toastId.current });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(dismissToast, TOAST_MS);
  };

  /** Adds a section; the course's other chosen sections stay. A clash is added too, with a warning. */
  const choose = (section: Course) => {
    const clash = findClash(section, chosen);
    chooseSection(section);
    setLastAdded(section.id);
    setFlash(true);
    setPreviewId(null);
    showToast({
      text: tr(`أُضيفت ${sectionName(section)}`, `Added ${sectionName(section)}`),
      detail: clash
        ? tr(`تتعارض مع ${clash.code} · الشعبة ${clash.section}`, `Clashes with ${clash.code} · section ${clash.section}`)
        : undefined,
      tone: clash ? 'warn' : 'ok',
      undo: () => removeSection(section),
    });
  };

  const remove = (section: Course) => {
    removeSection(section);
    showToast({ text: tr(`أُزيلت ${sectionName(section)}`, `Removed ${sectionName(section)}`), tone: 'ok', undo: () => chooseSection(section) });
  };

  /** Tap a section: add it; tap it again to remove it. */
  const tapSection = (section: Course) => {
    if (chosenIds.has(section.id)) remove(section);
    else choose(section);
  };

  const openDetail = (section: Course) => {
    setDetail(section);
    setDetailOpen(true);
  };

  const details = (
    <SectionDetails
      section={detail}
      visible={detailOpen}
      chosen={chosen}
      onClose={() => setDetailOpen(false)}
      onRemove={(section) => {
        setDetailOpen(false);
        remove(section);
      }}
    />
  );

  if (!ready) return <View style={styles.screen} />;
  if (groups.length === 0) return <EmptyTimetable />;

  const totals = { courses: chosenCourses.length, hours: totalHours, clash: clashCodes.size > 0 };

  const noTimeNote =
    noTime.length > 0 ? (
      <View style={[styles.noTime, { flexDirection: row }]}>
        <Icon name="clock" size={14} color={colors.muted} />
        <AppText size={11.5} color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
          {tr('بدون وقت:', 'No time:')} {noTime.map((c) => c.code).join(tr('، ', ', '))} · {tr('في الملخص فقط', 'in the summary only')}
        </AppText>
      </View>
    ) : null;

  if (wide) {
    // iPad: the course list on the start side (right in Arabic), the timetable fills the rest.
    const panelW = Math.round(clamp(winW * (tablet ? 0.36 : 0.4), 300, 400));
    const wideHour = wideGrid.h
      ? clamp(Math.floor((wideGrid.h - WIDE_GRID_HEAD) / hourCount), MIN_HOUR, WIDE_MAX_HOUR)
      : 40;
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={[styles.wide, { flexDirection: row }, !tablet && styles.wideShort]}>
          <View
            style={[styles.widePanel, shadow, { width: panelW }, !tablet && { paddingTop: 10, paddingHorizontal: 12 }]}>
            <CoursePanel groups={groups} chosen={chosen} clashCodes={clashCodes} onTapSection={tapSection} />
          </View>
          <View style={[styles.wideMain, !tablet && { gap: 8 }]}>
            <TimetableHeader {...totals} large={tablet} slim={!tablet} />
            <Card style={[styles.wideCard, !tablet && { padding: 10 }]}>
              <View
                style={{ flex: 1 }}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  setWideGrid({ w: Math.round(width), h: Math.round(height) });
                }}>
                <WeekGrid
                  chosen={chosen}
                  lastAddedId={lastAdded}
                  flash={flash}
                  onPressBlock={openDetail}
                  hourHeight={wideHour}
                  compact={wideHour < 34}
                  large={wideGrid.w >= LARGE_GRID_W}
                />
              </View>
              <ClashNotes pairs={pairs} exams={exams} max={3} />
              {noTimeNote}
            </Card>
          </View>
        </View>
        {toast ? <Toast toast={toast} onDismiss={dismissToast} inset={Math.max(16, (winW - 560) / 2)} /> : null}
        {details}
      </SafeAreaView>
    );
  }

  // Phone: the timetable fills the space above the course chips and section cards.
  const phoneHour = phoneGridH ? clamp(Math.floor((phoneGridH - GRID_HEAD) / hourCount), MIN_HOUR, MAX_HOUR) : 30;

  return (
    <View style={styles.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.top}>
            <TimetableHeader {...totals} />
          </View>

          <Card style={styles.phoneCard}>
            <View style={{ flex: 1 }} onLayout={(e) => setPhoneGridH(Math.round(e.nativeEvent.layout.height))}>
              <WeekGrid
                chosen={chosen}
                lastAddedId={lastAdded}
                flash={flash}
                onPressBlock={openDetail}
                hourHeight={phoneHour}
                compact
                preview={preview}
                onPressPreview={(section) => {
                  setActiveCode(section.code);
                  choose(section);
                }}
              />
            </View>
            <ClashNotes pairs={pairs} exams={exams} />
            {noTimeNote}
          </Card>

          <View style={styles.dock}>
            <CourseDock
              groups={groups}
              chosen={chosen}
              clashCodes={clashCodes}
              activeCode={active?.code ?? null}
              onSelectCourse={(code) => {
                setActiveCode(code);
                setPreviewId(null);
              }}
              previewId={preview?.id ?? null}
              onPreview={(section) => {
                // Keep this course selected (the default would move on once it has a section).
                setActiveCode(section.code);
                setPreviewId((id) => (id === section.id ? null : section.id));
              }}
              onToggle={(section) => {
                setActiveCode(section.code);
                tapSection(section);
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* At the top, over the header, so it never covers the section cards. */}
      {toast ? <Toast toast={toast} onDismiss={dismissToast} position="top" /> : null}
      {details}
    </View>
  );
}

/** 3 → "مقررات", 1, 2, 11+ → "مقرر": the noun after a written number. */
const unit = (n: number, one: string, many: string) => (n >= 3 && n <= 10 ? many : one);

/**
 * Logo, title and the export / summary / import buttons. The totals sit under the title as
 * small pills with bold numbers: easy to read, without taking height from the timetable.
 */
function TimetableHeader({
  courses,
  hours,
  clash,
  large = false,
  slim = false,
}: {
  courses: number;
  hours: number;
  clash: boolean;
  large?: boolean;
  /** Phone held sideways: one short row (title and totals side by side), smaller buttons. */
  slim?: boolean;
}) {
  const button = slim ? 34 : 40;
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <Logo size={large ? 46 : slim ? 30 : 40} />
      <View style={slim ? { flexDirection: row, alignItems: 'center', gap: 8 } : { gap: 3, flexShrink: 1 }}>
        <AppText weight="bold" size={large ? 24 : slim ? 18 : 20} style={{ lineHeight: large ? 30 : slim ? 24 : 25 }}>
          {tr('جدولي', 'My timetable')}
        </AppText>
        <View style={[{ flexDirection: row, gap: 5, alignItems: 'center' }]}>
          <Total
            value={courses}
            unit={isEnglish() ? (courses === 1 ? 'course' : 'courses') : unit(courses, 'مقرر', 'مقررات')}
            a11y={courses ? coursesLabel(courses) : tr('لا مقررات', 'No courses')}
            large={large}
          />
          <Total value={hours} unit={isEnglish() ? (hours === 1 ? 'hour' : 'hours') : unit(hours, 'ساعة', 'ساعات')} a11y={hoursLabel(hours)} large={large} />
          <View
            style={[styles.clashPill, { flexDirection: row }, clash ? styles.clashOn : styles.clashOff]}
            accessible
            accessibilityLabel={clash ? tr('يوجد تعارض', 'Clash found') : tr('لا تعارض', 'No clash')}>
            <Icon
              name={clash ? 'alert' : 'check'}
              size={13}
              color={clash ? colors.clash : colors.success}
              strokeWidth={2.5}
            />
            {clash || large ? (
              <AppText size={11.5} weight="bold" color={clash ? colors.clash : colors.success}>
                {clash ? tr('تعارض', 'Clash') : tr('لا تعارض', 'No clash')}
              </AppText>
            ) : null}
          </View>
        </View>
      </View>
      <View style={[{ flexDirection: row, gap: 8 }, pushToEnd]}>
        <IconButton icon="share" label={tr('تصدير الجدول', 'Export timetable')} size={button} onPress={() => router.push('/export')} />
        <IconButton icon="fileText" label={tr('ملخص الجدول', 'Timetable summary')} size={button} onPress={() => router.push('/summary')} />
        {large ? (
          <Button label={tr('استيراد', 'Import')} icon="download" variant="soft" onPress={() => router.push('/import')} />
        ) : (
          <IconButton icon="download" label={tr('استيراد من البوابة', 'Import from the portal')} size={button} onPress={() => router.push('/import')} />
        )}
      </View>
    </View>
  );
}

/** A small pill: bold number, then its unit ("3 مقررات"). */
function Total({ value, unit, a11y, large }: { value: number; unit: string; a11y: string; large: boolean }) {
  return (
    <View style={[styles.total, { flexDirection: row }]} accessible accessibilityLabel={a11y}>
      <AppText size={large ? 16 : 14.5} weight="bold" color={colors.accentDark} style={{ lineHeight: large ? 20 : 18 }}>
        {value}
      </AppText>
      <AppText
        size={large ? 12.5 : 11.5}
        weight="semibold"
        color={colors.muted}
        style={{ lineHeight: large ? 18 : 16 }}>
        {unit}
      </AppText>
    </View>
  );
}

function EmptyTimetable() {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.top, { gap: 12 }]}>
        <View style={[styles.header, { flexDirection: row }]}>
          <Logo size={38} />
          <View>
            <AppText weight="bold" size={21}>
              {tr('جدولي', 'My timetable')}
            </AppText>
            <AppText size={12} color={colors.muted}>
              {tr('لا توجد مقررات بعد', 'No courses yet')}
            </AppText>
          </View>
        </View>
        <Card style={styles.gridCard}>
          <WeekGrid chosen={[]} hourHeight={24} />
          <View style={styles.emptyOverlay} pointerEvents="none">
            <View style={styles.emptyIcon}>
              <Icon name="calendarPlus" size={28} color={colors.accent} />
            </View>
            <AppText weight="bold" size={17} align="center" style={{ marginTop: 8 }}>
              {tr('جدولك فارغ', 'Your timetable is empty')}
            </AppText>
            <AppText size={13} color={colors.muted} align="center">
              {tr('استورد المقررات المطروحة من البوابة لتبدأ', 'Import the offered courses from the portal to start')}
            </AppText>
          </View>
        </Card>
        <Button label={tr('استيراد من البوابة', 'Import from the portal')} icon="download" onPress={() => router.push('/import')} />
        <Card>
          <AppText weight="bold" size={15} style={{ marginBottom: 8 }}>
            {tr('كيف يعمل الاستيراد؟', 'How does importing work?')}
          </AppText>
          {[
            tr('سجّل دخولك في MyQU من داخل التطبيق.', 'Sign in to MyQU inside the app.'),
            tr('افتح صفحة «المقررات المطروحة وفق الخطة».', 'Open the “Offered courses by plan” page.'),
            tr('اضغط «استخراج المقررات» ثم اختر شعبك.', 'Tap “Extract courses”, then pick your sections.'),
          ].map((text, i) => (
            <View key={i} style={{ flexDirection: row, gap: 10, alignItems: 'flex-start', marginTop: i ? 8 : 0 }}>
              <View style={styles.stepNum}>
                <AppText size={12} weight="bold" color="#FFFFFF" align="center">
                  {i + 1}
                </AppText>
              </View>
              <AppText size={13} color="#3D4A5C" style={{ flex: 1 }}>
                {text}
              </AppText>
            </View>
          ))}
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 14, paddingTop: 8 },
  header: { alignItems: 'center', gap: 10 },
  total: {
    alignItems: 'baseline',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  clashPill: {
    alignItems: 'center',
    gap: 3,
    height: 22,
    minWidth: 22,
    paddingHorizontal: 5,
    borderRadius: 999,
    justifyContent: 'center',
  },
  clashOn: { backgroundColor: colors.clashSoft },
  clashOff: { backgroundColor: colors.successSoft },
  gridCard: { marginTop: 12, padding: 10 },
  phoneCard: { flex: 1, marginHorizontal: 14, marginTop: 8, padding: 8 },
  dock: { paddingTop: 8, paddingBottom: 8 },
  wide: { flex: 1, gap: 16, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  /** Phone held sideways: less space around, so the timetable keeps its height. */
  wideShort: { gap: 10, paddingTop: 4, paddingBottom: 6 },
  widePanel: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 16,
    overflow: 'hidden',
  },
  wideMain: { flex: 1, gap: 12 },
  wideCard: { flex: 1, padding: 14 },
  noTime: {
    marginTop: 8,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  emptyOverlay: {
    position: 'absolute',
    top: 40,
    left: 14,
    right: 40,
    bottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
