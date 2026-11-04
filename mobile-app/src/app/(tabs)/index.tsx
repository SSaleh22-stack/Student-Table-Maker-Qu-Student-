import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Announcements } from '@/components/Announcements';
import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { SafeAreaView } from '@/components/SafeAreaView';
import { setLang, tr, useLang } from '@/lib/i18n';
import {
  courseHours,
  coursesLabel,
  dayName,
  formatTimeRange,
  getCourseTheme,
  groupCourses,
  hoursLabel,
  slotsOf,
  toMinutes,
} from '@/lib/courses';
import { arabicDate } from '@/lib/export/dates';
import { useIsTablet } from '@/lib/layout';
import { alignStart, pushToEnd, row } from '@/lib/rtl';
import { clashingCodes } from '@/lib/schedule';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { useAppData } from '@/store/AppData';

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Meeting {
  course: Course;
  day: string;
  start: number;
  end: number;
  startTime: string;
  endTime: string;
  location?: string;
}

/** The class happening now, or the next one in the coming week. */
const nextMeeting = (meetings: Meeting[], now: Date) => {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let k = 0; k < 7; k++) {
    const day = DAY_KEYS[(now.getDay() + k) % 7];
    const list = meetings.filter((m) => m.day === day && (k > 0 || m.end > nowMin)).sort((a, b) => a.start - b.start);
    if (list.length) return { meeting: list[0], inDays: k, ongoing: k === 0 && list[0].start <= nowMin };
  }
  return null;
};

interface Feature {
  icon: IconName;
  title: string;
  text: string;
  href: Href;
}

const features = (): Feature[] => [
  {
    icon: 'calendar',
    title: tr('جدولي', 'My timetable'),
    text: tr('اختر الشعب وشاهد جدولك مباشرة', 'Pick sections and see your timetable live'),
    href: '/timetable',
  },
  {
    icon: 'download',
    title: tr('الاستيراد من البوابة', 'Import from the portal'),
    text: tr('المقررات المطروحة من MyQU', 'Offered courses from MyQU'),
    href: '/import',
  },
  {
    icon: 'calendarDays',
    title: tr('التقويم الأكاديمي', 'Academic calendar'),
    text: tr('بداية الفصل والإجازات والاختبارات', 'Term start, holidays and exams'),
    href: '/calendar',
  },
  {
    icon: 'calculator',
    title: tr('حاسبة المعدل', 'GPA calculator'),
    text: tr('معدلك الفصلي والتراكمي', 'Your term and cumulative GPA'),
    href: '/gpa',
  },
  {
    icon: 'userMinus',
    title: tr('حاسبة الغياب', 'Absence calculator'),
    text: tr('نسبة غيابك قبل الحرمان', 'Your absence before the limit'),
    href: '/absence',
  },
  { icon: 'star', title: tr('قيم', 'Qeeem'), text: tr('تقييمات أعضاء هيئة التدريس', 'Ratings of faculty members'), href: '/qeeem' },
  {
    icon: 'clipboardCheck',
    title: tr('تقييم المقررات', 'Course evaluations'),
    text: tr('املأ استبيانات تقييم المقررات بضغطة', 'Fill in course evaluation surveys in one tap'),
    href: '/reviews',
  },
  {
    icon: 'play',
    title: tr('مقاطع شرح الاستخدام', 'How-to videos'),
    text: tr('شرح مختصر لكل ميزة', 'A short guide to every feature'),
    href: '/tutorials',
  },
];

/** Main page: today's next class (when turned on in settings), and every feature. */
export default function HomeScreen() {
  const { chosen, settings } = useAppData();
  const lang = useLang();
  const { width } = useWindowDimensions();
  // 3 columns from tablet width, 2 on phones
  const columns = width >= 600 ? 3 : 2;
  // Cards get an exact width from the grid's measured width, so a short last row starts on the
  // reading side (right in Arabic) instead of being spread to both edges with a hole between.
  const [gridW, setGridW] = useState(0);
  // Tablets get bigger cards and text, so the page uses the screen
  const tablet = useIsTablet();
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const gridGap = t(10, 16);
  const cardW = gridW ? Math.floor((gridW - gridGap * (columns - 1)) / columns) : undefined;

  // Refresh "now" every minute, so the next class moves on by itself.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const courses = groupCourses(chosen);
  const hours = courses.reduce((n, g) => n + courseHours(g.sections), 0);
  const clashes = clashingCodes(chosen).size;

  const meetings: Meeting[] = chosen.flatMap((c) =>
    slotsOf(c).flatMap((s) =>
      s.days.map((day) => ({
        course: c,
        day,
        start: toMinutes(s.startTime),
        end: toMinutes(s.endTime),
        startTime: s.startTime,
        endTime: s.endTime,
        location: s.location ?? c.location,
      })),
    ),
  );
  const next = nextMeeting(meetings, now);
  const todayKey = DAY_KEYS[now.getDay()];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const leftToday = meetings.filter((m) => m.day === todayKey && m.end > nowMin).length;

  const nextLabel = !next
    ? ''
    : next.ongoing
      ? tr('الآن', 'Now')
      : next.inDays === 0
        ? tr('المحاضرة القادمة اليوم', 'Next class today')
        : next.inDays === 1
          ? tr('المحاضرة القادمة غداً', 'Next class tomorrow')
          : tr(`المحاضرة القادمة يوم ${dayName(next.meeting.day)}`, `Next class on ${dayName(next.meeting.day)}`);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          tablet && styles.contentTablet,
          { paddingHorizontal: Math.max(tablet ? 24 : 16, (width - 1100) / 2) },
        ]}>
        <View style={[styles.header, { flexDirection: row }]}>
          <Logo size={t(44, 56)} />
          <View style={{ flex: 1 }}>
            <AppText size={t(22, 28)} weight="bold" style={{ lineHeight: t(28, 36) }}>
              Qu Student
            </AppText>
            <AppText size={t(12.5, 15)} color={colors.muted}>
              {tr('كل ما تحتاجه لفصلك الدراسي في جامعة القصيم', 'Everything you need for your term at Qassim University')}
            </AppText>
          </View>
          {/* Language switch: shows the language it switches to. */}
          <Pressable
            onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            accessibilityRole="button"
            accessibilityLabel={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
            hitSlop={6}
            style={({ pressed }) => [
              styles.langBtn,
              { flexDirection: row },
              tablet && styles.langBtnTablet,
              pressed && { opacity: 0.8 },
            ]}>
            <Icon name="globe" size={t(15, 18)} color={colors.accentDark} />
            <AppText size={t(12.5, 15)} weight="semibold" color={colors.accentDark}>
              {lang === 'ar' ? 'English' : 'العربية'}
            </AppText>
          </Pressable>
        </View>

        {/* Today: off by default, turned on from the settings on the More tab */}
        {settings.showTodayCard ? (
          <Pressable
            onPress={() => router.push('/timetable')}
            accessibilityRole="button"
            accessibilityHint={tr('يفتح الجدول', 'Opens the timetable')}
            style={({ pressed }) => [styles.today, tablet && styles.todayTablet, pressed && { opacity: 0.92 }]}>
            <View style={[{ flexDirection: row, alignItems: 'center', gap: 8 }]}>
              <Icon name="sun" size={t(16, 19)} color="#CFEAF0" />
              <AppText size={t(13, 16)} weight="semibold" color="#CFEAF0" style={{ flex: 1 }}>
                {tr('اليوم', 'Today')} · {dayName(todayKey)} {arabicDate(now)}
              </AppText>
              {chosen.length ? (
                <AppText size={t(12, 15)} weight="semibold" color="#CFEAF0">
                  {leftToday
                    ? tr(`${leftToday} متبقية اليوم`, `${leftToday} left today`)
                    : tr('لا محاضرات متبقية اليوم', 'No classes left today')}
                </AppText>
              ) : null}
            </View>
            {next ? (
              <View style={[styles.nextClass, { flexDirection: row }]}>
                <View
                  style={[
                    styles.codeBox,
                    tablet && styles.codeBoxTablet,
                    { backgroundColor: getCourseTheme(next.meeting.course.code).bg },
                  ]}>
                  <AppText size={t(12, 15)} weight="bold" color={getCourseTheme(next.meeting.course.code).text}>
                    {next.meeting.course.code}
                  </AppText>
                </View>
                <View style={{ flex: 1 }}>
                  <AppText size={t(12, 15)} weight="semibold" color="#CFEAF0">
                    {nextLabel}
                  </AppText>
                  <AppText size={t(16, 22)} weight="bold" color="#FFFFFF" numberOfLines={1}>
                    {next.meeting.course.name}
                  </AppText>
                  <AppText size={t(13, 16)} color="#E6F6FA">
                    {formatTimeRange(next.meeting.startTime, next.meeting.endTime)}
                    {next.meeting.location ? ` · ${next.meeting.location}` : ''}
                  </AppText>
                </View>
              </View>
            ) : (
              <AppText size={t(15, 19)} weight="bold" color="#FFFFFF">
                {chosen.length
                  ? tr('لا محاضرات في الأيام القادمة', 'No classes in the coming days')
                  : tr('لم تُضف مقررات إلى جدولك بعد', 'No courses in your timetable yet')}
              </AppText>
            )}
            <View style={[{ flexDirection: row, alignItems: 'center', gap: 8 }]}>
              <View style={[styles.todayStat, tablet && styles.todayStatTablet]}>
                <AppText size={t(12.5, 15)} weight="bold" color="#FFFFFF">
                  {courses.length ? coursesLabel(courses.length) : tr('لا مقررات', 'No courses')}
                </AppText>
              </View>
              <View style={[styles.todayStat, tablet && styles.todayStatTablet]}>
                <AppText size={t(12.5, 15)} weight="bold" color="#FFFFFF">
                  {hoursLabel(hours)}
                </AppText>
              </View>
              {clashes ? (
                <View style={[styles.todayStat, tablet && styles.todayStatTablet, { backgroundColor: '#FFF1E2' }]}>
                  <AppText size={t(12.5, 15)} weight="bold" color={colors.clash}>
                    {tr('يوجد تعارض', 'Clash found')}
                  </AppText>
                </View>
              ) : null}
              <View style={[{ flexDirection: row, alignItems: 'center', gap: 4 }, pushToEnd]}>
                <AppText size={t(13, 16)} weight="bold" color="#FFFFFF">
                  {chosen.length ? tr('عرض الجدول', 'View timetable') : tr('ابدأ', 'Start')}
                </AppText>
                <Icon name="forward" size={t(16, 19)} color="#FFFFFF" />
              </View>
            </View>
          </Pressable>
        ) : null}

        <Announcements />

        {/* Every feature */}
        <AppText size={t(16, 19)} weight="bold">
          {tr('الخدمات', 'Services')}
        </AppText>
        <View
          style={[styles.grid, { flexDirection: row, gap: gridGap }]}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setGridW((old) => (Math.abs(old - w) < 1 ? old : w));
          }}>
          {features().map((f) => (
            <Pressable
              key={f.title}
              onPress={() => router.push(f.href)}
              accessibilityRole="button"
              accessibilityLabel={f.title}
              accessibilityHint={f.text}
              style={({ pressed }) => [
                styles.feature,
                tablet && styles.featureTablet,
                cardW ? { width: cardW } : { width: `${100 / columns - 2}%` },
                pressed && { opacity: 0.85 },
              ]}>
              {/* On the reading side, like the title under it (the native layout may be RTL in English too) */}
              <View style={[styles.iconBox, tablet && styles.iconBoxTablet, { alignSelf: alignStart }]}>
                <Icon name={f.icon} size={t(21, 25)} color={colors.accentDark} />
              </View>
              <AppText size={t(14.5, 18)} weight="bold">
                {f.title}
              </AppText>
              <AppText size={t(12, 14.5)} color={colors.muted} numberOfLines={2}>
                {f.text}
              </AppText>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 16, gap: 14, paddingBottom: 28 },
  contentTablet: { paddingTop: 24, gap: 20, paddingBottom: 32 },
  header: { alignItems: 'center', gap: 12 },
  today: { backgroundColor: colors.accent, borderRadius: 22, padding: 16, gap: 12 },
  todayTablet: { borderRadius: 28, padding: 26, gap: 18 },
  nextClass: { alignItems: 'center', gap: 12 },
  codeBox: { minWidth: 64, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 12, alignItems: 'center' },
  codeBoxTablet: { minWidth: 92, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 16 },
  todayStat: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  todayStatTablet: { paddingHorizontal: 14, paddingVertical: 5 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxTablet: { width: 50, height: 50, borderRadius: 15 },
  grid: { flexWrap: 'wrap' },
  feature: { minHeight: 128, padding: 14, gap: 6, borderRadius: 18, backgroundColor: colors.surface },
  langBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  langBtnTablet: { paddingHorizontal: 16, paddingVertical: 9 },
  featureTablet: { minHeight: 176, padding: 20, gap: 8, borderRadius: 22 },
});
