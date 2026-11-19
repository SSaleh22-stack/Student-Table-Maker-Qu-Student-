import { router, useFocusEffect, type Href } from 'expo-router';
import { setStatusBarStyle, useVerticalBarEdgeIOS } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

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
/** Icon card width from which all 8 services fit in one row (about 70pt each, tablet text). */
const ROW_OF_8_MIN = 560;
/** Same for the iPad layout, whose icons are bigger: only landscape iPads fit 8 in a row. */
const ROW_OF_8_TABLET = 900;
/** Border of the white services card (its cells are sized from the width inside it). */
const CARD_BORDER = 1;

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
  const cardPad = tablet ? 14 : 6;
  // Side margins; the content stays 1100 wide at most on big screens
  const sidePad = Math.max(tablet ? 24 : 16, (width - 1100) / 2);
  // Cells get an exact width from the card's measured width, so the rows line up on every screen.
  const [gridW, setGridW] = useState(0);
  // 4 icons a row (two full rows); all 8 in one row once the card has room for them. Decided by
  // the card's own width, not the screen's: iPhone Duo's unfolded screen is tablet-sized but
  // narrower than an iPad, and its side bar takes part of the width.
  const roomW = gridW || width - 2 * sidePad - 2 * cardPad - 2 * CARD_BORDER;
  // The iPad layout keeps two rows of 4 until the card is landscape-wide.
  const columns = roomW >= (tablet ? ROW_OF_8_TABLET : ROW_OF_8_MIN) ? 8 : 4;
  const cellW = gridW ? Math.floor(gridW / columns) : undefined;

  // White status bar text over the teal header, dark again on the other tabs and pages. When the
  // status bar sits in a side bar next to the page instead (iPhone Duo unfolded), it is over the
  // light background, so it stays dark.
  const verticalBar = useVerticalBarEdgeIOS();
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(verticalBar ? 'dark' : 'light');
      return () => setStatusBarStyle('dark');
    }, [verticalBar]),
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

  // iPad (and other tablets) get their own layout; phones keep the one below.
  if (tablet) {
    return (
      <TabletHome
        top={insets.top}
        sidePad={Math.max(32, (width - 1100) / 2)}
        dateLine={`${dayName(todayKey)} ${arabicDate(now)}`}
        hour={now.getHours()}
        lang={lang}
        columns={columns}
        cellW={cellW}
        onGridWidth={(w) => setGridW((old) => (Math.abs(old - w) < 1 ? old : w))}
      />
    );
  }

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
              const w = e.nativeEvent.layout.width - 2 * cardPad - 2 * CARD_BORDER;
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

          {/* A problem or an idea: one tap to the feedback form */}
          <Pressable
            onPress={() => router.push('/feedback')}
            accessibilityRole="button"
            accessibilityHint={tr('يفتح نموذج الملاحظات', 'Opens the feedback form')}
            style={({ pressed }) => [
              styles.feedback,
              tablet && styles.feedbackTablet,
              { flexDirection: row },
              pressed && { opacity: 0.85 },
            ]}>
            <View style={[styles.feedbackIcon, tablet && styles.feedbackIconTablet]}>
              <Icon name="message" size={t(20, 26)} color={colors.accentDark} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText size={t(14.5, 18)} weight="bold">
                {tr('عندك مشكلة أو فكرة؟', 'Got a problem or an idea?')}
              </AppText>
              <AppText size={t(12.5, 15)} color={colors.muted}>
                {tr('اكتب لنا من هنا وتصلنا رسالتك مباشرة', 'Write to us here and it reaches us directly')}
              </AppText>
            </View>
            <View style={[styles.feedbackGo, tablet && styles.feedbackGoTablet, { flexDirection: row }]}>
              <AppText size={t(12.5, 15)} weight="bold" color="#FFFFFF">
                {tr('اكتب لنا', 'Write to us')}
              </AppText>
              <Icon name="forward" size={t(14, 17)} color="#FFFFFF" />
            </View>
          </Pressable>

          <Announcements />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const greeting = (hour: number) =>
  hour < 12 ? tr('صباح الخير', 'Good morning') : hour < 18 ? tr('مساء الخير', 'Good afternoon') : tr('مساء الخير', 'Good evening');

/** Padding inside the iPad services card (its cells are sized from the width inside it). */
const TAB_CARD_PAD = 16;

/**
 * iPad home: a teal header with a greeting, every service as a big icon on one white card,
 * then the announcements and the feedback card side by side, filling the rest of the screen.
 */
function TabletHome({
  top,
  sidePad,
  dateLine,
  hour,
  lang,
  columns,
  cellW,
  onGridWidth,
}: {
  top: number;
  sidePad: number;
  dateLine: string;
  hour: number;
  lang: string;
  columns: number;
  cellW?: number;
  onGridWidth: (w: number) => void;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 28 }}>
        <View style={[tabStyles.hero, { paddingTop: top + 18, paddingHorizontal: sidePad + 8 }]}>
          {/* Teal above the page too, so pulling down past the top shows no gap */}
          <View style={[styles.overscroll, { backgroundColor: GRAD_TOP }]} />
          <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={GRAD_TOP} />
                <Stop offset="1" stopColor={GRAD_BOTTOM} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#heroGrad)" />
          </Svg>
          <View style={[tabStyles.circle, tabStyles.circleBig]} />
          <View style={[tabStyles.circle, tabStyles.circleSmall]} />

          <View style={[styles.header, { flexDirection: row }]}>
            <Logo size={52} onDark />
            <View style={{ flex: 1 }}>
              <AppText size={23} weight="bold" color={ON_TEAL.title} style={{ lineHeight: 30 }}>
                QU Student
              </AppText>
            </View>
            <Pressable
              onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              accessibilityRole="button"
              accessibilityLabel={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
              hitSlop={6}
              style={({ pressed }) => [styles.langBtn, styles.langBtnTablet, { flexDirection: row }, pressed && { opacity: 0.8 }]}>
              <Icon name="globe" size={18} color={ON_TEAL.title} />
              <AppText size={15} weight="semibold" color={ON_TEAL.title}>
                {lang === 'ar' ? 'English' : 'العربية'}
              </AppText>
            </Pressable>
          </View>

          <View style={{ marginTop: 52 }}>
            <AppText size={15} weight="semibold" color={ON_TEAL.text}>
              {dateLine}
            </AppText>
            <AppText size={38} weight="bold" color={ON_TEAL.title} style={{ lineHeight: 54 }}>
              {greeting(hour)}
            </AppText>
            <AppText size={17} color={ON_TEAL.soft}>
              {tr('كل ما تحتاجه لفصلك في مكان واحد', 'Everything for your term, in one place')}
            </AppText>
          </View>
        </View>

        <View style={{ flex: 1, paddingHorizontal: sidePad, marginTop: -64, gap: 20 }}>
          {/* Every service as a big icon on one white card */}
          <View
            style={[tabStyles.services, { flexDirection: row }]}
            onLayout={(e) => onGridWidth(e.nativeEvent.layout.width - 2 * TAB_CARD_PAD - 2 * CARD_BORDER)}>
            {features().map((f) => (
              <Pressable
                key={f.href as string}
                onPress={() => router.push(f.href)}
                accessibilityRole="button"
                accessibilityLabel={f.title}
                accessibilityHint={f.text}
                style={({ pressed }) => [
                  tabStyles.cell,
                  cellW ? { width: cellW } : { width: `${100 / columns}%` },
                  pressed && { opacity: 0.6 },
                ]}>
                <View style={tabStyles.iconSquare}>
                  <Icon name={f.icon} size={34} color={colors.accentDark} />
                </View>
                <AppText size={16.5} weight="semibold" align="center" numberOfLines={2}>
                  {f.label}
                </AppText>
              </Pressable>
            ))}
          </View>

          {/* Announcements and "problem or idea?" side by side, down to the tab bar */}
          <View style={[tabStyles.bottom, { flexDirection: row }]}>
            <View style={{ flex: 1.25 }}>
              <Announcements list />
            </View>
            <Pressable
              onPress={() => router.push('/feedback')}
              accessibilityRole="button"
              accessibilityHint={tr('يفتح نموذج الملاحظات', 'Opens the feedback form')}
              style={({ pressed }) => [tabStyles.feedback, pressed && { opacity: 0.9 }]}>
              <View style={[tabStyles.feedbackIcon, { alignSelf: alignStart }]}>
                <Icon name="message" size={28} color={WARM.icon} />
              </View>
              <View style={{ gap: 6, marginTop: 18 }}>
                <AppText size={21} weight="bold">
                  {tr('عندك مشكلة أو فكرة؟', 'Got a problem or an idea?')}
                </AppText>
                <AppText size={15.5} color={colors.muted} style={{ lineHeight: 25 }}>
                  {tr('اكتب لنا من داخل التطبيق وتصلنا رسالتك مباشرة.', 'Write to us from inside the app and it reaches us directly.')}
                </AppText>
              </View>
              <View style={[tabStyles.feedbackBtn, { flexDirection: row, alignSelf: alignStart }]}>
                <AppText size={15.5} weight="bold" color="#FFFFFF">
                  {tr('اكتب لنا', 'Write to us')}
                </AppText>
                <Icon name="forward" size={17} color="#FFFFFF" />
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** iPad header gradient, and the warm color of the feedback icon. */
const GRAD_TOP = '#0F7C99';
const GRAD_BOTTOM = '#0B5E75';
const WARM = { bg: '#FEF3DC', icon: '#B45309' };
const SOFT_SHADOW = '0px 8px 24px rgba(19, 32, 46, 0.07)';

const tabStyles = StyleSheet.create({
  hero: { paddingBottom: 100, overflow: 'hidden' },
  circle: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' },
  circleBig: { width: 460, height: 460, top: -190, left: -140 },
  circleSmall: { width: 260, height: 260, bottom: -150, left: '38%' },
  services: {
    flexWrap: 'wrap',
    paddingHorizontal: TAB_CARD_PAD,
    paddingVertical: 12,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: CARD_BORDER,
    borderColor: colors.border,
    boxShadow: SOFT_SHADOW,
  },
  cell: { alignItems: 'center', gap: 14, paddingVertical: 26, paddingHorizontal: 4 },
  iconSquare: {
    width: 78,
    height: 78,
    borderRadius: 24,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { flex: 1, minHeight: 250, gap: 20, alignItems: 'stretch' },
  feedback: {
    flex: 1,
    padding: 24,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: SOFT_SHADOW,
  },
  feedbackIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: WARM.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackBtn: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.ink,
  },
});

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
    borderWidth: CARD_BORDER,
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
  feedback: {
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feedbackTablet: { gap: 16, padding: 20, borderRadius: 24 },
  feedbackIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackIconTablet: { width: 56, height: 56, borderRadius: 18 },
  feedbackGo: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  feedbackGoTablet: { paddingHorizontal: 18, paddingVertical: 11 },
});
