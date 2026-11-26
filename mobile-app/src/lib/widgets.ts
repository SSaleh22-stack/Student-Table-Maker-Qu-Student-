/**
 * The data the home-screen and lock-screen widgets show (الجدول، مهامي، المحاضرة القادمة), as one
 * JSON snapshot written by modules/qu-widgets. The widgets work out "now" themselves (the current
 * and next lecture, today's tasks), so the snapshot only changes when the timetable, the tasks, the
 * calendar or the language change.
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

/** Open tasks kept in the snapshot, soonest first (the biggest widget shows far fewer). */
const MAX_OPEN_TASKS = 60;
/** Finished tasks stay this long, so "1 من 4 منجزة" and the struck-through rows are right today. */
const DONE_KEEP_DAYS = 2;

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

/** Undated last; then by date and time. */
const bySoonest = (a: Task, b: Task): number => {
  const ka = `${a.date ?? '9999-99-99'} ${a.time ?? '99:99'}`;
  const kb = `${b.date ?? '9999-99-99'} ${b.time ?? '99:99'}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
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

  const cutoff = dateKey(new Date(now.getTime() - DONE_KEEP_DAYS * 86_400_000));
  const open = p.tasks.filter((t) => !t.done).sort(bySoonest).slice(0, MAX_OPEN_TASKS);
  // Done tasks, and repeating ones finished recently (they moved on, only completedAt tells).
  const recent = p.tasks.filter(
    (t) => t.done && !!t.completedAt && dateKey(new Date(t.completedAt)) >= cutoff,
  );

  return {
    v: 1,
    lang: p.lang,
    hasTimetable: p.chosen.length > 0,
    lectures,
    noClass: noClassRanges(p.calendar),
    tasks: [...open, ...recent].map(toWidgetTask),
  };
}
