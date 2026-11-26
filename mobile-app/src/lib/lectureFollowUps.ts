/**
 * "هل هناك ما تضيفه إلى مهامك؟": a local notification when each lecture in the timetable ends,
 * while the setting is on (More › Settings, off by default). Tapping it opens a new task with that
 * course already chosen (handled in reminders.ts, which owns the notification taps).
 *
 * Holidays and the time after the term's classes end are skipped (calendar/classDays.ts), so the
 * notifications are one-off dates rather than weekly repeats: the next LOOKAHEAD_DAYS are scheduled,
 * and the list is rebuilt whenever the app starts or comes back, the timetable or the setting
 * changes, or the calendar is read again.
 *
 * Identifiers start with `lecture-`; every rebuild cancels all of them first. iOS keeps at most 64
 * pending notifications per app, so the count is capped there (task reminders keep the rest, see
 * reminders.ts). Every function here is a no-op on web and never throws.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { noClassRanges, upcomingLectureEnds, type WeeklyLecture } from '@/lib/calendar/classDays';
import type { CalendarSection } from '@/lib/calendar/parse';
import { tr } from '@/lib/i18n';
import { blocksOf } from '@/lib/schedule';
import type { Course } from '@/lib/types';

const PREFIX = 'lecture-';
const CHANNEL_ID = 'lectures';
const LOOKAHEAD_DAYS = 14;
/** iOS shares 64 slots with the task reminders (reminders.ts keeps 44 there). */
export const LECTURE_SLOTS = Platform.OS === 'ios' ? 16 : 40;

const enabled = Platform.OS !== 'web';

/** What a lecture notification carries, read back when it is tapped. */
export interface LectureFollowUpData {
  kind: 'lecture-follow-up';
  courseCode: string;
}

export const isLectureFollowUp = (data: unknown): data is LectureFollowUpData =>
  !!data &&
  typeof data === 'object' &&
  (data as { kind?: unknown }).kind === 'lecture-follow-up' &&
  typeof (data as { courseCode?: unknown }).courseCode === 'string';

async function safely<T>(run: () => Promise<T>): Promise<T | undefined> {
  if (!enabled) return undefined;
  try {
    return await run();
  } catch {
    return undefined;
  }
}

/** Rebuilds run one after another, so an older one can never finish last and put back stale ones. */
let queue: Promise<unknown> = Promise.resolve();
const inOrder = (run: () => Promise<void>): Promise<void> => {
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
};

let channelReady: Promise<unknown> | null = null;
const ensureChannel = () => {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= safely(() =>
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: tr('بعد المحاضرة', 'After lectures'),
      importance: AndroidImportance.DEFAULT,
      lightColor: '#0E7490',
    }),
  );
  return channelReady;
};

/** The weekly lectures of the chosen sections (one per day and time slot). */
export function weeklyLectures(chosen: readonly Course[]): WeeklyLecture[] {
  return chosen.flatMap((course) =>
    blocksOf(course)
      .filter((b) => b.end > b.start)
      .map((b) => ({ day: b.day, endMinutes: b.end, code: course.code, name: course.name || course.code })),
  );
}

async function cancelAllNow(): Promise<void> {
  const scheduled = (await safely(() => Notifications.getAllScheduledNotificationsAsync())) ?? [];
  for (const req of scheduled) {
    if (req.identifier.startsWith(PREFIX)) {
      await safely(() => Notifications.cancelScheduledNotificationAsync(req.identifier));
    }
  }
}

/** Removes every scheduled after-lecture notification (the setting was turned off). */
export function cancelLectureFollowUps(): Promise<void> {
  if (!enabled) return Promise.resolve();
  return inOrder(cancelAllNow);
}

/**
 * Schedules the after-lecture notifications for the coming days, replacing the ones scheduled
 * before. Call only while the setting is on and notifications are allowed.
 */
export function syncLectureFollowUps(chosen: readonly Course[], calendar: readonly CalendarSection[]): Promise<void> {
  if (!enabled) return Promise.resolve();
  return inOrder(async () => {
    await cancelAllNow();
    const ends = upcomingLectureEnds(weeklyLectures(chosen), new Date(), LOOKAHEAD_DAYS, noClassRanges(calendar)).slice(
      0,
      LECTURE_SLOTS,
    );
    if (!ends.length) return;
    await ensureChannel();
    for (const end of ends) {
      const data: LectureFollowUpData = { kind: 'lecture-follow-up', courseCode: end.code };
      await safely(() =>
        Notifications.scheduleNotificationAsync({
          identifier: `${PREFIX}${end.at.getTime()}-${end.code}`,
          content: {
            title: tr('هل هناك ما تضيفه إلى مهامك؟', 'Anything to add to your tasks?'),
            body: tr(`انتهت محاضرة ${end.name} (${end.code}). اضغط لإضافة مهمة.`, `${end.name} (${end.code}) just ended. Tap to add a task.`),
            data: data as unknown as Record<string, unknown>,
            sound: 'default',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: end.at, channelId: CHANNEL_ID },
        }),
      );
    }
  });
}
