/**
 * Keeps the after-lecture notifications (lib/lectureFollowUps.ts) in step with the setting, the
 * timetable and the academic calendar. Mounted once in the root layout; renders nothing.
 *
 * While the setting is on, the next two weeks are rebuilt when the app starts, every time it comes
 * back to the foreground, and when the timetable, the calendar or the language changes. Turning the
 * setting off cancels them all.
 */
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useAcademicCalendar } from '@/lib/calendar/useAcademicCalendar';
import { useLang } from '@/lib/i18n';
import { cancelLectureFollowUps, syncLectureFollowUps } from '@/lib/lectureFollowUps';
import type { Course } from '@/lib/types';
import { useAppData } from '@/store/AppData';

export function LectureFollowUps() {
  const { ready, settings, chosen } = useAppData();
  const on = settings.lectureFollowUp;

  useEffect(() => {
    if (ready && !on) cancelLectureFollowUps();
  }, [ready, on]);

  if (Platform.OS === 'web' || !ready || !on) return null;
  return <Scheduler chosen={chosen} />;
}

function Scheduler({ chosen }: { chosen: Course[] }) {
  // Only read while the setting is on, so the calendar page is not fetched for nothing.
  const { calendar } = useAcademicCalendar();
  const lang = useLang();
  const [wake, setWake] = useState(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setWake((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    syncLectureFollowUps(chosen, calendar.sections);
  }, [chosen, calendar.sections, lang, wake]);

  return null;
}
