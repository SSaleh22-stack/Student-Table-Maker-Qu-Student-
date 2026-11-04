/**
 * Timetable exports with the same look as the Qu Student app:
 *  - PDF: an A4 landscape page with the weekly grid, then the summary page(s), printed from a hidden frame
 *    (the browser's print window offers "Save as PDF").
 *  - Image: a PNG of the weekly grid in a white card on the teal gradient.
 * Ported from mobile-app/src/lib/export (html.ts, summaryPage.ts). The same file lives in
 * web-app/src/lib/scheduleExport.ts; keep the two in step.
 */
import html2canvas from 'html2canvas';
import type { Course, Language, TimeSlot, TimetableEntry } from '../types';
import { getCourseTheme } from './courseTheme';

const FILE_BASE = 'qu-schedule';
const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

/** A4 landscape in PDF points; pages are laid out at this size in CSS pixels. */
const PAGE = { width: 842, height: 595 };
/** Browsers print 96 CSS pixels per inch (4/3 of a point): enlarge each page so it fills the sheet. */
const PAGE_ZOOM = 1.333;

// ---------- Text ----------

const TEXT = {
  ar: {
    title: 'جدولي الدراسي',
    summary: 'ملخص الجدول',
    continued: ' (تابع)',
    weekly: 'الجدول الأسبوعي',
    of: 'من',
    courses: 'مقررات',
    credit: 'ساعة معتمدة',
    weeklyHours: 'ساعة أسبوعياً',
    sections: 'شعب',
    clashes: 'تعارض',
    section: 'الشعبة',
    activity: 'النشاط',
    times: 'المواعيد',
    room: 'القاعة',
    instructor: 'المدرّس',
    exam: 'فترة الاختبار',
    hours: 'الساعات',
    noTime: 'بدون وقت',
    noClash: '✓ لا يوجد تعارض في المحاضرات أو الاختبارات',
    lectureClash: (a: string, b: string) => `تعارض محاضرات: ${a} مع ${b}`,
    examClash: (p: string, codes: string) => `تعارض اختبارات في الفترة ${p}: ${codes}`,
    more: (n: number) => `و ${n} تعارضات أخرى`,
    period: (p: string) => `الفترة ${p}`,
    sep: '، ',
  },
  en: {
    title: 'My timetable',
    summary: 'Timetable summary',
    continued: ' (continued)',
    weekly: 'Weekly timetable',
    of: 'of',
    courses: 'Courses',
    credit: 'Credit hours',
    weeklyHours: 'Hours a week',
    sections: 'Sections',
    clashes: 'Clashes',
    section: 'Section',
    activity: 'Activity',
    times: 'Times',
    room: 'Room',
    instructor: 'Instructor',
    exam: 'Exam period',
    hours: 'Hours',
    noTime: 'No set time',
    noClash: '✓ No lecture or exam clashes',
    lectureClash: (a: string, b: string) => `Lecture clash: ${a} with ${b}`,
    examClash: (p: string, codes: string) => `Exam clash in period ${p}: ${codes}`,
    more: (n: number) => `and ${n} more`,
    period: (p: string) => `Period ${p}`,
    sep: ', ',
  },
};

const DAY_NAMES: Record<Language, Record<string, string>> = {
  ar: { Sun: 'الأحد', Mon: 'الاثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة', Sat: 'السبت' },
  en: { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' },
};

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const ACTIVITY: Record<Language, Record<string, string>> = {
  ar: { theoretical: 'نظري', practical: 'عملي', exercise: 'تدريب' },
  en: { theoretical: 'Theory', practical: 'Practical', exercise: 'Exercise' },
};

/** The stronger stripe color for each soft course background (same pairs as the app). */
const BAR: Record<string, string> = {
  '#DCEBFF': '#3B82F6',
  '#D8F3E8': '#10B981',
  '#FFE7CC': '#F59E0B',
  '#F6DDF0': '#EC4899',
  '#E9E3FF': '#8B5CF6',
  '#D5F1F6': '#06B6D4',
  '#FDE2E4': '#F43F5E',
  '#FEF3C7': '#EAB308',
  '#E2F0D9': '#65A30D',
  '#E5E9F2': '#64748B',
};

const themeOf = (code: string) => {
  const t = getCourseTheme(code);
  return { ...t, bar: BAR[t.bg] ?? t.text };
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dayName = (day: string, lang: Language) => DAY_NAMES[lang][day] ?? day;
const formatDays = (days: string[], lang: Language) => days.map((d) => dayName(d, lang)).join(TEXT[lang].sep);

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const hour12 = (hour: number) => (hour % 12 === 0 ? 12 : hour % 12);
/** 810 → "1:30" */
const clock = (minutes: number) => `${hour12(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;
const time12 = (time: string) => clock(toMinutes(time));

const hasSchedule = (c: { days: string[]; startTime: string; endTime: string }) =>
  c.days.length > 0 && !!c.startTime && !!c.endTime;

const slotsOf = (c: Course): TimeSlot[] => {
  if (c.timeSlots && c.timeSlots.length > 0) return c.timeSlots.filter(hasSchedule);
  return hasSchedule(c) ? [{ days: c.days, startTime: c.startTime, endTime: c.endTime, location: c.location }] : [];
};

const creditHours = (c: Course) => {
  const n = parseInt(c.hours ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};
/** Credit hours of a course, counted once even when several of its sections are chosen. */
const courseHours = (sections: Course[]) => Math.max(0, ...sections.map(creditHours));

/** English names for the activities the portal writes in Arabic. */
const ACTIVITY_EN: Record<string, string> = { نظري: 'Theory', عملي: 'Practical', تدريب: 'Exercise', تمارين: 'Exercise' };

const activityLabel = (c: Course, lang: Language): string | null => {
  const portal = c.activity?.trim();
  if (lang === 'en') return (portal && (ACTIVITY_EN[portal] ?? portal)) || (c.classType ? ACTIVITY.en[c.classType] : null);
  return portal || (c.classType ? ACTIVITY.ar[c.classType] : null);
};

const weeklyHours = (c: Course) => {
  const minutes = slotsOf(c).reduce(
    (sum, s) => sum + s.days.length * Math.max(0, toMinutes(s.endTime) - toMinutes(s.startTime)),
    0
  );
  return Math.round((minutes / 60) * 2) / 2;
};
/** Weekly hours of one course: one section per activity counts; same-activity sections count once. */
const courseWeeklyHours = (sections: Course[]) => {
  const byActivity = new Map<string, number>();
  for (const s of sections) {
    const key = activityLabel(s, 'ar') ?? '';
    byActivity.set(key, Math.max(byActivity.get(key) ?? 0, weeklyHours(s)));
  }
  return [...byActivity.values()].reduce((n, h) => n + h, 0);
};

const coursesLabel = (n: number, lang: Language) => {
  if (lang === 'en') return `${n} ${n === 1 ? 'course' : 'courses'}`;
  if (n === 0) return 'لا مقررات';
  if (n === 1) return 'مقرر واحد';
  if (n === 2) return 'مقرران';
  if (n >= 3 && n <= 10) return `${n} مقررات`;
  return `${n} مقرراً`;
};

const hoursLabel = (n: number, lang: Language) => {
  if (lang === 'en') return `${n} credit ${n === 1 ? 'hour' : 'hours'}`;
  if (n === 0) return '0 ساعة';
  if (n === 1) return 'ساعة واحدة';
  if (n === 2) return 'ساعتان';
  if (n >= 3 && n <= 10) return `${n} ساعات`;
  return `${n} ساعة`;
};

const formatDate = (d: Date, lang: Language) =>
  lang === 'ar'
    ? `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

interface CourseGroup {
  code: string;
  name: string;
  sections: Course[];
}

const groupCourses = (courses: Course[]): CourseGroup[] => {
  const map = new Map<string, CourseGroup>();
  for (const c of courses) {
    const g = map.get(c.code);
    if (g) g.sections.push(c);
    else map.set(c.code, { code: c.code, name: c.name, sections: [c] });
  }
  return [...map.values()];
};

/**
 * The timetable keeps each class time of a section as its own entry ("<id>-slot-<n>").
 * Exports work per section, so those entries are joined back into one section with all its times.
 */
export const sectionsFromTimetable = (timetable: TimetableEntry[]): Course[] => {
  const map = new Map<string, Course>();
  for (const { course } of timetable) {
    const id = course.id.split('-slot-')[0];
    const slot: TimeSlot = { days: course.days, startTime: course.startTime, endTime: course.endTime, location: course.location };
    const known = map.get(id);
    if (!known) {
      map.set(id, { ...course, id, timeSlots: course.id.includes('-slot-') ? [slot] : course.timeSlots });
    } else if (course.id.includes('-slot-')) {
      known.timeSlots = [...(known.timeSlots ?? []), slot];
    }
  }
  return [...map.values()];
};

// ---------- Timetable math (same rules as the app) ----------

interface Block {
  course: Course;
  day: string;
  start: number;
  end: number;
  location?: string;
}

const blocksOf = (c: Course): Block[] =>
  slotsOf(c).flatMap((slot) =>
    slot.days.map((day) => ({
      course: c,
      day,
      start: toMinutes(slot.startTime),
      end: toMinutes(slot.endTime),
      location: slot.location ?? c.location,
    }))
  );

const overlap = (a: Block, b: Block) => a.day === b.day && a.start < b.end && b.start < a.end;

interface LaidBlock extends Block {
  clash: boolean;
  lane: number;
  lanes: number;
}

/** Overlapping blocks of one day sit side by side in lanes. */
const layoutDay = (items: { block: Block; clash: boolean }[]): LaidBlock[] => {
  const sorted = [...items].sort((a, b) => a.block.start - b.block.start || a.block.end - b.block.end);
  const out: LaidBlock[] = [];
  let cluster: LaidBlock[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((it) => (it.lanes = lanes));
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const { block, clash } of sorted) {
    if (cluster.length > 0 && block.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    cluster.push({ ...block, clash, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length) flush();
  return out;
};

const clashPairs = (chosen: Course[]) => {
  const out: { a: Course; b: Course }[] = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const bb = blocksOf(chosen[j]);
      if (blocksOf(chosen[i]).some((x) => bb.some((y) => overlap(x, y)))) out.push({ a: chosen[i], b: chosen[j] });
    }
  }
  return out;
};

const examClashes = (chosen: Course[]) => {
  const byPeriod = new Map<string, Map<string, Course>>();
  for (const c of chosen) {
    const period = c.finalExam?.date?.trim();
    if (!period) continue;
    const courses = byPeriod.get(period) ?? new Map<string, Course>();
    if (!courses.has(c.code)) courses.set(c.code, c);
    byPeriod.set(period, courses);
  }
  return [...byPeriod].filter(([, c]) => c.size > 1).map(([period, c]) => ({ period, courses: [...c.values()] }));
};

/** Hour range for the grid: 08:00–16:00 by default, stretched to fit every class. */
const gridHours = (chosen: Course[]) => {
  let from = 8;
  let to = 16;
  for (const b of chosen.flatMap(blocksOf)) {
    if (!WEEK_DAYS.includes(b.day)) continue;
    from = Math.min(from, Math.floor(b.start / 60));
    to = Math.max(to, Math.ceil(b.end / 60));
  }
  return { from, to };
};

// ---------- Shared pieces ----------

/** The Qu Student mark in white, for the teal header. */
const LOGO_WHITE =
  '<rect width="128" height="128" rx="30" fill="#FFFFFF" fill-opacity=".14"/>' +
  '<rect x="26" y="34" width="72" height="62" rx="14" fill="none" stroke="#fff" stroke-width="9"/>' +
  '<path d="M46 24v16M78 24v16" stroke="#fff" stroke-width="9" stroke-linecap="round"/>' +
  '<path d="M26 56h72" stroke="#fff" stroke-width="7"/><rect x="37" y="66" width="22" height="18" rx="5" fill="#7FD3E3"/>' +
  '<path d="M80 78l24 24" stroke="#fff" stroke-width="11" stroke-linecap="round"/>';

/** As an <img>: the image export's canvas copy draws images more reliably than inline SVG. */
const logoImg = (size: number) =>
  `<img class="logo" width="${size}" height="${size}" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">${LOGO_WHITE}</svg>`
  )}">`;

/** "start"/"end" sides for the page direction (physical sides, so the image copy draws them right). */
const sides = (lang: Language) => (lang === 'ar' ? { s: 'right', e: 'left' } : { s: 'left', e: 'right' });

const subtitleOf = (chosen: Course[], lang: Language) => {
  const groups = groupCourses(chosen);
  const hours = groups.reduce((n, g) => n + courseHours(g.sections), 0);
  return `${coursesLabel(groups.length, lang)} · ${hoursLabel(hours, lang)}`;
};

/** The weekly grid (day names, hour labels, class blocks) at `hourH` pixels per hour. */
const gridHtml = (chosen: Course[], lang: Language, hourH: number) => {
  const { s } = sides(lang);
  const { from, to } = gridHours(chosen);
  const hourCount = Math.max(1, to - from);
  const span = hourCount * 60;
  const all = chosen.flatMap(blocksOf);
  const items = all.map((block) => ({
    block,
    clash: all.some((other) => other.course.id !== block.course.id && overlap(block, other)),
  }));

  const hourLabels = Array.from(
    { length: hourCount },
    (_, i) => `<div class="hl" style="height:${hourH}px">${hour12(from + i)}</div>`
  ).join('');

  const dayColumns = WEEK_DAYS.map((day) => {
    const laid = layoutDay(items.filter((it) => it.block.day === day));
    const blocks = laid
      .map((b) => {
        const theme = themeOf(b.course.code);
        const top = ((b.start - from * 60) / span) * 100;
        const height = ((b.end - b.start) / span) * 100;
        const width = 100 / b.lanes;
        const offset = width * b.lane;
        const tall = ((b.end - b.start) / 60) * hourH;
        const activity = activityLabel(b.course, lang);
        const style = b.clash
          ? 'background:#FFF1E2;color:#9A4A0A;border:1.5px dashed #E07B1F;'
          : `background:${theme.bg};color:${theme.text};border-${s}:4px solid ${theme.bar};`;
        return (
          `<div class="blk${b.lanes >= 3 ? ' narrow' : ''}" style="top:${top}%;height:${height}%;${s}:${offset}%;width:${width}%;${style}">` +
          `<b>${esc(b.course.code)}</b>` +
          `<span dir="ltr">${clock(b.start)}–${clock(b.end)}</span>` +
          (tall > 50 && b.location ? `<small>${esc(b.location)}</small>` : '') +
          (tall > 64 ? `<small>${activity ? `${esc(activity)} · ` : ''}${esc(b.course.section)}</small>` : '') +
          '</div>'
        );
      })
      .join('');
    const lines = Array.from({ length: hourCount }, () => `<div class="st" style="height:${hourH}px"></div>`).join('');
    return `<div class="day">${lines}${blocks}</div>`;
  }).join('');

  return (
    `<div class="head"><div class="tc"></div>${WEEK_DAYS.map((d) => `<div>${dayName(d, lang)}</div>`).join('')}</div>` +
    `<div class="body" style="height:${hourCount * hourH}px"><div class="times">${hourLabels}</div>${dayColumns}</div>`
  );
};

/** Grid styles; `p` scopes every selector (the image is drawn inside the live page). */
const gridCss = (lang: Language, p = '') => {
  const { s } = sides(lang);
  return `
${p}.head, ${p}.body { display: flex; gap: 5px; }
${p}.head div { flex: 1; text-align: center; font-size: 12px; font-weight: 700; color: #0B5F77; padding: 4px 0 5px; border-bottom: 2px solid #0E7490; margin-bottom: 6px; }
${p}.head .tc { border-bottom: 0; }
${p}.head .tc, ${p}.times { flex: 0 0 26px; width: 26px; }
${p}.hl { font-size: 10.5px; color: #64748B; text-align: center; line-height: 1; padding-top: 2px; }
${p}.day { flex: 1; position: relative; }
${p}.st { border-top: 1px solid #EEF2F6; }
${p}.blk { position: absolute; margin: 1px 0; padding: 3px 7px; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; font-size: 10px; line-height: 1.35; text-align: ${s}; }
${p}.blk b { font-size: 11.5px; }
${p}.blk > span { text-align: ${s}; }
${p}.blk small { font-size: 9.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${p}.narrow { padding: 3px 3px; }
${p}.narrow b { font-size: 9px; }
${p}.narrow > span { font-size: 8px; }
${p}.narrow small { font-size: 8px; }
`;
};

const FONT = "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif";

// ---------- PDF ----------

/** Room inside the white card (px), and what the table header, totals and clash note take of it. */
const CARD_SPACE = 479;
const TABLE_HEAD = 28;
const STATS = 50;
const NOTE_BASE = 23;
const NOTE_LINE = 16.5;
const COURSE_ROW = 30.5;
const SECTION_ROW = 26.5;
const EXTRA_LINE = 16;
const MAX_NOTES = 3;

const summaryCss = (lang: Language) => {
  const { s, e } = sides(lang);
  return `
.sum-page { width: ${PAGE.width}px; height: ${PAGE.height}px; position: relative; overflow: hidden; break-before: page; page-break-before: always; background: linear-gradient(160deg, #0E7490, #08485B); padding: 0 24px; display: flex; flex-direction: column; zoom: ${PAGE_ZOOM}; }
.sum-page.first { break-before: auto; page-break-before: auto; }
.sum-head { height: 62px; flex: 0 0 62px; display: flex; align-items: center; gap: 12px; color: #fff; padding: 0 4px; }
.sum-head .logo { flex: 0 0 40px; }
.sum-head .date { margin-${s}: auto; text-align: ${e}; font-size: 11px; line-height: 1.5; color: #CFEAF0; }
h1 { font-size: 22px; margin: 0; line-height: 1.25; }
.sub { font-size: 12px; opacity: .85; }
.sum-card { flex: 1; background: #fff; border-radius: 18px; padding: 14px 16px; overflow: hidden; }
.grid-card { padding: 10px 14px 12px; }
.sum-foot { height: 26px; flex: 0 0 26px; display: flex; align-items: center; justify-content: space-between; padding: 0 6px; font-size: 9.5px; color: #CFEAF0; }
.stats { display: flex; gap: 8px; margin-bottom: 10px; }
.stat { flex: 1; border: 1px solid #E3E9F0; border-radius: 10px; padding: 5px 12px; display: flex; align-items: baseline; gap: 8px; }
.stat b { font-size: 19px; color: #0B5F77; }
.stat span { font-size: 10.5px; color: #64748B; }
.sum-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.sum-table th { background: #0E7490; color: #fff; font-weight: 600; padding: 6px 8px; text-align: ${s}; }
.sum-table td { padding: 5px 8px; border-bottom: 1px solid #EEF2F6; vertical-align: top; }
.sum-table .c { text-align: center; }
.sum-table tr { break-inside: avoid; }
.sum-table tr.course td { background: #F4F8FA; border-bottom: 1px solid #E3E9F0; padding: 6px 8px; }
.sum-table .name { font-weight: 700; font-size: 11.5px; }
.code { display: inline-block; padding: 1px 6px; border-radius: 5px; font-weight: 700; font-size: 10px; }
.pill { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 9.5px; font-weight: 600; background: #E0F2F6; color: #0B5F77; margin-${s}: 6px; }
.act { display: inline-block; border-radius: 5px; padding: 0 6px; font-size: 9.5px; background: #EEF2F6; color: #334155; }
.ltr { unicode-bidi: isolate; }
.note { margin-top: 10px; border-radius: 8px; padding: 6px 10px; font-size: 10.5px; line-height: 1.6; }
.note.ok { background: #E8F7EE; color: #166534; }
.note.bad { background: #FFF1E2; color: #9A4A0A; border: 1px dashed #E07B1F; }
`;
};

const groupHeight = (g: CourseGroup) =>
  COURSE_ROW + g.sections.reduce((n, s) => n + SECTION_ROW + Math.max(0, slotsOf(s).length - 1) * EXTRA_LINE, 0);

/** Splits the courses into page-sized runs (a course is never split across pages). */
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

const summaryPages = (chosen: Course[], lang: Language, head: (title: string) => string) => {
  const T = TEXT[lang];
  const { s } = sides(lang);
  const groups = groupCourses(chosen);
  const credit = groups.reduce((n, g) => n + courseHours(g.sections), 0);
  const weekly = groups.reduce((n, g) => n + courseWeeklyHours(g.sections), 0);
  const pairs = clashPairs(chosen);
  const exams = examClashes(chosen);
  const clashCount = pairs.length + exams.length;

  const stats =
    '<div class="stats">' +
    `<div class="stat"><b>${groups.length}</b><span>${T.courses}</span></div>` +
    `<div class="stat"><b>${credit}</b><span>${T.credit}</span></div>` +
    `<div class="stat"><b>${weekly}</b><span>${T.weeklyHours}</span></div>` +
    `<div class="stat"><b>${chosen.length}</b><span>${T.sections}</span></div>` +
    `<div class="stat"><b style="color:${clashCount ? '#C2410C' : '#15803D'}">${clashCount}</b><span>${T.clashes}</span></div>` +
    '</div>';

  const lines = [
    ...pairs.map((p) =>
      T.lectureClash(`${esc(p.a.code)} (${esc(p.a.section)})`, `${esc(p.b.code)} (${esc(p.b.section)})`)
    ),
    ...exams.map((x) => T.examClash(esc(x.period), x.courses.map((c) => esc(c.code)).join(T.sep))),
  ];
  const shown = lines.slice(0, MAX_NOTES);
  if (lines.length > MAX_NOTES) shown.push(T.more(lines.length - MAX_NOTES));
  const note = lines.length
    ? `<div class="note bad">${shown.join('<br>')}</div>`
    : `<div class="note ok">${T.noClash}</div>`;

  const rooms = (c: Course) => {
    const list = [...new Set(slotsOf(c).map((t) => t.location ?? c.location).filter((r): r is string => !!r))];
    if (list.length === 0 && c.location) list.push(c.location);
    return list.join(T.sep) || '—';
  };
  const times = (c: Course) =>
    slotsOf(c).length
      ? slotsOf(c)
          .map(
            (t) =>
              `${esc(formatDays(t.days, lang))} <span dir="ltr" class="ltr">${time12(t.startTime)}–${time12(t.endTime)}</span>`
          )
          .join('<br>')
      : T.noTime;

  const rows = (g: CourseGroup) => {
    const theme = themeOf(g.code);
    return (
      `<tr class="course"><td colspan="7" style="border-${s}:4px solid ${theme.bar}">` +
      `<span class="code" style="background:${theme.bg};color:${theme.text}">${esc(g.code)}</span> ` +
      `<span class="name">${esc(g.name)}</span>` +
      `<span class="pill">${hoursLabel(courseHours(g.sections), lang)}</span></td></tr>` +
      g.sections
        .map(
          (c) =>
            `<tr><td class="c"><b>${esc(c.section)}</b></td>` +
            `<td class="c"><span class="act">${esc(activityLabel(c, lang) ?? '—')}</span></td>` +
            `<td>${times(c)}</td><td>${esc(rooms(c))}</td><td>${esc(c.instructor || '—')}</td>` +
            `<td class="c">${c.finalExam?.date ? esc(T.period(c.finalExam.date)) : '—'}</td>` +
            `<td class="c">${creditHours(c) || '—'}</td></tr>`
        )
        .join('')
    );
  };

  const thead =
    `<thead><tr><th style="width:62px" class="c">${T.section}</th><th style="width:70px" class="c">${T.activity}</th>` +
    `<th>${T.times}</th><th style="width:104px">${T.room}</th><th style="width:116px">${T.instructor}</th>` +
    `<th style="width:78px" class="c">${T.exam}</th><th style="width:52px" class="c">${T.hours}</th></tr></thead>`;

  const pages = paginate(groups, Math.max(1, shown.length));
  return pages
    .map((run, i) => {
      const table = `<table class="sum-table">${thead}<tbody>${run.map(rows).join('')}</tbody></table>`;
      return (
        '<div class="sum-page">' +
        head(T.summary + (i > 0 ? T.continued : '')) +
        `<div class="sum-card">${i === 0 ? stats : ''}${table}${i === 0 ? note : ''}</div>` +
        `<div class="sum-foot"><span>${T.summary}${pages.length > 1 ? ` · ${i + 1} ${T.of} ${pages.length}` : ''}</span><span>qustudent.net</span></div>` +
        '</div>'
      );
    })
    .join('\n');
};

/** The whole PDF as one HTML page: the weekly grid, then the summary page(s). A4 landscape. */
export const buildScheduleHtml = (chosen: Course[], lang: Language): string => {
  const T = TEXT[lang];
  const { from, to } = gridHours(chosen);
  const hourH = Math.min(58, Math.floor(448 / Math.max(1, to - from)));
  const subtitle = subtitleOf(chosen, lang);
  const date = formatDate(new Date(), lang);
  const head = (title: string) =>
    `<div class="sum-head">${logoImg(40)}<div><h1>${esc(title)}</h1><div class="sub">${subtitle}</div></div>` +
    `<div class="date">${date}<br>Qu Student</div></div>`;

  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${FILE_BASE}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${FONT}; color: #1B2533; background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${gridCss(lang)}
${summaryCss(lang)}
</style>
</head>
<body>
<div class="sum-page first">
  ${head(T.title)}
  <div class="sum-card grid-card">${gridHtml(chosen, lang, hourH)}</div>
  <div class="sum-foot"><span>${T.weekly}</span><span>qustudent.net</span></div>
</div>
${summaryPages(chosen, lang, head)}
</body>
</html>`;
};

/** Prints the PDF page from a hidden frame; the browser's print window offers "Save as PDF". */
export const exportSchedulePdf = async (chosen: Course[], lang: Language): Promise<void> => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error('print unavailable');
  }
  doc.open();
  doc.write(buildScheduleHtml(chosen, lang));
  doc.close();
  // Let the web font and the logo load first (at most ~2.5 seconds).
  await Promise.race([
    Promise.all([
      new Promise((resolve) => (doc.readyState === 'complete' ? resolve(null) : win.addEventListener('load', resolve))),
      doc.fonts?.ready,
    ]),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
  win.focus();
  win.print();
  setTimeout(() => frame.remove(), 60_000);
};

// ---------- Image ----------

const IMAGE_WIDTH = 1000;

/** The image: a white card with the weekly grid on the teal gradient, under a header with the logo. */
const imageHtml = (chosen: Course[], lang: Language) => {
  const { s, e } = sides(lang);
  const { from, to } = gridHours(chosen);
  const hourH = Math.max(52, Math.min(64, Math.floor(560 / Math.max(1, to - from))));
  return (
    `<style>${gridCss(lang, '.qs-shot ')}
.qs-shot { width: ${IMAGE_WIDTH}px; box-sizing: border-box; padding: 26px 22px 16px; font-family: ${FONT}; color: #1B2533;
  background: linear-gradient(160deg, #0E7490, #08485B); display: flex; flex-direction: column; gap: 16px; }
.qs-shot * { box-sizing: border-box; letter-spacing: 0; }
.qs-shot .top { display: flex; align-items: center; gap: 14px; padding: 0 4px; color: #fff; }
.qs-shot .logo { display: block; flex: 0 0 48px; }
.qs-shot h1 { font-size: 26px; margin: 0; line-height: 1.3; font-weight: 700; }
.qs-shot .sub { font-size: 14px; color: #D5EEF3; }
.qs-shot .date { margin-${s}: auto; text-align: ${e}; font-size: 13px; line-height: 1.5; color: #CFEAF0; }
.qs-shot .card { background: #fff; border-radius: 20px; padding: 14px 16px 16px; }
.qs-shot .foot { text-align: center; font-size: 13px; color: #CFEAF0; }
.qs-shot .head div { font-size: 15px; padding: 6px 0 7px; }
.qs-shot .head .tc, .qs-shot .times { flex: 0 0 30px; width: 30px; }
.qs-shot .hl { font-size: 12px; }
.qs-shot .blk { font-size: 12px; padding: 5px 9px; border-radius: 8px; line-height: 1.4; }
.qs-shot .blk b { font-size: 14px; }
.qs-shot .blk small { font-size: 11.5px; }
.qs-shot .narrow { padding: 4px 4px; }
.qs-shot .narrow b { font-size: 11px; }
.qs-shot .narrow > span, .qs-shot .narrow small { font-size: 10px; }
</style>` +
    `<div class="qs-shot" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" lang="${lang}">` +
    `<div class="top">${logoImg(48)}<div><h1>${TEXT[lang].title}</h1><div class="sub">${subtitleOf(chosen, lang)}</div></div>` +
    `<div class="date">${formatDate(new Date(), lang)}</div></div>` +
    `<div class="card">${gridHtml(chosen, lang, hourH)}</div>` +
    '<div class="foot">Qu Student · qustudent.net</div>' +
    '</div>'
  );
};

/** Draws the image off screen and downloads it as a PNG. */
export const exportScheduleImage = async (chosen: Course[], lang: Language): Promise<void> => {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;top:0;left:-${IMAGE_WIDTH + 200}px;width:${IMAGE_WIDTH}px;pointer-events:none;`;
  host.innerHTML = imageHtml(chosen, lang);
  document.body.appendChild(host);
  try {
    const shot = host.querySelector('.qs-shot') as HTMLElement;
    await Promise.all([
      document.fonts?.ready,
      ...Array.from(host.querySelectorAll('img')).map((img) =>
        img.complete ? null : new Promise((resolve) => img.addEventListener('load', resolve, { once: true }))
      ),
    ]);
    const canvas = await html2canvas(shot, {
      scale: 2,
      backgroundColor: '#0B5F77',
      logging: false,
      useCORS: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no image');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${FILE_BASE}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } finally {
    host.remove();
  }
};
