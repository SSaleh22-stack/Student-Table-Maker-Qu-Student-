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
  addCourse: (course: Course, skipConfirmation?: boolean, forceAddWithConflict?: boolean) => boolean; // Returns true if added, false if conflict
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
  return !!(exam1.date && exam2.date && exam1.date === exam2.date);
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

  const addCourse = useCallback((course: Course, skipConfirmation?: boolean, forceAddWithConflict?: boolean): boolean => {
    // If course has multiple time slots, add each time slot as a separate entry
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
        const hasConflict = checkScheduleConflict(slotCourse, timetable);
        if (hasConflict && !forceAddWithConflict) {
          allAdded = false;
          return; // Skip this slot due to conflict
        }

        // Add entry, marking as conflict section if forced with conflict
        entriesToAdd.push({ 
          courseId: slotId, 
          course: slotCourse,
          isConflictSection: hasConflict && forceAddWithConflict
        });
      });

      if (entriesToAdd.length === 0) {
        return false; // No slots could be added
      }

      // Add all valid time slot entries
      setTimetable((prev) => [...prev, ...entriesToAdd]);
      return allAdded || forceAddWithConflict; // Return true if all slots were added or forced
    } else {
      // Single time slot course (normal case)
      // Check if course is already in timetable
      if (timetable.some((entry) => entry.courseId === course.id)) {
        return false; // Already added
      }

      // Check for schedule conflicts
      const hasConflict = checkScheduleConflict(course, timetable);
      if (hasConflict && !forceAddWithConflict) {
        return false; // Schedule conflict detected
      }

      // Add course to timetable, marking as conflict section if forced with conflict
      setTimetable((prev) => [...prev, { 
        courseId: course.id, 
        course,
        isConflictSection: hasConflict && forceAddWithConflict
      }]);
      return true;
    }
  }, [timetable]);

  const removeCourse = useCallback((courseId: string) => {
    setTimetable((prev) => {
      let updated: TimetableEntry[];
      
      // If removing a time slot (format: courseId-slot-X), remove all time slots from the same section
      if (courseId.includes('-slot-')) {
        // Extract base course ID (everything before '-slot-')
        const baseCourseId = courseId.split('-slot-')[0];
        // Remove all entries that match this base course ID or are time slots of it
        updated = prev.filter((entry) => {
          // Remove exact match
          if (entry.courseId === courseId) return false;
          // Remove other time slots from the same section
          if (entry.courseId.startsWith(`${baseCourseId}-slot-`)) return false;
          // Keep everything else
          return true;
        });
      } else {
        // If removing a regular course, also check if there are time slots
        // Remove the course and all its time slots
        updated = prev.filter((entry) => {
          // Remove exact match
          if (entry.courseId === courseId) return false;
          // Remove time slots of this course
          if (entry.courseId.startsWith(`${courseId}-slot-`)) return false;
          return true;
        });
      }

      // After removal, check all remaining entries for conflicts
      // If a conflict section no longer has a conflict, remove the conflict flag
      return updated.map((entry) => {
        // Only check entries that are marked as conflict sections
        if (entry.isConflictSection) {
          // Check if this entry still has a conflict
          const stillHasConflict = checkScheduleConflict(entry.course, updated, entry.courseId);
          if (!stillHasConflict) {
            // Conflict is gone, remove the conflict flag
            return {
              ...entry,
              isConflictSection: false
            };
          }
        }
        return entry;
      });
    });
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
    // Check if course is in timetable (either as main course or as any time slot)
    return timetable.some((entry) => {
      // Direct match
      if (entry.courseId === courseId) {
        return true;
      }
      // Check if it's a time slot of this course
      if (entry.courseId.startsWith(`${courseId}-slot-`)) {
        return true;
      }
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
