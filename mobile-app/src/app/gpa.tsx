import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Card, CodeBadge, IconButton, ScreenHeader } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { courseHours, getCourseTheme, groupCourses } from '@/lib/courses';
import {
  calcNewCumulativeGpa,
  calcQualityPoints,
  calcSemesterGpa,
  calcTotalHours,
  getDefaultGradePoints,
  type CourseGrade,
  type GPAScale,
  type GradeLetter,
} from '@/lib/gpa';
import { useIsTablet } from '@/lib/layout';
import { goBack } from '@/lib/nav';
import { inputDir, ltr, row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import { useAppData } from '@/store/AppData';

const GRADES: GradeLetter[] = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'DN', ''];

/** Standard grade names for Saudi universities. */
const gpaLabel = (gpa: number, scale: GPAScale): string => {
  const [excellent, veryGood, good, pass] = scale === 5 ? [4.5, 3.75, 2.75, 2] : [3.5, 2.75, 1.75, 1];
  if (gpa >= excellent) return tr('ممتاز', 'Excellent');
  if (gpa >= veryGood) return tr('جيد جداً', 'Very good');
  if (gpa >= good) return tr('جيد', 'Good');
  if (gpa >= pass) return tr('مقبول', 'Pass');
  return tr('أقل من مقبول', 'Below pass');
};

const toNumber = (s: string) => {
  const n = parseFloat(s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  return Number.isFinite(n) ? n : 0;
};

export default function GpaScreen() {
  const { chosen, gpa, setGpa, setGrade } = useAppData();
  const [picking, setPicking] = useState<string | null>(null);
  // Tablets get bigger numbers, rows and text, so the page uses the screen
  const tablet = useIsTablet();
  const t = (phone: number, tab: number) => (tablet ? tab : phone);

  const map = getDefaultGradePoints(gpa.scale);
  const rows: (CourseGrade & { code: string; name: string })[] = useMemo(
    () =>
      // One row per course, even when its نظري and عملي sections are both chosen
      groupCourses(chosen).map((g) => ({
        id: g.code,
        code: g.code,
        name: g.name,
        title: g.name,
        hours: courseHours(g.sections),
        grade: gpa.grades[g.code] ?? '',
      })),
    [chosen, gpa.grades],
  );

  const prevGpa = Math.min(toNumber(gpa.prevGpa), gpa.scale);
  const prevHours = Math.max(0, Math.round(toNumber(gpa.prevHours)));
  const graded = rows.filter((r) => r.grade !== '');
  const semester = calcSemesterGpa(graded, map);
  const cumulative = calcNewCumulativeGpa(prevGpa, prevHours, graded, map);
  const delta = cumulative !== null && prevHours > 0 ? cumulative - prevGpa : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, tablet && styles.contentTablet]}
        keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={tr('حاسبة المعدل', 'GPA calculator')}
          leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />}
          trailing={
            <View
              style={[styles.seg, { flexDirection: row }]}
              accessibilityRole="radiogroup"
              accessibilityLabel={tr('نظام المعدل', 'GPA scale')}>
              {([5, 4] as GPAScale[]).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setGpa({ scale: s })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: gpa.scale === s }}
                  style={[styles.segBtn, tablet && styles.segBtnTablet, gpa.scale === s && styles.segOn]}>
                  <AppText size={t(13, 15)} weight="semibold" color={gpa.scale === s ? '#FFFFFF' : colors.muted}>
                    {tr('من', 'Out of')} {s}
                  </AppText>
                </Pressable>
              ))}
            </View>
          }
        />

        <View style={{ flexDirection: row, gap: t(8, 14) }}>
          <View style={[styles.result, tablet && styles.resultTablet, { backgroundColor: colors.accent }]}>
            <AppText size={t(12, 15)} color="#E6F6FA">
              {tr('معدل الفصل', 'Term GPA')}
            </AppText>
            <AppText size={t(34, 56)} weight="bold" color="#FFFFFF">
              {semester !== null ? semester.toFixed(2) : '—'}
            </AppText>
            <AppText size={t(12, 15)} weight="semibold" color="#CFF1F7">
              {semester !== null ? gpaLabel(semester, gpa.scale) : tr('أدخل درجاتك', 'Enter your grades')}
            </AppText>
          </View>
          <View style={[styles.result, tablet && styles.resultTablet, { backgroundColor: colors.surface }]}>
            <AppText size={t(12, 15)} color={colors.muted}>
              {tr('المعدل التراكمي الجديد', 'New cumulative GPA')}
            </AppText>
            <AppText size={t(34, 56)} weight="bold">
              {cumulative !== null && (prevHours > 0 || graded.length > 0) ? cumulative.toFixed(2) : '—'}
            </AppText>
            <AppText size={t(12, 15)} weight="semibold" color={delta !== null && delta < 0 ? colors.danger : '#15803D'}>
              {cumulative !== null && (prevHours > 0 || graded.length > 0)
                ? `${delta !== null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)} · ` : ''}${gpaLabel(cumulative, gpa.scale)}`
                : tr('أدخل معدلك السابق', 'Enter your previous GPA')}
            </AppText>
          </View>
        </View>

        <Card style={{ flexDirection: row, gap: 10 }}>
          <Field
            label={tr('المعدل التراكمي السابق', 'Previous cumulative GPA')}
            value={gpa.prevGpa}
            onChange={(v) => setGpa({ prevGpa: v })}
            placeholder={tr('مثال: 4.25', 'e.g. 4.25')}
            large={tablet}
          />
          <Field
            label={tr('عدد الساعات السابقة', 'Previous credit hours')}
            value={gpa.prevHours}
            onChange={(v) => setGpa({ prevHours: v })}
            placeholder={tr('مثال: 64', 'e.g. 64')}
            large={tablet}
          />
        </Card>

        <Card>
          <View style={{ flexDirection: row, alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <AppText weight="bold" size={t(15, 18)}>
              {tr('مقررات الفصل الحالي', 'This term’s courses')}
            </AppText>
            <View style={styles.fromTag}>
              <AppText size={t(11, 13)} weight="semibold" color={colors.accentDark}>
                {tr('من جدولك', 'From your timetable')}
              </AppText>
            </View>
          </View>
          {rows.length === 0 ? (
            <AppText size={t(13, 15)} color={colors.muted} style={{ paddingVertical: 12 }}>
              {tr('أضف مقررات إلى جدولك أولاً، وستظهر هنا لتختار درجاتها.', 'Add courses to your timetable first; they show here so you can pick their grades.')}
            </AppText>
          ) : (
            rows.map((r) => {
              const theme = getCourseTheme(r.code);
              return (
                <View key={r.id} style={[styles.courseRow, tablet && styles.courseRowTablet, { flexDirection: row }]}>
                  <CodeBadge code={r.code} bg={theme.bg} fg={theme.text} large={tablet} />
                  <AppText size={t(13, 16)} numberOfLines={1} style={{ flex: 1 }}>
                    {r.name}
                  </AppText>
                  <AppText size={t(12, 14)} color={colors.muted}>
                    {r.hours} {tr('س', 'h')}
                  </AppText>
                  <Pressable
                    onPress={() => setPicking(r.code)}
                    accessibilityRole="button"
                    accessibilityLabel={tr(`درجة ${r.code}`, `Grade for ${r.code}`)}
                    style={[styles.grade, tablet && styles.gradeTablet, { flexDirection: row }]}>
                    <AppText size={t(13, 16)} weight="bold">
                      {r.grade ? ltr(r.grade) : '—'}
                    </AppText>
                    <Icon name="chevronDown" size={t(13, 15)} color={colors.muted} />
                  </Pressable>
                </View>
              );
            })
          )}
          <View style={[styles.totals, { flexDirection: row }]}>
            <AppText size={t(12.5, 15)} color={colors.muted}>
              {tr('ساعات الفصل:', 'Term hours:')}{' '}
              <AppText size={t(12.5, 15)} weight="bold">
                {calcTotalHours(graded)}
              </AppText>
            </AppText>
            <AppText size={t(12.5, 15)} color={colors.muted}>
              {tr('النقاط:', 'Points:')}{' '}
              <AppText size={t(12.5, 15)} weight="bold">
                {calcQualityPoints(graded, map).toFixed(2)}
              </AppText>
            </AppText>
          </View>
        </Card>
      </ScrollView>

      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={styles.dim} onPress={() => setPicking(null)} accessibilityLabel={tr('إغلاق', 'Close')}>
          <Pressable style={styles.picker} onPress={() => {}}>
            <AppText weight="bold" size={16} style={{ marginBottom: 10 }}>
              {tr('اختر الدرجة', 'Choose a grade')} · {picking}
            </AppText>
            <View style={{ flexDirection: row, flexWrap: 'wrap', gap: 8 }}>
              {GRADES.map((g) => {
                const on = picking ? (gpa.grades[picking] ?? '') === g : false;
                return (
                  <Pressable
                    key={g || 'none'}
                    onPress={() => {
                      if (picking) setGrade(picking, g);
                      setPicking(null);
                    }}
                    accessibilityRole="button"
                    style={[styles.gradeOpt, on && styles.gradeOptOn]}>
                    <AppText size={15} weight="bold" color={on ? '#FFFFFF' : colors.text} align="center">
                      {g ? ltr(g) : tr('بدون', 'None')}
                    </AppText>
                    <AppText size={11} color={on ? '#E6F6FA' : colors.muted} align="center">
                      {g ? map[g].toFixed(2) : '—'}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  large,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Tablet size */
  large?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <AppText size={large ? 14 : 12} weight="semibold" color={colors.muted} style={{ marginBottom: large ? 6 : 4 }}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        style={[styles.input, inputDir(), large && styles.inputTablet]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentTablet: { padding: 24, gap: 16 },
  seg: { padding: 3, borderRadius: 12, backgroundColor: colors.surface },
  segBtn: { minHeight: 32, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center' },
  segBtnTablet: { minHeight: 40, paddingHorizontal: 16 },
  segOn: { backgroundColor: colors.accent },
  result: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12 },
  resultTablet: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 22, gap: 4 },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },
  inputTablet: { height: 54, borderRadius: 14, paddingHorizontal: 16, fontSize: 18 },
  fromTag: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.accentSoft },
  courseRow: { alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider },
  courseRowTablet: { gap: 14, paddingVertical: 16 },
  grade: {
    minWidth: 64,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  gradeTablet: { minWidth: 96, height: 46, borderRadius: 12, paddingHorizontal: 12 },
  totals: {
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  dim: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  picker: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 18,
    paddingBottom: 34,
  },
  gradeOpt: {
    width: '22%',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  gradeOptOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
