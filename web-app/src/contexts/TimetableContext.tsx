import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Course, TimetableEntry, Exam } from '../types';

export interface ConflictInfo {
  type: 'schedule' | 'exam-period';
  conflictingCourse: Course;
  details: string;
  canProceed?: boolean; // false for schedule conflicts (hard conflicts), true for exam period conflicts (warn only)
}

interface TimetableContextType {
  timetable: TimetableEntry[];
  addCourse: (course: Course, skipConfirmation?: boolean) => boolean; // Returns true if added, false if conflict
  removeCourse: (courseId: string) => void;
  removeAllCourses: () => void; // Remove all courses from timetable
  hasConflict: (course: Course) => boolean;
  getConflictInfo: (course: Course) => ConflictInfo | null; // Returns conflict details
  isInTimetable: (courseId: string) => boolean;
  hoveredCourse: Course | null; // Course being hovered in compact view
  setHoveredCourse: (course: Course | null) => void; // Set hovered course for preview
}

const TimetableContext = createContext<TimetableContextType | undefined>(undefined);

/**
 * Check if two time ranges overlap
 */
const timeOverlaps = (
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean => {
  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  // Check if time ranges overlap
  return s1 < e2 && s2 < e1;
};

/**
 * Check if two exams conflict (same day and overlapping time)
 */
const checkExamConflict = (exam1: Exam, exam2: Exam): boolean => {
  if (exam1.day !== exam2.day) return false;
  return timeOverlaps(exam1.startTime, exam1.endTime, exam2.startTime, exam2.endTime);
};

/**
 * Check if two exams have the same period (exam period conflict - warn only)
 */
const checkExamPeriodConflict = (exam1: Exam, exam2: Exam): boolean => {
  // Same exam period (date field contains period number)
  return exam1.date && exam2.date && exam1.date === exam2.date;
};

/**
 * Check if two time ranges overlap
 */
const doTimesOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  // Times overlap if one starts before the other ends
  return s1 < e2 && s2 < e1;
};

/**
 * Check if a course has a schedule conflict with existing courses
 * A conflict occurs when two courses have overlapping times on the same day(s)
 */
const checkScheduleConflict = (course: Course, timetable: TimetableEntry[], excludeCourseId?: string): boolean => {
  for (const entry of timetable) {
    // Skip the course being checked if it's already in the timetable
    if (excludeCourseId && entry.courseId === excludeCourseId) {
      continue;
    }

    // Skip other time slots from the same section if excluding a time slot
    if (excludeCourseId && excludeCourseId.includes('-slot-')) {
      const baseId = excludeCourseId.split('-slot-')[0];
      if (entry.courseId.startsWith(`${baseId}-slot-`)) {
        continue;
      }
    }

    const existingCourse = entry.course;

    // Check main time slot
    const commonDays = course.days.filter(day => existingCourse.days.includes(day));
    if (commonDays.length > 0) {
      if (doTimesOverlap(course.startTime, course.endTime, existingCourse.startTime, existingCourse.endTime)) {
        return true;
      }
    }

    // Check additional time slots
    if (course.timeSlots) {
      for (const slot of course.timeSlots) {
        const slotCommonDays = slot.days.filter(day => existingCourse.days.includes(day));
        if (slotCommonDays.length > 0) {
          if (doTimesOverlap(slot.startTime, slot.endTime, existingCourse.startTime, existingCourse.endTime)) {
            return true;
          }
        }
      }
    }

    // Check existing course's time slots
    if (existingCourse.timeSlots) {
      for (const existingSlot of existingCourse.timeSlots) {
        const commonDays = course.days.filter(day => existingSlot.days.includes(day));
        if (commonDays.length > 0) {
          if (doTimesOverlap(course.startTime, course.endTime, existingSlot.startTime, existingSlot.endTime)) {
            return true;
          }
        }
      }
    }
  }

  return false;
};

/**
 * Get detailed conflict information for a course
 */
const getConflictDetails = (course: Course, timetable: TimetableEntry[], excludeCourseId?: string): ConflictInfo | null => {
  for (const entry of timetable) {
    // Skip the course being checked if it's already in the timetable
    if (excludeCourseId && entry.courseId === excludeCourseId) {
      continue;
    }

    // Skip other time slots from the same section if excluding a time slot
    if (excludeCourseId && excludeCourseId.includes('-slot-')) {
      const baseId = excludeCourseId.split('-slot-')[0];
      if (entry.courseId.startsWith(`${baseId}-slot-`)) {
        continue;
      }
    }

    const existingCourse = entry.course;

    // Check schedule conflicts
    const commonDays = course.days.filter(day => existingCourse.days.includes(day));
    if (commonDays.length > 0) {
      if (doTimesOverlap(course.startTime, course.endTime, existingCourse.startTime, existingCourse.endTime)) {
        return {
          type: 'schedule',
          conflictingCourse: existingCourse,
          details: `Schedule conflict on ${commonDays.join(', ')} at ${course.startTime}-${course.endTime} with ${existingCourse.code}`,
          canProceed: false,
        };
      }
    }

    // Check for exam period conflicts (same exam period)
    if (course.finalExam && existingCourse.finalExam) {
      if (checkExamPeriodConflict(course.finalExam, existingCourse.finalExam)) {
        return {
          type: 'exam-period',
          conflictingCourse: existingCourse,
          details: `Same exam period (${course.finalExam.date}) with ${existingCourse.code}`,
          canProceed: true, // Warn only - allow with confirmation
        };
      }
    }
  }

  return null; // No conflict
};

export const TimetableProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [hoveredCourse, setHoveredCourse] = useState<Course | null>(null);

  // Load timetable from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('qu-student-timetable');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTimetable(parsed);
        }
      }
    } catch (error) {
      console.error('Error loading timetable:', error);
    }
  }, []);

  // Save timetable to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('qu-student-timetable', JSON.stringify(timetable));
    } catch (error) {
      console.error('Error saving timetable:', error);
    }
  }, [timetable]);

  const addCourse = useCallback((course: Course, skipConfirmation?: boolean): boolean => {
    // Check if course is already in timetable
    if (timetable.some((entry) => entry.courseId === course.id)) {
      return false; // Already added
    }

    // Check for schedule conflicts
    if (checkScheduleConflict(course, timetable)) {
      return false; // Schedule conflict detected
    }

    // Add course to timetable
    setTimetable((prev) => [...prev, { courseId: course.id, course }]);
    return true;
  }, [timetable]);

  const removeCourse = useCallback((courseId: string) => {
    setTimetable((prev) => prev.filter((entry) => entry.courseId !== courseId));
  }, []);

  const removeAllCourses = useCallback(() => {
    setTimetable([]);
  }, []);

  const hasConflict = useCallback((course: Course): boolean => {
    const entry = timetable.find((e) => e.courseId === course.id);
    if (entry) {
      return checkScheduleConflict(course, timetable, course.id);
    }
    return checkScheduleConflict(course, timetable);
  }, [timetable]);

  const getConflictInfo = useCallback((course: Course): ConflictInfo | null => {
    const entry = timetable.find((e) => e.courseId === course.id);
    if (entry) {
      return getConflictDetails(course, timetable, course.id);
    }
    return getConflictDetails(course, timetable);
  }, [timetable]);

  const isInTimetable = useCallback((courseId: string): boolean => {
    return timetable.some((entry) => entry.courseId === courseId);
  }, [timetable]);

  const value: TimetableContextType = {
    timetable,
    addCourse,
    removeCourse,
    removeAllCourses,
    hasConflict,
    getConflictInfo,
    isInTimetable,
    hoveredCourse,
    setHoveredCourse,
  };

  return (
    <TimetableContext.Provider value={value}>
      {children}
    </TimetableContext.Provider>
  );
};

export const useTimetable = (): TimetableContextType => {
  const context = useContext(TimetableContext);
  if (context === undefined) {
    throw new Error('useTimetable must be used within a TimetableProvider');
  }
  return context;
};
