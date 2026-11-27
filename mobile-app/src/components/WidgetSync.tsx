/**
 * Keeps the home-screen and lock-screen widgets in step with the app (lib/widgets.ts). Mounted
 * once in the root layout; renders nothing.
 *
 * - Ticks made on a widget while the app was away are applied to the tasks when the app starts and
 *   every time it comes back to the foreground (the task's reminder is then updated as usual).
 * - The snapshot is written again when the timetable, the tasks or the language change, and on
 *   every return to the foreground (a newly saved academic calendar is picked up then).
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { readSavedCalendarSections } from '@/lib/calendar/useAcademicCalendar';
import { useLang } from '@/lib/i18n';
import { buildWidgetSnapshot } from '@/lib/widgets';
import { useAppData } from '@/store/AppData';
import { useTasks } from '@/store/Tasks';

import { setWidgetSnapshot, takeWidgetToggles, widgetsAvailable } from '../../modules/qu-widgets';

/** Several changes in a row (ticking a few tasks) write one snapshot. */
const WRITE_DELAY_MS = 400;

export function WidgetSync() {
  if (Platform.OS === 'web' || !widgetsAvailable()) return null;
  return <Sync />;
}

function Sync() {
  const { ready, chosen } = useAppData();
  // `saved`, not `loaded`: while the saved tasks could not be read, the widget ticks stay queued and
  // no empty list is written over the widgets.
  const { saved, tasks, applyWidgetToggles } = useTasks();
  const lang = useLang();
  const [wake, setWake] = useState(0);
  const apply = useRef(applyWidgetToggles);
  useEffect(() => {
    apply.current = applyWidgetToggles;
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setWake((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  // Widget ticks first, so the snapshot written next already has them.
  useEffect(() => {
    if (!saved) return;
    const toggles = takeWidgetToggles();
    if (toggles.length) apply.current(toggles);
  }, [saved, wake]);

  useEffect(() => {
    if (!ready || !saved) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const calendar = await readSavedCalendarSections();
      if (cancelled) return;
      setWidgetSnapshot(JSON.stringify(buildWidgetSnapshot({ lang, chosen, tasks, calendar })));
    }, WRITE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, saved, chosen, tasks, lang, wake]);

  return null;
}
