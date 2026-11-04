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
import { arabicDate, arabicMonth } from '@/lib/export/dates';
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

/** Qassim University's academic calendar: what's on now, what's next, and every event. */
export default function CalendarScreen() {
  const { calendar, loading, failed, refresh } = useAcademicCalendar();
  const [kind, setKind] = useState<CalendarSection['kind']>('undergrad');
  const [showPast, setShowPast] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  const section = calendar.sections.find((s) => s.kind === kind) ?? calendar.sections[0];
  const events = section?.events ?? [];
  const sorted = [...events].sort((a, b) => a.start.iso.localeCompare(b.start.iso));
  const now = sorted.filter((e) => timingOf(e.start.iso, e.end?.iso) === 'now');
  const upcoming = sorted.filter((e) => timingOf(e.start.iso, e.end?.iso) === 'upcoming');
  const past = sorted.filter((e) => timingOf(e.start.iso, e.end?.iso) === 'past');
  const next = upcoming[0];
  // The top card: the (at most two) ongoing events that end soonest.
  const nowShort = [...now].sort((a, b) => (a.end?.iso ?? a.start.iso).localeCompare(b.end?.iso ?? b.start.iso)).slice(0, 2);

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

        {now.length > 0 || next ? (
          <View style={styles.hero}>
            {now.length > 0 ? (
              <>
                <AppText size={12.5} weight="semibold" color="#CFEAF0">
                  {tr('جارٍ الآن', 'Happening now')}
                </AppText>
                {nowShort.map((e) => (
                  <View key={`${e.title}-${e.start.iso}`} style={{ gap: 2 }}>
                    <AppText size={15} weight="bold" color="#FFFFFF">
                      {e.title}
                    </AppText>
                    {e.end ? (
                      <AppText size={12.5} color="#CFEAF0">
                        {tr('ينتهي', 'Ends')} {inDaysLabel(daysFromToday(e.end.iso)).toLowerCase()} · {wd(e.end.weekday)} {arabicDate(dateOf(e.end.iso))}
                      </AppText>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
            {next ? (
              <View style={[{ gap: 2 }, now.length > 0 && styles.heroNext]}>
                <AppText size={12.5} weight="semibold" color="#CFEAF0">
                  {tr('القادم', 'Next')} · {inDaysLabel(daysFromToday(next.start.iso))}
                </AppText>
                <AppText size={15} weight="bold" color="#FFFFFF">
                  {next.title}
                </AppText>
                <AppText size={12.5} color="#CFEAF0">
                  {wd(next.start.weekday)} {arabicDate(dateOf(next.start.iso))}
                  {next.start.hijri ? ` · ${ltr(next.start.hijri)}${tr('هـ', ' AH')}` : ''}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}

        {upcoming.length > 0 ? (
          <AppText size={15} weight="bold">
            {tr('القادمة', 'Upcoming')}
          </AppText>
        ) : null}
        <View style={styles.list}>
          {[...now, ...upcoming].map((e) => (
            <EventRow key={`${e.title}-${e.start.iso}`} event={e} />
          ))}
        </View>

        {past.length > 0 ? (
          <Pressable
            onPress={() => setShowPast((s) => !s)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPast }}
            style={[styles.pastToggle, { flexDirection: row }]}>
            <AppText size={14} weight="semibold" color={colors.muted}>
              {tr('الأحداث السابقة', 'Past events')} ({past.length})
            </AppText>
            <Icon name={showPast ? 'chevronUp' : 'chevronDown'} size={16} color={colors.muted} />
          </Pressable>
        ) : null}
        {showPast ? (
          <View style={styles.list}>
            {[...past].reverse().map((e) => (
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
          color={exam ? EXAM_FG : event.holiday ? colors.success : colors.accentDark}
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

const EXAM_FG = '#3730A3';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentWide: { paddingHorizontal: 32 },
  seg: { padding: 4, borderRadius: 14, backgroundColor: colors.surface, gap: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  hero: { backgroundColor: colors.accent, borderRadius: 20, padding: 16, gap: 8 },
  heroNext: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)' },
  list: { gap: 8 },
  event: { gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'flex-start' },
  dateBox: {
    width: 56,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.accentTint,
  },
  dateHoliday: { backgroundColor: colors.successSoft },
  dateExam: { backgroundColor: '#EEF2FF' },
  pastToggle: { alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 4 },
});
