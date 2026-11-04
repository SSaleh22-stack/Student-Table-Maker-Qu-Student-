/**
 * Course data, in the same shape the extension's extractor produces
 * (see src/content/extractCourses.ts in the extension).
 */

export interface Exam {
  day: string;
  /** The portal only gives an exam period number, stored here (e.g. "2"). */
  date?: string;
  startTime: string;
  endTime: string;
  location?: string;
}

export type ClassStatus = 'open' | 'closed';
export type ClassType = 'practical' | 'theoretical' | 'exercise';

export interface TimeSlot {
  /** e.g. ["Sun", "Tue"] */
  days: string[];
  /** "08:00" */
  startTime: string;
  endTime: string;
  location?: string;
}

/** One section of a course. Several sections share the same `code`. */
export interface Course {
  id: string;
  code: string;
  name: string;
  section: string;
  campus?: string;
  /** Credit hours as text, e.g. "3" */
  hours?: string;
  days: string[];
  startTime: string;
  endTime: string;
  location?: string;
  timeSlots?: TimeSlot[];
  instructor?: string;
  finalExam?: Exam;
  status?: ClassStatus;
  classType?: ClassType;
  /** النشاط exactly as the portal shows it, e.g. "نظري", "عملي", "تدريب" */
  activity?: string;
  /** Row position on the portal page, so sections keep the website's order */
  order?: number;
}
