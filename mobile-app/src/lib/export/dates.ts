/** Small date helpers for exports (Gregorian dates, Arabic or English month names). */
import { isEnglish } from '@/lib/i18n';

const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/** "28 أكتوبر 2026" */
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthName = (d: Date) => (isEnglish() ? MONTHS_EN : MONTHS)[d.getMonth()];

/** "28 أكتوبر 2026" ("28 October 2026" in English) */
export const arabicDate = (d: Date): string => `${d.getDate()} ${monthName(d)} ${d.getFullYear()}`;

/** "أكتوبر" */
export const arabicMonth = (d: Date): string => monthName(d);

/** Midnight of the given day, `days` days later (calendar days, safe across clock changes). */
export const addDays = (d: Date, days: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** Sunday of the week that contains `d` (the Saudi week starts on Sunday). */
export const sundayOf = (d: Date): Date => addDays(d, -d.getDay());

/** "20261028" */
export const ymd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
