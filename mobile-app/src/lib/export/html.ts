/**
 * The timetable as a printable HTML page (A4 landscape), turned into a PDF or printed.
 * Every page is a white card on the teal gradient (same look as the exported image):
 * page 1 is the weekly grid, the summary page(s) follow.
 */
import { Platform } from 'react-native';

import { getLang, isEnglish, tr } from '@/lib/i18n';
import {
  activityLabel,
  courseHours,
  coursesLabel,
  dayName,
  getCourseTheme,
  groupCourses,
  hour12,
  hoursLabel,
  WEEK_DAYS,
} from '@/lib/courses';
import { gridHours, layoutDay, markedBlocks } from '@/lib/schedule';
import type { Course } from '@/lib/types';

import { arabicDate } from './dates';
import { buildSummaryPages, SUMMARY_CSS } from './summaryPage';

/** A4 landscape in PDF points; the layout is drawn at this size in CSS pixels. */
export const PAGE = { width: 842, height: 595 };

/**
 * How much to enlarge each page so it fills the sheet. iOS prints 1 CSS pixel per point, so the
 * layout already fits. Android and browsers print 96 CSS pixels per inch (4/3 of a point), so an
 * 842 px page would cover only three quarters of the sheet; 1.333 (a hair under 4/3) fills it
 * without spilling onto a next page.
 */
const PAGE_ZOOM = Platform.OS === 'ios' ? 1 : 1.333;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 810 → "1:30" */
const clock = (minutes: number) => `${hour12(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;

/** The Qu Student mark in white, for the teal page header. */
const LOGO_WHITE =
  '<svg width="40" height="40" viewBox="0 0 128 128"><rect width="128" height="128" rx="30" fill="#FFFFFF" fill-opacity=".14"/>' +
  '<rect x="26" y="34" width="72" height="62" rx="14" fill="none" stroke="#fff" stroke-width="9"/>' +
  '<path d="M46 24v16M78 24v16" stroke="#fff" stroke-width="9" stroke-linecap="round"/>' +
  '<path d="M26 56h72" stroke="#fff" stroke-width="7"/><rect x="37" y="66" width="22" height="18" rx="5" fill="#7FD3E3"/>' +
  '<path d="M80 78l24 24" stroke="#fff" stroke-width="11" stroke-linecap="round"/></svg>';

export const buildScheduleHtml = (chosen: Course[]): string => {
  const groups = groupCourses(chosen);
  const hours = groups.reduce((n, g) => n + courseHours(g.sections), 0);
  const { from, to } = gridHours(chosen);
  const hourCount = Math.max(1, to - from);
  // Fit the grid in the white card, under the day names.
  const hourH = Math.min(58, Math.floor(448 / hourCount));
  const span = hourCount * 60;
  const items = markedBlocks(chosen);
  const subtitle = `${coursesLabel(groups.length)} · ${hoursLabel(hours)}`;
  const date = arabicDate(new Date());

  const hourLabels = Array.from(
    { length: hourCount },
    (_, i) => `<div class="hl" style="height:${hourH}px">${hour12(from + i)}</div>`,
  ).join('');

  const dayColumns = WEEK_DAYS.map((day) => {
    const laid = layoutDay(items.filter((it) => it.block.day === day));
    const blocks = laid
      .map((b) => {
        const theme = getCourseTheme(b.course.code);
        const top = ((b.start - from * 60) / span) * 100;
        const height = ((b.end - b.start) / span) * 100;
        const width = 100 / b.lanes;
        const right = width * b.lane;
        const tall = ((b.end - b.start) / 60) * hourH;
        const activity = activityLabel(b.course);
        const style = b.clash
          ? 'background:#FFF1E2;color:#9A4A0A;border:1.5px dashed #E07B1F;'
          : `background:${theme.bg};color:${theme.text};border-inline-start:4px solid ${theme.bar};`;
        return (
          `<div class="blk${b.lanes >= 3 ? ' narrow' : ''}" style="top:${top}%;height:${height}%;inset-inline-start:${right}%;width:${width}%;${style}">` +
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

  return `<!doctype html>
<html lang="${getLang()}" dir="${isEnglish() ? 'ltr' : 'rtl'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${PAGE.width}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'IBM Plex Sans Arabic', 'Geeza Pro', 'Noto Sans Arabic', Tahoma, sans-serif; color: #1B2533; background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 22px; margin: 0; line-height: 1.25; }
.sub { font-size: 12px; opacity: .85; }
.date { margin-inline-start: auto; text-align: end; font-size: 11px; line-height: 1.5; opacity: .85; }
.head, .body { display: flex; gap: 5px; }
.head div { flex: 1; text-align: center; font-size: 12px; font-weight: 700; color: #0B5F77; padding: 4px 0 5px; border-bottom: 2px solid #0E7490; margin-bottom: 6px; }
.head .tc { border-bottom: 0; }
.head .tc, .times { flex: 0 0 26px; width: 26px; }
.hl { font-size: 10.5px; color: #64748B; text-align: center; line-height: 1; padding-top: 2px; }
.day { flex: 1; position: relative; }
.st { border-top: 1px solid #EEF2F6; }
.blk { position: absolute; margin: 1px 0; padding: 3px 7px; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; font-size: 10px; line-height: 1.35; }
.blk b { font-size: 11.5px; }
.blk > span { text-align: start; unicode-bidi: isolate; }
.blk small { font-size: 9.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.narrow { padding: 3px 3px; }
.narrow b { font-size: 9px; }
.narrow > span { font-size: 8px; }
.narrow small { font-size: 8px; }
.code { display: inline-block; padding: 1px 6px; border-radius: 5px; font-weight: 700; font-size: 10px; }
${SUMMARY_CSS}
.sum-page { zoom: ${PAGE_ZOOM}; }
.sum-page.first { break-before: auto; page-break-before: auto; }
.grid-card { padding: 10px 14px 12px; }
</style>
</head>
<body>
<div class="sum-page first">
  <div class="sum-head">${LOGO_WHITE}<div><h1>${tr('جدولي الدراسي', 'My class timetable')}</h1><div class="sub">${subtitle}</div></div><div class="date">${date}<br>Qu Student</div></div>
  <div class="sum-card grid-card">
    <div class="head"><div class="tc"></div>${WEEK_DAYS.map((d) => `<div>${dayName(d)}</div>`).join('')}</div>
    <div class="body" style="height:${hourCount * hourH}px">
      <div class="times">${hourLabels}</div>
      ${dayColumns}
    </div>
  </div>
  <div class="sum-foot"><span>${tr('الجدول الأسبوعي', 'Weekly timetable')}</span><span>qustudent.net</span></div>
</div>
${buildSummaryPages(chosen, { logo: LOGO_WHITE, date, subtitle })}
</body>
</html>`;
};
