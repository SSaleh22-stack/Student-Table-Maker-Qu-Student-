/**
 * Time wheel in a bottom sheet: hour, minute and AM/PM columns that snap to the middle row,
 * plus quick choices. Minutes go in steps of 5, but a task's existing odd minute (say 11:59)
 * is kept in the list so opening and closing the picker never changes it.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { Button, Chip } from '@/components/ui';
import { PickerSheet } from '@/components/tasks/PickerSheet';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { dateKey, formatTime, todayKey } from '@/lib/tasks';
import { colors } from '@/lib/theme';

const ITEM = 44;
/** Rows visible in a wheel; the middle one is the picked value. */
const VISIBLE = 5;
const PAD = ITEM * ((VISIBLE - 1) / 2);

const nowMs = () => Date.now();
const pad2 = (n: number) => String(n).padStart(2, '0');
const toHHmm = (h24: number, m: number) => `${pad2(h24)}:${pad2(m)}`;

/** A time as the three wheels show it. */
export interface TimeParts {
  hour: number; // 1–12
  minute: number;
  pm: boolean;
}

type Parts = TimeParts;

export const fromHHmm = (hhmm: string): Parts => {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: m || 0, pm: h >= 12 };
};

const toH24 = (p: Parts) => (p.hour % 12) + (p.pm ? 12 : 0);

/** The wheels' time back as 'HH:mm' (24h). */
export const partsToHHmm = (p: Parts) => toHHmm(toH24(p), p.minute);

/** Minutes in steps of 5, plus `own` when it is off that grid, so an existing 11:59 stays as it is. */
export const wheelMinutes = (own: number): number[] => {
  const list = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!list.includes(own)) list.push(own);
  return list.sort((a, b) => a - b);
};

/**
 * The next whole hour, a sensible first guess for a new task. After 23:00 that is midnight, which
 * belongs to tomorrow: the date comes with it, or the task would be due (and late) at 00:00 today.
 */
const nextHour = (): { time: string; date?: string } => {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const key = dateKey(d);
  return { time: toHHmm(d.getHours(), 0), date: key === todayKey() ? undefined : key };
};

export function TimePickerSheet({
  visible,
  value,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** Current time 'HH:mm' (24h), if any. */
  value?: string;
  onClose: () => void;
  /** `date` is set only when the time rolls over to tomorrow ("in an hour", or the first guess after 23:00). */
  onDone: (time: string, date?: string) => void;
}) {
  return (
    <PickerSheet visible={visible} title={tr('وقت المهمة', 'Task time')} onClose={onClose}>
      <TimeBody
        value={value}
        onDone={(time, date) => {
          onDone(time, date);
          onClose();
        }}
      />
    </PickerSheet>
  );
}

function TimeBody({ value, onDone }: { value?: string; onDone: (time: string, date?: string) => void }) {
  const [guess] = useState(nextHour);
  const [parts, setParts] = useState<Parts>(() => fromHHmm(value ?? guess.time));
  // Set by "in an hour" (or the first guess) so the date follows past midnight; any wheel change drops it.
  const [quickDate, setQuickDate] = useState<string | undefined>(value ? undefined : guess.date);

  // Steps of 5, plus the minute the task already had.
  const [minutes] = useState(() => wheelMinutes(fromHHmm(value ?? guess.time).minute));

  const set = (patch: Partial<Parts>) => {
    setQuickDate(undefined);
    setParts((p) => ({ ...p, ...patch }));
  };

  const quick = (h24: number, m: number, date?: string) => {
    // Quick picks land on the 5-minute grid, so the minute is always in the list.
    setParts({ hour: h24 % 12 === 0 ? 12 : h24 % 12, minute: m, pm: h24 >= 12 });
    setQuickDate(date);
  };

  const inAnHour = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    quick(d.getHours(), d.getMinutes(), dateKey(d));
  };

  const current = partsToHHmm(parts);

  return (
    <View style={{ gap: 14 }}>
      <TimeWheels parts={parts} minutes={minutes} onChange={set} />

      <View style={{ gap: 8 }}>
        <AppText size={13} weight="semibold" color={colors.muted}>
          {tr('اختيارات سريعة', 'Quick picks')}
        </AppText>
        <View style={[styles.chips, { flexDirection: row }]}>
          <Chip label={formatTime('08:00')} selected={current === '08:00' && !quickDate} onPress={() => quick(8, 0)} />
          <Chip label={formatTime('12:00')} selected={current === '12:00' && !quickDate} onPress={() => quick(12, 0)} />
          <Chip label={formatTime('20:00')} selected={current === '20:00' && !quickDate} onPress={() => quick(20, 0)} />
          <Chip label={tr('بعد ساعة', 'In an hour')} selected={!!quickDate} onPress={inAnHour} />
        </View>
      </View>

      <Button label={tr('تم', 'Done')} onPress={() => onDone(current, quickDate)} />
    </View>
  );
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * The hour, minute and AM/PM wheels on a highlighted middle row. Shared with the custom reminder
 * sheet; `minutes` is the list from wheelMinutes, and each change reports only the part that moved.
 */
export function TimeWheels({
  parts,
  minutes,
  onChange,
}: {
  parts: TimeParts;
  minutes: number[];
  onChange: (patch: Partial<TimeParts>) => void;
}) {
  const amPm = [tr('ص', 'AM'), tr('م', 'PM')];
  return (
    <View style={styles.wheels}>
      <View style={styles.band} pointerEvents="none" />
      <View style={[styles.wheelRow, { flexDirection: row }]}>
        <Wheel
          items={HOURS.map(String)}
          index={HOURS.indexOf(parts.hour)}
          onChange={(i) => onChange({ hour: HOURS[i] })}
          label={tr('الساعة', 'Hour')}
        />
        <AppText size={22} weight="semibold" style={styles.colon}>
          :
        </AppText>
        <Wheel
          items={minutes.map(pad2)}
          index={Math.max(0, minutes.indexOf(parts.minute))}
          onChange={(i) => onChange({ minute: minutes[i] })}
          label={tr('الدقيقة', 'Minute')}
        />
        <Wheel
          items={amPm}
          index={parts.pm ? 1 : 0}
          onChange={(i) => onChange({ pm: i === 1 })}
          label={tr('صباحاً أو مساءً', 'AM or PM')}
        />
      </View>
    </View>
  );
}

/**
 * One snapping column. It reports the row in the middle while scrolling, and scrolls itself when
 * the value changes from outside (a quick pick).
 */
function Wheel({
  items,
  index,
  onChange,
  label,
}: {
  items: string[];
  index: number;
  onChange: (index: number) => void;
  label: string;
}) {
  const ref = useRef<ScrollViewInstance>(null);
  // The row this wheel last showed, so its own scrolling doesn't trigger a scroll back.
  const shown = useRef(index);
  // Row being scrolled to by code; scroll events on the way there are not the user's choice.
  // It expires on its own in case the wheel was already there and no event comes, and each
  // scroll step on the way extends it.
  const target = useRef<{ i: number; until: number } | null>(null);
  const aim = (i: number) => {
    target.current = { i, until: nowMs() + 600 };
    ref.current?.scrollTo({ y: i * ITEM, animated: true });
  };
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (index !== shown.current) {
      shown.current = index;
      target.current = { i: index, until: nowMs() + 600 };
      ref.current?.scrollTo({ y: index * ITEM, animated: true });
    }
  }, [index]);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  const clamp = (i: number) => Math.min(items.length - 1, Math.max(0, i));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const i = clamp(Math.round(y / ITEM));
    const t = target.current;
    if (t && nowMs() < t.until) {
      if (Math.abs(y - t.i * ITEM) < 1) target.current = null;
      // Still on its way (a long smooth scroll on the web takes well over the first 600 ms):
      // give it more time with every step, so it isn't mistaken for the user's choice midway.
      else t.until = nowMs() + 250;
      return;
    }
    target.current = null;
    if (i !== shown.current) {
      shown.current = i;
      onChange(i);
    }
    // The web has no snapToInterval momentum, so line the row up once scrolling stops.
    if (Platform.OS === 'web') {
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => {
        if (Math.abs(y - i * ITEM) > 1) ref.current?.scrollTo({ y: i * ITEM, animated: true });
      }, 120);
    }
  };

  const pick = (i: number) => {
    shown.current = i;
    onChange(i);
    aim(i);
  };

  return (
    <View style={styles.wheel} accessibilityLabel={label}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentOffset={{ x: 0, y: index * ITEM }}
        onLayout={() => ref.current?.scrollTo({ y: shown.current * ITEM, animated: false })}
        contentContainerStyle={{ paddingVertical: PAD }}
        nestedScrollEnabled>
        {items.map((item, i) => {
          const dist = Math.abs(i - index);
          return (
            <Pressable
              key={`${i}-${item}`}
              onPress={() => pick(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: dist === 0 }}
              accessibilityLabel={`${label} ${item}`}
              style={styles.item}>
              <AppText
                size={dist === 0 ? 22 : dist === 1 ? 18 : 15}
                weight={dist === 0 ? 'semibold' : 'regular'}
                color={dist === 0 ? colors.text : dist === 1 ? '#8A94A3' : '#B4BCC7'}
                align="center">
                {item}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wheels: { height: ITEM * VISIBLE, justifyContent: 'center' },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PAD,
    height: ITEM,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  wheelRow: { height: ITEM * VISIBLE, alignItems: 'center', justifyContent: 'center', gap: 4 },
  wheel: { width: 76, height: ITEM * VISIBLE },
  colon: { width: 16, textAlign: 'center' },
  item: { height: ITEM, alignItems: 'center', justifyContent: 'center' },
  chips: { flexWrap: 'wrap', gap: 8 },
});
