/**
 * Display helpers shared by the timetable and the course list:
 * soft course colors, translated day names and section counts.
 */
import type { Language } from '../types';

export interface CourseTheme {
  bg: string;
  text: string;
  border: string;
}

// Soft backgrounds with dark text (all pairs pass 4.5:1 contrast)
const palette: CourseTheme[] = [
  { bg: '#DCEBFF', text: '#1E3A8A', border: '#BBD3FB' },
  { bg: '#D8F3E8', text: '#065F46', border: '#A9E2C8' },
  { bg: '#FFE7CC', text: '#9A3412', border: '#F7C99A' },
  { bg: '#F6DDF0', text: '#86198F', border: '#EBB8DF' },
  { bg: '#E9E3FF', text: '#4C1D95', border: '#CFC3FB' },
  { bg: '#D5F1F6', text: '#155E75', border: '#A5DCE8' },
  { bg: '#FDE2E4', text: '#9F1239', border: '#F7B9BF' },
  { bg: '#FEF3C7', text: '#854D0E', border: '#F2D888' },
  { bg: '#E2F0D9', text: '#3F6212', border: '#C3DFAE' },
  { bg: '#E5E9F2', text: '#334155', border: '#C9D1E0' },
];

/** Same course code always gets the same color. */
export const getCourseTheme = (courseCode: string): CourseTheme => {
  let hash = 0;
  for (let i = 0; i < courseCode.length; i++) {
    hash = courseCode.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
};

interface DayNames {
  sunday: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
}

/** Turns ["Sun", "Tue"] into "الأحد، الثلاثاء" (or "Sunday, Tuesday"). */
export const formatDays = (days: string[], t: DayNames, language: Language): string => {
  const names: Record<string, string> = {
    Sun: t.sunday,
    Mon: t.monday,
    Tue: t.tuesday,
    Wed: t.wednesday,
    Thu: t.thursday,
    Fri: t.friday,
    Sat: t.saturday,
  };
  return days.map((day) => names[day] ?? day).join(language === 'ar' ? '، ' : ', ');
};

/** "3 شعب", "شعبتان", "1 section", ... */
export const sectionsLabel = (count: number, language: Language): string => {
  if (language === 'en') {
    return `${count} ${count === 1 ? 'section' : 'sections'}`;
  }
  if (count === 1) return 'شعبة واحدة';
  if (count === 2) return 'شعبتان';
  if (count >= 3 && count <= 10) return `${count} شعب`;
  return `${count} شعبة`;
};

/** "5 مقررات", "1 course", ... */
export const coursesLabel = (count: number, language: Language): string => {
  if (language === 'en') {
    return `${count} ${count === 1 ? 'course' : 'courses'}`;
  }
  if (count === 1) return 'مقرر واحد';
  if (count === 2) return 'مقرران';
  if (count >= 3 && count <= 10) return `${count} مقررات`;
  return `${count} مقرراً`;
};
