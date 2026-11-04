/**
 * Reads Qassim University's academic calendar page (https://www.qu.edu.sa/academic-calendar/).
 *
 * The page has one table per programme (undergraduate, graduate). Each row is an event with a
 * start date and sometimes an end date, written as "الأحد 1448/03/10هـ الموافق 2026/08/23م";
 * holidays have the row class "qu-holiday". The page is someone else's site, so everything
 * read from it is treated as untrusted text and size-limited.
 */

export const CALENDAR_URL = 'https://www.qu.edu.sa/academic-calendar/';

export interface CalendarDate {
  /** e.g. "الأحد" */
  weekday: string;
  /** Hijri date as written, e.g. "1448/03/10" */
  hijri: string;
  /** Gregorian date, "2026-08-23" */
  iso: string;
}

export interface CalendarEvent {
  title: string;
  start: CalendarDate;
  end?: CalendarDate;
  holiday: boolean;
}

export interface CalendarSection {
  /** The table's caption, e.g. "التقويم الأكاديمي للفصل الدراسي الأول (481) … — المرحلة الجامعية" */
  title: string;
  kind: 'undergrad' | 'grad' | 'other';
  /** Picture of the whole calendar, when the page links one */
  imageUrl?: string;
  events: CalendarEvent[];
}

const MAX_TABLES = 8;
const MAX_EVENTS = 120;
const MAX_TEXT = 300;

const NAMED: Record<string, string> = {
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
};

const decode = (s: string) =>
  s
    .replace(/&#(\d{1,7});/g, (_, n: string) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);

const safeChar = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');

/** Visible text of an HTML fragment, spaces collapsed. */
const textOf = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);

const pad = (n: string) => n.padStart(2, '0');

/** "الأحد 1448/03/10هـ الموافق 2026/08/23م" → its parts; null without a Gregorian date. */
const parseDate = (cellHtml: string): CalendarDate | null => {
  const t = textOf(cellHtml);
  const g = t.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*م/);
  if (!g) return null;
  const [, y, m, d] = g;
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const h = t.match(/(\d{4}\/\d{1,2}\/\d{1,2})\s*هـ/);
  const weekday = t.split(' ')[0] ?? '';
  return {
    weekday: /^[؀-ۿ]+$/.test(weekday) ? weekday : '',
    hijri: h ? h[1] : '',
    iso: `${y}-${pad(m)}-${pad(d)}`,
  };
};

/** Only links to the university's own site. */
const safeUrl = (url: string | undefined) =>
  url && /^https:\/\/(www\.)?qu\.edu\.sa\/[^\s"'<>]+$/i.test(url) ? url : undefined;

export function parseAcademicCalendar(html: string): CalendarSection[] {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi)?.slice(0, MAX_TABLES) ?? [];
  const sections: CalendarSection[] = [];

  for (const table of tables) {
    const caption = table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? '';
    const title = textOf(caption);
    const imageUrl = safeUrl(decode(caption.match(/href="([^"]+)"/i)?.[1] ?? ''));
    const events: CalendarEvent[] = [];

    for (const rowHtml of table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
      if (/<th\b/i.test(rowHtml)) continue;
      const [titleCell, startCell, endCell] = rowHtml.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) ?? [];
      if (!titleCell || !startCell) continue;
      const eventTitle = textOf(titleCell);
      const start = parseDate(startCell);
      if (!eventTitle || !start) continue;
      const end = endCell ? parseDate(endCell) : null;
      events.push({
        title: eventTitle,
        start,
        end: end && end.iso !== start.iso ? end : undefined,
        holiday: /^<tr\b[^>]*class="[^"]*\bqu-holiday\b/i.test(rowHtml),
      });
      if (events.length >= MAX_EVENTS) break;
    }

    if (events.length === 0) continue;
    sections.push({
      title,
      kind: title.includes('الدراسات العليا') ? 'grad' : title.includes('الجامعية') ? 'undergrad' : 'other',
      imageUrl,
      events,
    });
  }
  return sections;
}

/** Checks data read back from storage (it could be from an older app version, or damaged). */
export function isCalendarSections(value: unknown): value is CalendarSection[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (s) =>
        s &&
        typeof s.title === 'string' &&
        Array.isArray(s.events) &&
        s.events.every(
          (e: CalendarEvent) =>
            e &&
            typeof e.title === 'string' &&
            e.start &&
            typeof e.start.iso === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(e.start.iso),
        ),
    )
  );
}
