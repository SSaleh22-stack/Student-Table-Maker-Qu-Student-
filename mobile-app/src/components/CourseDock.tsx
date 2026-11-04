import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/ui';
import { tr } from '@/lib/i18n';
import {
  activityKey,
  activityLabel,
  activityName,
  formatDaysCompact,
  formatTimeRangeShort,
  getCourseTheme,
  slotsOf,
  type CourseGroup,
} from '@/lib/courses';
import { inputDir, padEnd, padStart, pushToEnd, row, scrollStartsAtReadingSide } from '@/lib/rtl';
import { findClash } from '@/lib/schedule';
import { colors, fonts } from '@/lib/theme';
import type { Course } from '@/lib/types';

interface CourseDockProps {
  groups: CourseGroup[];
  chosen: Course[];
  clashCodes: Set<string>;
  /** Course whose sections are shown as cards */
  activeCode: string | null;
  onSelectCourse: (code: string) => void;
  /** Section shown as a preview on the timetable */
  previewId: string | null;
  /** Tap a card: preview it on the timetable (tap again to hide the preview) */
  onPreview: (section: Course) => void;
  /** The card's button: add the section, or remove it when it is already added */
  onToggle: (section: Course) => void;
}

type Tone = 'ok' | 'warn' | 'muted' | 'accent' | 'danger';

/** Section card height: badge, type + days, time, instructor, exam period, clash line and the button. */
const CARD_H = 174;
/** Exam period tag colours (indigo, so it stands apart from the status badge). */
const EXAM_FG = '#3730A3';
const EXAM_BG = '#EEF2FF';

/**
 * Under the timetable on phones: a row of course chips, then cards for the chosen
 * course's sections. Everything stays on one screen with the timetable.
 */
export function CourseDock({
  groups,
  chosen,
  clashCodes,
  activeCode,
  onSelectCourse,
  previewId,
  onPreview,
  onToggle,
}: CourseDockProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const chosenIds = useMemo(() => new Set(chosen.map((c) => c.id)), [chosen]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.code.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        g.sections.some((s) => (s.instructor ?? '').toLowerCase().includes(q)),
    );
  }, [groups, query]);

  const active = groups.find((g) => g.code === activeCode) ?? null;
  const activities = active ? [...new Set(active.sections.map(activityKey).filter(Boolean))].map(activityName) : [];

  /** Short status on a chip: what is added, else how many sections are open (the portal's wording). */
  const chipStatus = (g: CourseGroup): { text: string; tone: Tone } => {
    const picked = g.sections.filter((s) => chosenIds.has(s.id));
    if (picked.length > 0) {
      if (clashCodes.has(g.code)) return { text: tr('تعارض', 'Clash'), tone: 'warn' };
      return {
        text: `✓ ${picked.length <= 2 ? picked.map((p) => p.section).join(tr('، ', ', ')) : picked.length}`,
        tone: 'ok',
      };
    }
    if (!g.sections.some((s) => slotsOf(s).length > 0)) return { text: tr('بلا وقت', 'No time'), tone: 'muted' };
    // Open sections that fit the timetable; if every open one clashes, say so.
    const open = g.sections.filter((s) => s.status !== 'closed');
    const fitting = open.filter((s) => !findClash(s, chosen)).length;
    if (fitting > 0) return { text: tr(`${fitting} مفتوحة`, `${fitting} open`), tone: 'accent' };
    return open.length > 0 ? { text: tr('تعارض', 'Clash'), tone: 'warn' } : { text: tr('مغلقة', 'Closed'), tone: 'danger' };
  };

  // When rows are reversed by hand (Arabic in Expo Go / web, English in RTL release builds),
  // the reading start of a horizontal scroll is at its far end. Scroll the selected chip into view, and start the
  // cards at the right end.
  const chipsRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const cardsRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const chipsShownFor = useRef<string | null>(null);
  const cardsStartedFor = useRef<string | null>(null);
  const activeChip = useRef<{ code: string; x: number; w: number } | null>(null);
  const chipsW = useRef(0);
  const chipsViewW = useRef(0);

  /** Once the chip row has its size: bring the selected chip into view, else start at the right end. */
  const startChips = () => {
    if (scrollStartsAtReadingSide || !chipsW.current || !chipsViewW.current || !activeCode || chipsShownFor.current === activeCode)
      return;
    const chip = activeChip.current;
    if (chip && chip.code === activeCode) {
      chipsShownFor.current = activeCode;
      // Right edge of the chip a little inside the screen's right edge.
      const view = chipsViewW.current;
      const x = Math.min(Math.max(0, chip.x + chip.w + 12 - view), Math.max(0, chipsW.current - view));
      chipsRef.current?.scrollTo({ x, animated: false });
    } else {
      chipsRef.current?.scrollToEnd({ animated: false });
    }
  };

  return (
    <View style={styles.dock}>
      {searching ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tr('ابحث بالرمز أو الاسم أو المدرّس', 'Search by code, name or instructor')}
          placeholderTextColor={colors.placeholder}
          autoFocus
          style={[styles.search, inputDir()]}
          accessibilityLabel={tr('بحث في المقررات', 'Search courses')}
        />
      ) : null}

      {/* Search stays put at the start; the course chips scroll beside it. */}
      <View style={[styles.chipRow, { flexDirection: row }, padStart(14)]}>
        <Pressable
          onPress={() => {
            if (searching) setQuery('');
            setSearching((on) => !on);
          }}
          accessibilityRole="button"
          accessibilityLabel={searching ? tr('إغلاق البحث', 'Close search') : tr('بحث في المقررات', 'Search courses')}
          style={[styles.searchBtn, searching && styles.searchOn]}>
          <Icon name={searching ? 'x' : 'search'} size={16} color={searching ? colors.accent : colors.muted} />
        </Pressable>
        <ScrollView
          ref={chipsRef}
          style={{ flex: 1 }}
          onLayout={(e) => {
            chipsViewW.current = e.nativeEvent.layout.width;
            startChips();
          }}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.chips, { flexDirection: row }, padEnd(14)]}
          onContentSizeChange={(w) => {
            chipsW.current = w;
            startChips();
          }}
          accessibilityRole="tablist"
          accessibilityLabel={tr('المقررات المطروحة', 'Offered courses')}>
          {visible.length === 0 ? (
            <AppText size={12} color={colors.muted} style={{ paddingVertical: 8 }}>
              {tr('لا توجد مقررات تطابق البحث', 'No courses match your search')}
            </AppText>
          ) : null}
          {visible.map((g) => {
            const on = g.code === activeCode;
            const status = chipStatus(g);
            const statusColor = on
              ? '#CFEAF0'
              : status.tone === 'ok'
                ? colors.success
                : status.tone === 'warn'
                  ? colors.clash
                  : status.tone === 'accent'
                    ? colors.accentDark
                    : status.tone === 'danger'
                      ? colors.danger
                      : colors.muted;
            return (
              <Pressable
                key={g.code}
                onPress={() => onSelectCourse(g.code)}
                onLayout={
                  on
                    ? (e) => {
                        activeChip.current = { code: g.code, x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
                        startChips();
                      }
                    : undefined
                }
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${g.code} ${g.name}${tr('، ', ', ')}${status.text}`}
                style={[styles.chip, { flexDirection: row }, on && styles.chipOn]}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: on ? '#FFFFFF' : getCourseTheme(g.code).bar,
                    },
                  ]}
                />
                <AppText size={12.5} weight="bold" color={on ? '#FFFFFF' : colors.text}>
                  {g.code}
                </AppText>
                <AppText size={11} weight="semibold" color={statusColor}>
                  {status.text}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {active ? (
        <>
          <View style={[styles.courseLine, { flexDirection: row }]}>
            <AppText size={13} weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {active.name}
            </AppText>
            {activities.length > 1 ? (
              <AppText size={11.5} color={colors.accentDark} numberOfLines={1}>
                · {tr('يلزمك شعبة من كل نوع:', 'You need one section of each type:')} {activities.join(' + ')}
              </AppText>
            ) : null}
          </View>
          <ScrollView
            ref={cardsRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.cards, { flexDirection: row }]}
            onContentSizeChange={() => {
              if (!scrollStartsAtReadingSide && cardsStartedFor.current !== active.code) {
                cardsStartedFor.current = active.code;
                cardsRef.current?.scrollToEnd({ animated: false });
              }
            }}>
            {active.sections.map((s) => (
              <SectionCard
                key={s.id}
                section={s}
                chosen={chosenIds.has(s.id)}
                previewed={previewId === s.id}
                clash={findClash(s, chosen)}
                examClash={examPeriodClash(s, chosen)}
                onPreview={() => onPreview(s)}
                onToggle={() => onToggle(s)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

/** A chosen section of another course with the same final-exam period, if any. */
const examPeriodClash = (section: Course, chosen: Course[]): Course | null => {
  const period = section.finalExam?.date;
  if (!period) return null;
  return chosen.find((c) => c.code !== section.code && c.finalExam?.date === period) ?? null;
};

function SectionCard({
  section,
  chosen,
  previewed,
  clash,
  examClash,
  onPreview,
  onToggle,
}: {
  section: Course;
  chosen: boolean;
  previewed: boolean;
  clash: Course | null;
  examClash: Course | null;
  onPreview: () => void;
  onToggle: () => void;
}) {
  const slots = slotsOf(section);
  const activity = activityLabel(section);
  const closed = section.status === 'closed';
  const period = section.finalExam?.date;
  // The portal's status words (مفتوحة / مغلقة); an open section that clashes says تعارض instead.
  const badge: { label: string; tone: Tone } | null = chosen
    ? { label: tr('مضافة', 'Added'), tone: 'accent' }
    : closed
      ? { label: tr('مغلقة', 'Closed'), tone: 'danger' }
      : clash
        ? { label: tr('تعارض', 'Clash'), tone: 'warn' }
        : section.status === 'open'
          ? { label: tr('مفتوحة', 'Open'), tone: 'ok' }
          : null;

  // Two separate tap areas (a button can't sit inside another button on web):
  // the card's body previews the section, the button adds or removes it.
  return (
    <View
      style={[
        styles.card,
        chosen && styles.cardChosen,
        previewed && (clash ? styles.cardPreviewClash : styles.cardPreview),
        closed && !chosen && { opacity: 0.8 },
      ]}>
      <Pressable
        onPress={chosen || slots.length === 0 ? undefined : onPreview}
        accessibilityRole="button"
        accessibilityState={{ selected: previewed }}
        accessibilityLabel={[
          tr(`الشعبة ${section.section}`, `Section ${section.section}`),
          activity,
          badge?.label,
          period ? tr(`فترة الاختبار ${period}`, `Exam period ${period}`) : null,
          clash && !chosen ? tr(`تتعارض مع ${clash.code}`, `Clashes with ${clash.code}`) : null,
        ]
          .filter(Boolean)
          .join(tr('، ', ', '))}
        accessibilityHint={chosen || slots.length === 0 ? undefined : tr('اضغط لمعاينتها في الجدول', 'Tap to preview it in the timetable')}
        style={styles.cardBody}>
        <View style={[styles.cardTop, { flexDirection: row }]}>
          <AppText size={13.5} weight="bold" style={styles.tight}>
            {tr('الشعبة', 'Section')} {section.section}
          </AppText>
          {badge ? (
            <View style={pushToEnd}>
              <Tag label={badge.label} tone={badge.tone} />
            </View>
          ) : null}
        </View>
        {/* Two things per line, so every detail fits the card: days + time, then type + instructor. */}
        {slots.length > 0 ? (
          slots.map((s, i) => (
            <AppText key={i} size={11.5} weight="semibold" style={styles.tight} numberOfLines={1}>
              {formatDaysCompact(s.days)}{' '}
              <AppText size={11.5} weight="bold" color={colors.accentDark} style={styles.tight}>
                {formatTimeRangeShort(s.startTime, s.endTime)}
              </AppText>
            </AppText>
          ))
        ) : (
          <AppText size={11.5} color={colors.muted} style={styles.tight} numberOfLines={1}>
            {tr('بدون وقت محدد', 'No set time')}
          </AppText>
        )}
        {activity || section.instructor ? (
          <AppText size={11} color={colors.muted} numberOfLines={1} style={styles.tight}>
            {activity ? (
              <AppText size={11} weight="semibold" color={colors.text} style={styles.tight}>
                {activity}
              </AppText>
            ) : null}
            {activity && section.instructor ? ' · ' : ''}
            {section.instructor ?? ''}
          </AppText>
        ) : null}
        {/* The exam period matters when choosing: its own tag, orange when it matches an added course. */}
        {period ? (
          <View style={[styles.exam, { flexDirection: row }, examClash ? styles.examClash : null]}>
            <Icon name="fileText" size={11} color={examClash ? colors.clash : EXAM_FG} />
            <AppText
              size={11}
              weight="bold"
              color={examClash ? colors.clash : EXAM_FG}
              numberOfLines={1}
              style={{ flexShrink: 1 }}>
              {tr('فترة الاختبار', 'Exam period')} {period}
              {examClash ? ` · ${tr('مع', 'with')} ${examClash.code}` : ''}
            </AppText>
          </View>
        ) : null}
        {clash && !chosen ? (
          <AppText size={11} weight="semibold" color={colors.clash} numberOfLines={1} style={styles.tight}>
            {tr('تتعارض مع', 'Clashes with')} {clash.code} · {clash.section}
          </AppText>
        ) : null}
      </Pressable>
      <View style={styles.btnWrap}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={chosen ? tr(`إزالة الشعبة ${section.section}`, `Remove section ${section.section}`) : tr(`إضافة الشعبة ${section.section}`, `Add section ${section.section}`)}
          style={({ pressed }) => [
            styles.cardBtn,
            { flexDirection: row },
            chosen ? styles.cardBtnRemove : previewed ? styles.cardBtnPrimary : null,
            pressed && { opacity: 0.8 },
          ]}>
          <Icon
            name={chosen ? 'minus' : 'plus'}
            size={14}
            color={chosen ? colors.danger : previewed ? '#FFFFFF' : colors.accent}
          />
          <AppText size={12.5} weight="bold" color={chosen ? colors.danger : previewed ? '#FFFFFF' : colors.accent}>
            {chosen ? tr('إزالة', 'Remove') : tr('إضافة', 'Add')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { gap: 6 },
  searchBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchOn: { borderColor: colors.accent },
  search: {
    marginHorizontal: 16,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  chipRow: { alignItems: 'center', gap: 6 },
  chips: { gap: 6 },
  chip: {
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dot: { width: 8, height: 8, borderRadius: 4 },
  courseLine: { alignItems: 'center', gap: 4, paddingHorizontal: 18 },
  cards: { gap: 8, paddingHorizontal: 14, paddingBottom: 2 },
  // Fixed size, so the course area (and the timetable above it) never changes height when a
  // section is added, removed or previewed, or another course is picked.
  card: {
    width: 150,
    height: CARD_H,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  cardBody: { flex: 1, gap: 1, overflow: 'hidden' },
  cardChosen: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentTint,
  },
  cardPreview: {
    borderColor: colors.accent,
    backgroundColor: '#F3FAFC',
  },
  cardPreviewClash: {
    borderColor: '#C2410C',
    backgroundColor: '#FFFBF6',
  },
  cardTop: { alignItems: 'center', gap: 6, marginBottom: 2 },
  tight: { lineHeight: 17 },
  exam: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    marginBottom: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: EXAM_BG,
  },
  examClash: { backgroundColor: colors.clashSoft },
  btnWrap: { paddingTop: 5 },
  cardBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 32,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
  },
  cardBtnPrimary: { backgroundColor: colors.accent },
  cardBtnRemove: { backgroundColor: colors.dangerSoft },
});
