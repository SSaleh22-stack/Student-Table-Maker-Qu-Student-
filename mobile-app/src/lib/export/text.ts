/** The timetable as plain text, for WhatsApp/Telegram or the clipboard. */
import { tr } from '@/lib/i18n';
import { activityLabel, courseHours, coursesLabel, formatSchedule, groupCourses, hoursLabel } from '@/lib/courses';
import type { Course } from '@/lib/types';

/** "CS101: 01، 52" per line: what a student types when registering on the portal. */
export const buildSectionNumbers = (chosen: Course[]): string =>
  groupCourses(chosen)
    .map((g) => `${g.code}: ${g.sections.map((s) => s.section).join(tr('، ', ', '))}`)
    .join('\n');

export const buildScheduleText = (chosen: Course[]): string => {
  const groups = groupCourses(chosen);
  const hours = groups.reduce((n, g) => n + courseHours(g.sections), 0);
  const lines: string[] = [`${tr('جدولي الدراسي', 'My class timetable')} · ${coursesLabel(groups.length)} · ${hoursLabel(hours)}`, ''];

  for (const g of groups) {
    lines.push(`${g.code} — ${g.name}`);
    for (const s of g.sections) {
      const activity = activityLabel(s);
      const room = s.location ? ` · ${s.location}` : '';
      lines.push(`• ${tr('الشعبة', 'Section')} ${s.section}${activity ? ` (${activity})` : ''}: ${formatSchedule(s)}${room}`);
    }
    lines.push('');
  }

  lines.push(tr('أرقام الشعب:', 'Section numbers:'), buildSectionNumbers(chosen), '', '— Qu Student');
  return lines.join('\n');
};
