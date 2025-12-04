export interface Exam {
  day: string;
  date?: string;
  startTime: string;
  endTime: string;
  location?: string;
}

export type ClassStatus = 'open' | 'closed';
export type ClassType = 'practical' | 'theoretical' | 'exercise';

export interface TimeSlot {
  days: string[];
  startTime: string;
  endTime: string;
  location?: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  section: string;
  days: string[];
  startTime: string;
  endTime: string;
  location?: string;
  timeSlots?: TimeSlot[];
  instructor?: string;
  finalExam?: Exam;
  status?: ClassStatus;
  classType?: ClassType;
}

export type Language = 'en' | 'ar';

export interface TimetableEntry {
  courseId: string;
  course: Course;
  isConflictSection?: boolean; // Flag to mark sections added despite conflicts
}

