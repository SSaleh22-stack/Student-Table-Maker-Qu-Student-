/**
 * The PDF's summary page(s): a white card on the teal gradient (same look as the exported image).
 * Totals on top, then one table grouped by course: a title row per course (credit hours)
 * and a row per section (activity, times, room, teacher, exam period, hours). A long table continues on more pages.
 */
import { tr } from '@/lib/i18n';
import {
  activityLabel,
  courseHours,
  courseWeeklyHours,
  creditHours,
  formatDays,
  formatExam,
  getCourseTheme,
  groupCourses,
  hoursLabel,
  slotsOf,
  time12,
  type CourseGroup,
} from '@/lib/courses';
import { clashPairs, examClashes } from '@/lib/schedule';
import type { Course } from '@/lib/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const range = (a: string, b: string) => `<span dir="ltr" class="ltr">${time12(a)}–${time12(b)}</span>`;

/** Room inside the white card (px), and what the table header, totals and clash note take of it. */
const CARD_SPACE = 479;
const TABLE_HEAD = 28;
const STATS = 50;
const NOTE_BASE = 23;
const NOTE_LINE = 16.5;
/** Row heights measured in a printed PDF (px): a course title row, a section row, and each extra time line in it. */
const COURSE_ROW = 30.5;
const SECTION_ROW = 26.5;
const EXTRA_LINE = 16;
/** At most this many clash lines are spelled out; the rest are counted. */
const MAX_NOTES = 3;

export const SUMMARY_CSS = `
.sum-page { width: 842px; height: 595px; position: relative; overflow: hidden; break-before: page; page-break-before: always; background: linear-gradient(160deg, #0E7490, #08485B); padding: 0 24px; display: flex; flex-direction: column; }
.sum-head { height: 62px; flex: 0 0 62px; display: flex; align-items: center; gap: 12px; color: #fff; padding: 0 4px; }
.sum-head svg { flex: 0 0 40px; }
.sum-head .date { color: #CFEAF0; opacity: 1; }
.sum-card { flex: 1; background: #fff; border-radius: 18px; padding: 14px 16px; overflow: hidden; }
.sum-foot { height: 26px; flex: 0 0 26px; display: flex; align-items: center; justify-content: space-between; padding: 0 6px; font-size: 9.5px; color: #CFEAF0; }
.ltr { unicode-bidi: isolate; }
.stats { display: flex; gap: 8px; margin-bottom: 10px; }
.stat { flex: 1; border: 1px solid #E3E9F0; border-radius: 10px; padding: 5px 12px; display: flex; align-items: baseline; gap: 8px; }
.stat b { font-size: 19px; color: #0B5F77; }
.stat span { font-size: 10.5px; color: #64748B; }
.sum-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.sum-table th { background: #0E7490; color: #fff; font-weight: 600; padding: 6px 8px; text-align: start; }
.sum-table td { padding: 5px 8px; border-bottom: 1px solid #EEF2F6; vertical-align: top; }
.sum-table .c { text-align: center; }
.sum-table tr { break-inside: avoid; }
.sum-table tr.course td { background: #F4F8FA; border-bottom: 1px solid #E3E9F0; padding: 6px 8px; }
.sum-table .name { font-weight: 700; font-size: 11.5px; }
.pill { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 9.5px; font-weight: 600; background: #E0F2F6; color: #0B5F77; margin-inline-start: 6px; }
.act { display: inline-block; border-radius: 5px; padding: 0 6px; font-size: 9.5px; background: #EEF2F6; color: #334155; }
.note { margin-top: 10px; border-radius: 8px; padding: 6px 10px; font-size: 10.5px; line-height: 1.6; }
.note.ok { background: #E8F7EE; color: #166534; }
.note.bad { background: #FFF1E2; color: #9A4A0A; border: 1px dashed #E07B1F; }
`;

const roomsOf = (s: Course) => {
  const rooms = [
    ...new Set(
      slotsOf(s)
        .map((t) => t.location ?? s.location)
        .filter((r): r is string => !!r),
    ),
  ];
  if (rooms.length === 0 && s.location) rooms.push(s.location);
  return rooms.join(tr('، ', ', ')) || '—';
};

const timesOf = (s: Course) =>
  slotsOf(s).length
    ? slotsOf(s)
        .map((t) => `${esc(formatDays(t.days))} ${range(t.startTime, t.endTime)}`)
        .join('<br>')
    : tr('بدون وقت', 'No time');

const groupHeight = (g: CourseGroup) =>
  COURSE_ROW + g.sections.reduce((n, s) => n + SECTION_ROW + Math.max(0, slotsOf(s).length - 1) * EXTRA_LINE, 0);

/** The rows of one course: its title row, then a row per section. */
const courseRows = (g: CourseGroup) => {
  const theme = getCourseTheme(g.code);
  return (
    `<tr class="course"><td colspan="7" style="border-inline-start:4px solid ${theme.bar}">` +
    `<span class="code" style="background:${theme.bg};color:${theme.text}">${esc(g.code)}</span> ` +
    `<span class="name">${esc(g.name)}</span>` +
    `<span class="pill">${hoursLabel(courseHours(g.sections))}</span>` +
    '</td></tr>' +
    g.sections
      .map(
        (s) =>
          `<tr><td class="c"><b>${esc(s.section)}</b></td>` +
          `<td class="c"><span class="act">${esc(activityLabel(s) ?? '—')}</span></td>` +
          `<td>${timesOf(s)}</td><td>${esc(roomsOf(s))}</td><td>${esc(s.instructor ?? '—')}</td>` +
          `<td class="c">${esc(formatExam(s.finalExam) ?? '—')}</td>` +
          `<td class="c">${creditHours(s) || '—'}</td></tr>`,
      )
      .join('')
  );
};

/**
 * Splits the courses into page-sized runs (a course is never split). The first page also holds
 * the totals and the clash note (`noteLines` lines), so it has less room for rows.
 */
const paginate = (groups: CourseGroup[], noteLines: number): CourseGroup[][] => {
  const firstSpace = CARD_SPACE - TABLE_HEAD - STATS - (NOTE_BASE + noteLines * NOTE_LINE);
  const nextSpace = CARD_SPACE - TABLE_HEAD;
  const pages: CourseGroup[][] = [[]];
  let used = 0;
  for (const g of groups) {
    const h = groupHeight(g);
    const space = pages.length === 1 ? firstSpace : nextSpace;
    if (used + h > space && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(g);
    used += h;
  }
  return pages;
};

export interface SummaryOptions {
  /** White Qu Student mark (SVG) */
  logo: string;
  date: string;
  subtitle: string;
}

/** The summary page(s) as HTML, ready to follow the timetable page. */
export const buildSummaryPages = (chosen: Course[], { logo, date, subtitle }: SummaryOptions): string => {
  const groups = groupCourses(chosen);
  const credit = groups.reduce((n, g) => n + courseHours(g.sections), 0);
  const weekly = groups.reduce((n, g) => n + courseWeeklyHours(g.sections), 0);
  const pairs = clashPairs(chosen);
  const exams = examClashes(chosen);
  const clashCount = pairs.length + exams.length;

  const stats =
    '<div class="stats">' +
    `<div class="stat"><b>${groups.length}</b><span>${tr('مقررات', 'Courses')}</span></div>` +
    `<div class="stat"><b>${credit}</b><span>${tr('ساعة معتمدة', 'Credit hours')}</span></div>` +
    `<div class="stat"><b>${weekly}</b><span>${tr('ساعة أسبوعياً', 'Hours a week')}</span></div>` +
    `<div class="stat"><b>${chosen.length}</b><span>${tr('شعب', 'Sections')}</span></div>` +
    `<div class="stat"><b style="color:${clashCount ? '#C2410C' : '#15803D'}">${clashCount}</b><span>${tr('تعارض', 'Clashes')}</span></div>` +
    '</div>';

  const lines = [
    ...pairs.map(
      (p) =>
        `${tr('تعارض محاضرات:', 'Class clash:')} ${esc(p.a.code)} (${esc(p.a.section)}) ${tr('مع', 'with')} ${esc(p.b.code)} (${esc(p.b.section)})`,
    ),
    ...exams.map(
      (e) =>
        `${tr('تعارض اختبارات في الفترة', 'Exam clash in period')} ${esc(e.period)}: ${e.courses.map((c) => esc(c.code)).join(tr('، ', ', '))}`,
    ),
  ];
  const shown = lines.slice(0, MAX_NOTES);
  if (lines.length > MAX_NOTES) shown.push(tr(`و ${lines.length - MAX_NOTES} تعارضات أخرى`, `and ${lines.length - MAX_NOTES} more clashes`));
  const note = lines.length
    ? `<div class="note bad">${shown.join('<br>')}</div>`
    : `<div class="note ok">✓ ${tr('لا يوجد تعارض في المحاضرات أو الاختبارات', 'No class or exam clashes')}</div>`;

  const head =
    `<thead><tr><th style="width:62px" class="c">${tr('الشعبة', 'Section')}</th><th style="width:70px" class="c">${tr('النشاط', 'Type')}</th>` +
    `<th>${tr('المواعيد', 'Times')}</th><th style="width:104px">${tr('القاعة', 'Room')}</th><th style="width:116px">${tr('المدرّس', 'Instructor')}</th>` +
    `<th style="width:78px" class="c">${tr('فترة الاختبار', 'Exam period')}</th><th style="width:52px" class="c">${tr('الساعات', 'Hours')}</th></tr></thead>`;

  const pages = paginate(groups, Math.max(1, shown.length));
  return pages
    .map((run, i) => {
      const more = i > 0 ? tr(' (تابع)', ' (continued)') : '';
      const table = `<table class="sum-table">${head}<tbody>${run.map(courseRows).join('')}</tbody></table>`;
      return (
        '<div class="sum-page">' +
        `<div class="sum-head">${logo}<div><h1>${tr('ملخص الجدول', 'Timetable summary')}${more}</h1><div class="sub">${subtitle}</div></div>` +
        `<div class="date">${date}<br>Qu Student</div></div>` +
        `<div class="sum-card">${i === 0 ? stats : ''}${table}${i === 0 ? note : ''}</div>` +
        `<div class="sum-foot"><span>${tr('ملخص الجدول', 'Timetable summary')}${pages.length > 1 ? ` · ${i + 1} ${tr('من', 'of')} ${pages.length}` : ''}</span><span>qustudent.net</span></div>` +
        '</div>'
      );
    })
    .join('\n');
};
