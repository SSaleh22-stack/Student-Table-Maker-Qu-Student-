import { router } from 'expo-router';
import { tr } from '@/lib/i18n';
import { goBack } from '@/lib/nav';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, CodeBadge, IconButton, Tag } from '@/components/ui';
import { WebFrame, type WebFrameHandle } from '@/components/WebFrame';
import { coursesLabel, getCourseTheme, groupCourses, hasSchedule, sectionsLabel } from '@/lib/courses';
import {
  allowImportFrame,
  EXTRACT_SCRIPT,
  isLoginPage,
  MYQU_LOGIN_URL,
  OFFERED_COURSES_URL,
  parsePortalMessage,
  SCAN_SCRIPT,
} from '@/lib/portal/portal';
import { row } from '@/lib/rtl';
import { SAMPLE_COURSES } from '@/lib/sampleCourses';
import { colors, radius, shadow } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { useAppData } from '@/store/AppData';

type Step = 1 | 2 | 3;

export default function ImportScreen() {
  const { importCourses } = useAppData();
  const frame = useRef<WebFrameHandle>(null);
  const [url, setUrl] = useState(MYQU_LOGIN_URL);
  const [found, setFound] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Course[] | null>(null);

  const host = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return 'myqu.qu.edu.sa';
    }
  }, [url]);

  const step: Step = found > 0 ? 3 : isLoginPage(url) ? 1 : 2;

  const onMessage = (data: string) => {
    const msg = parsePortalMessage(data);
    if (!msg) return;
    if (msg.type === 'scan') setFound(msg.count);
    if (msg.type === 'courses') {
      setExtracting(false);
      if (msg.courses.length === 0) {
        setError(
          tr(
            'لم نجد مقررات في هذه الصفحة. افتح صفحة «المقررات المطروحة وفق الخطة» ثم حاول مرة أخرى.',
            'No courses found on this page. Open the “Offered courses by plan” page and try again.',
          ),
        );
        return;
      }
      importCourses(msg.courses);
      setResult(msg.courses);
    }
    if (msg.type === 'error') {
      setExtracting(false);
      setError(tr('تعذّر استخراج المقررات من هذه الصفحة. حدّث الصفحة ثم حاول مرة أخرى.', 'Could not extract the courses from this page. Refresh the page and try again.'));
    }
  };

  const extract = () => {
    setError(null);
    setExtracting(true);
    frame.current?.inject(EXTRACT_SCRIPT);
    // If the page never answers (navigated away, script blocked), stop the spinner.
    setTimeout(() => setExtracting(false), 8000);
  };

  const loadSample = () => {
    importCourses(SAMPLE_COURSES);
    setResult(SAMPLE_COURSES);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <IconButton icon="x" label={tr('إغلاق', 'Close')} tone="muted" onPress={goBack} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <AppText weight="bold" size={15} align="center">
            {tr('استيراد من البوابة', 'Import from the portal')}
          </AppText>
          <View style={[styles.url, { flexDirection: row }]}>
            <Icon name="lock" size={11} color={colors.muted} />
            <AppText size={11} color={colors.muted}>
              {host}
            </AppText>
          </View>
        </View>
        <IconButton icon="refresh" label={tr('إعادة تحميل الصفحة', 'Reload the page')} tone="muted" onPress={() => frame.current?.reload()} />
      </View>

      <View style={[styles.steps, { flexDirection: row }]} accessibilityLabel={tr('خطوات الاستيراد', 'Import steps')}>
        <StepPill n={1} label={tr('الدخول في MyQU', 'Sign in to MyQU')} state={step > 1 ? 'done' : 'current'} />
        <StepPill n={2} label={tr('المقررات المطروحة', 'Offered courses')} state={step > 2 ? 'done' : step === 2 ? 'current' : 'todo'} />
        <StepPill n={3} label={tr('الاستخراج', 'Extract')} state={step === 3 ? 'current' : 'todo'} />
      </View>

      <View style={styles.webWrap}>
        <WebFrame
          ref={frame}
          uri={MYQU_LOGIN_URL}
          injectedJavaScript={SCAN_SCRIPT}
          onMessage={onMessage}
          onNavigation={(s) => {
            setUrl(s.url);
            if (s.loading) setFound(0);
          }}
          allowUrl={allowImportFrame}
        />
      </View>

      <View style={[styles.panel, shadow]}>
        {error ? (
          <View style={[styles.alert, { flexDirection: row }]}>
            <Icon name="alert" size={16} color={colors.clash} />
            <AppText size={12.5} color={colors.clash} style={{ flex: 1 }}>
              {error}
            </AppText>
          </View>
        ) : null}
        {found > 0 ? (
          <>
            <View style={[styles.panelRow, { flexDirection: row }]}>
              <View style={styles.panelIcon}>
                <Icon name="calendar" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={16}>
                  {tr(`وجدنا ${found} شعبة في هذه الصفحة`, `Found ${found} sections on this page`)}
                </AppText>
                <AppText size={12} color={colors.muted}>
                  {tr('الرمز والاسم والشعبة والأوقات والمدرّس وفترة الاختبار', 'Code, name, section, times, instructor and exam period')}
                </AppText>
              </View>
            </View>
            <Button label={tr('استخراج المقررات', 'Extract courses')} icon="download" onPress={extract} loading={extracting} />
          </>
        ) : (
          <>
            <AppText size={13} color={colors.muted}>
              {step === 1
                ? tr(
                    'سجّل دخولك في MyQU باسم المستخدم أو عبر تطبيق نفاذ. بعد الدخول افتح صفحة المقررات المطروحة.',
                    'Sign in to MyQU with your username or through the Nafath app. Then open the offered courses page.',
                  )
                : tr(
                    'افتح صفحة «المقررات المطروحة وفق الخطة». سيظهر زر الاستخراج عندما نجد المقررات.',
                    'Open the “Offered courses by plan” page. The extract button appears once we find the courses.',
                  )}
            </AppText>
            <Button
              label={tr('فتح صفحة المقررات المطروحة', 'Open the offered courses page')}
              icon="calendar"
              variant={step === 1 ? 'outline' : 'soft'}
              onPress={() => frame.current?.load(OFFERED_COURSES_URL)}
            />
            {/* Lets anyone (including store reviewers) try every feature without a student account. */}
            <Button label={tr('تجربة التطبيق ببيانات تجريبية (بدون تسجيل دخول)', 'Try the app with sample data (no sign-in)')} variant="ghost" onPress={loadSample} />
          </>
        )}
        <View style={[styles.privacy, { flexDirection: row }]}>
          <Icon name="lock" size={12} color={colors.muted} />
          <AppText size={11.5} color={colors.muted}>
            {tr('تسجيل الدخول يتم في موقع الجامعة، ولا نحتفظ بكلمة المرور', 'You sign in on the university website; we never keep your password')}
          </AppText>
        </View>
      </View>

      {result ? (
        <ImportedSheet
          courses={result}
          // Straight to the timetable to pick sections (wherever the import was opened from).
          onDone={() => router.dismissTo('/timetable')}
          onAgain={() => setResult(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function StepPill({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  const bg = state === 'current' ? colors.accent : colors.surface;
  const fg = state === 'current' ? '#FFFFFF' : state === 'done' ? colors.success : colors.muted;
  const dotBg = state === 'current' ? '#FFFFFF' : state === 'done' ? colors.successBar : colors.border;
  const dotFg = state === 'current' ? colors.accent : state === 'done' ? '#FFFFFF' : colors.muted;
  return (
    <View
      style={[styles.step, { backgroundColor: bg, flexDirection: row }]}
      accessibilityState={{ selected: state === 'current' }}>
      <View style={[styles.stepDot, { backgroundColor: dotBg }]}>
        {state === 'done' ? (
          <Icon name="check" size={11} color={dotFg} strokeWidth={3} />
        ) : (
          <AppText size={10.5} weight="bold" color={dotFg} align="center">
            {n}
          </AppText>
        )}
      </View>
      <AppText size={11} weight={state === 'current' ? 'semibold' : 'medium'} color={fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function ImportedSheet({ courses, onDone, onAgain }: { courses: Course[]; onDone: () => void; onAgain: () => void }) {
  const groups = groupCourses(courses);
  return (
    <View style={styles.dim}>
      <View style={styles.sheet}>
        <View style={styles.okCircle}>
          <Icon name="check" size={28} color={colors.accent} strokeWidth={2.6} />
        </View>
        <AppText weight="bold" size={21} align="center" style={{ marginTop: 10 }}>
          {tr('تم استخراج المقررات', 'Courses extracted')}
        </AppText>
        <AppText size={13} color={colors.muted} align="center">
          {coursesLabel(groups.length)} · {courses.length} {tr('شعبة', 'sections')}
        </AppText>
        <ScrollView style={styles.list} contentContainerStyle={{ paddingVertical: 2 }}>
          {groups.map((g) => {
            const theme = getCourseTheme(g.code);
            const noTime = g.sections.every((s) => !hasSchedule(s));
            return (
              <View key={g.code} style={[styles.listRow, { flexDirection: row }]}>
                <CodeBadge code={g.code} bg={theme.bg} fg={theme.text} />
                <AppText size={13} weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                  {g.name}
                </AppText>
                {noTime ? (
                  <Tag label={tr('بدون وقت', 'No time')} tone="muted" />
                ) : (
                  <AppText size={12} color={colors.muted}>
                    {sectionsLabel(g.sections.length)}
                  </AppText>
                )}
              </View>
            );
          })}
        </ScrollView>
        <View style={[styles.info, { flexDirection: row }]}>
          <Icon name="clock" size={16} color={colors.muted} />
          <AppText size={12.5} color={colors.muted} style={{ flex: 1 }}>
            {tr('المقررات التي ليس لها وقت محدد تظهر في الملخص فقط ولا تُضاف إلى الجدول.', 'Courses without a set time show in the summary only and are not added to the timetable.')}
          </AppText>
        </View>
        <Button label={tr('ابدأ بناء الجدول', 'Start building the timetable')} onPress={onDone} style={{ marginTop: 12 }} />
        <Button label={tr('إعادة الاستخراج', 'Extract again')} variant="ghost" onPress={onAgain} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: row,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  url: { alignItems: 'center', gap: 4 },
  steps: { gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  step: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 6,
  },
  stepDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  webWrap: {
    flex: 1,
    marginHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  panel: {
    marginTop: 10,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 16,
    gap: 12,
  },
  panelRow: { alignItems: 'center', gap: 12 },
  panelIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alert: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.clashSoft, alignItems: 'flex-start' },
  privacy: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  dim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 18,
    paddingBottom: 28,
    maxHeight: '86%',
  },
  okCircle: {
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, flexGrow: 0 },
  listRow: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  info: {
    marginTop: 12,
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'flex-start',
  },
});
