/**
 * TEMPORARY, development builds only: marks the library tour, the first-time setup and the notebook
 * tour unseen (and turns pen pressure off, the new default) ONCE per DEV_TOUR_RESET token, so testing in Expo Go can see the first-visit experience
 * again. Bump the token to reset again; delete this file (and its call in NotebookServices) before the
 * beta ships. Release builds never run it (__DEV__ is false there).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

import { useNotebooks } from '@/notebook/store/hooks';
import { settingsStore } from '@/notebook/store/settingsStore';
import { resetTours } from '@/notebook/tours/tourState';

const DEV_TOUR_RESET = '2026-11-23-3';
const KEY = 'nb-dev-tour-reset';

export function useDevTourReset(): void {
  const loaded = useNotebooks().loaded;
  useEffect(() => {
    if (!__DEV__ || !loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        if ((await AsyncStorage.getItem(KEY)) === DEV_TOUR_RESET || cancelled) return;
        resetTours();
        settingsStore.set({ pressure: false });
        await AsyncStorage.setItem(KEY, DEV_TOUR_RESET);
      } catch {
        // Development helper only: nothing to do.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded]);
}
