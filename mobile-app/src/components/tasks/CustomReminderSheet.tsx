/**
 * "مخصص": the student types their own reminder time in a bottom sheet. Either some minutes, hours
 * or days before the due time (only when the task has a time), or a clock time on the task's day
 * or a few days before it. A live line under it says when the notification will really arrive.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { PickerSheet } from '@/components/tasks/PickerSheet';
import { fromHHmm, partsToHHmm, TimeWheels, wheelMinutes, type TimeParts } from '@/components/tasks/TimePickerSheet';
import { Button, Chip } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import {
  daysBeforeLabel,
  dueAt,
  fireHint,
  MAX_BEFORE_MINUTES,
  nextReminderAt,
  reminderFireDate,
  splitMinutes,
  unitMinutes,
  type CustomReminder,
  type DurationUnit,
  type Repeat,
} from '@/lib/tasks';
import { colors, fonts } from '@/lib/theme';

type Kind = CustomReminder['kind'];

const UNITS: DurationUnit[] = ['m', 'h', 'd'];
const unitLabel = (u: DurationUnit) =>
  u === 'm' ? tr('دقائق', 'Minutes') : u === 'h' ? tr('ساعات', 'Hours') : tr('أيام', 'Days');

/** Day chips for 'at'; a saved value further back is added so it stays selectable. */
const DAY_CHOICES = [0, 1, 2, 3];

/** First guess for 'at': the evening before, when students tend to check their plans. */
const DEFAULT_AT = { daysBefore: 1, time: '20:00' };

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to 0-9, then digits only, so any keyboard works. */
const westernDigits = (text: string) =>
  text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');

export function CustomReminderSheet({
  visible,
  value,
  date,
  time,
  repeat,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** The custom reminder set so far, if any. */
  value?: CustomReminder;
  /** The task's date as it will be saved (a time alone counts as today). */
  date?: string;
  time?: string;
  repeat: Repeat;
  onClose: () => void;
  onDone: (value: CustomReminder) => void;
}) {
  return (
    <PickerSheet visible={visible} title={tr('تذكير مخصص', 'Custom reminder')} onClose={onClose}>
      <CustomBody
        value={value}
        date={date}
        time={time}
        repeat={repeat}
        onDone={(v) => {
          onDone(v);
          onClose();
        }}
      />
    </PickerSheet>
  );
}

function CustomBody({
  value,
  date,
  time,
  repeat,
  onDone,
}: {
  value?: CustomReminder;
  date?: string;
  time?: string;
  repeat: Repeat;
  onDone: (value: CustomReminder) => void;
}) {
  const canBefore = !!time;
  // Opens on the saved kind, else "before" when the task has a time.
  const [kind, setKind] = useState<Kind>(() => {
    if (value && (value.kind === 'at' || canBefore)) return value.kind;
    return canBefore ? 'before' : 'at';
  });

  // 'before': the number as typed, and its unit (a saved 120 minutes opens as 2 hours).
  const [initial] = useState(() =>
    value?.kind === 'before' ? splitMinutes(value.minutes) : { n: 30, unit: 'm' as DurationUnit },
  );
  const [amount, setAmount] = useState(String(initial.n));
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);

  // 'at': which day and the clock time on it.
  const [daysBefore, setDaysBefore] = useState(value?.kind === 'at' ? value.daysBefore : DEFAULT_AT.daysBefore);
  const [parts, setParts] = useState<TimeParts>(() => fromHHmm(value?.kind === 'at' ? value.time : DEFAULT_AT.time));
  const [minutes] = useState(() => wheelMinutes(parts.minute));
  const dayChoices = DAY_CHOICES.includes(daysBefore) ? DAY_CHOICES : [...DAY_CHOICES, daysBefore];

  const total = amount ? Number(amount) * unitMinutes(unit) : 0;
  const at: CustomReminder = { kind: 'at', daysBefore, time: partsToHHmm(parts) };
  // An 'at' time later than the task's own time would ring once the task is already overdue.
  const atFire =
    kind === 'at' && time ? reminderFireDate({ date, time, reminder: 'custom', reminderCustom: at }) : null;
  const atDue = time ? dueAt({ date, time }) : null;
  const error =
    kind !== 'before'
      ? atFire && atDue && atFire.getTime() > atDue.getTime()
        ? tr('وقت التذكير بعد موعد المهمة', 'This is after the due time')
        : null
      : total < 1
        ? tr('اكتب عدداً أكبر من صفر', 'Enter a number above zero')
        : total > MAX_BEFORE_MINUTES
          ? tr('أقصى مدة 30 يوماً قبل الموعد', 'At most 30 days before')
          : null;

  const result: CustomReminder | null = error ? null : kind === 'before' ? { kind: 'before', minutes: total } : at;

  const now = new Date();
  // A repeating task rolls on to its next occurrence, the same way the editor shows it.
  const fire = result ? nextReminderAt({ date, time, reminder: 'custom', reminderCustom: result, repeat }, now) : null;
  const past = !!fire && fire.getTime() <= now.getTime();

  return (
    <View style={{ gap: 16 }}>
      {canBefore ? (
        <View style={[styles.segments, { flexDirection: row }]} accessibilityRole="tablist">
          <Segment label={tr('قبل الموعد', 'Before due time')} on={kind === 'before'} onPress={() => setKind('before')} />
          <Segment label={tr('وقت محدد', 'Set time')} on={kind === 'at'} onPress={() => setKind('at')} />
        </View>
      ) : null}

      {kind === 'before' ? (
        <View style={{ gap: 10 }}>
          <AppText size={13} weight="semibold" color={colors.muted}>
            {tr('كم قبل الموعد؟', 'How long before?')}
          </AppText>
          <View style={[styles.amountRow, { flexDirection: row }]}>
            <TextInput
              value={amount}
              onChangeText={(text) => setAmount(westernDigits(text).slice(0, 5))}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              selectTextOnFocus
              placeholder="0"
              placeholderTextColor={colors.placeholder}
              style={[styles.amount, !!error && styles.amountError]}
              accessibilityLabel={tr('المدة قبل الموعد', 'Time before due')}
            />
            <View style={[styles.chips, { flexDirection: row, flex: 1 }]}>
              {UNITS.map((u) => (
                <Chip key={u} label={unitLabel(u)} selected={unit === u} onPress={() => setUnit(u)} />
              ))}
            </View>
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <AppText size={13} weight="semibold" color={colors.muted}>
            {tr('اليوم', 'Day')}
          </AppText>
          <View style={[styles.chips, { flexDirection: row }]}>
            {dayChoices.map((d) => (
              <Chip key={d} label={daysBeforeLabel(d)} selected={daysBefore === d} onPress={() => setDaysBefore(d)} />
            ))}
          </View>
          <AppText size={13} weight="semibold" color={colors.muted} style={{ marginTop: 4 }}>
            {tr('الساعة', 'Time')}
          </AppText>
          <TimeWheels parts={parts} minutes={minutes} onChange={(patch) => setParts((p) => ({ ...p, ...patch }))} />
        </View>
      )}

      {error ? (
        <Hint text={error} color={colors.danger} />
      ) : fire ? (
        past ? (
          <Hint
            text={tr('وقت هذا التذكير مضى، اختر وقتاً آخر', 'This reminder time has passed; pick another')}
            color={colors.clash}
          />
        ) : (
          <Hint text={fireHint(fire, now)} />
        )
      ) : null}

      <Button label={tr('تم', 'Done')} onPress={() => result && onDone(result)} disabled={!result} />
    </View>
  );
}

function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      style={[styles.segment, on && styles.segmentOn]}>
      <AppText size={14} weight={on ? 'semibold' : 'medium'} color={on ? colors.accentDark : colors.muted} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

function Hint({ text, color = colors.faint }: { text: string; color?: string }) {
  return (
    <View style={{ flexDirection: row, alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
      <Icon name="info" size={14} color={color} />
      <AppText size={12.5} color={color} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { gap: 4, padding: 4, borderRadius: 14, backgroundColor: colors.surfaceMuted },
  segment: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  amountRow: { alignItems: 'center', gap: 12 },
  amount: {
    width: 96,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    fontFamily: fonts.semibold,
    fontSize: 20,
    color: colors.text,
    textAlign: 'center',
  },
  amountError: { borderColor: colors.danger },
  chips: { flexWrap: 'wrap', gap: 8 },
});
