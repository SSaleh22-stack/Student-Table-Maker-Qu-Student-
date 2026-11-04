import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Chip, CodeBadge, Tag } from '@/components/ui';
import { tr } from '@/lib/i18n';
import {
  activityKey,
  activityLabel,
  activityName,
  courseHours,
  formatDaysCompact,
  formatExam,
  formatTimeRange,
  formatSchedule,
  getCourseTheme,
  hoursLabel,
  sectionsLabel,
  slotsOf,
  type CourseGroup,
} from '@/lib/courses';
import { inputDir, pushToEnd, row } from '@/lib/rtl';
import { findClash } from '@/lib/schedule';
import { colors, fonts } from '@/lib/theme';
import type { Course } from '@/lib/types';

type Filter = 'all' | 'added' | 'open';

interface CoursePanelProps {
  groups: CourseGroup[];
  chosen: Course[];
  clashCodes: Set<string>;
  /** Tap a section card: add it (or switch within its activity), or remove it if already chosen. */
  onTapSection: (section: Course) => void;
  /** Wraps the title and filters (the screen makes them draggable). */
  wrapTop?: (node: ReactNode) => ReactNode;
}

/** Activity names of a course in the portal's order, e.g. ["نظري", "عملي"]. */
const activitiesOf = (sections: Course[]) => [...new Set(sections.map(activityKey).filter(Boolean))].map(activityName);

/** The list of offered courses under the timetable. Tap a section to add it; tap again to remove it. */
export function CoursePanel({ groups, chosen, clashCodes, onTapSection, wrapTop = (node) => node }: CoursePanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [detailed, setDetailed] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Two cards per row, or one when the list is narrow (iPad held upright).
  const [width, setWidth] = useState(0);
  const oneColumn = width > 0 && (width - 28) / 2 < 128;

  const chosenIds = useMemo(() => new Set(chosen.map((c) => c.id)), [chosen]);
  const chosenCodes = useMemo(() => new Set(chosen.map((c) => c.code)), [chosen]);
  const sectionCount = groups.reduce((n, g) => n + g.sections.length, 0);
  const openCount = groups.reduce((n, g) => n + g.sections.filter((s) => s.status !== 'closed').length, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        sections: filter === 'open' ? g.sections.filter((s) => s.status !== 'closed') : g.sections,
      }))
      .filter((g) => g.sections.length > 0)
      .filter((g) => (filter === 'added' ? chosenCodes.has(g.code) : true))
      .filter(
        (g) =>
          !q ||
          g.code.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q) ||
          g.sections.some((s) => (s.instructor ?? '').toLowerCase().includes(q) || s.section.includes(q))
      );
  }, [groups, filter, query, chosenCodes]);

  const toggleGroup = (code: string) => setOpen((cur) => (cur === code ? null : code));

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {wrapTop(
        <View>
          <View style={[styles.head, { flexDirection: row }]}>
            <AppText weight="bold" size={16}>
              {tr('المقررات المطروحة', 'Offered courses')}
            </AppText>
            <AppText size={12} color={colors.muted}>
              {sectionCount} {tr('شعبة', 'sections')}
            </AppText>
            <View style={[styles.seg, pushToEnd, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={tr('طريقة العرض', 'View')}>
              <Pressable
                onPress={() => setDetailed(true)}
                accessibilityRole="radio"
                accessibilityState={{ checked: detailed }}
                accessibilityLabel={tr('مفصّل', 'Detailed')}
                style={[styles.segBtn, detailed && styles.segOn]}>
                <Icon name="list" size={17} color={detailed ? colors.accent : colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => setDetailed(false)}
                accessibilityRole="radio"
                accessibilityState={{ checked: !detailed }}
                accessibilityLabel={tr('مضغوط', 'Compact')}
                style={[styles.segBtn, !detailed && styles.segOn]}>
                <Icon name="grid" size={17} color={!detailed ? colors.accent : colors.muted} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.chips, { flexDirection: row }]}>
            <Chip label={`${tr('الكل', 'All')} · ${sectionCount}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label={`${tr('المضافة', 'Added')} · ${chosenCodes.size}`} selected={filter === 'added'} onPress={() => setFilter('added')} />
            <Chip label={`${tr('المفتوحة', 'Open')} · ${openCount}`} selected={filter === 'open'} onPress={() => setFilter('open')} />
            <Pressable
              onPress={() => {
                setSearching((s) => !s);
                if (searching) setQuery('');
              }}
              accessibilityRole="button"
              accessibilityLabel={tr('بحث', 'Search')}
              style={[styles.searchBtn, pushToEnd, searching && { borderColor: colors.accent }]}>
              <Icon name={searching ? 'x' : 'search'} size={16} color={colors.muted} />
            </Pressable>
          </View>

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

          {chosen.length === 0 ? (
            <AppText size={12} color={colors.muted} style={{ marginBottom: 8 }}>
              {tr('اضغط على شعبة لإضافتها إلى جدولك، واضغط عليها مرة أخرى لإزالتها.', 'Tap a section to add it to your timetable, and tap it again to remove it.')}
            </AppText>
          ) : null}
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(g) => g.code}
        contentContainerStyle={{ gap: 8, paddingBottom: 110 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <AppText size={13} color={colors.muted} align="center" style={{ paddingVertical: 24 }}>
            {tr('لا توجد مقررات تطابق البحث', 'No courses match your search')}
          </AppText>
        }
        renderItem={({ item: g }) => {
          const picked = chosen.filter((c) => c.code === g.code);
          const isOpen = open === g.code;
          const theme = getCourseTheme(g.code);
          const hours = courseHours(g.sections);
          const activities = activitiesOf(g.sections);
          return (
            <View style={[styles.group, isOpen && styles.groupOpen]}>
              <Pressable
                onPress={() => toggleGroup(g.code)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                style={[styles.groupHead, { flexDirection: row }]}>
                <CodeBadge code={g.code} bg={theme.bg} fg={theme.text} />
                <View style={{ flex: 1 }}>
                  <AppText size={13} weight="semibold" numberOfLines={1}>
                    {g.name}
                  </AppText>
                  <AppText size={11} color={colors.muted} numberOfLines={1}>
                    {[hours ? hoursLabel(hours) : null, sectionsLabel(g.sections.length), activities.join(' + ') || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                </View>
                {picked.length > 0 ? (
                  <Tag
                    label={`${clashCodes.has(g.code) ? tr('تعارض ·', 'Clash ·') : '✓'} ${picked.map((p) => p.section).join(tr('، ', ', '))}`}
                    tone={clashCodes.has(g.code) ? 'warn' : 'ok'}
                  />
                ) : null}
                <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} color={colors.muted} />
              </Pressable>

              {isOpen ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {activities.length > 1 ? (
                    <View style={[styles.hint, { flexDirection: row }]}>
                      <Icon name="info" size={13} color={colors.accentDark} />
                      <AppText size={11.5} color={colors.accentDark} style={{ flex: 1 }}>
                        {tr('يلزمك شعبة من كل نوع:', 'You need one section of each type:')} {activities.join(' + ')}
                      </AppText>
                    </View>
                  ) : null}
                  {/* Sections in the same order as the portal page */}
                  {detailed ? (
                    <View style={{ gap: 6 }}>
                      {g.sections.map((s) => (
                        <SectionRow
                          key={s.id}
                          section={s}
                          chosen={chosenIds.has(s.id)}
                          clash={findClash(s, chosen)}
                          onPress={() => onTapSection(s)}
                        />
                      ))}
                    </View>
                  ) : (
                    <View style={[styles.tiles, { flexDirection: row }]}>
                      {g.sections.map((s) => (
                        <SectionTile
                          key={s.id}
                          wide={oneColumn}
                          section={s}
                          chosen={chosenIds.has(s.id)}
                          clash={findClash(s, chosen)}
                          onPress={() => onTapSection(s)}
                        />
                      ))}
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

/**
 * A small section card, two per row. Kept short so several fit on a phone:
 * one line per meeting (days + time), then instructor, then room and exam period.
 * The list view (SectionRow) has the full wording.
 */
function SectionTile({
  section,
  chosen,
  clash,
  onPress,
  wide,
}: {
  wide: boolean;
  section: Course;
  chosen: boolean;
  clash: Course | null;
  onPress: () => void;
}) {
  const closed = section.status === 'closed';
  const slots = slotsOf(section);
  const activity = activityLabel(section);
  const period = section.finalExam?.date;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={`${tr('الشعبة', 'Section')} ${section.section}${activity ? ` ${activity}` : ''}`}
      accessibilityHint={chosen ? tr('اضغط لإزالتها من الجدول', 'Tap to remove it from the timetable') : tr('اضغط لإضافتها إلى الجدول', 'Tap to add it to the timetable')}
      style={[styles.tile, wide && { width: '100%' }, clash && styles.tileClash, chosen && (clash ? styles.tileOnClash : styles.tileOn), closed && { opacity: 0.75 }]}>
      <View style={[styles.tileTop, { flexDirection: row }]}>
        <AppText size={13} weight="bold" style={[styles.tight, { flex: 1 }]} numberOfLines={1}>
          {tr('الشعبة', 'Section')} {section.section}
        </AppText>
        {activity ? <Tag label={activity} tone={activity === 'نظري' || activity === 'Lecture' ? 'muted' : 'accent'} /> : null}
        {chosen ? (
          <View style={[styles.tileCheck, clash && { backgroundColor: '#E07B1F' }]}>
            <Icon name="check" size={10} color="#FFFFFF" strokeWidth={3.5} />
          </View>
        ) : null}
      </View>

      {slots.length > 0 ? (
        slots.map((s, i) => (
          <AppText key={i} size={11.5} weight="semibold" style={styles.tight} numberOfLines={1}>
            {formatDaysCompact(s.days)}
            <AppText size={11.5} weight="medium" color={colors.accentDark}>
              {'  '}
              {formatTimeRange(s.startTime, s.endTime)}
            </AppText>
          </AppText>
        ))
      ) : (
        <AppText size={11.5} color={colors.muted} style={styles.tight}>
          {tr('بدون وقت محدد', 'No set time')}
        </AppText>
      )}

      {section.instructor ? (
        <AppText size={11} color={colors.muted} style={styles.tight} numberOfLines={1}>
          {section.instructor}
        </AppText>
      ) : null}
      {section.location ? (
        <AppText size={11} color={colors.muted} style={styles.tight} numberOfLines={1}>
          {section.location}
        </AppText>
      ) : null}
      {period ? (
        <AppText size={11} weight="bold" color="#3730A3" style={styles.tight} numberOfLines={1}>
          {tr('فترة الاختبار', 'Exam period')} {period}
        </AppText>
      ) : null}
      {closed ? (
        <AppText size={11} weight="semibold" color={colors.danger} style={styles.tight} numberOfLines={1}>
          {tr('مغلقة', 'Closed')}
        </AppText>
      ) : null}
      {clash ? (
        <AppText size={11} weight="semibold" color={colors.clash} style={styles.tight} numberOfLines={1}>
          {tr('تتعارض مع', 'Clashes with')} {clash.code} · {clash.section}
        </AppText>
      ) : null}
    </Pressable>
  );
}

function SectionRow({
  section,
  chosen,
  clash,
  onPress,
}: {
  section: Course;
  chosen: boolean;
  clash: Course | null;
  onPress: () => void;
}) {
  const exam = formatExam(section.finalExam);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityHint={chosen ? tr('اضغط لإزالتها من الجدول', 'Tap to remove it from the timetable') : tr('اضغط لإضافتها إلى الجدول', 'Tap to add it to the timetable')}
      style={[styles.secRow, { flexDirection: row }, clash && styles.tileClash, chosen && (clash ? styles.tileOnClash : styles.tileOn)]}>
      <AppText size={14} weight="bold" style={{ width: 26 }}>
        {section.section}
      </AppText>
      <View style={{ flex: 1 }}>
        <AppText size={12.5}>{formatSchedule(section)}</AppText>
        <AppText size={11.5} color={colors.muted} numberOfLines={1}>
          {[activityLabel(section), section.instructor, section.location, exam ? `${tr('فترة الاختبار:', 'Exam period:')} ${section.finalExam?.date}` : null]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
        {clash ? (
          <AppText size={11.5} color={colors.clash} numberOfLines={1}>
            {tr('تتعارض مع', 'Clashes with')} {clash.code} · {clash.section}
          </AppText>
        ) : null}
      </View>
      {chosen ? <Tag label={tr('مضافة', 'Added')} tone={clash ? 'warn' : 'accent'} /> : section.status === 'closed' ? <Tag label={tr('مغلقة', 'Closed')} tone="danger" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: 8, marginBottom: 10 },
  seg: { padding: 3, borderRadius: 12, backgroundColor: colors.bg, gap: 2 },
  segBtn: { width: 34, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface },
  chips: { flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' },
  searchBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    marginBottom: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 10, backgroundColor: colors.surface },
  groupOpen: { borderColor: colors.accentBorder, backgroundColor: '#FAFDFE' },
  groupHead: { alignItems: 'center', gap: 10 },
  hint: { alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.accentTint },
  tiles: { flexWrap: 'wrap', gap: 6 },
  tile: {
    width: '48.5%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    gap: 1,
  },
  tileTop: { alignItems: 'center', gap: 5, marginBottom: 1 },
  tight: { lineHeight: 17 },
  tileClash: { borderColor: colors.clashBorder, backgroundColor: '#FFFBF6' },
  tileOn: { borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.accentTint },
  tileOnClash: { borderWidth: 1.5, borderColor: '#E07B1F', backgroundColor: colors.clashSoft },
  tileCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secRow: {
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    backgroundColor: colors.surface,
  },
});
