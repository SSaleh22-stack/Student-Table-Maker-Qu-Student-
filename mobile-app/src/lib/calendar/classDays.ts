/**
 * Which days have no lectures, read from the academic calendar (parse.ts), and when the next
 * lectures end. Used by the after-lecture "anything to add to your tasks?" notification so it stays
 * quiet on holidays and once the term's classes are over.
 *
 * Plain functions with no React Native imports, so they run in the Node tests.
 *
 * NO-CLASS RULES (dates are local "YYYY-MM-DD" keys; string order is date order):
 * - A holiday with an end date: every day from its start to its end.
 * - A holiday "بنهاية دوام يوم ..." (starts at the end of that day's work): the day itself still has
 *   classes; the days after it have none until the next "استئناف الدراسة" or "بداية الدراسة" event.
 *   Without such an event, only the days up to its end date (if any) are off.
 * - Any other holiday without an end date: that one day.
 * - Final exams ("الاختبارات النهائية"): from their start until the next "بداية الدراسة" event. When
 *   no later term start is known yet, every day from then on (the term's classes are over).
 *
 * Undergraduate tables are used when there are any (most students), otherwise every table.
 */
import type { CalendarEvent, CalendarSection } from './parse';

export interface NoClassRange {
  /** First day without lectures */
  from: string;
  /** Last day without lectures; undefined: open-ended (no later term start known) */
  to?: string;
}

const AFTER_WORK = 'بنهاية دوام';
const FINALS = 'الاختبارات النهائية';
const isResume = (e: CalendarEvent) => e.title.includes('استئناف الدراسة') || e.title.includes('بداية الدراسة');
const isTermStart = (e: CalendarEvent) => e.title.includes('بداية الدراسة');

/** "2026-11-19" plus `days` days, as a key (calendar math in UTC, so no daylight-saving drift). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** The local date key of a Date ("YYYY-MM-DD"). */
export function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The periods without lectures in these calendar tables. */
export function noClassRanges(sections: readonly CalendarSection[]): NoClassRange[] {
  const undergrad = sections.filter((s) => s.kind === 'undergrad');
  const events = (undergrad.length ? undergrad : sections)
    .flatMap((s) => s.events)
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.start.iso))
    .sort((a, b) => (a.start.iso < b.start.iso ? -1 : a.start.iso > b.start.iso ? 1 : 0));

  /** The first event after `iso` that matches. */
  const nextAfter = (iso: string, match: (e: CalendarEvent) => boolean) => events.find((e) => e.start.iso > iso && match(e));

  const ranges: NoClassRange[] = [];
  for (const e of events) {
    const start = e.start.iso;
    const end = e.end?.iso;
    if (e.title.includes(FINALS)) {
      const next = nextAfter(start, isTermStart);
      ranges.push({ from: start, to: next ? addDays(next.start.iso, -1) : undefined });
      continue;
    }
    if (!e.holiday) continue;
    if (e.title.includes(AFTER_WORK)) {
      const from = addDays(start, 1);
      const resume = nextAfter(start, isResume);
      if (resume) ranges.push({ from, to: addDays(resume.start.iso, -1) });
      else if (end && end >= from) ranges.push({ from, to: end });
      continue;
    }
    ranges.push({ from: start, to: end && end > start ? end : start });
  }
  return ranges.filter((r) => r.to === undefined || r.to >= r.from);
}

/** True when the day (a "YYYY-MM-DD" key) falls in one of the ranges. */
export function isNoClassDay(iso: string, ranges: readonly NoClassRange[]): boolean {
  return ranges.some((r) => iso >= r.from && (r.to === undefined || iso <= r.to));
}

/** One weekly lecture: the day ('Sun'..'Sat') and when it ends, in minutes after midnight. */
export interface WeeklyLecture {
  day: string;
  endMinutes: number;
  code: string;
  name: string;
}

export interface LectureEnd {
  at: Date;
  code: string;
  name: string;
}

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The lecture ends from `now` (exclusive) through the next `days` days, soonest first, skipping
 * no-class days. The same course ending at the same moment twice (two sections, or a split
 * slot) counts once.
 */
export function upcomingLectureEnds(
  lectures: readonly WeeklyLecture[],
  now: Date,
  days: number,
  ranges: readonly NoClassRange[],
): LectureEnd[] {
  const out: LectureEnd[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = localDateKey(day);
    if (isNoClassDay(key, ranges)) continue;
    for (const l of lectures) {
      if (DAY_INDEX[l.day] !== day.getDay()) continue;
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, l.endMinutes);
      if (at.getTime() <= now.getTime()) continue;
      const id = `${key}|${l.endMinutes}|${l.code}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ at, code: l.code, name: l.name });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
