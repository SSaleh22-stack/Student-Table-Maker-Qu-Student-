/**
 * Core types for the Student Table Maker extension
 */

export interface Exam {
  day: string; // e.g. "Sun", "Mon"
  date?: string; // Optional date string
  startTime: string; // "08:00"
  endTime: string; // "10:00"
  location?: string;
}

export type ClassStatus = 'open' | 'closed';
export type ClassType = 'practical' | 'theoretical' | 'exercise';

export interface TimeSlot {
  days: string[]; // e.g. ["Sun", "Tue"] or ["Mon", "Wed"]
  startTime: string; // "08:00"
  endTime: string; // "09:50"
  location?: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  section: string;
  days: string[]; // e.g. ["Sun", "Tue"] - combined days from all time slots (for backwards compatibility)
  startTime: string; // "08:00" - first time slot start time (for backwards compatibility)
  endTime: string; // "09:50" - first time slot end time (for backwards compatibility)
  location?: string; // First time slot location (for backwards compatibility)
  timeSlots?: TimeSlot[]; // All time slots for this section (if multiple exist)
  instructor?: string;
  finalExam?: Exam;
  status?: ClassStatus; // 'open' or 'closed'
  classType?: ClassType; // 'practical', 'theoretical', or 'exercise'
}

export type Language = 'en' | 'ar';

export interface TimetableEntry {
  courseId: string;
  course: Course;
}

export interface AppState {
  courses: Course[];
  timetable: TimetableEntry[];
  language: Language;
}

