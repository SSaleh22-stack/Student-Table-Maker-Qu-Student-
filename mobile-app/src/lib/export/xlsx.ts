/**
 * The timetable as an Excel workbook (.xlsx), built by hand: two right-to-left sheets,
 * "المقررات" (one row per class time) and "الجدول الأسبوعي" (hours × days).
 */
import { strToU8, zipSync } from 'fflate';

import { isEnglish, tr } from '@/lib/i18n';
import { activityLabel, creditHours, dayName, formatExam, hour12, slotsOf, time12, WEEK_DAYS } from '@/lib/courses';
import { blocksOf, gridHours } from '@/lib/schedule';
import type { Course } from '@/lib/types';

type Cell = string | number | null;

/** 810 → "13:30" */
const fmt = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** Cell styles, matching styles.xml below: 0 plain, 1 header, 2 body (wrapped, bordered). */
const HEADER = 1;
const BODY = 2;

const xml = (s: string) =>
  s
    // Characters XML 1.0 doesn't allow
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0 → "A", 26 → "AA" */
const column = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

const cellXml = (value: Cell, ref: string, style: number): string => {
  if (value === null || value === '') return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === 'number') return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
};

const sheetXml = (header: string[], rows: Cell[][], widths: number[], rowHeights?: number[]): string => {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const all = [header, ...rows];
  const data = all
    .map((cells, r) => {
      const height = r > 0 && rowHeights?.[r - 1] ? ` ht="${rowHeights[r - 1]}" customHeight="1"` : '';
      const body = cells.map((v, c) => cellXml(v, `${column(c)}${r + 1}`, r === 0 ? HEADER : BODY)).join('');
      return `<row r="${r + 1}"${height}>${body}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView rightToLeft="${isEnglish() ? 0 : 1}" workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${data}</sheetData>` +
    '</worksheet>'
  );
};

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7490"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFDCE4EC"/></left><right style="thin"><color rgb="FFDCE4EC"/></right>' +
  '<top style="thin"><color rgb="FFDCE4EC"/></top><bottom style="thin"><color rgb="FFDCE4EC"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
  '<alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
  '<alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Builds the .xlsx file bytes. */
export const buildXlsx = (chosen: Course[]): Uint8Array => {
  // Sheet 1: one row per class time of each section
  const courseRows: Cell[][] = [];
  for (const s of chosen) {
    const slots = slotsOf(s);
    const base = [s.code, s.name, s.section, activityLabel(s) ?? ''];
    const tail: Cell[] = [
      s.instructor ?? '',
      creditHours(s) || null,
      formatExam(s.finalExam) ?? '',
      s.status === 'closed' ? tr('مغلقة', 'Closed') : s.status === 'open' ? tr('مفتوحة', 'Open') : '',
    ];
    if (slots.length === 0) {
      courseRows.push([...base, tr('بدون وقت', 'No time'), '', '', s.location ?? '', ...tail]);
    } else {
      for (const slot of slots) {
        courseRows.push([
          ...base,
          slot.days.map(dayName).join(tr('، ', ', ')),
          time12(slot.startTime),
          time12(slot.endTime),
          slot.location ?? s.location ?? '',
          ...tail,
        ]);
      }
    }
  }
  const sheet1 = sheetXml(
    isEnglish()
      ? ['Code', 'Course', 'Section', 'Type', 'Days', 'From', 'To', 'Room', 'Instructor', 'Hours', 'Final exam', 'Status']
      : ['الرمز', 'المقرر', 'الشعبة', 'النشاط', 'الأيام', 'من', 'إلى', 'القاعة', 'المدرّس', 'الساعات', 'الاختبار النهائي', 'الحالة'],
    courseRows,
    [11, 28, 8, 9, 20, 8, 8, 16, 22, 8, 14, 9]
  );

  // Sheet 2: weekly grid, one row per hour; a class is listed in every hour it covers
  const { from, to } = gridHours(chosen);
  const blocks = chosen.flatMap(blocksOf);
  const gridRows: Cell[][] = [];
  const heights: number[] = [];
  for (let h = from; h < to; h++) {
    const start = h * 60;
    const end = start + 60;
    let maxLines = 1;
    const cells = WEEK_DAYS.map((day) => {
      const here = blocks.filter((b) => b.day === day && b.start < end && b.end > start);
      maxLines = Math.max(maxLines, here.length * 2);
      return here
        .map((b) => `${b.course.code} (${b.course.section})\n${time12(fmt(b.start))}–${time12(fmt(b.end))}`)
        .join('\n');
    });
    gridRows.push([`${hour12(h)}:00`, ...cells]);
    heights.push(Math.max(30, maxLines * 15));
  }
  const sheet2 = sheetXml([tr('الوقت', 'Time'), ...WEEK_DAYS.map(dayName)], gridRows, [8, 20, 20, 20, 20, 20], heights);

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${tr('المقررات', 'Courses')}" sheetId="1" r:id="rId1"/><sheet name="${tr('الجدول الأسبوعي', 'Weekly timetable')}" sheetId="2" r:id="rId2"/></sheets>` +
        '</workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    ),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
    'xl/worksheets/sheet2.xml': strToU8(sheet2),
  };
  return zipSync(files, { level: 6 });
};
