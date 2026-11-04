/**
 * Display helpers for courses: colors, day names, labels and grouping (Arabic or English).
 * Ported from the extension's src/lib/courseTheme.ts.
 */
import { isEnglish, tr } from './i18n';
import { ltr } from './rtl';
import type { Course, Exam, TimeSlot } from './types';

/** Teaching days shown in the weekly grid, in order. */
export const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'] as const;

const DAY_NAMES: Record<string, string> = {
  Sun: 'الأحد',
  Mon: 'الاثنين',
  Tue: 'الثلاثاء',
  Wed: 'الأربعاء',
  Thu: 'الخميس',
  Fri: 'الجمعة',
  Sat: 'السبت',
};

const DAY_LETTERS: Record<string, string> = {
  Sun: 'ح',
  Mon: 'ن',
  Tue: 'ث',
  Wed: 'ر',
  Thu: 'خ',
  Fri: 'ج',
  Sat: 'س',
};

const DAY_NAMES_EN: Record<string, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
};

export const dayName = (day: string) => (isEnglish() ? DAY_NAMES_EN[day] : DAY_NAMES[day]) ?? day;

/** List separator: "،" in Arabic, "," in English. */
export const listSep = () => tr('، ', ', ');

/** "الأحد، الثلاثاء" */
export const formatDays = (days: string[]) => days.map(dayName).join(listSep());

/** "أحد، ثلاثاء": day names without "ال" ("Sun, Tue" in English), for small cards */
export const formatDaysCompact = (days: string[]) =>
  isEnglish() ? days.join(', ') : days.map((d) => dayName(d).replace(/^ال/, '')).join('، ');

/** "ح ث" (the short form used on the portal; "Su Tu" in English) */
export const formatDaysShort = (days: string[]) =>
  days.map((d) => (isEnglish() ? d.slice(0, 2) : (DAY_LETTERS[d] ?? d))).join(' ');

export interface CourseTheme {
  bg: string;
  text: string;
  border: string;
  bar: string;
}

// Soft backgrounds with dark text (all pairs pass 4.5:1 contrast), plus a stronger bar color.
const PALETTE: CourseTheme[] = [
  { bg: '#DCEBFF', text: '#1E3A8A', border: '#BBD3FB', bar: '#3B82F6' },
  { bg: '#D8F3E8', text: '#065F46', border: '#A9E2C8', bar: '#10B981' },
  { bg: '#FFE7CC', text: '#9A3412', border: '#F7C99A', bar: '#F59E0B' },
  { bg: '#F6DDF0', text: '#86198F', border: '#EBB8DF', bar: '#EC4899' },
  { bg: '#E9E3FF', text: '#4C1D95', border: '#CFC3FB', bar: '#8B5CF6' },
  { bg: '#D5F1F6', text: '#155E75', border: '#A5DCE8', bar: '#06B6D4' },
  { bg: '#FDE2E4', text: '#9F1239', border: '#F7B9BF', bar: '#F43F5E' },
  { bg: '#FEF3C7', text: '#854D0E', border: '#F2D888', bar: '#EAB308' },
  { bg: '#E2F0D9', text: '#3F6212', border: '#C3DFAE', bar: '#65A30D' },
  { bg: '#E5E9F2', text: '#334155', border: '#C9D1E0', bar: '#64748B' },
];

/** The same course code always gets the same color. */
export const getCourseTheme = (code: string): CourseTheme => {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
};

export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * True when a section has real lecture days and times. Sections without a time
 * (projects, online courses) stay out of the grid and appear in the summary only.
 */
export const hasSchedule = (c: { days: string[]; startTime: string; endTime: string }): boolean =>
  c.days.length > 0 && !!c.startTime && !!c.endTime;

/** Every weekly time slot of a section (a section can meet at different times on different days). */
export const slotsOf = (course: Course): TimeSlot[] => {
  if (course.timeSlots && course.timeSlots.length > 0) {
    return course.timeSlots.filter((s) => hasSchedule(s));
  }
  if (!hasSchedule(course)) return [];
  return [{ days: course.days, startTime: course.startTime, endTime: course.endTime, location: course.location }];
};

/** 13 → 1, 0 → 12: hours on a 12-hour clock, the way students read class times. */
export const hour12 = (hour: number): number => (hour % 12 === 0 ? 12 : hour % 12);

/** "13:30" → "1:30", "08:00" → "8:00" */
export const time12 = (time: string): string => {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  return `${hour12(h)}:${String(m).padStart(2, '0')}`;
};

/** "1:00–2:40", kept left-to-right inside Arabic text */
export const formatTimeRange = (start: string, end: string): string => ltr(`${time12(start)}–${time12(end)}`);

/** 570 → "09:30" */
export const fromMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "10–11:30": whole hours without ":00", for tight spaces */
export const formatTimeRangeShort = (start: string, end: string): string => {
  const short = (t: string) => time12(t).replace(/:00$/, '');
  return ltr(`${short(start)}–${short(end)}`);
};

/** "الأحد، الثلاثاء · 8:00–9:30" for each slot, joined. */
export const formatSchedule = (course: Course): string => {
  const slots = slotsOf(course);
  if (slots.length === 0) return tr('بدون وقت محدد', 'No set time');
  return slots.map((s) => `${formatDays(s.days)} · ${formatTimeRange(s.startTime, s.endTime)}`).join(' / ');
};

/** "ح ث · 8:00" */
export const formatScheduleShort = (course: Course): string => {
  const slots = slotsOf(course);
  if (slots.length === 0) return tr('بدون وقت', 'No time');
  return slots.map((s) => `${formatDaysShort(s.days)} · ${ltr(time12(s.startTime))}`).join(' / ');
};

/** The portal only gives an exam period, so we never show a guessed time. */
export const formatExam = (exam?: Exam): string | null => {
  if (!exam) return null;
  if (exam.date) return tr(`الفترة ${exam.date}`, `Period ${exam.date}`);
  return null;
};

export const creditHours = (course: Course): number => {
  const n = parseInt(course.hours ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};

/** A course's credit hours, counted once even when several of its sections are chosen (نظري + عملي). */
export const courseHours = (sections: Course[]): number => Math.max(0, ...sections.map(creditHours));

const CLASS_TYPE_LABEL: Record<string, string> = { theoretical: 'نظري', practical: 'عملي', exercise: 'تدريب' };

const ACTIVITY_EN: Record<string, string> = { نظري: 'Lecture', عملي: 'Lab', تدريب: 'Tutorial', تمارين: 'Exercises' };

/** The activity in Arabic, as the portal names it (used to match sections, never translated). */
const activityRaw = (course: Course): string | null =>
  course.activity?.trim() || (course.classType ? CLASS_TYPE_LABEL[course.classType] : null);

/** "نظري", "عملي", "تدريب"… as the portal names the section's activity (النشاط); English names in English. */
export const activityLabel = (course: Course): string | null => {
  const raw = activityRaw(course);
  if (!raw || !isEnglish()) return raw;
  return ACTIVITY_EN[raw] ?? raw;
};

/** Sections of a course with the same activity are alternatives to each other. */
export const activityKey = (course: Course): string => (activityRaw(course) ?? '').trim();

/** An activity key (Arabic, from the portal) as shown in the app language. */
export const activityName = (key: string): string => (isEnglish() ? (ACTIVITY_EN[key] ?? key) : key);

/** Lecture hours per week, from the section's time slots (rounded to the nearest half hour). */
export const weeklyHours = (course: Course): number => {
  const minutes = slotsOf(course).reduce(
    (sum, s) => sum + s.days.length * Math.max(0, toMinutes(s.endTime) - toMinutes(s.startTime)),
    0
  );
  return Math.round((minutes / 60) * 2) / 2;
};

/**
 * Weekly hours of one course from its chosen sections: one section per activity counts
 * (نظري + عملي …). Two sections of the same activity count once, at the longer one.
 */
export const courseWeeklyHours = (sections: Course[]): number => {
  const byActivity = new Map<string, number>();
  for (const s of sections) {
    const key = activityKey(s);
    byActivity.set(key, Math.max(byActivity.get(key) ?? 0, weeklyHours(s)));
  }
  return [...byActivity.values()].reduce((n, h) => n + h, 0);
};

/** "3 شعب", "شعبتان", ... */
export const sectionsLabel = (count: number): string => {
  if (isEnglish()) return count === 1 ? '1 section' : `${count} sections`;
  if (count === 1) return 'شعبة واحدة';
  if (count === 2) return 'شعبتان';
  if (count >= 3 && count <= 10) return `${count} شعب`;
  return `${count} شعبة`;
};

/** "5 مقررات", ... */
export const coursesLabel = (count: number): string => {
  if (isEnglish()) return count === 0 ? 'No courses' : count === 1 ? '1 course' : `${count} courses`;
  if (count === 0) return 'لا مقررات';
  if (count === 1) return 'مقرر واحد';
  if (count === 2) return 'مقرران';
  if (count >= 3 && count <= 10) return `${count} مقررات`;
  return `${count} مقرراً`;
};

/** "3 ساعات", "ساعتان", ... */
export const hoursLabel = (count: number): string => {
  if (isEnglish()) return count === 1 ? '1 hour' : `${count} hours`;
  if (count === 0) return '0 ساعة';
  if (count === 1) return 'ساعة واحدة';
  if (count === 2) return 'ساعتان';
  if (count >= 3 && count <= 10) return `${count} ساعات`;
  return `${count} ساعة`;
};

export interface CourseGroup {
  code: string;
  name: string;
  sections: Course[];
}

/** Groups sections by course code, keeping the portal's order. */
export const groupCourses = (courses: Course[]): CourseGroup[] => {
  const map = new Map<string, CourseGroup>();
  for (const c of courses) {
    const g = map.get(c.code);
    if (g) g.sections.push(c);
    else map.set(c.code, { code: c.code, name: c.name, sections: [c] });
  }
  return [...map.values()];
};
