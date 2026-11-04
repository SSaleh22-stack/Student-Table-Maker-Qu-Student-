import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, Card, CodeBadge, IconButton, ScreenHeader, Tag } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { calculateAbsence, type AbsenceResult } from '@/lib/absence';
import { courseWeeklyHours, getCourseTheme, groupCourses } from '@/lib/courses';
import { goBack } from '@/lib/nav';
import { fromStart, inputDir, ltr, row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import { useAppData } from '@/store/AppData';

const LEVEL = {
  safe: {
    get label() {
      return tr('آمن', 'Safe');
    },
    bg: colors.successSoft, fg: colors.success, bar: colors.successBar },
  warning: {
    get label() {
      return tr('تحذير', 'Warning');
    },
    bg: colors.warningSoft, fg: colors.warning, bar: colors.warningBar },
  danger: {
    get label() {
      return tr('خطر', 'Danger');
    },
    bg: colors.dangerSoft, fg: colors.danger, bar: colors.dangerBar },
  exceeded: {
    get label() {
      return tr('تم تجاوز الحد', 'Limit exceeded');
    },
    bg: '#F9D8D5', fg: '#7A1F1A', bar: '#7A1F1A' },
} as const;

const ORDER = { exceeded: 0, danger: 1, warning: 2, safe: 3 } as const;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Most at risk first; courses without weekly hours last. */
const byRisk = (a: { result: AbsenceResult | null }, b: { result: AbsenceResult | null }) => {
  if (!a.result) return 1;
  if (!b.result) return -1;
  return (
    ORDER[a.result.warningLevel] - ORDER[b.result.warningLevel] || b.result.absencePercent - a.result.absencePercent
  );
};

/** A course on this screen: from the timetable, or added here by hand. */
interface Entry {
  /** Key in the saved absence data: the course code, or the manual course's id */
  key: string;
  code: string;
  name: string;
  manual: boolean;
}

export default function AbsenceScreen() {
  const { chosen, absence, setAbsence, setAbsent, setWeeklyOverride, addManualAbsence, removeManualAbsence } =
    useAppData();
  /** Show only courses at this level (tap a counter; tap it again for all) */
  const [only, setOnly] = useState<keyof typeof LEVEL | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => {
    const result = (perWeek: number, absent: number): AbsenceResult | null =>
      perWeek > 0
        ? calculateAbsence({
            studyWeeks: absence.studyWeeks,
            hoursPerWeek: perWeek,
            hoursAbsent: absent,
            maxAbsencePercent: absence.maxPercent,
          })
        : null;
    // One card per timetable course; its weekly hours add up its activities (نظري + عملي …)
    const fromTimetable = groupCourses(chosen).map((g) => {
      const entry: Entry = { key: g.code, code: g.code, name: g.name, manual: false };
      const perWeek = absence.weeklyOverride[g.code] ?? courseWeeklyHours(g.sections);
      const absent = absence.absent[g.code] ?? 0;
      return { entry, perWeek, absent, result: result(perWeek, absent) };
    });
    // Courses added by hand on this screen
    const manual = absence.manual.map((m) => {
      const entry: Entry = { key: m.id, code: m.code, name: m.name, manual: true };
      const perWeek = absence.weeklyOverride[m.id] ?? 0;
      const absent = absence.absent[m.id] ?? 0;
      return { entry, perWeek, absent, result: result(perWeek, absent) };
    });
    return [...fromTimetable, ...manual];
  }, [chosen, absence]);

  // Sorted by risk when a course first shows up, then each card keeps its place:
  // re-sorting on every tap moved the card out from under the user's finger.
  const [order, setOrder] = useState<string[]>([]);
  const fresh = list.filter((it) => !order.includes(it.entry.key));
  if (fresh.length) setOrder([...[...fresh].sort(byRisk).map((it) => it.entry.key), ...order]);
  const items = [...list].sort((a, b) => order.indexOf(a.entry.key) - order.indexOf(b.entry.key));

  const counts = { safe: 0, warning: 0, danger: 0, exceeded: 0 };
  items.forEach((it) => it.result && counts[it.result.warningLevel]++);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      {/* Pinned: title, the two settings, and the counters (which filter the list). */}
      <View style={styles.pinned}>
        <ScreenHeader title={tr('حاسبة الغياب', 'Absence calculator')} leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />} />
        <View style={[styles.settings, { flexDirection: row }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText size={12} weight="semibold" color={colors.muted}>
              {tr('أسابيع الدراسة', 'Study weeks')}
            </AppText>
            <Stepper
              label={tr('أسابيع الدراسة', 'Study weeks')}
              value={absence.studyWeeks}
              onChange={(v) => setAbsence({ studyWeeks: Math.min(30, Math.max(1, v)) })}
              compact
              wide
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText size={12} weight="semibold" color={colors.muted}>
              {tr('الغياب المسموح', 'Allowed absence')} {ltr('%')}
            </AppText>
            <Stepper
              label={tr('نسبة الغياب المسموحة', 'Allowed absence percentage')}
              value={absence.maxPercent}
              onChange={(v) => setAbsence({ maxPercent: Math.min(50, Math.max(15, v)) })}
              compact
              wide
            />
          </View>
        </View>
        {items.length > 0 ? (
          <View style={{ flexDirection: row, gap: 6, flexWrap: 'wrap' }} accessibilityRole="tablist">
            {(['safe', 'warning', 'danger', 'exceeded'] as const)
              .filter((k) => k !== 'exceeded' || counts.exceeded > 0)
              .map((k) => {
                const on = only === k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => setOnly(on ? null : k)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${counts[k]} ${LEVEL[k].label}`}
                    style={[
                      styles.count,
                      { flexDirection: row },
                      on && { backgroundColor: LEVEL[k].bg, borderColor: LEVEL[k].bar },
                    ]}>
                    <View style={[styles.dot, { backgroundColor: LEVEL[k].bar }]} />
                    <AppText size={12.5} weight="semibold" color={on ? LEVEL[k].fg : colors.text}>
                      {counts[k]} {LEVEL[k].label}
                    </AppText>
                  </Pressable>
                );
              })}
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {items.length === 0 ? (
          <Card>
            <AppText size={13} color={colors.muted}>
              {tr('مقررات جدولك تظهر هنا تلقائياً. ويمكنك أيضاً إضافة أي مقرر يدوياً لمتابعة غيابه.', 'Your timetable’s courses show here automatically. You can also add any course by hand to track its absences.')}
            </AppText>
          </Card>
        ) : null}

        {adding ? (
          <AddCourseForm
            onCancel={() => setAdding(false)}
            onAdd={(course) => {
              addManualAbsence(course);
              setAdding(false);
            }}
          />
        ) : (
          <Button label={tr('إضافة مقرر يدوياً', 'Add a course by hand')} icon="plus" variant="soft" onPress={() => setAdding(true)} />
        )}

        {only && !items.some((it) => it.result?.warningLevel === only) ? (
          <Card>
            <AppText size={13} color={colors.muted}>
              {tr(`لا توجد مقررات بحالة «${LEVEL[only].label}».`, `No courses with status “${LEVEL[only].label}”.`)}
            </AppText>
          </Card>
        ) : null}

        {items
          .filter((it) => !only || it.result?.warningLevel === only)
          .map(({ entry, perWeek, absent, result }) => (
            <CourseCard
              key={entry.key}
              entry={entry}
              perWeek={perWeek}
              absent={absent}
              result={result}
              studyWeeks={absence.studyWeeks}
              onAbsent={(n) => setAbsent(entry.key, n)}
              onPerWeek={(n) => setWeeklyOverride(entry.key, n)}
              onRemove={entry.manual ? () => removeManualAbsence(entry.key) : undefined}
            />
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Name, optional code and weekly hours for a course that isn't in the timetable. */
function AddCourseForm({
  onAdd,
  onCancel,
}: {
  onAdd: (course: { code: string; name: string; hoursPerWeek: number }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [hours, setHours] = useState(3);
  const ready = name.trim().length > 0 && hours > 0;
  return (
    <Card style={{ gap: 10 }}>
      <AppText size={15} weight="bold">
        {tr('إضافة مقرر لمتابعة الغياب', 'Add a course to track absences')}
      </AppText>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={tr('اسم المقرر (مطلوب)', 'Course name (required)')}
        placeholderTextColor={colors.placeholder}
        style={[styles.input, inputDir()]}
        accessibilityLabel={tr('اسم المقرر', 'Course name')}
        autoFocus
      />
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder={tr('رمز المقرر (اختياري)، مثل CS101', 'Course code (optional), e.g. CS101')}
        placeholderTextColor={colors.placeholder}
        style={[styles.input, inputDir()]}
        accessibilityLabel={tr('رمز المقرر', 'Course code')}
        autoCapitalize="characters"
      />
      <Stepper label={tr('ساعات المحاضرات في الأسبوع', 'Class hours per week')} value={hours} onChange={(n) => setHours(Math.min(30, n))} />
      <View style={{ flexDirection: row, gap: 8 }}>
        <Button
          label={tr('إضافة', 'Add')}
          icon="plus"
          disabled={!ready}
          onPress={() => onAdd({ code, name, hoursPerWeek: hours })}
          style={{ flex: 1 }}
        />
        <Button label={tr('إلغاء', 'Cancel')} variant="outline" onPress={onCancel} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function CourseCard({
  entry,
  perWeek,
  absent,
  result,
  studyWeeks,
  onAbsent,
  onPerWeek,
  onRemove,
}: {
  entry: Entry;
  perWeek: number;
  absent: number;
  result: AbsenceResult | null;
  studyWeeks: number;
  onAbsent: (n: number) => void;
  onPerWeek: (n: number) => void;
  /** Only for courses added by hand */
  onRemove?: () => void;
}) {
  const theme = getCourseTheme(entry.code || entry.name);
  const title = (
    <View style={{ flexDirection: row, alignItems: 'center', gap: 8 }}>
      {entry.code ? <CodeBadge code={entry.code} bg={theme.bg} fg={theme.text} /> : null}
      <AppText size={13.5} weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
        {entry.name}
      </AppText>
      {entry.manual ? <Tag label={tr('يدوي', 'Manual')} tone="muted" /> : null}
      {onRemove ? (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={tr(`حذف ${entry.name}`, `Delete ${entry.name}`)} hitSlop={8}>
          <Icon name="trash" size={16} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );

  if (!result) {
    return (
      <Card style={styles.noTimeCard}>
        {title}
        <AppText size={12.5} color={colors.muted} style={{ marginTop: 6 }}>
          {entry.manual
            ? tr('حدّد ساعاته الأسبوعية لحساب الغياب.', 'Set its weekly hours to calculate absences.')
            : tr(
                'ليس له وقت محدد في الجدول. حدّد ساعاته الأسبوعية لحساب الغياب.',
                'It has no set time in the timetable. Set its weekly hours to calculate absences.',
              )}
        </AppText>
        <View style={{ marginTop: 8 }}>
          <Stepper label={tr('ساعات في الأسبوع', 'Hours per week')} value={perWeek} onChange={onPerWeek} />
        </View>
      </Card>
    );
  }

  const level = LEVEL[result.warningLevel];
  const maxHours = result.totalHours > 0 ? result.hoursRemaining + absent : 0;
  const fill = maxHours > 0 ? Math.min(1, absent / maxHours) : 0;
  const pct = `${Math.round(fill * 100)}%` as const;

  return (
    <Card
      style={[
        result.warningLevel === 'danger' || result.warningLevel === 'exceeded' ? styles.dangerCard : null,
        { gap: 8 },
      ]}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>{title}</View>
        <View style={[styles.badge, { backgroundColor: level.bg }]}>
          <AppText size={11.5} weight="bold" color={level.fg}>
            {level.label}
          </AppText>
        </View>
      </View>
      <View
        style={styles.meter}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(fill * 100) }}>
        <View
          style={[
            styles.meterFill,
            { width: pct, backgroundColor: level.bar, ...fromStart(0) },
          ]}
        />
      </View>
      <View style={{ flexDirection: row, alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <AppText size={12} color={colors.muted}>
            {tr('غياب', 'Absent')}{' '}
            <AppText size={12} weight="bold">
              {fmt(absent)}
            </AppText>{' '}
            {tr(`من ${fmt(result.totalHours)} ساعة`, `of ${fmt(result.totalHours)} hours`)} · {ltr(`${fmt(result.absencePercent)}%`)}
          </AppText>
          <AppText size={12} color={colors.muted}>
            {result.canStillAttend ? (
              <>
                {tr('متبقٍ لك', 'You have')}{' '}
                <AppText size={12} weight="bold">
                  {fmt(result.hoursRemaining)} {tr('ساعة', 'hours left')}
                </AppText>
              </>
            ) : (
              tr('تجاوزت الحد المسموح', 'You passed the allowed limit')
            )}
            {` · ${fmt(perWeek)} ${tr('س/أسبوع', 'h/week')} × ${studyWeeks}`}
          </AppText>
        </View>
        <Stepper value={absent} onChange={onAbsent} label={tr(`ساعات الغياب في ${entry.code || entry.name}`, `Hours absent in ${entry.code || entry.name}`)} compact />
      </View>
    </Card>
  );
}

function Stepper({
  value,
  onChange,
  label,
  compact,
  wide,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  compact?: boolean;
  /** Fill the available width (the number sits in the middle) */
  wide?: boolean;
}) {
  return (
    <View style={[styles.stepper, { flexDirection: row }]} accessibilityLabel={label}>
      {!compact ? (
        <AppText size={12.5} color={colors.muted} style={{ flex: 1, paddingHorizontal: 10 }}>
          {label}
        </AppText>
      ) : null}
      <Pressable
        onPress={() => onChange(value + 1)}
        accessibilityRole="button"
        accessibilityLabel={tr('زيادة', 'Increase')}
        style={styles.stepBtn}>
        <Icon name="plus" size={14} />
      </Pressable>
      <AppText size={14} weight="bold" align="center" style={wide ? { flex: 1 } : { minWidth: 30 }}>
        {fmt(value)}
      </AppText>
      <Pressable
        onPress={() => onChange(Math.max(0, value - 1))}
        accessibilityRole="button"
        accessibilityLabel={tr('إنقاص', 'Decrease')}
        style={styles.stepBtn}>
        <Icon name="minus" size={14} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pinned: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 10,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settings: { gap: 10 },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  count: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { paddingHorizontal: 9, paddingVertical: 1, borderRadius: 999 },
  meter: { height: 8, borderRadius: 4, backgroundColor: '#E9EEF3', overflow: 'hidden' },
  meterFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 4 },
  stepper: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  stepBtn: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg },
  dangerCard: { borderWidth: 1.5, borderColor: '#F5B4B0' },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  noTimeCard: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD8E3', backgroundColor: '#F7F9FB' },
});
