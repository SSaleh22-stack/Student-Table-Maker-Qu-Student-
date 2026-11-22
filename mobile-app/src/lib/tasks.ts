/**
 * Personal tasks ("مهامي"): the data shape and the pure rules behind the list, the editor and
 * the reminders. No React here, so screens, the store and the notification code share one set
 * of rules.
 *
 * Dates are kept as local 'YYYY-MM-DD' keys and times as 'HH:mm' (24h), not as ISO instants:
 * a task "on Monday at 3 PM" should stay on Monday at 3 PM even if the phone changes time zone.
 */
import { hour12 } from '@/lib/courses';
import { tr } from '@/lib/i18n';
import { ltr } from '@/lib/rtl';

/**
 * 'morning' = 8:00 on the task's day (date without time); '1d' with no time = 8:00 the day before;
 * 'custom' = a time the student typed in, kept in the task's `reminderCustom`.
 */
export type ReminderOffset = 'atTime' | '10m' | '1h' | '1d' | 'morning' | 'custom';
export type Repeat = 'none' | 'daily' | 'weekly';
export type TaskFilter = 'today' | 'upcoming' | 'done' | 'all';

/**
 * A reminder time the student entered: some minutes before the due time (needs a task time), or a
 * clock time on the task's day or a few days before it. Both are relative to the task's date, so a
 * repeating task keeps the same reminder at every occurrence.
 */
export type CustomReminder = { kind: 'before'; minutes: number } | { kind: 'at'; daysBefore: number; time: string };

/** The longest "before" a custom reminder can be: 30 days, in minutes. */
export const MAX_BEFORE_MINUTES = 30 * 24 * 60;
/** How many days before the task an 'at' reminder can be. */
export const MAX_DAYS_BEFORE = 30;

export interface Task {
  id: string;
  title: string;
  notes?: string;
  /** 'YYYY-MM-DD', local */
  date?: string;
  /** 'HH:mm', 24h */
  time?: string;
  reminder: ReminderOffset | null;
  /** Set only when `reminder` is 'custom'. */
  reminderCustom?: CustomReminder;
  repeat: Repeat;
  courseCode?: string;
  done: boolean;
  /** ISO */
  completedAt?: string;
  /** ISO */
  createdAt: string;
}

export type TaskDraft = Pick<
  Task,
  'title' | 'notes' | 'date' | 'time' | 'reminder' | 'reminderCustom' | 'repeat' | 'courseCode'
>;

export interface TaskSection {
  key: string;
  title: string;
  tasks: Task[];
}

/** Hour used for reminders of tasks that have a date but no time. */
const MORNING_HOUR = 8;

const pad2 = (n: number) => String(n).padStart(2, '0');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const isDateKey = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v);
export const isTimeKey = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v);

/** A real clock time, not just the 'HH:mm' shape ('25:70' is out). */
const isClock = (v: unknown): v is string => {
  if (!isTimeKey(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h < 24 && m < 60;
};

/** Local calendar day of a Date as 'YYYY-MM-DD'. */
export const dateKey = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const todayKey = (now: Date = new Date()): string => dateKey(now);

/** 'YYYY-MM-DD' → that day at local midnight. */
export const parseDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Adds whole days by calendar fields, so a daylight-saving change never shifts the day. */
const addDays = (key: string, days: number): string => {
  const d = parseDateKey(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
};

const parseTime = (hhmm: string): { h: number; m: number } => {
  const [h, m] = hhmm.split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
};

/** A day key at a given local hour and minute. */
const at = (key: string, h: number, m: number): Date => {
  const d = parseDateKey(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
};

const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'اليوم' / 'غداً' / 'أمس', otherwise 'الإثنين، 23 نوفمبر' ('Mon, 23 Nov'), with the year when it is not this year. */
export const formatTaskDate = (key: string, now: Date = new Date()): string => {
  const today = todayKey(now);
  if (key === today) return tr('اليوم', 'Today');
  if (key === addDays(today, 1)) return tr('غداً', 'Tomorrow');
  if (key === addDays(today, -1)) return tr('أمس', 'Yesterday');
  const d = parseDateKey(key);
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return tr(
    `${AR_DAYS[d.getDay()]}، ${d.getDate()} ${AR_MONTHS[d.getMonth()]}${year}`,
    `${EN_DAYS[d.getDay()]}, ${d.getDate()} ${EN_MONTHS[d.getMonth()]}${year}`,
  );
};

/** '15:00' → '3:00 م' ('3:00 PM'); the digits stay left-to-right inside Arabic text. */
export const formatTime = (hhmm: string): string => {
  const { h, m } = parseTime(hhmm);
  const clock = ltr(`${hour12(h)}:${pad2(m)}`);
  return h < 12 ? tr(`${clock} ص`, `${clock} AM`) : tr(`${clock} م`, `${clock} PM`);
};

/** When the task is due: date + time, or the end of its day when it has no time; null without a date. */
export const dueAt = (task: Pick<Task, 'date' | 'time'>): Date | null => {
  if (!task.date) return null;
  if (task.time) {
    const { h, m } = parseTime(task.time);
    return at(task.date, h, m);
  }
  const d = parseDateKey(task.date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
};

/** The reminder choices that make sense for what the task has (a reminder needs at least a date). */
export const reminderOptions = (p: { date?: string; time?: string }): ReminderOffset[] => {
  if (p.time) return ['atTime', '10m', '1h', '1d', 'custom'];
  if (p.date) return ['morning', '1d', 'custom'];
  return [];
};

/**
 * A custom reminder that is whole and fits the task, rebuilt from anything (a draft or a saved
 * file): numbers are rounded and kept in range. 'before' needs a task time, so it is dropped
 * without one. Undefined when nothing usable is left.
 */
export const cleanCustomReminder = (v: unknown, hasTime: boolean): CustomReminder | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Record<string, unknown>;
  if (c.kind === 'before') {
    if (!hasTime || typeof c.minutes !== 'number' || !Number.isFinite(c.minutes)) return undefined;
    const minutes = Math.round(c.minutes);
    if (minutes < 1) return undefined;
    return { kind: 'before', minutes: Math.min(MAX_BEFORE_MINUTES, minutes) };
  }
  if (c.kind === 'at') {
    if (!isClock(c.time) || typeof c.daysBefore !== 'number' || !Number.isFinite(c.daysBefore)) return undefined;
    const daysBefore = Math.min(MAX_DAYS_BEFORE, Math.max(0, Math.round(c.daysBefore)));
    return { kind: 'at', daysBefore, time: c.time };
  }
  return undefined;
};

/** Two custom reminders say the same thing (both missing counts as the same). */
export const sameCustomReminder = (a?: CustomReminder, b?: CustomReminder): boolean => {
  if (!a || !b) return !a && !b;
  if (a.kind === 'before' && b.kind === 'before') return a.minutes === b.minutes;
  if (a.kind === 'at' && b.kind === 'at') return a.daysBefore === b.daysBefore && a.time === b.time;
  return false;
};

export type DurationUnit = 'm' | 'h' | 'd';
const UNIT_MINUTES: Record<DurationUnit, number> = { m: 1, h: 60, d: 24 * 60 };

export const unitMinutes = (unit: DurationUnit): number => UNIT_MINUTES[unit];

/** Minutes in the largest whole unit: 120 → 2 hours, 2880 → 2 days, 90 stays 90 minutes. */
export const splitMinutes = (minutes: number): { n: number; unit: DurationUnit } => {
  if (minutes % UNIT_MINUTES.d === 0) return { n: minutes / UNIT_MINUTES.d, unit: 'd' };
  if (minutes % UNIT_MINUTES.h === 0) return { n: minutes / UNIT_MINUTES.h, unit: 'h' };
  return { n: minutes, unit: 'm' };
};

/** Arabic counted nouns: one, two, 3–10 and 11+ each take their own form. */
const AR_UNITS: Record<DurationUnit, [string, string, string, string]> = {
  m: ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'],
  h: ['ساعة', 'ساعتين', 'ساعات', 'ساعة'],
  d: ['يوم', 'يومين', 'أيام', 'يوماً'],
};

const arCount = (n: number, unit: DurationUnit): string => {
  const [one, two, few, many] = AR_UNITS[unit];
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${n <= 10 ? few : many}`;
};

const enCount = (n: number, unit: DurationUnit, short: boolean): string => {
  if (unit === 'm') return short ? `${n} min` : `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  const word = unit === 'h' ? 'hour' : 'day';
  return `${n} ${n === 1 ? word : `${word}s`}`;
};

/** 'دقيقتين' / '30 دقيقة' ('2 minutes' / '30 minutes'). `short` writes 'min' in English. */
export const durationWords = (minutes: number, short = false): string => {
  const { n, unit } = splitMinutes(minutes);
  return tr(arCount(n, unit), enCount(n, unit, short));
};

/** 'غداً' / 'بعد يومين' ('tomorrow' / 'in 2 days'): how far the task is from a reminder N days before it. */
export const daysAheadWords = (days: number): string => {
  if (days === 0) return tr('اليوم', 'today');
  if (days === 1) return tr('غداً', 'tomorrow');
  return tr(`بعد ${arCount(days, 'd')}`, `in ${enCount(days, 'd', false)}`);
};

/** 'يوم المهمة' / 'قبل يومين' ('On the day' / '2 days before'): the day part of an 'at' reminder. */
export const daysBeforeLabel = (days: number): string => {
  if (days === 0) return tr('يوم المهمة', 'On the day');
  return tr(`قبل ${arCount(days, 'd')}`, `${enCount(days, 'd', false)} before`);
};

/** 'قبل 30 دقيقة' / 'قبل يوم 9:00 م' ('30 min before' / '1 day before, 9:00 PM'). */
export const customReminderLabel = (c: CustomReminder): string => {
  if (c.kind === 'before') {
    const w = durationWords(c.minutes, true);
    return tr(`قبل ${w}`, `${w} before`);
  }
  const day = daysBeforeLabel(c.daysBefore);
  return tr(`${day} ${formatTime(c.time)}`, `${day}, ${formatTime(c.time)}`);
};

/** `custom` is the task's own custom value; without one the 'custom' choice just reads 'مخصص'. */
export const reminderLabel = (r: ReminderOffset, hasTime: boolean, custom?: CustomReminder): string => {
  const morning = formatTime(`${pad2(MORNING_HOUR)}:00`);
  switch (r) {
    case 'custom':
      return custom ? customReminderLabel(custom) : tr('مخصص', 'Custom');
    case 'atTime':
      return tr('عند الموعد', 'At due time');
    case '10m':
      return tr('قبل 10 دقائق', '10 min before');
    case '1h':
      return tr('قبل ساعة', '1 hour before');
    case '1d':
      return hasTime ? tr('قبل يوم', '1 day before') : tr(`قبل يوم ${morning}`, `Day before, ${morning}`);
    case 'morning':
      return tr(`صباح اليوم ${morning}`, `Same day, ${morning}`);
  }
};

/** When the reminder should go off for the task's current date, or null when it has none. */
export const reminderFireDate = (task: Pick<Task, 'date' | 'time' | 'reminder' | 'reminderCustom'>): Date | null => {
  if (!task.reminder || !task.date) return null;
  if (task.reminder === 'custom') {
    const c = cleanCustomReminder(task.reminderCustom, !!task.time);
    if (!c) return null;
    if (c.kind === 'at') {
      const { h, m } = parseTime(c.time);
      return at(addDays(task.date, -c.daysBefore), h, m);
    }
    // By calendar fields, like the fixed choices: the Date constructor carries the minutes back
    // across hours and days on the local clock.
    const { h, m } = parseTime(task.time as string);
    return at(task.date, h, m - c.minutes);
  }
  if (!task.time) {
    if (task.reminder === '1d') return at(addDays(task.date, -1), MORNING_HOUR, 0);
    // Any other choice on a task without a time falls back to the morning of its day.
    return at(task.date, MORNING_HOUR, 0);
  }
  const { h, m } = parseTime(task.time);
  switch (task.reminder) {
    case 'atTime':
      return at(task.date, h, m);
    case '10m':
      return at(task.date, h, m - 10);
    case '1h':
      return at(task.date, h - 1, m);
    case '1d':
      return at(addDays(task.date, -1), h, m);
    case 'morning':
      return at(task.date, MORNING_HOUR, 0);
  }
};

/** "You'll get a notification on Monday at 10:59 PM", from when the reminder will fire. */
export const fireHint = (fire: Date, now: Date = new Date()): string => {
  const key = dateKey(fire);
  const today = todayKey(now);
  const time = formatTime(`${pad2(fire.getHours())}:${pad2(fire.getMinutes())}`);
  const relative = key === today || key === addDays(today, 1);
  const day = formatTaskDate(key, now);
  const dayAr = relative ? day : `يوم ${day}`;
  const dayEn = relative ? day.toLowerCase() : `on ${day}`;
  return tr(`سيصلك إشعار ${dayAr} الساعة ${time}`, `You'll get a notification ${dayEn} at ${time}`);
};

/**
 * When the reminder will really ring next. A repeating task keeps a daily or weekly trigger even
 * after its own reminder time has passed, so that time is moved on by whole periods until it is
 * in the future; a one-off reminder stays as it is (and may be in the past).
 */
export const nextReminderAt = (
  task: Pick<Task, 'date' | 'time' | 'reminder' | 'reminderCustom' | 'repeat'>,
  now: Date = new Date(),
): Date | null => {
  const fire = reminderFireDate(task);
  if (!fire || task.repeat === 'none' || fire.getTime() > now.getTime()) return fire;
  const step = task.repeat === 'daily' ? 1 : 7;
  // Jump most of the way in one go (an old daily task may be years behind), then step by calendar
  // days so a daylight-saving change keeps the same clock time.
  const behind = Math.floor((now.getTime() - fire.getTime()) / (step * 24 * 60 * 60 * 1000)) * step;
  let days = Math.max(0, behind - step);
  const shifted = () =>
    new Date(fire.getFullYear(), fire.getMonth(), fire.getDate() + days, fire.getHours(), fire.getMinutes());
  while (shifted().getTime() <= now.getTime()) days += step;
  return shifted();
};

export const repeatLabel = (r: Repeat): string => {
  switch (r) {
    case 'none':
      return tr('لا يتكرر', 'Does not repeat');
    case 'daily':
      return tr('يومياً', 'Daily');
    case 'weekly':
      return tr('أسبوعياً', 'Weekly');
  }
};

/**
 * The next date of a repeating task after its current one. Missed days are skipped: finishing a
 * daily task that is three days late moves it to tomorrow, not to two days ago.
 */
export const nextOccurrence = (task: Pick<Task, 'date' | 'repeat'>, now: Date = new Date()): string | undefined => {
  if (!task.date || task.repeat === 'none') return undefined;
  const step = task.repeat === 'daily' ? 1 : 7;
  const today = todayKey(now);
  let next = addDays(task.date, step);
  // Keys compare correctly as strings ('YYYY-MM-DD').
  while (next <= today) next = addDays(next, step);
  return next;
};

/** Not done and past its due time (a task without a time is late only once its day is over). */
export const isOverdue = (task: Task, now: Date = new Date()): boolean => {
  if (task.done) return false;
  const due = dueAt(task);
  return due !== null && due.getTime() < now.getTime();
};

/**
 * Cleans a draft before saving: trims text, gives a time without a date today's date, drops a
 * reminder that no longer fits (a custom one also when its value is missing or does not fit), and
 * turns repeat off when there is no date to repeat from.
 */
export const normalizeDraft = (d: TaskDraft): TaskDraft => {
  const title = d.title.trim();
  const notes = d.notes?.trim() || undefined;
  const time = isTimeKey(d.time) ? d.time : undefined;
  let date = isDateKey(d.date) ? d.date : undefined;
  if (time && !date) date = todayKey();
  let reminder = d.reminder && reminderOptions({ date, time }).includes(d.reminder) ? d.reminder : null;
  const reminderCustom = reminder === 'custom' ? cleanCustomReminder(d.reminderCustom, !!time) : undefined;
  if (reminder === 'custom' && !reminderCustom) reminder = null;
  const repeat = date && (d.repeat === 'daily' || d.repeat === 'weekly') ? d.repeat : 'none';
  const courseCode = d.courseCode?.trim() || undefined;
  // reminderCustom is always listed (maybe undefined), so saving over a task clears an old value.
  return { title, notes, date, time, reminder, reminderCustom, repeat, courseCode };
};

/** Undone first, then by date, timed tasks by time with all-day ones after, then oldest first. */
const compareTasks = (a: Task, b: Task): number => {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }
  if (a.time !== b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
};

/** Newest completion first. */
const compareDone = (a: Task, b: Task): number => (b.completedAt ?? '').localeCompare(a.completedAt ?? '');

const section = (key: string, title: string, tasks: Task[], sort = compareTasks): TaskSection[] =>
  tasks.length > 0 ? [{ key, title, tasks: [...tasks].sort(sort) }] : [];

const overdueTitle = () => tr('متأخرة', 'Overdue');
const noDateTitle = () => tr('بدون موعد', 'No date');
const doneTitle = () => tr('المنجزة', 'Done');

/** True when the task was ticked off on the given local day. */
const completedOn = (task: Task, key: string): boolean =>
  !!task.completedAt && dateKey(new Date(task.completedAt)) === key;

/**
 * A repeating task ticked off today. It moved on to its next date and stays open, so only its
 * completedAt tells that today's occurrence was finished.
 */
export const repeatDoneToday = (task: Task, now: Date = new Date()): boolean =>
  !task.done && task.repeat !== 'none' && completedOn(task, todayKey(now));

/** Groups tasks into the sections shown for a filter; empty sections are left out. */
export const groupTasks = (tasks: Task[], filter: TaskFilter, now: Date = new Date()): TaskSection[] => {
  const today = todayKey(now);
  const undone = tasks.filter((t) => !t.done);
  const overdue = undone.filter((t) => isOverdue(t, now));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const onTime = undone.filter((t) => !overdueIds.has(t.id));
  const noDate = onTime.filter((t) => !t.date);
  const done = tasks.filter((t) => t.done);

  if (filter === 'today') {
    // Tasks ticked off today stay in view (struck through) so a tick does not make them jump away.
    const doneToday = done.filter((t) => t.date === today || (completedOn(t, today) && !!t.date && t.date < today));
    const doneNoDate = done.filter((t) => !t.date && completedOn(t, today));
    return [
      ...section('overdue', overdueTitle(), overdue),
      ...section('today', tr('اليوم', 'Today'), [...onTime.filter((t) => t.date === today), ...doneToday]),
      ...section('nodate', noDateTitle(), [...noDate, ...doneNoDate]),
    ];
  }

  const byDate = (list: Task[]): TaskSection[] => {
    const keys = [...new Set(list.map((t) => t.date as string))].sort();
    return keys.flatMap((key) => section(key, formatTaskDate(key, now), list.filter((t) => t.date === key)));
  };

  if (filter === 'upcoming') return byDate(onTime.filter((t) => !!t.date && t.date > today));

  if (filter === 'done') return section('done', doneTitle(), done, compareDone);

  return [
    ...section('overdue', overdueTitle(), overdue),
    ...byDate(onTime.filter((t) => !!t.date)),
    ...section('nodate', noDateTitle(), noDate),
    ...section('done', doneTitle(), done, compareDone),
  ];
};

/** The number on a filter chip: open tasks for today/upcoming, finished ones for done, every task for all. */
export const countForFilter = (tasks: Task[], filter: TaskFilter, now: Date = new Date()): number => {
  if (filter === 'all') return tasks.length;
  if (filter === 'done') return tasks.filter((t) => t.done).length;
  return groupTasks(tasks, filter, now).reduce((n, s) => n + s.tasks.filter((t) => !t.done).length, 0);
};
