/**
 * The data the home-screen and lock-screen widgets show (الجدول، مهامي، المحاضرة القادمة), as one
 * JSON snapshot written by modules/qu-widgets. The widgets work out "now" themselves (the current
 * and next lecture, which tasks are overdue), so the snapshot only changes when the timetable, the
 * tasks, the calendar or the language change.
 *
 * Read by targets/widgets/Store.swift (iOS) and modules/qu-widgets/android/.../WidgetData.kt
 * (Android): keep the field names in step with both.
 */
import { noClassRanges, type NoClassRange } from '@/lib/calendar/classDays';
import type { CalendarSection } from '@/lib/calendar/parse';
import { activityLabel, fromMinutes, getCourseTheme } from '@/lib/courses';
import type { Lang } from '@/lib/i18n';
import { blocksOf } from '@/lib/schedule';
import { dateKey, type Task } from '@/lib/tasks';
import type { Course } from '@/lib/types';

export interface WidgetLecture {
  code: string;
  name: string;
  section: string;
  /** "نظري" / "Lecture", in the app language */
  kind: string;
  room: string;
  instructor: string;
  /** 'Sun' … 'Sat' */
  day: string;
  /** 'HH:mm', 24h */
  start: string;
  end: string;
  /** Course colors (lib/courses.ts): soft background, dark text and the stronger bar color */
  bg: string;
  text: string;
  bar: string;
}

export interface WidgetTask {
  id: string;
  title: string;
  date?: string;
  time?: string;
  code?: string;
  /** The course's bar color, for the dot next to its code */
  bar?: string;
  done: boolean;
  completedAt?: string;
  repeat: Task['repeat'];
}

export interface WidgetSnapshot {
  v: 1;
  lang: Lang;
  /** False until the student has chosen sections: the widgets then ask to add the timetable. */
  hasTimetable: boolean;
  lectures: WidgetLecture[];
  /** Holidays and the weeks after classes end (academic calendar): no lectures on these days. */
  noClass: NoClassRange[];
  tasks: WidgetTask[];
}

/**
 * Open tasks kept in the snapshot, in the widget's order. Well above any real list, so the counts
 * (lock screen, "+N أخرى") stay right; it only guards the snapshot's size.
 */
const MAX_OPEN_TASKS = 500;

const toWidgetTask = (t: Task): WidgetTask => ({
  id: t.id,
  title: t.title,
  date: t.date,
  time: t.time,
  code: t.courseCode,
  bar: t.courseCode ? getCourseTheme(t.courseCode).bar : undefined,
  done: t.done,
  completedAt: t.completedAt,
  repeat: t.repeat,
});

/**
 * The مهامي widget's order: overdue and today's (by date and time), then those without a date (in
 * the app's order), then the later dates. Only decides which tasks the cap keeps: the widgets sort
 * again at the moment they draw (a task due at 2:00 is overdue from 2:00).
 */
const widgetOrder = (today: string) => {
  const rank = (t: Task) => (!t.date ? 1 : t.date <= today ? 0 : 2);
  const key = (t: Task) => `${t.date ?? ''} ${t.time ?? '99:99'}`;
  return (a: Task, b: Task): number => {
    const r = rank(a) - rank(b);
    if (r !== 0 || rank(a) === 1) return r;
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
};

export function buildWidgetSnapshot(p: {
  lang: Lang;
  chosen: readonly Course[];
  tasks: readonly Task[];
  calendar: readonly CalendarSection[];
  now?: Date;
}): WidgetSnapshot {
  const now = p.now ?? new Date();
  const lectures = p.chosen.flatMap((course) => {
    const theme = getCourseTheme(course.code);
    return blocksOf(course)
      .filter((b) => b.end > b.start)
      .map(
        (b): WidgetLecture => ({
          code: course.code,
          name: course.name || course.code,
          section: course.section ?? '',
          kind: activityLabel(course) ?? '',
          room: b.location ?? '',
          instructor: course.instructor ?? '',
          day: b.day,
          start: fromMinutes(b.start),
          end: fromMinutes(b.end),
          bg: theme.bg,
          text: theme.text,
          bar: theme.bar,
        }),
      );
  });
  lectures.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  // A ticked task leaves the widget at once, so only open tasks are needed.
  const open = p.tasks.filter((t) => !t.done).sort(widgetOrder(dateKey(now))).slice(0, MAX_OPEN_TASKS);

  return {
    v: 1,
    lang: p.lang,
    hasTimetable: p.chosen.length > 0,
    lectures,
    noClass: noClassRanges(p.calendar),
    tasks: open.map(toWidgetTask),
  };
}
