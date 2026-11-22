/**
 * Month calendar in a bottom sheet for picking a task's date. Weeks start on Sunday like the
 * Saudi calendar, today is outlined, and past days stay pickable but dimmed (a late task is
 * still a task). Tapping a day picks it and closes the sheet.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconButton } from '@/components/ui';
import { PickerSheet } from '@/components/tasks/PickerSheet';
import { tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import { dateKey, parseDateKey, todayKey } from '@/lib/tasks';
import { colors } from '@/lib/theme';

const monthName = (m: number) =>
  tr(
    ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][m],
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
      'December'][m],
  );

/** Short weekday names, Sunday first (JS getDay order). */
const weekdayNames = () =>
  [
    ['أحد', 'Sun'],
    ['إثنين', 'Mon'],
    ['ثلاثاء', 'Tue'],
    ['أربعاء', 'Wed'],
    ['خميس', 'Thu'],
    ['جمعة', 'Fri'],
    ['سبت', 'Sat'],
  ].map(([ar, en]) => tr(ar, en));

export function DatePickerSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** The current date key ('YYYY-MM-DD'), if any. */
  value?: string;
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  return (
    <PickerSheet visible={visible} title={tr('تاريخ المهمة', 'Task date')} onClose={onClose}>
      <Calendar
        value={value}
        onPick={(key) => {
          onPick(key);
          onClose();
        }}
      />
    </PickerSheet>
  );
}

function Calendar({ value, onPick }: { value?: string; onPick: (key: string) => void }) {
  const today = todayKey();
  // Opens on the chosen date's month, or this month.
  const start = parseDateKey(value ?? today);
  const [year, setYear] = useState(start.getFullYear());
  const [month, setMonth] = useState(start.getMonth());

  const shift = (by: number) => {
    const d = new Date(year, month + by, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  // Blank cells before the 1st, then the days, padded to whole weeks.
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const thisYear = new Date().getFullYear();

  return (
    <View style={{ paddingBottom: 4 }}>
      <View style={[styles.nav, { flexDirection: row }]}>
        <AppText size={16} weight="semibold" style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {monthName(month)}
          {year !== thisYear ? ` ${ltr(year)}` : ''}
        </AppText>
        <IconButton icon="back" label={tr('الشهر السابق', 'Previous month')} tone="muted" size={36} onPress={() => shift(-1)} />
        <IconButton icon="forward" label={tr('الشهر التالي', 'Next month')} tone="muted" size={36} onPress={() => shift(1)} />
      </View>

      <View style={{ flexDirection: row }}>
        {weekdayNames().map((name, i) => (
          <View key={i} style={styles.cell}>
            <AppText size={11} weight="medium" color={colors.faint} align="center">
              {name}
            </AppText>
          </View>
        ))}
      </View>

      {weeks.map((week, w) => (
        <View key={w} style={{ flexDirection: row }}>
          {week.map((day, i) => {
            if (day == null) return <View key={i} style={styles.cell} />;
            const key = dateKey(new Date(year, month, day));
            const selected = key === value;
            const isToday = key === today;
            const past = key < today;
            return (
              <View key={i} style={styles.cell}>
                <Pressable
                  onPress={() => onPick(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${day} ${monthName(month)}${isToday ? ` (${tr('اليوم', 'today')})` : ''}`}
                  style={({ pressed }) => [
                    styles.day,
                    isToday && styles.today,
                    selected && styles.selected,
                    pressed && !selected && { backgroundColor: colors.surfaceMuted },
                  ]}>
                  <AppText
                    size={15}
                    weight={selected || isToday ? 'bold' : 'regular'}
                    color={selected ? '#FFFFFF' : isToday ? colors.accentDark : past ? '#A3ACB8' : colors.text}
                    align="center">
                    {day}
                  </AppText>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { alignItems: 'center', gap: 8, marginBottom: 8 },
  cell: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  day: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.accent },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
});
