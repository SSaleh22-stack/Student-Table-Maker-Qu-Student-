/**
 * Local reminder notifications for personal tasks (expo-notifications). Nothing is sent from a
 * server: every reminder is scheduled on the phone itself, so it works offline and in Expo Go.
 *
 * Each task has at most one scheduled reminder, with the identifier `task-<id>`, plus an optional
 * one-off `task-<id>-snooze`. Every function here is a no-op on web and never throws: a reminder
 * failing must never stop a task from being saved.
 */
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';

import { tr } from '@/lib/i18n';
import { isLectureFollowUp, LECTURE_SLOTS } from '@/lib/lectureFollowUps';
import {
  cleanCustomReminder,
  daysAheadWords,
  dueAt,
  durationWords,
  formatTime,
  nextReminderAt,
  reminderFireDate,
  type Task,
} from '@/lib/tasks';

const CHANNEL_ID = 'tasks';
/** Category ids must not contain ":" or "-" (expo-notifications docs). */
const CATEGORY_ID = 'task_reminder';
const ACTION_DONE = 'done';
const ACTION_SNOOZE = 'snooze';
const PREFIX = 'task-';
const SNOOZE_SUFFIX = '-snooze';

/**
 * iOS keeps at most 64 pending notifications per app; stay under it and keep the soonest. Part of
 * that is left for the after-lecture notifications (lectureFollowUps.ts). Android has no such limit.
 */
const MAX_SCHEDULED = Platform.OS === 'ios' ? 60 - LECTURE_SLOTS : 60;

const DAY_MS = 24 * 60 * 60 * 1000;

const enabled = Platform.OS !== 'web';

const reminderId = (taskId: string) => `${PREFIX}${taskId}`;
const snoozeId = (taskId: string) => `${PREFIX}${taskId}${SNOOZE_SUFFIX}`;

/** Runs a notifications call and swallows any error (unsupported platform, Expo Go limits, ...). */
async function safely<T>(run: () => Promise<T>): Promise<T | undefined> {
  if (!enabled) return undefined;
  try {
    return await run();
  } catch {
    return undefined;
  }
}

/**
 * Reminder changes run one after another. Each one is several native calls, and they share the
 * `task-<id>` identifiers, so a slow resync started earlier must not finish after a later edit
 * and put back a reminder that was just changed or removed.
 */
let queue: Promise<unknown> = Promise.resolve();
const inOrder = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
};

let channelReady: Promise<unknown> | null = null;

/** Android shows nothing without a channel, and on Android 13+ the permission prompt needs one first. */
const ensureChannel = () => {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= safely(() =>
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: tr('تذكير المهام', 'Task reminders'),
      importance: AndroidImportance.HIGH,
      lightColor: '#0E7490',
    }),
  );
  return channelReady;
};

/** Asks for notification permission if it was never asked. Resolves to whether reminders can show. */
export async function ensureReminderPermission(): Promise<boolean> {
  const result = await safely(async () => {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.ios?.status === IosAuthorizationStatus.PROVISIONAL) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return asked.granted || asked.ios?.status === IosAuthorizationStatus.PROVISIONAL;
  });
  return result ?? false;
}

/** "باقي ساعة على الموعد · 11:59 م · CS102". `withTime` is off when the lead already says the time. */
const bodyFor = (task: Task, lead: string, withTime = true): string =>
  [lead, withTime && task.time ? formatTime(task.time) : null, task.courseCode ?? null].filter(Boolean).join(' · ');

/**
 * The text of a custom reminder. 'before' counts down to the due time; 'at' says how far the task
 * still is ('موعدها غداً الساعة 11:59 م'), in relative words so it stays true for every repeat.
 */
const customText = (task: Task): { lead: string; withTime: boolean } => {
  const c = cleanCustomReminder(task.reminderCustom, !!task.time);
  if (!c) return { lead: tr('تذكير بالمهمة', 'Task reminder'), withTime: true };
  if (c.kind === 'before') {
    const w = durationWords(c.minutes);
    return { lead: tr(`باقي ${w} على الموعد`, `Due in ${w}`), withTime: true };
  }
  // A saved 'at' that rings after the due time would talk about a passed time as if still coming.
  const fire = reminderFireDate(task);
  const due = dueAt(task);
  if (fire && due && fire.getTime() > due.getTime()) {
    return { lead: tr('تذكير بالمهمة', 'Task reminder'), withTime: true };
  }
  const ahead = daysAheadWords(c.daysBefore);
  if (task.time) {
    const time = formatTime(task.time);
    return { lead: tr(`موعدها ${ahead} الساعة ${time}`, `Due ${ahead} at ${time}`), withTime: false };
  }
  const lead = c.daysBefore === 0 ? tr('مهمة اليوم', 'Due today') : tr(`موعدها ${ahead}`, `Due ${ahead}`);
  return { lead, withTime: true };
};

const leadFor = (task: Task): string => {
  switch (task.reminder) {
    case 'custom':
      return customText(task).lead;
    case 'atTime':
      return tr('حان موعد المهمة', 'Due now');
    case '10m':
      return tr('باقي 10 دقائق على الموعد', 'Due in 10 minutes');
    case '1h':
      return tr('باقي ساعة على الموعد', 'Due in 1 hour');
    case '1d':
      return tr('الموعد غداً', 'Due tomorrow');
    default:
      return tr('مهمة اليوم', 'Due today');
  }
};

const contentFor = (task: Task, lead: string, withTime = true): Notifications.NotificationContentInput => ({
  title: task.title,
  body: bodyFor(task, lead, withTime),
  data: { taskId: task.id },
  categoryIdentifier: CATEGORY_ID,
  sound: 'default',
});

/**
 * The trigger for a task's reminder, or null when none is due. A repeating task gets a repeating
 * trigger so it keeps reminding even if the app is not opened; when its first reminder is more
 * than one period away, a one-off date is used instead (a daily trigger would start firing today),
 * and the next app start switches it to the repeating one.
 */
const triggerFor = (task: Task, now = Date.now()): Notifications.NotificationTriggerInput | null => {
  if (task.done) return null;
  const fire = reminderFireDate(task);
  if (!fire) return null;
  const channelId = CHANNEL_ID;
  const period = task.repeat === 'daily' ? DAY_MS : task.repeat === 'weekly' ? 7 * DAY_MS : 0;
  if (period > 0 && fire.getTime() - now <= period) {
    const hour = fire.getHours();
    const minute = fire.getMinutes();
    if (task.repeat === 'daily') {
      return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId };
    }
    // expo-notifications counts weekdays 1–7 from Sunday; JS getDay() counts 0–6.
    return { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: fire.getDay() + 1, hour, minute, channelId };
  }
  if (fire.getTime() <= now) return null;
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fire, channelId };
};

const schedule = (task: Task, trigger: Notifications.NotificationTriggerInput) =>
  safely(async () => {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(task.id),
      content: contentFor(task, leadFor(task), task.reminder !== 'custom' || customText(task).withTime),
      trigger,
    });
  });

/**
 * Replaces the task's scheduled reminder with one that matches it now (or none). A snooze is
 * dropped too: snoozing never changes the task, so this only runs after the task itself changed
 * (ticked off, moved, edited), and the snoozed reminder would be about the old version.
 */
export function syncTaskReminder(task: Task): Promise<void> {
  return inOrder(async () => {
    await safely(() => Notifications.cancelScheduledNotificationAsync(reminderId(task.id)));
    await safely(() => Notifications.cancelScheduledNotificationAsync(snoozeId(task.id)));
    const trigger = triggerFor(task);
    if (trigger) await schedule(task, trigger);
  });
}

/** Removes the task's reminder and any snoozed one (the task was deleted). */
export function cancelTaskReminder(id: string): Promise<void> {
  return inOrder(async () => {
    await safely(() => Notifications.cancelScheduledNotificationAsync(reminderId(id)));
    await safely(() => Notifications.cancelScheduledNotificationAsync(snoozeId(id)));
  });
}

/**
 * Makes the phone's scheduled reminders match the saved tasks: drops reminders of deleted or
 * finished tasks and schedules every one that is needed, soonest first. Run after the tasks load
 * (and when the language changes, so the text follows it).
 */
export function resyncAllReminders(tasks: Task[]): Promise<void> {
  if (!enabled) return Promise.resolve();
  return inOrder(() => resyncNow(tasks));
}

async function resyncNow(tasks: Task[]): Promise<void> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const scheduled = (await safely(() => Notifications.getAllScheduledNotificationsAsync())) ?? [];
  for (const req of scheduled) {
    const id = req.identifier;
    if (!id.startsWith(PREFIX)) continue;
    if (id.endsWith(SNOOZE_SUFFIX)) {
      const task = byId.get(id.slice(PREFIX.length, -SNOOZE_SUFFIX.length));
      if (task && !task.done) continue;
    }
    await safely(() => Notifications.cancelScheduledNotificationAsync(id));
  }
  const now = Date.now();
  const at = new Date(now);
  // Sorted by when each one really rings next (a repeating reminder rolls on to its next period).
  const wanted = tasks
    .map((task) => ({ task, trigger: triggerFor(task, now), fire: nextReminderAt(task, at)?.getTime() ?? 0 }))
    .filter((w) => w.trigger !== null)
    .sort((a, b) => a.fire - b.fire)
    .slice(0, MAX_SCHEDULED);
  for (const w of wanted) await schedule(w.task, w.trigger as Notifications.NotificationTriggerInput);
}

/** A one-off reminder in a few minutes ("ذكّرني بعد 10 دقائق"). */
export function snoozeReminder(task: Task, minutes: number): Promise<void> {
  return inOrder(async () => {
    await safely(async () => {
      await ensureChannel();
      await Notifications.scheduleNotificationAsync({
        identifier: snoozeId(task.id),
        content: contentFor(task, tr('تذكير بالمهمة', 'Task reminder')),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(60, Math.round(minutes * 60)),
          channelId: CHANNEL_ID,
        },
      });
    });
  });
}

/** The same response can arrive both as an event and as the "last response" at a cold start. */
const handled = new Set<string>();

/**
 * Shows reminders while the app is open, registers the "done" and "snooze" buttons, and routes
 * taps: a button calls the handler, a tap on the notification opens the tasks tab. Call once the
 * tasks are loaded, so a button pressed before the app started finds its task. Returns cleanup.
 */
export function setupReminders(handlers: {
  /** `deliveredMs`: when the reminder rang (ms), to tell which occurrence it was for. */
  onDone(id: string, deliveredMs?: number): void;
  onSnooze(id: string): void;
}): () => void {
  if (!enabled) return () => {};
  let active = true;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Not available here; the reminders still arrive while the app is closed.
  }

  ensureChannel();
  // Both buttons open the app: with the app killed, a button that stays in the background never
  // reaches JS (no response event, no "last response"), so the tick or the snooze would be lost.
  safely(() =>
    Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
      { identifier: ACTION_DONE, buttonTitle: tr('تم إنجاز المهمة', 'Mark as done'), options: { opensAppToForeground: true } },
      {
        identifier: ACTION_SNOOZE,
        buttonTitle: tr('ذكّرني بعد 10 دقائق', 'Remind me in 10 minutes'),
        options: { opensAppToForeground: true },
      },
    ]),
  );

  const respond = (response: Notifications.NotificationResponse) => {
    const { notification, actionIdentifier } = response;
    const key = `${notification.request.identifier}:${notification.date}:${actionIdentifier}`;
    if (!active || handled.has(key)) return;
    handled.add(key);
    const data = notification.request.content.data as unknown;
    // "هل هناك ما تضيفه إلى مهامك؟" after a lecture: a tap opens a new task for that course.
    if (isLectureFollowUp(data)) {
      if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        setTimeout(() => {
          try {
            router.push({ pathname: '/task', params: { course: data.courseCode } });
          } catch {
            // No navigator yet; the app simply opens where it was.
          }
        }, 0);
      }
      safely(() => Notifications.clearLastNotificationResponseAsync());
      return;
    }
    const taskId = (data as { taskId?: unknown } | undefined)?.taskId;
    if (typeof taskId !== 'string') return;
    try {
      if (actionIdentifier === ACTION_DONE) {
        // Seconds on some platforms, milliseconds on others.
        const delivered = typeof notification.date === 'number' && notification.date > 0 ? notification.date : undefined;
        handlers.onDone(taskId, delivered === undefined ? undefined : delivered < 1e11 ? delivered * 1000 : delivered);
      }
      else if (actionIdentifier === ACTION_SNOOZE) handlers.onSnooze(taskId);
      else if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        // Wait a tick so the navigator is mounted when the app was opened by this tap.
        setTimeout(() => {
          try {
            router.navigate('/tasks');
          } catch {
            // No navigator yet; the app simply opens where it was.
          }
        }, 0);
      }
    } catch {
      // A handler error must not break the listener.
    }
    if (actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      safely(() => Notifications.dismissNotificationAsync(notification.request.identifier));
    }
    safely(() => Notifications.clearLastNotificationResponseAsync());
  };

  let subscription: { remove(): void } | null = null;
  try {
    subscription = Notifications.addNotificationResponseReceivedListener(respond);
  } catch {
    subscription = null;
  }
  // The app may have been started by a tap or a button on a reminder.
  safely(() => Notifications.getLastNotificationResponseAsync()).then((last) => {
    if (last) respond(last);
  });

  return () => {
    active = false;
    subscription?.remove();
  };
}
