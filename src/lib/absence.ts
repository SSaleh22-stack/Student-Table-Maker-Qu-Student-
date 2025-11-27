/**
 * Shared Absence Calculator Module
 * Used by Chrome Extension and Web App
 */

export interface AbsenceInput {
  studyWeeks: number;
  hoursPerWeek: number;
  hoursAbsent: number;
  maxAbsencePercent: number; // 15% to 50%
}

export interface AbsenceResult {
  totalHours: number;
  absencePercent: number;
  hoursRemaining: number;
  canStillAttend: boolean;
  warningLevel: 'safe' | 'warning' | 'danger' | 'exceeded';
}

/**
 * Calculate absence statistics
 */
export function calculateAbsence(input: AbsenceInput): AbsenceResult {
  const totalHours = input.studyWeeks * input.hoursPerWeek;
  const absencePercent = totalHours > 0 
    ? (input.hoursAbsent / totalHours) * 100 
    : 0;
  
  const maxAbsenceHours = (totalHours * input.maxAbsencePercent) / 100;
  const hoursRemaining = maxAbsenceHours - input.hoursAbsent;
  const canStillAttend = input.hoursAbsent < maxAbsenceHours;
  
  let warningLevel: 'safe' | 'warning' | 'danger' | 'exceeded';
  if (!canStillAttend) {
    warningLevel = 'exceeded';
  } else if (absencePercent >= input.maxAbsencePercent * 0.9) {
    warningLevel = 'danger';
  } else if (absencePercent >= input.maxAbsencePercent * 0.7) {
    warningLevel = 'warning';
  } else {
    warningLevel = 'safe';
  }
  
  return {
    totalHours,
    absencePercent,
    hoursRemaining: Math.max(0, hoursRemaining),
    canStillAttend,
    warningLevel,
  };
}

/**
 * Validate absence input
 */
export function validateAbsenceInput(input: AbsenceInput): { valid: boolean; error?: string } {
  if (input.studyWeeks <= 0) {
    return { valid: false, error: 'Study weeks must be greater than 0' };
  }
  if (input.hoursPerWeek <= 0) {
    return { valid: false, error: 'Hours per week must be greater than 0' };
  }
  if (input.hoursAbsent < 0) {
    return { valid: false, error: 'Hours absent cannot be negative' };
  }
  if (input.maxAbsencePercent < 15 || input.maxAbsencePercent > 50) {
    return { valid: false, error: 'Max absence percent must be between 15% and 50%' };
  }
  if (input.hoursAbsent > input.studyWeeks * input.hoursPerWeek) {
    return { valid: false, error: 'Hours absent cannot exceed total course hours' };
  }
  return { valid: true };
}

