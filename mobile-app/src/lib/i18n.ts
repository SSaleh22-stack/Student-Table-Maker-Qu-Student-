/**
 * App language: Arabic (default) or English.
 *
 * The app always starts in Arabic, whatever the phone's language is. A student can switch to
 * English from the home screen; the choice is saved on the device. Switching remounts the
 * screens (the root layout keys them by language), so `tr()` can be called anywhere at render
 * time, including plain helpers outside components.
 *
 * Text that comes from the portal (course names, instructors) is data and stays as it is.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { applyDirection } from '@/lib/rtl';

export type Lang = 'ar' | 'en';

const STORAGE_KEY = 'qu-student:lang';

let current: Lang = 'ar';
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;
export const isEnglish = (): boolean => current === 'en';

/** Picks the text for the current language: `tr('رجوع', 'Back')`. */
export function tr(ar: string, en: string): string {
  return current === 'en' ? en : ar;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  applyDirection(lang === 'ar');
  AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The current language; re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Loads the saved language once at startup. Resolves to true when ready. */
export function useLanguageBoot(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'en') {
          current = 'en';
          applyDirection(false);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return ready;
}
