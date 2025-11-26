/**
 * Shared GPA Calculator Module
 * Used by both Chrome Extension and Web App
 * Based on QU GPA Calculator: https://www.qu.edu.sa/mainservices/gpa
 */

export type GradeLetter = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D+" | "D" | "F" | "DN" | "";

export interface CourseGrade {
  id: string;
  title?: string;
  hours: number;
  grade: GradeLetter;
}

export type GradePointMap = Record<GradeLetter, number>;

export type GPAScale = 4 | 5;

/**
 * Get default grade point mappings for the selected scale
 * Based on QU GPA Calculator standards
 */
export function getDefaultGradePoints(scale: GPAScale): GradePointMap {
  if (scale === 5) {
    return {
      "A+": 5.00,
      "A": 4.75,
      "B+": 4.50,
      "B": 4.00,
      "C+": 3.50,
      "C": 3.00,
      "D+": 2.50,
      "D": 2.00,
      "F": 1.00,
      "DN": 1.00,
      "": 0.00, // Not specified / غير محدد
    };
  } else {
    // 4.0 scale
    return {
      "A+": 4.00,
      "A": 3.75,
      "B+": 3.50,
      "B": 3.00,
      "C+": 2.50,
      "C": 2.00,
      "D+": 1.50,
      "D": 1.00,
      "F": 0.00,
      "DN": 0.00,
      "": 0.00, // Not specified / غير محدد
    };
  }
}

/**
 * Calculate total quality points for current semester courses
 * QualityPoints = Σ(gradePoint * creditHours)
 */
export function calcQualityPoints(
  courses: CourseGrade[],
  map: GradePointMap
): number {
  return courses.reduce((total, course) => {
    if (course.grade === "" || course.hours <= 0) {
      return total;
    }
    const gradePoint = map[course.grade] || 0;
    return total + gradePoint * course.hours;
  }, 0);
}

/**
 * Calculate total credit hours for current semester
 */
export function calcTotalHours(courses: CourseGrade[]): number {
  return courses.reduce((total, course) => {
    return total + (course.hours > 0 ? course.hours : 0);
  }, 0);
}

/**
 * Calculate semester GPA
 * SemesterGPA = CurrentQualityPoints / CurrentHours
 * Returns null if hours = 0
 */
export function calcSemesterGpa(
  courses: CourseGrade[],
  map: GradePointMap
): number | null {
  const totalHours = calcTotalHours(courses);
  if (totalHours === 0) {
    return null;
  }
  const qualityPoints = calcQualityPoints(courses, map);
  return qualityPoints / totalHours;
}

/**
 * Calculate new cumulative GPA
 * NewCumulativeGPA = (PrevGPA*PrevHours + CurrentQualityPoints) / (PrevHours + CurrentHours)
 * Returns null if total hours = 0
 */
export function calcNewCumulativeGpa(
  prevGpa: number,
  prevHours: number,
  courses: CourseGrade[],
  map: GradePointMap
): number | null {
  const currentHours = calcTotalHours(courses);
  const totalHours = prevHours + currentHours;
  
  if (totalHours === 0) {
    return null;
  }
  
  const prevQualityPoints = prevGpa * prevHours;
  const currentQualityPoints = calcQualityPoints(courses, map);
  const totalQualityPoints = prevQualityPoints + currentQualityPoints;
  
  return totalQualityPoints / totalHours;
}

/**
 * Get grade letter description (for display)
 */
export function getGradeDescription(grade: GradeLetter, language: 'en' | 'ar'): string {
  if (grade === "") {
    return language === 'ar' ? 'غير محدد' : 'Not Specified';
  }
  return grade;
}

/**
 * Validate GPA input
 */
export function validateGpa(gpa: number, scale: GPAScale): boolean {
  return gpa >= 0 && gpa <= scale;
}

/**
 * Validate hours input
 */
export function validateHours(hours: number): boolean {
  return hours >= 0;
}

