/**
 * The academic calendar, read from the university's site and kept on the device.
 *
 * Shows the last saved copy straight away (or the copy bundled with the app), then reads the
 * live page in the background when the saved one is older than a few hours.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { isEnglish } from '@/lib/i18n';

import { CALENDAR_URL, isCalendarSections, parseAcademicCalendar, type CalendarSection } from './parse';
import { CALENDAR_SNAPSHOT, CALENDAR_SNAPSHOT_DATE } from './snapshot';

const CACHE_KEY = 'qu-student:academic-calendar';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

export interface AcademicCalendar {
  sections: CalendarSection[];
  /** When this copy was read from the site (ISO) */
  updatedAt: string;
  /** "live": read now · "saved": from the device · "bundled": the copy that ships with the app */
  source: 'live' | 'saved' | 'bundled';
}

const bundled: AcademicCalendar = { sections: CALENDAR_SNAPSHOT, updatedAt: CALENDAR_SNAPSHOT_DATE, source: 'bundled' };

async function readLive(): Promise<CalendarSection[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CALENDAR_URL, { signal: controller.signal, headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = (await res.text()).slice(0, 3_000_000);
    const sections = parseAcademicCalendar(html);
    if (sections.length === 0) throw new Error('no calendar tables');
    return sections;
  } finally {
    clearTimeout(timer);
  }
}

export function useAcademicCalendar() {
  const [calendar, setCalendar] = useState<AcademicCalendar>(bundled);
  const [loading, setLoading] = useState(false);
  /** The last attempt to read the site failed (the shown copy may be old) */
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const sections = await readLive();
      const fresh: AcademicCalendar = { sections, updatedAt: new Date().toISOString(), source: 'live' };
      setCalendar(fresh);
      setFailed(false);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ sections, updatedAt: fresh.updatedAt })).catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let savedAt = 0;
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        const saved = raw ? (JSON.parse(raw) as { sections?: unknown; updatedAt?: unknown }) : null;
        if (saved && isCalendarSections(saved.sections) && typeof saved.updatedAt === 'string' && !cancelled) {
          setCalendar({ sections: saved.sections, updatedAt: saved.updatedAt, source: 'saved' });
          savedAt = Date.parse(saved.updatedAt) || 0;
        }
      } catch {
        // Damaged saved copy: keep the bundled one.
      }
      if (!cancelled && Date.now() - savedAt > MAX_AGE_MS) refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return { calendar, loading, failed, refresh };
}

/** Local midnight of "2026-08-23". */
export const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Whole days from today to `iso` (negative when it is past). */
export const daysFromToday = (iso: string, today = new Date()) => {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((dateOf(iso).getTime() - start.getTime()) / 86_400_000);
};

export type EventTiming = 'past' | 'now' | 'upcoming';

export const timingOf = (start: string, end: string | undefined, today = new Date()): EventTiming => {
  const fromStart = daysFromToday(start, today);
  const fromEnd = daysFromToday(end ?? start, today);
  if (fromEnd < 0) return 'past';
  if (fromStart <= 0) return 'now';
  return 'upcoming';
};

/** "اليوم", "غداً", "بعد 3 أيام", "بعد 12 يوماً", "بعد 207 أيام" (the noun follows the last two digits) */
export const inDaysLabel = (days: number) => {
  if (isEnglish()) return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'غداً';
  if (days === 2) return 'بعد يومين';
  const lastTwo = days % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `بعد ${days} أيام`;
  if (lastTwo >= 11) return `بعد ${days} يوماً`;
  return `بعد ${days} يوم`;
};
