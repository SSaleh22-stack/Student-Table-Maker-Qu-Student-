/**
 * The timetable as an iCalendar (.ics) file: one weekly repeating event per class time,
 * for the iPhone, Google or Outlook calendar. Times are Saudi time (Asia/Riyadh, no DST).
 */
import { tr } from '@/lib/i18n';
import { activityLabel, slotsOf } from '@/lib/courses';
import type { Course } from '@/lib/types';

import { addDays, ymd } from './dates';

const TZID = 'Asia/Riyadh';
const BYDAY: Record<string, string> = { Sun: 'SU', Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA' };
const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface IcsOptions {
  /** First day of the first week (a Sunday) */
  start: Date;
  /** Number of teaching weeks */
  weeks: number;
  /** Reminder before each class, in minutes; null for none */
  reminderMinutes: number | null;
}

/** Escapes text values (RFC 5545 §3.3.11). */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const utf8Length = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
};

/** Folds a content line to 75 bytes per line, never splitting a character (RFC 5545 §3.1). */
const fold = (line: string): string => {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = utf8Length(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
};

/** "20261028T080000" in local (Riyadh) time */
const localStamp = (day: Date, hhmm: string) => `${ymd(day)}T${hhmm.replace(':', '')}00`;

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export const buildIcs = (chosen: Course[], { start, weeks, reminderMinutes }: IcsOptions): string => {
  const lastDay = addDays(start, weeks * 7 - 1);
  // 23:59:59 Riyadh time on the last day, written in UTC (Riyadh is UTC+3 all year).
  const until = `${ymd(lastDay)}T205959Z`;
  const stamp = utcStamp(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Qu Student//Timetable//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${tr('جدولي الدراسي', 'My class timetable')}`,
    `X-WR-TIMEZONE:${TZID}`,
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0300',
    'TZNAME:+03',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const section of chosen) {
    const activity = activityLabel(section);
    slotsOf(section).forEach((slot, i) => {
      const days = slot.days.filter((d) => d in BYDAY);
      if (days.length === 0) return;
      // The first class on or after the start date.
      let first = start;
      for (let k = 0; k < 7; k++) {
        const day = addDays(start, k);
        if (days.some((d) => DAY_INDEX[d] === day.getDay())) {
          first = day;
          break;
        }
      }
      const room = slot.location ?? section.location;
      const details = [
        `${tr('الشعبة', 'Section')} ${section.section}${activity ? ` (${activity})` : ''}`,
        section.instructor,
        room,
      ].filter(Boolean);

      lines.push(
        'BEGIN:VEVENT',
        `UID:${section.id.replace(/[^\w.-]/g, '_')}-${i}@qustudent`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${localStamp(first, slot.startTime)}`,
        `DTEND;TZID=${TZID}:${localStamp(first, slot.endTime)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')};UNTIL=${until}`,
        `SUMMARY:${text(`${section.code} ${section.name}${activity && activity !== 'نظري' && activity !== 'Lecture' ? ` (${activity})` : ''}`)}`,
        ...(room ? [`LOCATION:${text(room)}`] : []),
        `DESCRIPTION:${text(details.join('\n'))}`
      );
      if (reminderMinutes) {
        lines.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${text(section.code)}`,
          `TRIGGER:-PT${reminderMinutes}M`,
          'END:VALARM'
        );
      }
      lines.push('END:VEVENT');
    });
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
};
