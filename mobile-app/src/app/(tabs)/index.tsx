import { router, useFocusEffect, type Href } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { pushToEnd, row } from '@/lib/rtl';
import { clashingCodes } from '@/lib/schedule';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { useAppData } from '@/store/AppData';

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Light text and see-through white boxes on the teal header. */
const ON_TEAL = { title: '#FFFFFF', text: '#CFEAF0', soft: '#E6F6FA', glass: 'rgba(255,255,255,0.16)' };

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
  /** Short name under the icon */
  label: string;
  /** Full name and description, read out by screen readers */
  title: string;
  text: string;
  href: Href;
}

const features = (): Feature[] => [
  {
    icon: 'calendar',
    label: tr('جدولي', 'Timetable'),
    title: tr('جدولي', 'My timetable'),
    text: tr('اختر الشعب وشاهد جدولك مباشرة', 'Pick sections and see your timetable live'),
    href: '/timetable',
  },
  {
    icon: 'download',
    label: tr('الاستيراد', 'Import'),
    title: tr('الاستيراد من البوابة', 'Import from the portal'),
    text: tr('المقررات المطروحة من MyQU', 'Offered courses from MyQU'),
    href: '/import',
  },
  {
    icon: 'calendarDays',
    label: tr('التقويم', 'Calendar'),
    title: tr('التقويم الأكاديمي', 'Academic calendar'),
    text: tr('بداية الفصل والإجازات والاختبارات', 'Term start, holidays and exams'),
    href: '/calendar',
  },
  {
    icon: 'calculator',
    label: tr('المعدل', 'GPA'),
    title: tr('حاسبة المعدل', 'GPA calculator'),
    text: tr('معدلك الفصلي والتراكمي', 'Your term and cumulative GPA'),
    href: '/gpa',
  },
  {
    icon: 'userMinus',
    label: tr('الغياب', 'Absence'),
    title: tr('حاسبة الغياب', 'Absence calculator'),
    text: tr('نسبة غيابك قبل الحرمان', 'Your absence before the limit'),
    href: '/absence',
  },
  {
    icon: 'star',
    label: tr('قيم', 'Qeeem'),
    title: tr('قيم', 'Qeeem'),
    text: tr('تقييمات أعضاء هيئة التدريس', 'Ratings of faculty members'),
    href: '/qeeem',
  },
  {
    icon: 'clipboardCheck',
    label: tr('تقييم المقررات', 'Evaluations'),
    title: tr('تقييم المقررات', 'Course evaluations'),
    text: tr('املأ استبيانات تقييم المقررات بضغطة', 'Fill in course evaluation surveys in one tap'),
    href: '/reviews',
  },
  {
    icon: 'play',
    label: tr('مقاطع الشرح', 'How-to videos'),
    title: tr('مقاطع شرح الاستخدام', 'How-to videos'),
    text: tr('شرح مختصر لكل ميزة', 'A short guide to every feature'),
    href: '/tutorials',
  },
];

/**
 * Main page: a teal header (with today's next class when turned on in settings), a white card
 * with every service as a round icon, and the announcements.
 */
export default function HomeScreen() {
  const { chosen, settings } = useAppData();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Tablets get bigger icons and text, so the page uses the screen
  const tablet = useIsTablet();
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  // 4 icons a row on phones (two full rows); all 8 in one row from tablet width
  const columns = width >= 600 ? 8 : 4;
  // Cells get an exact width from the card's measured width, so the rows line up on every screen.
  const [gridW, setGridW] = useState(0);
  const cellW = gridW ? Math.floor(gridW / columns) : undefined;
  const cardPad = tablet ? 14 : 6;
  // Side margins; the content stays 1100 wide at most on big screens
  const sidePad = Math.max(tablet ? 24 : 16, (width - 1100) / 2);

  // White status bar text over the teal header, dark again on the other tabs and pages.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

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
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ paddingBottom: t(28, 32) }}>
        {/* Teal header, running up under the status bar */}
        <View
          style={[
            styles.hero,
            { paddingTop: insets.top + t(14, 22), paddingHorizontal: sidePad + t(4, 8), paddingBottom: t(56, 72) },
          ]}>
          {/* Teal above the page too, so pulling down past the top doesn't show a gap */}
          <View style={styles.overscroll} />

          <View style={[styles.header, { flexDirection: row }]}>
            <Logo size={t(40, 52)} onDark />
            <View style={{ flex: 1 }}>
              <AppText size={t(20, 26)} weight="bold" color={ON_TEAL.title} style={{ lineHeight: t(26, 34) }}>
                QU Student
              </AppText>
              <AppText size={t(12, 15)} color={ON_TEAL.text}>
                {tr('جامعة القصيم', 'Qassim University')}
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
              <Icon name="globe" size={t(15, 18)} color={ON_TEAL.title} />
              <AppText size={t(12.5, 15)} weight="semibold" color={ON_TEAL.title}>
                {lang === 'ar' ? 'English' : 'العربية'}
              </AppText>
            </Pressable>
          </View>

          <View style={{ marginTop: t(18, 26), gap: 2 }}>
            <AppText size={t(12.5, 15)} weight="medium" color={ON_TEAL.text}>
              {dayName(todayKey)} {arabicDate(now)}
            </AppText>

            {settings.showTodayCard ? (
              // Today (off by default, turned on from the settings on the More tab): the next class
              <Pressable
                onPress={() => router.push('/timetable')}
                accessibilityRole="button"
                accessibilityHint={tr('يفتح الجدول', 'Opens the timetable')}
                style={({ pressed }) => [{ gap: t(10, 14), marginTop: 6 }, pressed && { opacity: 0.85 }]}>
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
                      <AppText size={t(12, 15)} weight="semibold" color={ON_TEAL.text}>
                        {nextLabel}
                      </AppText>
                      <AppText size={t(16, 22)} weight="bold" color={ON_TEAL.title} numberOfLines={1}>
                        {next.meeting.course.name}
                      </AppText>
                      <AppText size={t(13, 16)} color={ON_TEAL.soft}>
                        {formatTimeRange(next.meeting.startTime, next.meeting.endTime)}
                        {next.meeting.location ? ` · ${next.meeting.location}` : ''}
                      </AppText>
                    </View>
                  </View>
                ) : (
                  <AppText size={t(17, 22)} weight="bold" color={ON_TEAL.title}>
                    {chosen.length
                      ? tr('لا محاضرات في الأيام القادمة', 'No classes in the coming days')
                      : tr('لم تُضف مقررات إلى جدولك بعد', 'No courses in your timetable yet')}
                  </AppText>
                )}
                <View style={{ flexDirection: row, alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <View style={[styles.pill, tablet && styles.pillTablet]}>
                    <AppText size={t(12, 15)} weight="bold" color={ON_TEAL.title}>
                      {courses.length ? coursesLabel(courses.length) : tr('لا مقررات', 'No courses')}
                    </AppText>
                  </View>
                  <View style={[styles.pill, tablet && styles.pillTablet]}>
                    <AppText size={t(12, 15)} weight="bold" color={ON_TEAL.title}>
                      {hoursLabel(hours)}
                    </AppText>
                  </View>
                  {chosen.length ? (
                    <View style={[styles.pill, tablet && styles.pillTablet]}>
                      <AppText size={t(12, 15)} weight="bold" color={ON_TEAL.title}>
                        {leftToday
                          ? tr(`${leftToday} متبقية اليوم`, `${leftToday} left today`)
                          : tr('لا محاضرات متبقية اليوم', 'No classes left today')}
                      </AppText>
                    </View>
                  ) : null}
                  {clashes ? (
                    <View style={[styles.pill, tablet && styles.pillTablet, { backgroundColor: colors.clashSoft }]}>
                      <AppText size={t(12, 15)} weight="bold" color={colors.clash}>
                        {tr('يوجد تعارض', 'Clash found')}
                      </AppText>
                    </View>
                  ) : null}
                  <View style={[{ flexDirection: row, alignItems: 'center', gap: 4 }, pushToEnd]}>
                    <AppText size={t(13, 16)} weight="bold" color={ON_TEAL.title}>
                      {chosen.length ? tr('عرض الجدول', 'View timetable') : tr('ابدأ', 'Start')}
                    </AppText>
                    <Icon name="forward" size={t(16, 19)} color={ON_TEAL.title} />
                  </View>
                </View>
              </Pressable>
            ) : (
              <AppText size={t(17, 22)} weight="bold" color={ON_TEAL.title}>
                {tr('أهلاً بك، كل ما تحتاجه لفصلك هنا', 'Welcome — everything for your term is here')}
              </AppText>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: sidePad, marginTop: t(-38, -50), gap: t(14, 20) }}>
          {/* Every service as a round icon, on a white card over the header's edge */}
          <View
            style={[styles.services, tablet && styles.servicesTablet, { flexDirection: row, paddingHorizontal: cardPad }]}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width - 2 * cardPad;
              setGridW((old) => (Math.abs(old - w) < 1 ? old : w));
            }}>
            {features().map((f) => (
              <Pressable
                key={f.href as string}
                onPress={() => router.push(f.href)}
                accessibilityRole="button"
                accessibilityLabel={f.title}
                accessibilityHint={f.text}
                style={({ pressed }) => [
                  styles.cell,
                  cellW ? { width: cellW } : { width: `${100 / columns}%` },
                  pressed && { opacity: 0.6 },
                ]}>
                <View style={[styles.iconCircle, tablet && styles.iconCircleTablet]}>
                  <Icon name={f.icon} size={t(22, 28)} color={colors.accentDark} />
                </View>
                <AppText size={t(11.5, 14)} weight="semibold" align="center" numberOfLines={2}>
                  {f.label}
                </AppText>
              </Pressable>
            ))}
          </View>

          <Announcements />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.accent },
  overscroll: { position: 'absolute', top: -1000, height: 1000, left: 0, right: 0, backgroundColor: colors.accent },
  header: { alignItems: 'center', gap: 12 },
  nextClass: { alignItems: 'center', gap: 12 },
  codeBox: { minWidth: 64, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 12, alignItems: 'center' },
  codeBoxTablet: { minWidth: 92, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 16 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: ON_TEAL.glass },
  pillTablet: { paddingHorizontal: 14, paddingVertical: 5 },
  langBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: ON_TEAL.glass,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  langBtnTablet: { paddingHorizontal: 16, paddingVertical: 9 },
  services: {
    flexWrap: 'wrap',
    rowGap: 16,
    paddingVertical: 18,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  servicesTablet: { rowGap: 22, paddingVertical: 26, borderRadius: 28 },
  cell: { alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleTablet: { width: 64, height: 64, borderRadius: 32 },
});
