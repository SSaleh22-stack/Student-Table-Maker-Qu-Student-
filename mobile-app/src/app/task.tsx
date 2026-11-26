/**
 * Add or edit a personal task, shown as a sheet over the tasks tab. The date, the time and the
 * reminder are all optional: a task can be just a title ("buy a lab notebook"). Opened with
 * `{ id }` to edit an existing task.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { CustomReminderSheet } from '@/components/tasks/CustomReminderSheet';
import { DatePickerSheet } from '@/components/tasks/DatePickerSheet';
import { TimePickerSheet } from '@/components/tasks/TimePickerSheet';
import { Button, Chip, IconButton, ScreenHeader } from '@/components/ui';
import { getCourseTheme } from '@/lib/courses';
import { tr } from '@/lib/i18n';
import { useScreenInsets } from '@/lib/insets';
import { useIsTablet } from '@/lib/layout';
import { goBack } from '@/lib/nav';
import { ensureReminderPermission } from '@/lib/reminders';
import { inputDir, pushToEnd, row } from '@/lib/rtl';
import {
  cleanCustomReminder,
  dateKey,
  fireHint,
  formatTaskDate,
  formatTime,
  nextReminderAt,
  normalizeDraft,
  reminderLabel,
  reminderOptions,
  repeatLabel,
  sameCustomReminder,
  todayKey,
  type CustomReminder,
  type ReminderOffset,
  type Repeat,
  type Task,
  type TaskDraft,
} from '@/lib/tasks';
import { colors, fonts } from '@/lib/theme';
import { useAppData } from '@/store/AppData';
import { useTasks } from '@/store/Tasks';

const REPEATS: Repeat[] = ['none', 'daily', 'weekly'];

/** The current time; read when the screen draws so the "already passed" hint stays honest. */
const nowMs = () => Date.now();

/** Date key `days` after today. */
const fromToday = (days: number) => {
  const d = new Date();
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
};

/** The reminder picked when the switch is turned on: an hour before a timed task, else that morning. */
const defaultReminder = (options: ReminderOffset[]): ReminderOffset | null =>
  options.includes('1h') ? '1h' : (options[0] ?? null);

function confirmDelete(run: () => void) {
  const title = tr('حذف المهمة؟', 'Delete this task?');
  const message = tr('ستُحذف المهمة وتذكيرها.', 'The task and its reminder will be removed.');
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: tr('إلغاء', 'Cancel'), style: 'cancel' },
    { text: tr('حذف', 'Delete'), style: 'destructive', onPress: run },
  ]);
}

export default function TaskScreen() {
  const tablet = useIsTablet();
  // `course`: a new task for that course (the after-lecture notification opens the editor this way).
  const { id, course } = useLocalSearchParams<{ id?: string; course?: string }>();
  const { loaded, getTask, addTask, updateTask, deleteTask } = useTasks();
  const { chosen } = useAppData();
  const task = id ? getTask(id) : undefined;
  const editing = !!id;

  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [date, setDate] = useState<string | undefined>(task?.date);
  const [time, setTime] = useState<string | undefined>(task?.time);
  const [remindOn, setRemindOn] = useState(!!task?.reminder);
  const [offset, setOffset] = useState<ReminderOffset | null>(task?.reminder ?? null);
  // Kept even while another choice is picked, so going back to "مخصص" finds the student's value.
  const [custom, setCustom] = useState<CustomReminder | undefined>(task?.reminderCustom);
  const [repeat, setRepeat] = useState<Repeat>(task?.repeat ?? 'none');
  const [courseCode, setCourseCode] = useState<string | undefined>(task?.courseCode ?? (id ? undefined : course || undefined));
  const [picker, setPicker] = useState<'date' | 'time' | 'custom' | null>(null);
  const [titleFocused, setTitleFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  // The task as the editor first showed it, to tell the student's edits from changes made
  // elsewhere while the sheet was open (e.g. "Mark as done" on a reminder moving its date).
  const [original, setOriginal] = useState<Task | undefined>(task);
  // How far the page sheet starts below the top of the screen. KeyboardAvoidingView compares its
  // own (sheet-relative) frame with the keyboard's screen position, so without this the Save
  // button ends up behind the keyboard on iOS.
  const { height: windowHeight } = useWindowDimensions();
  const insets = useScreenInsets();
  const [sheetTop, setSheetTop] = useState(0);

  // Opened before the saved tasks finished loading (e.g. from a notification): fill in once they do.
  const [seeded, setSeeded] = useState(!editing || !!task);
  if (!seeded && task) {
    setSeeded(true);
    setOriginal(task);
    setTitle(task.title);
    setNotes(task.notes ?? '');
    setDate(task.date);
    setTime(task.time);
    setRemindOn(!!task.reminder);
    setOffset(task.reminder);
    setCustom(task.reminderCustom);
    setRepeat(task.repeat);
    setCourseCode(task.courseCode);
  }

  // The task was deleted (or the link is stale): nothing to edit.
  useEffect(() => {
    if (editing && loaded && !task && !saving) goBack();
  }, [editing, loaded, task, saving]);

  // A time alone counts as today, the same way it is saved.
  const whenDate = date ?? (time ? todayKey() : undefined);
  const options = reminderOptions({ date: whenDate, time });
  const canRemind = options.length > 0;
  // The custom value while it fits the task: "30 min before" needs a time, a set clock time does not.
  const customFit = cleanCustomReminder(custom, !!time);
  const fits = (o: ReminderOffset | null): o is ReminderOffset =>
    !!o && options.includes(o) && (o !== 'custom' || !!customFit);
  // Keeps the picked reminder when it still fits the date/time, otherwise falls back to a default.
  const reminder: ReminderOffset | null =
    remindOn && canRemind ? (fits(offset) ? offset : defaultReminder(options)) : null;
  const reminderCustom = reminder === 'custom' ? customFit : undefined;
  // A repeating reminder whose time passed today still rings at the next occurrence.
  const fire = nextReminderAt(
    { date: whenDate, time, reminder, reminderCustom, repeat: whenDate ? repeat : 'none' },
    new Date(nowMs()),
  );
  const firePast = !!fire && fire.getTime() <= nowMs();

  // The student's courses (one chip per code), keeping a linked course that was since removed.
  const codes = [...new Set(chosen.map((c) => c.code))];
  if (task?.courseCode && !codes.includes(task.courseCode)) codes.push(task.courseCode);
  if (!id && course && !codes.includes(course)) codes.push(course);

  const canSave = title.trim().length > 0 && !saving;
  const t = (phone: number, tab: number) => (tablet ? tab : phone);

  const save = async () => {
    if (!canSave) return;
    let draft = normalizeDraft({ title, notes, date, time, reminder, reminderCustom, repeat, courseCode });
    const current = id ? getTask(id) : undefined;
    if (editing && original && current) {
      // Fields the student left alone take the task's current value, so saving never undoes a
      // change made while the editor was open.
      const pick = <K extends keyof TaskDraft>(k: K): TaskDraft[K] =>
        draft[k] === original[k] ? current[k] : draft[k];
      // The custom value is an object, so "left alone" means it says the same thing.
      const keptCustom = sameCustomReminder(draft.reminderCustom, original.reminderCustom);
      draft = normalizeDraft({
        title: pick('title'),
        notes: pick('notes'),
        date: pick('date'),
        time: pick('time'),
        reminder: pick('reminder'),
        reminderCustom: keptCustom ? current.reminderCustom : draft.reminderCustom,
        repeat: pick('repeat'),
        courseCode: pick('courseCode'),
      });
    }
    setSaving(true);
    // Asked here, when the student first wants a reminder, not at app start.
    const allowed = draft.reminder ? await ensureReminderPermission() : true;
    if (editing && id) updateTask(id, draft);
    else addTask(draft);
    if (!allowed && Platform.OS !== 'web') {
      // Saved anyway; the reminder starts working once notifications are allowed in Settings.
      Alert.alert(
        tr('الإشعارات مغلقة', 'Notifications are off'),
        tr(
          'حُفظت المهمة، لكن لن يصلك التذكير حتى تسمح بالإشعارات للتطبيق من الإعدادات.',
          "The task is saved, but its reminder won't arrive until you allow notifications in Settings.",
        ),
        [{ text: tr('حسناً', 'OK'), onPress: goBack }],
        { cancelable: true, onDismiss: goBack },
      );
      return;
    }
    goBack();
  };

  const remove = () =>
    confirmDelete(() => {
      if (!id) return;
      setSaving(true);
      deleteTask(id);
      goBack();
    });

  const quickDates = [
    { label: tr('اليوم', 'Today'), key: todayKey() },
    { label: tr('غداً', 'Tomorrow'), key: fromToday(1) },
    { label: tr('بعد أسبوع', 'In a week'), key: fromToday(7) },
  ];

  return (
    <SafeAreaView
      style={styles.screen}
      // On an iPhone the page sheet already sits below the status bar; on an iPad it is full screen.
      edges={Platform.OS === 'ios' && !tablet ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={sheetTop}
        onLayout={(e) => {
          if (Platform.OS !== 'ios' || tablet) return;
          // The sheet ends at the bottom of the screen, so its top is what the window has above it.
          const { y, height } = e.nativeEvent.layout;
          setSheetTop(Math.max(0, Math.round(windowHeight - (y + height + insets.bottom))));
        }}>
        {Platform.OS === 'ios' && !tablet ? <View style={styles.grab} /> : null}
        <ScrollView
          contentContainerStyle={[styles.content, tablet && styles.contentTablet]}
          keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={editing ? tr('تعديل المهمة', 'Edit task') : tr('مهمة جديدة', 'New task')}
            trailing={<IconButton icon="x" label={tr('إغلاق', 'Close')} tone="muted" size={36} onPress={goBack} />}
          />

          <View style={styles.field}>
            <Label text={tr('عنوان المهمة', 'Task title')} />
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={tr('مثال: تسليم واجب البرمجة', 'e.g. Submit the programming homework')}
              placeholderTextColor={colors.placeholder}
              style={[styles.input, tablet && styles.inputTablet, titleFocused && styles.inputFocused, inputDir()]}
              accessibilityLabel={tr('عنوان المهمة', 'Task title')}
              autoFocus={!editing}
              maxLength={120}
              returnKeyType="done"
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
            />
            <View style={[styles.notesBox, tablet && styles.inputTablet, { flexDirection: row }]}>
              <Icon name="fileText" size={18} color={colors.placeholder} />
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={tr('أضف ملاحظة (اختياري)', 'Add a note (optional)')}
                placeholderTextColor={colors.placeholder}
                style={[styles.notesInput, tablet && { fontSize: 17 }, inputDir()]}
                accessibilityLabel={tr('ملاحظة', 'Note')}
                multiline
                textAlignVertical="top"
                maxLength={500}
              />
            </View>
          </View>

          <View style={styles.field}>
            <View style={{ flexDirection: row, alignItems: 'center' }}>
              <Label text={tr('الموعد', 'When')} />
              <AppText size={12} color={colors.faint} style={pushToEnd}>
                {tr('اختياري', 'Optional')}
              </AppText>
            </View>
            <View style={styles.box}>
              <WhenRow
                icon="calendar"
                label={tr('التاريخ', 'Date')}
                value={date ? formatTaskDate(date) : time ? formatTaskDate(todayKey()) : undefined}
                implied={!date && !!time}
                onPick={() => setPicker('date')}
                onClear={date ? () => setDate(undefined) : undefined}
                size={t(15, 17)}
              />
              <View style={styles.divider} />
              <WhenRow
                icon="clock"
                label={tr('الوقت', 'Time')}
                value={time ? formatTime(time) : undefined}
                onPick={() => setPicker('time')}
                onClear={() => setTime(undefined)}
                size={t(15, 17)}
              />
            </View>
            <View style={[styles.chips, { flexDirection: row }]}>
              {quickDates.map((q) => (
                <Chip key={q.key} label={q.label} selected={date === q.key} onPress={() => setDate(q.key)} />
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <View style={[styles.box, styles.switchRow, { flexDirection: row }]}>
              <Icon name="bell" size={20} color={canRemind ? colors.accent : colors.placeholder} />
              <AppText size={t(15, 17)} weight="medium" color={canRemind ? colors.text : colors.faint} style={{ flex: 1 }}>
                {tr('تذكير بإشعار', 'Reminder')}
              </AppText>
              <Switch
                value={!!reminder}
                onValueChange={(on) => {
                  setRemindOn(on);
                  if (on && !fits(offset)) setOffset(defaultReminder(options));
                }}
                disabled={!canRemind}
                trackColor={{ true: colors.accent, false: '#CBD5E1' }}
                thumbColor="#FFFFFF"
                accessibilityLabel={tr('تذكير بإشعار', 'Reminder')}
              />
            </View>
            {!canRemind ? (
              <Hint text={tr('أضف تاريخاً أو وقتاً لتفعيل التذكير', 'Add a date or time to turn on a reminder')} />
            ) : reminder ? (
              <>
                <View style={[styles.chips, { flexDirection: row }]}>
                  {options.map((o) =>
                    o === 'custom' ? (
                      // Opens the sheet; the choice switches to "custom" only once the student taps Done.
                      <Chip
                        key={o}
                        label={reminderLabel(o, !!time, customFit)}
                        selected={reminder === o}
                        onPress={() => setPicker('custom')}
                      />
                    ) : (
                      <Chip key={o} label={reminderLabel(o, !!time)} selected={reminder === o} onPress={() => setOffset(o)} />
                    ),
                  )}
                </View>
                {fire ? (
                  firePast ? (
                    <Hint
                      text={tr('وقت هذا التذكير مضى، اختر وقتاً آخر', 'This reminder time has passed; pick another')}
                      color={colors.clash}
                    />
                  ) : (
                    <Hint text={fireHint(fire)} />
                  )
                ) : null}
              </>
            ) : null}
          </View>

          {whenDate ? (
            <View style={styles.field}>
              <Label text={tr('التكرار', 'Repeat')} />
              <View style={[styles.chips, { flexDirection: row }]}>
                {REPEATS.map((r) => (
                  <Chip key={r} label={repeatLabel(r)} selected={repeat === r} onPress={() => setRepeat(r)} />
                ))}
              </View>
            </View>
          ) : null}

          {codes.length > 0 ? (
            <View style={styles.field}>
              <Label text={tr('ربط بمقرر (اختياري)', 'Link a course (optional)')} />
              <View style={[styles.chips, { flexDirection: row }]}>
                {codes.map((code) => {
                  const th = getCourseTheme(code);
                  const on = courseCode === code;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => setCourseCode(on ? undefined : code)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.course, { borderColor: on ? th.text : 'transparent' }]}>
                      <View style={[styles.courseInner, { backgroundColor: th.bg }]}>
                        <AppText size={t(12.5, 14)} weight="bold" color={th.text}>
                          {code}
                        </AppText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {editing ? (
            <Button
              label={tr('حذف المهمة', 'Delete task')}
              icon="trash"
              variant="danger"
              onPress={remove}
              style={{ marginTop: 4 }}
            />
          ) : null}
        </ScrollView>

        <View style={[styles.footer, tablet && styles.footerTablet]}>
          <Button
            label={tr('حفظ المهمة', 'Save task')}
            icon="check"
            onPress={save}
            disabled={!canSave}
            loading={saving}
          />
        </View>
      </KeyboardAvoidingView>

      <DatePickerSheet
        visible={picker === 'date'}
        value={date}
        onClose={() => setPicker(null)}
        onPick={(key) => setDate(key)}
      />
      <CustomReminderSheet
        visible={picker === 'custom'}
        value={customFit}
        date={whenDate}
        time={time}
        repeat={whenDate ? repeat : 'none'}
        onClose={() => setPicker(null)}
        onDone={(value) => {
          setCustom(value);
          setOffset('custom');
          setRemindOn(true);
        }}
      />
      <TimePickerSheet
        visible={picker === 'time'}
        value={time}
        onClose={() => setPicker(null)}
        onDone={(hhmm, day) => {
          setTime(hhmm);
          if (day) setDate(day);
        }}
      />
    </SafeAreaView>
  );
}

function Label({ text }: { text: string }) {
  return (
    <AppText size={13} weight="semibold" color={colors.muted}>
      {text}
    </AppText>
  );
}

function Hint({ text, color = colors.faint }: { text: string; color?: string }) {
  return (
    <View style={{ flexDirection: row, alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
      <Icon name="info" size={14} color={color} />
      <AppText size={12} color={color} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

/**
 * "Date" or "Time": the value in a pill with a small × to clear it, or "+ Add" when empty.
 * `implied` shows the date a time-only task will get (today) without a × of its own.
 */
function WhenRow({
  icon,
  label,
  value,
  implied,
  onPick,
  onClear,
  size,
}: {
  icon: IconName;
  label: string;
  value?: string;
  implied?: boolean;
  onPick: () => void;
  onClear?: () => void;
  size: number;
}) {
  return (
    <View style={[styles.whenRow, { flexDirection: row }]}>
      <Icon name={icon} size={20} color={value ? colors.accent : colors.placeholder} />
      <AppText size={size} weight="medium" style={{ flex: 1 }}>
        {label}
      </AppText>
      {value ? (
        <>
          <Pressable
            onPress={onPick}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${value}`}
            style={({ pressed }) => [styles.valuePill, implied && styles.valuePillImplied, pressed && { opacity: 0.8 }]}>
            <AppText size={13} weight="semibold" color={colors.accentDark}>
              {value}
            </AppText>
          </Pressable>
          {onClear && !implied ? (
            <Pressable
              onPress={onClear}
              accessibilityRole="button"
              accessibilityLabel={tr(`إزالة ${label}`, `Clear ${label.toLowerCase()}`)}
              hitSlop={8}
              style={styles.clear}>
              <Icon name="x" size={12} color={colors.faint} strokeWidth={2.6} />
            </Pressable>
          ) : null}
        </>
      ) : (
        <Pressable
          onPress={onPick}
          accessibilityRole="button"
          accessibilityLabel={tr(`إضافة ${label}`, `Add ${label.toLowerCase()}`)}
          style={({ pressed }) => [styles.addPill, { flexDirection: row }, pressed && { opacity: 0.8 }]}>
          <Icon name="plus" size={14} color={colors.accentDark} strokeWidth={2.6} />
          <AppText size={13} weight="semibold" color={colors.accentDark}>
            {tr('إضافة', 'Add')}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginTop: 8 },
  content: { padding: 20, paddingTop: 12, gap: 18, paddingBottom: 24 },
  contentTablet: { width: '100%', paddingHorizontal: 40, paddingTop: 20, gap: 22 },
  field: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 16,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text,
  },
  inputTablet: { minHeight: 56, borderRadius: 16 },
  inputFocused: { borderColor: colors.accent, borderWidth: 1.5 },
  notesBox: {
    minHeight: 52,
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 16,
    paddingTop: 15,
  },
  notesInput: {
    flex: 1,
    minHeight: 24,
    maxHeight: 120,
    padding: 0,
    paddingBottom: 12,
    marginTop: -3,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  box: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
  },
  divider: { height: 1, backgroundColor: colors.border },
  whenRow: { alignItems: 'center', gap: 10, minHeight: 56 },
  valuePill: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  valuePillImplied: { backgroundColor: colors.accentTint },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPill: {
    minHeight: 32,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  switchRow: { alignItems: 'center', gap: 10, minHeight: 56 },
  chips: { flexWrap: 'wrap', gap: 8 },
  course: { borderWidth: 2, borderRadius: 12, padding: 2 },
  courseInner: { borderRadius: 9, paddingHorizontal: 11, paddingVertical: 3 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, backgroundColor: colors.surface },
  footerTablet: { width: '100%', paddingHorizontal: 40, paddingBottom: 16 },
});
