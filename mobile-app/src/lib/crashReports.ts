/**
 * Automatic crash reports (Firebase Crashlytics), always on in release builds (firebase.json).
 *
 * Getting the Crashlytics instance installs its handler for uncaught JavaScript errors, so this runs
 * first thing at startup (src/app/_layout.tsx). Native crashes are caught by the Firebase SDK itself.
 *
 * A report carries the error and where it happened, the app version, device model, OS version and
 * the app language. No user id and nothing the student entered (timetable, grades, tasks, notes).
 * Debug builds send nothing (crashlytics_debug_enabled is false). The web build uses
 * crashReports.web.ts, which does nothing.
 */
import { getCrashlytics, setAttribute } from '@react-native-firebase/crashlytics';

import type { Lang } from '@/lib/i18n';

/** Never lets crash reporting itself break the app (for example a build without the native module). */
function crashlytics() {
  try {
    return getCrashlytics();
  } catch {
    return null;
  }
}

export function startCrashReports(): void {
  crashlytics();
}

/** The app language, attached to later reports. */
export function setCrashReportLanguage(lang: Lang): void {
  const c = crashlytics();
  if (c) setAttribute(c, 'lang', lang).catch(() => {});
}
