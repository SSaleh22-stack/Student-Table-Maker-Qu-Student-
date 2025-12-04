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

    // Check if courses share any common days
    const commonDays = course.days.filter(day => existingCourse.days.includes(day));
    
    if (commonDays.length > 0) {
      // If they share days, check if times overlap
      if (doTimesOverlap(
        course.startTime,
        course.endTime,
        existingCourse.startTime,
        existingCourse.endTime
      )) {
        return true; // Schedule conflict found
      }
    }
  }

  return false; // No conflict
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

    // Check if courses share any common days
    const commonDays = course.days.filter(day => existingCourse.days.includes(day));
    
    if (commonDays.length > 0) {
      // If they share days, check if times overlap
      if (doTimesOverlap(
        course.startTime,
        course.endTime,
        existingCourse.startTime,
        existingCourse.endTime
      )) {
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

  // Load timetable from storage on mount
  useEffect(() => {
    chrome.storage.sync.get(['timetable'], (result) => {
      if (result.timetable && Array.isArray(result.timetable)) {
        setTimetable(result.timetable);
      }
    });
  }, []);

  // Save timetable to storage whenever it changes
  useEffect(() => {
    if (timetable.length > 0 || chrome.storage) {
      chrome.storage.sync.set({ timetable });
    }
  }, [timetable]);

  const addCourse = useCallback((course: Course, skipConfirmation?: boolean): boolean => {
    // If course has multiple time slots, add each as a separate entry
    if (course.timeSlots && course.timeSlots.length > 1) {
      let allAdded = true;
      const entriesToAdd: TimetableEntry[] = [];

      course.timeSlots.forEach((slot, slotIndex) => {
        // Create a course entry for this time slot
        const slotCourse: Course = {
          ...course,
          id: `${course.id}-slot-${slotIndex}`, // Unique ID for each time slot
          days: slot.days,
          startTime: slot.startTime,
          endTime: slot.endTime,
          location: slot.location || course.location,
        };

        // Check if this specific time slot is already in timetable
        const slotId = slotCourse.id;
        if (timetable.some((entry) => entry.courseId === slotId)) {
          return; // Skip this slot, already added
        }

        // Check for schedule conflicts
        if (checkScheduleConflict(slotCourse, timetable)) {
          allAdded = false;
          return; // Skip this slot due to conflict
        }

        entriesToAdd.push({ courseId: slotId, course: slotCourse });
      });

      if (entriesToAdd.length === 0) {
        return false; // No slots could be added
      }

      // Add all valid time slot entries
      setTimetable((prev) => [...prev, ...entriesToAdd]);
      return allAdded; // Return true only if all slots were added
    } else {
      // Single time slot course (normal case)
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
    }
  }, [timetable]);

  const removeCourse = useCallback((courseId: string) => {
    setTimetable((prev) => {
      // If removing a time slot (format: courseId-slot-X), remove all time slots from the same section
      if (courseId.includes('-slot-')) {
        // Extract base course ID (everything before '-slot-')
        const baseCourseId = courseId.split('-slot-')[0];
        // Remove all entries that match this base course ID or are time slots of it
        return prev.filter((entry) => {
          // Remove exact match
          if (entry.courseId === courseId) return false;
          // Remove other time slots from the same section
          if (entry.courseId.startsWith(`${baseCourseId}-slot-`)) return false;
          // Keep everything else
          return true;
        });
      }
      // If removing a regular course, also check if there are time slots
      // Remove the course and all its time slots
      return prev.filter((entry) => {
        // Remove exact match
        if (entry.courseId === courseId) return false;
        // Remove time slots of this course
        if (entry.courseId.startsWith(`${courseId}-slot-`)) return false;
        return true;
      });
    });
  }, []);

  const removeAllCourses = useCallback(() => {
    setTimetable([]);
  }, []);

  const hasConflict = useCallback((course: Course): boolean => {
    // Check if course has multiple time slots
    if (course.timeSlots && course.timeSlots.length > 1) {
      return course.timeSlots.some((slot, slotIndex) => {
        const slotCourse: Course = {
          ...course,
          id: `${course.id}-slot-${slotIndex}`,
          days: slot.days,
          startTime: slot.startTime,
          endTime: slot.endTime,
        };
        const slotId = slotCourse.id;
        const entry = timetable.find((e) => e.courseId === slotId);
        if (entry) {
          return checkScheduleConflict(slotCourse, timetable, slotId);
        }
        return checkScheduleConflict(slotCourse, timetable);
      });
    }
    
    // Single time slot course
    const entry = timetable.find((e) => e.courseId === course.id);
    if (entry) {
      return checkScheduleConflict(course, timetable, course.id);
    }
    return checkScheduleConflict(course, timetable);
  }, [timetable]);

  const getConflictInfo = useCallback((course: Course): ConflictInfo | null => {
    // Check if course has multiple time slots
    if (course.timeSlots && course.timeSlots.length > 1) {
      for (let slotIndex = 0; slotIndex < course.timeSlots.length; slotIndex++) {
        const slot = course.timeSlots[slotIndex];
        const slotCourse: Course = {
          ...course,
          id: `${course.id}-slot-${slotIndex}`,
          days: slot.days,
          startTime: slot.startTime,
          endTime: slot.endTime,
        };
        const slotId = slotCourse.id;
        const entry = timetable.find((e) => e.courseId === slotId);
        const conflictInfo = entry 
          ? getConflictDetails(slotCourse, timetable, slotId)
          : getConflictDetails(slotCourse, timetable);
        if (conflictInfo) {
          return conflictInfo;
        }
      }
      return null;
    }
    
    // Single time slot course
    const entry = timetable.find((e) => e.courseId === course.id);
    if (entry) {
      return getConflictDetails(course, timetable, course.id);
    }
    return getConflictDetails(course, timetable);
  }, [timetable]);

  const isInTimetable = useCallback((courseId: string): boolean => {
    // Check if the course or any of its time slots are in the timetable
    return timetable.some((entry) => {
      // Check exact match
      if (entry.courseId === courseId) return true;
      // Check if it's a time slot of this course (format: courseId-slot-X)
      if (entry.courseId.startsWith(`${courseId}-slot-`)) return true;
      return false;
    });
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

