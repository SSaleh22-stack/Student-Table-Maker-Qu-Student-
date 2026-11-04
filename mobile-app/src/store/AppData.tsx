/**
 * App state: imported sections, the chosen sections (any number, even of the same course),
 * GPA inputs, absence counts and app settings. Everything is saved on the device with AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { groupCourses, type CourseGroup } from '@/lib/courses';
import type { GPAScale, GradeLetter } from '@/lib/gpa';
import type { Course } from '@/lib/types';

const STORAGE_KEY = 'qu-student:v1';

export interface GpaInputs {
  scale: GPAScale;
  prevGpa: string;
  prevHours: string;
  /** Grade per course code */
  grades: Record<string, GradeLetter>;
}

/** A course tracked for absence only (added by hand, not in the timetable). */
export interface ManualAbsenceCourse {
  /** "manual-…"; also its key in `absent` and `weeklyOverride` */
  id: string;
  code: string;
  name: string;
}

export interface AbsenceInputs {
  studyWeeks: number;
  maxPercent: number;
  /** Hours absent per course code (or manual course id) */
  absent: Record<string, number>;
  /** Weekly hours set by hand (for courses with no time, or to override) */
  weeklyOverride: Record<string, number>;
  /** Courses added by hand on the absence screen */
  manual: ManualAbsenceCourse[];
}

/** Choices from the settings group on the More tab. */
export interface AppSettings {
  /** Show the "next lecture" card on the home screen (off unless the user turns it on) */
  showTodayCard: boolean;
}

interface Persisted {
  version: 1;
  courses: Course[];
  /** Ids of the chosen sections */
  chosenIds: string[];
  importedAt?: string;
  gpa: GpaInputs;
  absence: AbsenceInputs;
  settings: AppSettings;
}

/** Keeps the chosen ids that still match a section, without duplicates. */
const keepExisting = (ids: string[], courses: Course[]): string[] => {
  const known = new Set(courses.map((c) => c.id));
  return [...new Set(ids)].filter((id) => known.has(id));
};

const initialState: Persisted = {
  version: 1,
  courses: [],
  chosenIds: [],
  gpa: { scale: 5, prevGpa: '', prevHours: '', grades: {} },
  absence: { studyWeeks: 15, maxPercent: 25, absent: {}, weeklyOverride: {}, manual: [] },
  settings: { showTodayCard: false },
};

interface AppDataValue extends Persisted {
  ready: boolean;
  groups: CourseGroup[];
  /** Chosen sections, in the portal's course order */
  chosen: Course[];
  importCourses: (courses: Course[]) => void;
  /** Adds a section to the timetable (other sections of the course stay) */
  chooseSection: (section: Course) => void;
  removeSection: (section: Course) => void;
  addManualCourse: (course: Course) => void;
  setGpa: (patch: Partial<Omit<GpaInputs, 'grades'>>) => void;
  setGrade: (code: string, grade: GradeLetter) => void;
  setAbsence: (patch: Partial<Pick<AbsenceInputs, 'studyWeeks' | 'maxPercent'>>) => void;
  setAbsent: (code: string, hours: number) => void;
  setWeeklyOverride: (code: string, hours: number) => void;
  /** Adds a course to the absence screen only; returns its id */
  addManualAbsence: (course: { code: string; name: string; hoursPerWeek: number }) => string;
  removeManualAbsence: (id: string) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  clearAll: () => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(initialState);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load once
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        // Older saves kept one section per course in `selection` (key → section id).
        const saved = JSON.parse(raw) as Partial<Persisted> & { selection?: Record<string, string> };
        if (saved.version !== 1) return;
        const courses = Array.isArray(saved.courses) ? saved.courses : [];
        const ids = Array.isArray(saved.chosenIds) ? saved.chosenIds : Object.values(saved.selection ?? {});
        setState({
          version: 1,
          courses,
          chosenIds: keepExisting(
            ids.filter((id): id is string => typeof id === 'string'),
            courses,
          ),
          importedAt: saved.importedAt,
          gpa: { ...initialState.gpa, ...saved.gpa },
          absence: {
            ...initialState.absence,
            ...saved.absence,
            manual: Array.isArray(saved.absence?.manual)
              ? saved.absence.manual.filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
              : [],
          },
          settings: { ...initialState.settings, ...saved.settings },
        });
      })
      .catch(() => {
        // Corrupt or unreadable data: start fresh rather than crash.
      })
      .finally(() => setReady(true));
  }, []);

  // Save shortly after every change
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    }, 300);
  }, [state, ready]);

  const importCourses = useCallback((courses: Course[]) => {
    setState((prev) => {
      const ids = new Set(courses.map((c) => c.id));
      // Keep manually added courses that the portal doesn't know about
      const manual = prev.courses.filter((c) => c.id.startsWith('manual-') && !ids.has(c.id));
      const all = [...courses, ...manual];
      // Keep earlier choices whose section still exists
      return {
        ...prev,
        courses: all,
        chosenIds: keepExisting(prev.chosenIds, all),
        importedAt: new Date().toISOString(),
      };
    });
  }, []);

  const chooseSection = useCallback((section: Course) => {
    setState((prev) =>
      prev.chosenIds.includes(section.id) ? prev : { ...prev, chosenIds: [...prev.chosenIds, section.id] },
    );
  }, []);

  const removeSection = useCallback((section: Course) => {
    setState((prev) => ({ ...prev, chosenIds: prev.chosenIds.filter((id) => id !== section.id) }));
  }, []);

  const addManualCourse = useCallback((course: Course) => {
    setState((prev) => ({
      ...prev,
      courses: [...prev.courses.filter((c) => c.id !== course.id), course],
      chosenIds: prev.chosenIds.includes(course.id) ? prev.chosenIds : [...prev.chosenIds, course.id],
    }));
  }, []);

  const setGpa = useCallback((patch: Partial<Omit<GpaInputs, 'grades'>>) => {
    setState((prev) => ({ ...prev, gpa: { ...prev.gpa, ...patch } }));
  }, []);

  const setGrade = useCallback((code: string, grade: GradeLetter) => {
    setState((prev) => ({ ...prev, gpa: { ...prev.gpa, grades: { ...prev.gpa.grades, [code]: grade } } }));
  }, []);

  const setAbsence = useCallback((patch: Partial<Pick<AbsenceInputs, 'studyWeeks' | 'maxPercent'>>) => {
    setState((prev) => ({ ...prev, absence: { ...prev.absence, ...patch } }));
  }, []);

  const setAbsent = useCallback((code: string, hours: number) => {
    setState((prev) => ({
      ...prev,
      absence: { ...prev.absence, absent: { ...prev.absence.absent, [code]: Math.max(0, hours) } },
    }));
  }, []);

  const setWeeklyOverride = useCallback((code: string, hours: number) => {
    setState((prev) => ({
      ...prev,
      absence: { ...prev.absence, weeklyOverride: { ...prev.absence.weeklyOverride, [code]: Math.max(0, hours) } },
    }));
  }, []);

  const addManualAbsence = useCallback((course: { code: string; name: string; hoursPerWeek: number }) => {
    const id = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setState((prev) => ({
      ...prev,
      absence: {
        ...prev.absence,
        manual: [
          ...prev.absence.manual,
          { id, code: course.code.trim().slice(0, 20), name: course.name.trim().slice(0, 120) },
        ],
        weeklyOverride: { ...prev.absence.weeklyOverride, [id]: Math.max(0, course.hoursPerWeek) },
      },
    }));
    return id;
  }, []);

  const removeManualAbsence = useCallback((id: string) => {
    setState((prev) => {
      const absent = { ...prev.absence.absent };
      const weeklyOverride = { ...prev.absence.weeklyOverride };
      delete absent[id];
      delete weeklyOverride[id];
      return {
        ...prev,
        absence: { ...prev.absence, manual: prev.absence.manual.filter((m) => m.id !== id), absent, weeklyOverride },
      };
    });
  }, []);

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  // Settings are preferences, not data: deleting the data keeps them.
  const clearAll = useCallback(() => setState((prev) => ({ ...initialState, settings: prev.settings })), []);

  const groups = useMemo(() => groupCourses(state.courses), [state.courses]);

  const chosen = useMemo(() => {
    const ids = new Set(state.chosenIds);
    return groups.flatMap((g) => g.sections.filter((s) => ids.has(s.id)));
  }, [groups, state.chosenIds]);

  const value: AppDataValue = {
    ...state,
    ready,
    groups,
    chosen,
    importCourses,
    chooseSection,
    removeSection,
    addManualCourse,
    setGpa,
    setGrade,
    setAbsence,
    setAbsent,
    setWeeklyOverride,
    addManualAbsence,
    removeManualAbsence,
    setSettings,
    clearAll,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}
