import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, Card, IconButton, ScreenHeader, Tag } from '@/components/ui';
import { isEnglish, tr } from '@/lib/i18n';
import { CALENDAR_URL, type CalendarEvent, type CalendarSection } from '@/lib/calendar/parse';
import { dateOf, daysFromToday, inDaysLabel, timingOf, useAcademicCalendar } from '@/lib/calendar/useAcademicCalendar';
import { addDays, arabicDate, arabicMonth } from '@/lib/export/dates';
import { goBack } from '@/lib/nav';
import { ltr, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

const kindLabel = (kind: CalendarSection['kind']) =>
  kind === 'undergrad'
    ? tr('المرحلة الجامعية', 'Undergraduate')
    : kind === 'grad'
      ? tr('الدراسات العليا', 'Graduate studies')
      : tr('التقويم', 'Calendar');

const WEEKDAYS_EN: Record<string, string> = {
  الأحد: 'Sunday',
  الاثنين: 'Monday',
  الإثنين: 'Monday',
  الثلاثاء: 'Tuesday',
  الأربعاء: 'Wednesday',
  الخميس: 'Thursday',
  الجمعة: 'Friday',
  السبت: 'Saturday',
};

/** The calendar's weekday (Arabic in the university's table), in the app language. */
const wd = (weekday: string) => (isEnglish() ? (WEEKDAYS_EN[weekday] ?? weekday) : weekday);

/** "للفصل الدراسي الأول (481) من العام الجامعي 1448–1449هـ" from the table's caption */
const subtitleOf = (title: string) =>
  title
    .replace(/^التقويم الأكاديمي\s*/, '')
    .replace(/\s*—\s*المرحلة الجامعية\s*$/, '')
    .replace(/^لبرامج الدراسات العليا\s*—\s*/, '');

const isExam = (e: CalendarEvent) => /اختبار|الاختبارات/.test(e.title);

/**
 * The official title cut down to its first clause, without the academic year or the
 * "at the end of Thursday" note: "إجازة الخريف بنهاية دوام يوم الخميس" → "إجازة الخريف".
 * The full title stays in the "All events" list and in the screen-reader label.
 */
const shortTitle = (title: string) => {
  const short = title
    .split(/[،,]/)[0]
    .replace(/\s*من العام الجامعي\s*[\d/–-]+\s*هـ?/, '')
    .replace(/\s*بنهاية دوام يوم\s*\S+/, '')
    .trim();
  return short || title;
};

type Kind = 'study' | 'deadline' | 'holiday' | 'exam' | 'reg';

const kindOf = (e: CalendarEvent): Kind =>
  e.holiday
    ? 'holiday'
    : isExam(e)
      ? 'exam'
      : /تحويل|تسجيل|تخصيص/.test(e.title)
        ? 'reg'
        : e.end
          ? 'deadline'
          : 'study';

const KIND: Record<Kind, { fg: string; bg: string; bar: string }> = {
  study: { fg: colors.accentDark, bg: colors.accentTint, bar: colors.accent },
  deadline: { fg: colors.warning, bg: colors.warningSoft, bar: colors.warningBar },
  holiday: { fg: colors.success, bg: colors.successSoft, bar: colors.successBar },
  exam: { fg: '#3730A3', bg: '#EEF2FF', bar: '#6366F1' },
  reg: { fg: colors.muted, bg: colors.surfaceMuted, bar: '#94A3B8' },
};

/** The noun after a day count: "1 يوم", "5 أيام", "12 يوماً" ("days" in English). */
const daysNoun = (n: number) => {
  if (isEnglish()) return n === 1 ? 'day' : 'days';
  const lastTwo = n % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return 'أيام';
  if (lastTwo >= 11) return 'يوماً';
  return 'يوم';
};

/** "21 نوفمبر" */
const dayMonth = (iso: string) => {
  const d = dateOf(iso);
  return `${d.getDate()} ${arabicMonth(d)}`;
};

const dateRange = (e: CalendarEvent) => (e.end ? `${dayMonth(e.start.iso)} – ${dayMonth(e.end.iso)}` : `${wd(e.start.weekday)} ${dayMonth(e.start.iso)}`);

/** "2026-11-29" (the calendar's own date format) */
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const RESUME = /استئناف الدراسة|بداية الدراسة/;

interface Break {
  event: CalendarEvent;
  /** First day back in class (a "study resumes" event, or the day after the holiday) */
  backIso: string;
  /** Holiday has started (false on its first day when it begins "at the end of Thursday") */
  started: boolean;
  totalDays: number;
  elapsedDays: number;
}

/** The holiday the student is in right now (or that starts after classes today), if any. */
function currentBreak(sorted: CalendarEvent[]): Break | null {
  const holidays = sorted.filter((e) => e.holiday).reverse();
  for (const h of holidays) {
    const fromStart = daysFromToday(h.start.iso);
    if (fromStart > 0) continue;
    // A study-resumes event shortly after the holiday tells the real first day back.
    const lastDay = h.end?.iso ?? h.start.iso;
    const limit = isoOf(addDays(dateOf(lastDay), h.end ? 4 : 21));
    const resume = sorted.find((e) => !e.holiday && RESUME.test(e.title) && e.start.iso > lastDay && e.start.iso <= limit);
    const backIso = resume?.start.iso ?? isoOf(addDays(dateOf(lastDay), 1));
    if (daysFromToday(backIso) <= 0) continue;
    const startsAfterClasses = /بنهاية دوام/.test(h.title);
    const firstOffDay = startsAfterClasses ? isoOf(addDays(dateOf(h.start.iso), 1)) : h.start.iso;
    const totalDays = Math.max(1, daysFromToday(backIso) - daysFromToday(firstOffDay));
    return {
      event: h,
      backIso,
      started: daysFromToday(firstOffDay) <= 0,
      totalDays,
      elapsedDays: Math.max(0, -daysFromToday(firstOffDay)),
    };
  }
  return null;
}

/** Qassim University's academic calendar: where the semester is, what is closing, what is next. */
export default function CalendarScreen() {
  const { calendar, loading, failed, refresh } = useAcademicCalendar();
  const [kind, setKind] = useState<CalendarSection['kind']>('undergrad');
  const [showAll, setShowAll] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  const section = calendar.sections.find((s) => s.kind === kind) ?? calendar.sections[0];
  const events = section?.events ?? [];
  const sorted = [...events].sort((a, b) => a.start.iso.localeCompare(b.start.iso));
  const upcoming = sorted.filter((e) => timingOf(e.start.iso, e.end?.iso) === 'upcoming');

  const onBreak = currentBreak(sorted);
  // Open windows (withdrawal, transfers, exams...) with the one closing first on top.
  const closing = sorted
    .filter((e) => e.end && !e.holiday && timingOf(e.start.iso, e.end.iso) === 'now')
    .sort((a, b) => a.end!.iso.localeCompare(b.end!.iso));
  // The hero counts down to going back after a break, otherwise to the next event.
  const next = onBreak ? undefined : upcoming[0];
  const comingUp = upcoming.filter((e) => e !== next && e.start.iso !== onBreak?.backIso).slice(0, 4);

  const updated =
    calendar.source === 'bundled'
      ? tr('نسخة محفوظة مع التطبيق', 'Copy saved with the app')
      : tr(`آخر تحديث ${arabicDate(new Date(calendar.updatedAt))}`, `Last updated ${arabicDate(new Date(calendar.updatedAt))}`);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide && styles.contentWide]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}>
        <ScreenHeader
          title={tr('التقويم الأكاديمي', 'Academic calendar')}
          subtitle={section ? subtitleOf(section.title) : undefined}
          leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />}
        />

        {calendar.sections.length > 1 ? (
          <View style={[styles.seg, { flexDirection: row }]} accessibilityRole="tablist">
            {calendar.sections.map((s) => (
              <Pressable
                key={s.kind}
                onPress={() => setKind(s.kind)}
                accessibilityRole="tab"
                accessibilityState={{ selected: s.kind === section?.kind }}
                style={[styles.segBtn, s.kind === section?.kind && styles.segOn]}>
                <AppText size={13.5} weight="semibold" color={s.kind === section?.kind ? '#FFFFFF' : colors.muted}>
                  {kindLabel(s.kind)}
                </AppText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {onBreak ? <BreakHero b={onBreak} /> : next ? <NextHero event={next} /> : null}

        {closing.length > 0 ? (
          <>
            <SectionTitle
              title={tr('مواعيد تُغلق', 'Closing soon')}
              note={tr(`${closing.length} مفتوحة الآن`, `${closing.length} open now`)}
            />
            <View style={styles.list}>
              {closing.map((e) => (
                <WindowCard key={`${e.title}-${e.start.iso}`} event={e} />
              ))}
            </View>
          </>
        ) : null}

        {comingUp.length > 0 ? (
          <>
            <SectionTitle title={tr('قادم', 'Coming up')} />
            <View style={[styles.tiles, { flexDirection: row }]}>
              {comingUp.map((e) => (
                <Tile key={`${e.title}-${e.start.iso}`} event={e} wide={wide} />
              ))}
            </View>
          </>
        ) : null}

        {sorted.length > 0 ? (
          <Pressable
            onPress={() => setShowAll((s) => !s)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAll }}
            style={[styles.allToggle, { flexDirection: row }]}>
            <AppText size={14} weight="semibold" color={colors.accentDark}>
              {tr('كل الأحداث', 'All events')} ({sorted.length})
            </AppText>
            <Icon name={showAll ? 'chevronUp' : 'chevronDown'} size={16} color={colors.accentDark} />
          </Pressable>
        ) : null}
        {showAll ? (
          <View style={styles.list}>
            {sorted.map((e) => (
              <EventRow key={`${e.title}-${e.start.iso}`} event={e} />
            ))}
          </View>
        ) : null}

        <Card style={{ gap: 10 }}>
          <View style={[{ flexDirection: row, alignItems: 'center', gap: 8 }]}>
            <Icon name="info" size={16} color={colors.muted} />
            <AppText size={12} color={colors.muted} style={{ flex: 1 }}>
              {tr('المصدر: موقع جامعة القصيم', 'Source: Qassim University website')} · {updated}
              {failed
                ? tr(' · تعذّر التحديث الآن، اسحب للأسفل للمحاولة مجدداً', ' · Could not update now; pull down to try again')
                : ''}
            </AppText>
          </View>
          <View style={[{ flexDirection: row, gap: 8 }]}>
            <Button
              label={tr('فتح في موقع الجامعة', 'Open on the university site')}
              icon="external"
              variant="soft"
              size="sm"
              onPress={() => WebBrowser.openBrowserAsync(CALENDAR_URL).catch(() => {})}
              style={{ flex: 1 }}
            />
            {section?.imageUrl ? (
              <Button
                label={tr('التقويم كصورة', 'Calendar as image')}
                icon="image"
                variant="outline"
                size="sm"
                onPress={() => WebBrowser.openBrowserAsync(section.imageUrl!).catch(() => {})}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <View style={[styles.sectionTitle, { flexDirection: row }]}>
      <AppText size={15} weight="bold" accessibilityRole="header">
        {title}
      </AppText>
      {note ? (
        <AppText size={12} color={colors.faint}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

/** Green card while on a break: days until classes resume, with one dot per day off. */
function BreakHero({ b }: { b: Break }) {
  const left = daysFromToday(b.backIso);
  const back = dateOf(b.backIso);
  const backEvent = b.event;
  const dots = b.totalDays <= 21;
  return (
    <View
      style={[styles.hero, { backgroundColor: colors.successSoft }]}
      accessible
      accessibilityLabel={`${backEvent.title}${tr('، ', ', ')}${left} ${daysNoun(left)} ${tr('حتى العودة للدراسة', 'until classes resume')}`}>
      <AppText size={12.5} weight="semibold" color={colors.success}>
        {b.started
          ? tr(`أنت في ${shortTitle(backEvent.title)}`, `You are on ${shortTitle(backEvent.title)}`)
          : tr(`${shortTitle(backEvent.title)} تبدأ بنهاية دوام اليوم`, `${shortTitle(backEvent.title)} starts after classes today`)}
      </AppText>
      <View style={[styles.bigRow, { flexDirection: row }]}>
        <AppText size={48} weight="bold" color={colors.success} style={styles.bigNum}>
          {left}
        </AppText>
        <AppText size={15} weight="semibold" color={colors.success} style={{ flexShrink: 1 }}>
          {daysNoun(left)} {tr('حتى العودة للدراسة', 'until classes resume')}
        </AppText>
      </View>
      <AppText size={12} color={colors.muted}>
        {arabicDate(back)}
      </AppText>
      {dots ? (
        <View style={[styles.dots, { flexDirection: row }]}>
          {Array.from({ length: b.totalDays }, (_, i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i < b.elapsedDays + (b.started ? 1 : 0) ? colors.successBar : 'rgba(22, 101, 52, 0.16)' }]}
            />
          ))}
        </View>
      ) : (
        <Meter used={(b.elapsedDays + 1) / b.totalDays} color={colors.successBar} track="rgba(22, 101, 52, 0.16)" />
      )}
    </View>
  );
}

/** Teal card when not on a break: the next event and how many days away it is. */
function NextHero({ event }: { event: CalendarEvent }) {
  const left = daysFromToday(event.start.iso);
  return (
    <View
      style={[styles.hero, { backgroundColor: colors.accent }]}
      accessible
      accessibilityLabel={`${tr('القادم', 'Next')}${tr('، ', ', ')}${event.title}${tr('، ', ', ')}${inDaysLabel(left)}`}>
      <AppText size={12.5} weight="semibold" color="#CFEAF0">
        {tr('القادم', 'Next')}
      </AppText>
      <View style={[styles.bigRow, { flexDirection: row }]}>
        <AppText size={48} weight="bold" color="#FFFFFF" style={styles.bigNum}>
          {left}
        </AppText>
        <AppText size={15} weight="semibold" color="#FFFFFF">
          {daysNoun(left)}
        </AppText>
      </View>
      <AppText size={15} weight="bold" color="#FFFFFF">
        {shortTitle(event.title)}
      </AppText>
      <AppText size={12} color="#CFEAF0">
        {wd(event.start.weekday)} {arabicDate(dateOf(event.start.iso))}
        {event.start.hijri ? ` · ${ltr(event.start.hijri)}${tr('هـ', ' AH')}` : ''}
      </AppText>
    </View>
  );
}

/** An open window: how much of it has passed, and when it closes. Red in its last 3 days. */
function WindowCard({ event }: { event: CalendarEvent }) {
  const end = event.end!;
  const left = daysFromToday(end.iso);
  const total = Math.max(1, daysFromToday(end.iso) - daysFromToday(event.start.iso) + 1);
  const used = (total - left) / total;
  const hot = left <= 3;
  const k = KIND[kindOf(event)];
  const closesWord = kindOf(event) === 'exam' ? tr('تنتهي', 'Ends') : tr('يُغلق', 'Closes');
  return (
    <View
      style={styles.window}
      accessible
      accessibilityLabel={`${event.title}${tr('، ', ', ')}${closesWord} ${wd(end.weekday)} ${arabicDate(dateOf(end.iso))}${tr('، ', ', ')}${inDaysLabel(left)}`}>
      <View style={[styles.windowTop, { flexDirection: row }]}>
        <AppText size={14} weight="semibold" style={{ flex: 1 }}>
          {shortTitle(event.title)}
        </AppText>
        <Tag label={left <= 0 ? tr('آخر يوم', 'Last day') : inDaysLabel(left)} tone={hot ? 'danger' : 'muted'} />
      </View>
      <Meter used={used} color={hot ? colors.dangerBar : left > 30 ? KIND.reg.bar : k.bar} track={colors.surfaceMuted} />
      <AppText size={12} color={colors.muted}>
        {closesWord} {wd(end.weekday)} {arabicDate(dateOf(end.iso))}
      </AppText>
    </View>
  );
}

function Meter({ used, color, track }: { used: number; color: string; track: string }) {
  const pct = Math.round(Math.min(1, Math.max(0.03, used)) * 100);
  return (
    <View style={[styles.meter, { backgroundColor: track, flexDirection: row }]}>
      <View style={{ width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

/** A coming-up event: days away, short title, and its date or range. */
function Tile({ event, wide }: { event: CalendarEvent; wide: boolean }) {
  const left = daysFromToday(event.start.iso);
  const k = KIND[kindOf(event)];
  return (
    <View
      style={[styles.tile, { flexBasis: wide ? '23%' : '46%' }]}
      accessible
      accessibilityLabel={`${event.title}${tr('، ', ', ')}${dateRange(event)}${tr('، ', ', ')}${inDaysLabel(left)}`}>
      <View style={[styles.tileNum, { flexDirection: row }]}>
        <AppText size={24} weight="bold" color={k.fg} style={{ lineHeight: 30 }}>
          {left}
        </AppText>
        <AppText size={11.5} weight="semibold" color={k.fg}>
          {daysNoun(left)}
        </AppText>
      </View>
      <AppText size={13} weight="semibold" numberOfLines={2}>
        {shortTitle(event.title)}
      </AppText>
      <AppText size={11} color={colors.muted}>
        {dateRange(event)}
      </AppText>
    </View>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const timing = timingOf(event.start.iso, event.end?.iso);
  const start = dateOf(event.start.iso);
  const exam = isExam(event);
  const days = daysFromToday(event.start.iso);
  return (
    <View
      style={[styles.event, { flexDirection: row }, timing === 'past' && { opacity: 0.6 }]}
      accessible
      accessibilityLabel={`${event.title}${tr('، ', ', ')}${wd(event.start.weekday)} ${arabicDate(start)}${
        event.end ? ` ${tr('حتى', 'to')} ${wd(event.end.weekday)} ${arabicDate(dateOf(event.end.iso))}` : ''
      }`}>
      <View style={[styles.dateBox, event.holiday && styles.dateHoliday, exam && styles.dateExam]}>
        <AppText
          size={20}
          weight="bold"
          color={exam ? KIND.exam.fg : event.holiday ? colors.success : colors.accentDark}
          style={{ lineHeight: 24 }}>
          {start.getDate()}
        </AppText>
        <AppText size={11} weight="semibold" color={colors.muted} style={{ lineHeight: 14 }}>
          {arabicMonth(start)}
        </AppText>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText size={14} weight="semibold">
          {event.title}
        </AppText>
        <AppText size={12} color={colors.muted}>
          {wd(event.start.weekday)} {event.start.hijri ? `${ltr(event.start.hijri)}${tr('هـ', ' AH')}` : ''}
          {event.end ? ` ${tr('حتى', 'to')} ${wd(event.end.weekday)} ${arabicDate(dateOf(event.end.iso))}` : ''}
        </AppText>
        <View style={[{ flexDirection: row, gap: 6, flexWrap: 'wrap', marginTop: 2 }]}>
          {timing === 'now' ? <Tag label={tr('جارٍ الآن', 'Now')} tone="accent" /> : null}
          {timing === 'upcoming' ? <Tag label={inDaysLabel(days)} tone="muted" /> : null}
          {event.holiday ? <Tag label={tr('إجازة', 'Holiday')} tone="ok" /> : null}
          {exam ? <Tag label={tr('اختبارات', 'Exams')} tone="warn" /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentWide: { paddingHorizontal: 32 },
  seg: { padding: 4, borderRadius: 14, backgroundColor: colors.surface, gap: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  sectionTitle: { alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 4 },
  hero: { borderRadius: 20, padding: 16, gap: 4 },
  bigRow: { alignItems: 'baseline', gap: 8 },
  bigNum: { lineHeight: 56 },
  dots: { gap: 3, marginTop: 8 },
  dot: { flex: 1, height: 6, borderRadius: 3 },
  list: { gap: 8 },
  window: { gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.surface },
  windowTop: { alignItems: 'flex-start', gap: 8 },
  meter: { height: 6, borderRadius: 3, overflow: 'hidden' },
  tiles: { flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, gap: 2, padding: 12, borderRadius: 16, backgroundColor: colors.surface },
  tileNum: { alignItems: 'baseline', gap: 4 },
  allToggle: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  event: { gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'flex-start' },
  dateBox: {
    width: 56,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.accentTint,
  },
  dateHoliday: { backgroundColor: colors.successSoft },
  dateExam: { backgroundColor: KIND.exam.bg },
});
