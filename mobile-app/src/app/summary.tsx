import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { SectionClashNotes } from '@/components/ClashNotes';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, Card, IconButton, ScreenHeader } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { activityLabel, courseHours, formatExam, formatSchedule, getCourseTheme, groupCourses } from '@/lib/courses';
import { row } from '@/lib/rtl';
import { clashingCodes, clashPairs, examClashes } from '@/lib/schedule';
import { goBack } from '@/lib/nav';
import { colors } from '@/lib/theme';
import { useAppData } from '@/store/AppData';

export default function SummaryScreen() {
  const { chosen } = useAppData();
  const clashes = useMemo(() => clashingCodes(chosen), [chosen]);
  const pairs = useMemo(() => clashPairs(chosen), [chosen]);
  const exams = useMemo(() => examClashes(chosen), [chosen]);
  const courses = useMemo(() => groupCourses(chosen), [chosen]);
  const hours = courses.reduce((n, g) => n + courseHours(g.sections), 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={tr('ملخص الجدول', 'Timetable summary')} leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />} />
        <View style={{ flexDirection: row, gap: 8 }}>
          <Stat value={courses.length} label={tr('مقررات', 'Courses')} />
          <Stat value={hours} label={tr('ساعة معتمدة', 'Credit hours')} />
          <Stat value={clashes.size} label={tr('تعارض', 'Clashes')} good={clashes.size === 0} />
        </View>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {chosen.length === 0 ? (
            <AppText size={13} color={colors.muted} align="center" style={{ padding: 24 }}>
              {tr('لم تُضف أي مقرر إلى جدولك بعد.', 'You haven’t added any course to your timetable yet.')}
            </AppText>
          ) : (
            chosen.map((c, i) => {
              const theme = getCourseTheme(c.code);
              const exam = formatExam(c.finalExam);
              return (
                <View key={c.id} style={[styles.row, { flexDirection: row }, i > 0 && styles.divider]}>
                  <View style={[styles.bar, { backgroundColor: theme.bar }]} />
                  <View style={{ flex: 1 }}>
                    <AppText size={13.5} weight="semibold" numberOfLines={1}>
                      {c.code} · {c.name}
                    </AppText>
                    <AppText size={11.5} color={colors.muted}>
                      {tr('الشعبة', 'Section')} {c.section}
                      {activityLabel(c) ? ` (${activityLabel(c)})` : ''} · {formatSchedule(c)}
                    </AppText>
                    {c.location || c.instructor ? (
                      <AppText size={11.5} color={colors.muted} numberOfLines={1}>
                        {[c.location, c.instructor].filter(Boolean).join(' · ')}
                      </AppText>
                    ) : null}
                    <SectionClashNotes section={c} pairs={pairs} exams={exams} />
                  </View>
                  <View style={styles.exam}>
                    <AppText size={10.5} color={colors.muted} align="center">
                      {tr('الاختبار', 'Exam')}
                    </AppText>
                    <AppText size={12} weight="semibold" align="center">
                      {exam ?? '—'}
                    </AppText>
                  </View>
                </View>
              );
            })
          )}
        </Card>

        {chosen.length > 0 ? (
          <Button label={tr('تصدير ومشاركة', 'Export and share')} icon="share" onPress={() => router.push('/export')} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label, good }: { value: number; label: string; good?: boolean }) {
  return (
    <Card style={{ flex: 1, paddingVertical: 10 }}>
      <AppText size={24} weight="bold" color={good ? '#15803D' : colors.text}>
        {value}
      </AppText>
      <AppText size={12} color={colors.muted}>
        {label}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  row: { gap: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'stretch' },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  bar: { width: 4, borderRadius: 2 },
  exam: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
});
