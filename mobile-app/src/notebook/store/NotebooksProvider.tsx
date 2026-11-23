/**
 * Mounts the notebook store for the whole app. It sits in the root layout inside TasksProvider and
 * OUTSIDE <View key={lang}>, so a language switch never reloads the library or closes a session.
 *
 * On iOS and Android it reads the index and the settings (AsyncStorage), starts the background
 * flush (AppState), records the timetable's course names whenever useAppData().chosen changes, and
 * once the index is read runs the library boot (staging, inbox, old trash, reconcile) in the
 * background. On web it does no disk or storage work at all.
 *
 * The store itself is a module singleton (library.ts), read through the hooks in hooks.ts.
 */
import { useEffect, type ReactNode } from 'react';

import { notebookSupported } from '@/notebook/flags';
import { useAppData } from '@/store/AppData';

import { loadIndex } from './indexStore';
import { bootLibrary, markStoreMounted, markStoreRendered, setChosenCourses, syncChosenCourses } from './library';
import { installAppStateFlush } from './sessions';
import { loadSettings } from './settingsStore';

export function NotebooksProvider({ children }: { children: ReactNode }) {
  const { chosen } = useAppData();
  // Marked during render too: children's mount effects run before this component's effects, and
  // they may already call getNotebooksStore().
  markStoreRendered();

  useEffect(() => markStoreMounted(), []);

  useEffect(() => {
    if (!notebookSupported) return;
    const stopFlush = installAppStateFlush();
    let alive = true;
    void Promise.all([loadIndex(), loadSettings()]).then(() => {
      if (!alive) return;
      // Course names seen while the index was loading, then the boot in the background.
      syncChosenCourses();
      void bootLibrary();
    });
    return () => {
      alive = false;
      stopFlush();
    };
  }, []);

  useEffect(() => {
    if (!notebookSupported) return;
    setChosenCourses(chosen.map((c) => ({ code: c.code, name: c.name })));
  }, [chosen]);

  return <>{children}</>;
}
