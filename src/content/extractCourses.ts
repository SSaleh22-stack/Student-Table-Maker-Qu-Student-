/**
 * Course extraction logic for QU student page
 * This file contains the DOM scraping logic with configurable selectors
 */

import { Course, TimeSlot } from '../types';

/**
 * Configuration for DOM selectors for QU student portal
 * URL: https://stu-gate.qu.edu.sa/qu/ui/student/offeredCourses/index/offeredCoursesIndex.faces
 * 
 * Actual structure:
 * - Table rows: <tr class="ROW1">, <tr class="ROW2">, etc.
 * - Columns use data-th attributes: "رمز المقرر", "اسم المقرر", "الشعبة", etc.
 * - Section details are in hidden inputs: name="myForm:offeredCoursesTable:0:section"
 * - Format: " 1 @t 08:00 ص - 09:40 ص @r 5132 كلية اللغات"
 *   Where: section number @t time @r location
 */
export const SELECTORS = {
  // Main course table selector
  courseTable: 'table tbody, tbody',
  
  // Course row selector - QU uses ROW1, ROW2, etc.
  courseRow: 'tbody tr.ROW1, tbody tr.ROW2, tbody tr.ROW3, tbody tr.ROW4, tbody tr.ROW5, tbody tr[class^="ROW"]',
  
  // Column indices based on data-th attributes
  // 0: رمز المقرر (course code)
  // 1: اسم المقرر (course name)
  // 2: المقر (campus)
  // 3: الشعبة (section number)
  // 4: النشاط (activity type: نظري/practical/etc)
  // 5: الساعات (hours)
  // 6: الحالة (status: مفتوحة/مغلقة)
  // 7: التفاصيل (details - contains hidden inputs)
};

/**
 * Parse day abbreviations from text
 * Handles various formats: "Sun, Tue", "Sunday Tuesday", "S T", etc.
 * Also handles Arabic day names
 */
function parseDays(dayText: string): string[] {
  if (!dayText) return [];
  
  const dayMap: Record<string, string> = {
    'sun': 'Sun',
    'sunday': 'Sun',
    's': 'Sun',
    'أحد': 'Sun',
    'mon': 'Mon',
    'monday': 'Mon',
    'm': 'Mon',
    'اثنين': 'Mon',
    'tue': 'Tue',
    'tuesday': 'Tue',
    't': 'Tue',
    'ثلاثاء': 'Tue',
    'wed': 'Wed',
    'wednesday': 'Wed',
    'w': 'Wed',
    'أربعاء': 'Wed',
    'thu': 'Thu',
    'thursday': 'Thu',
    'th': 'Thu',
    'خميس': 'Thu',
    'خ': 'Thu',
    'fri': 'Fri',
    'friday': 'Fri',
    'f': 'Fri',
    'جمعة': 'Fri',
    'ج': 'Fri',
    'sat': 'Sat',
    'saturday': 'Sat',
    'سبت': 'Sat',
    'س': 'Sat',
  };

  const normalized = dayText.toLowerCase().trim();
  const days: string[] = [];
  
  // Try to match day abbreviations (both English and Arabic)
  for (const [key, value] of Object.entries(dayMap)) {
    if (normalized.includes(key.toLowerCase()) || dayText.includes(key)) {
      if (!days.includes(value)) {
        days.push(value);
      }
    }
  }
  
  return days;
}

/**
 * Parse time string to HH:MM format (24-hour)
 * Handles formats like "8:00 AM", "08:00", "8:00", "8:00 ص" (AM), "8:00 م" (PM), etc.
 */
function parseTime(timeText: string): string {
  if (!timeText) return '08:00';
  
  const cleaned = timeText.trim();
  
  // Check for Arabic period indicators: ص (AM) or م (PM)
  const hasArabicPeriod = cleaned.includes('ص') || cleaned.includes('م');
  
  // Extract time and period
  let time = cleaned.replace(/[صمAPM]/gi, '').trim();
  const parts = time.split(':');
  
  if (parts.length === 2) {
    let hours = parseInt(parts[0]);
    const minutes = parts[1].padStart(2, '0');
    
    // Handle Arabic periods
    if (hasArabicPeriod) {
      if (cleaned.includes('م')) {
        // PM: add 12 hours (except 12:xx PM stays 12)
        if (hours !== 12) {
          hours += 12;
        }
      } else if (cleaned.includes('ص')) {
        // AM: 12:xx AM becomes 00:xx
        if (hours === 12) {
          hours = 0;
        }
      }
    } else {
      // Handle English AM/PM
      const upperCleaned = cleaned.toUpperCase();
      if (upperCleaned.includes('PM')) {
        if (hours !== 12) {
          hours += 12;
        }
      } else if (upperCleaned.includes('AM')) {
        if (hours === 12) {
          hours = 0;
        }
      }
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  }
  
  return '08:00';
}

/**
 * Parse a single time slot from section details
 * Format: " 1 @t 08:00 ص - 09:40 ص @r 5132 كلية اللغات" (single day)
 * Format: " 2 4 @t 09:45 ص - 11:00 ص @r COC-303COE" (multiple days, same time)
 * Returns: { days, startTime, endTime, location }
 */
function parseTimeSlot(slotText: string): {
  days: string[];
  startTime: string;
  endTime: string;
  location?: string;
} {
  const result = {
    days: ['Sun'],
    startTime: '08:00',
    endTime: '09:30',
    location: undefined as string | undefined,
  };

  if (!slotText) return result;

  // Day number mapping: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu
  const dayMap: Record<number, string> = {
    1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu',
  };

  // Parse ALL day numbers before @t (e.g., " 2 4 @t" means Monday and Wednesday)
  const dayNumbersMatch = slotText.match(/^\s*((?:\d+\s*)+)@t/);
  if (dayNumbersMatch) {
    const dayNumbersStr = dayNumbersMatch[1].trim();
    const dayNumbers = dayNumbersStr.split(/\s+/).map(num => parseInt(num.trim())).filter(num => !isNaN(num));
    const parsedDays: string[] = [];
    dayNumbers.forEach(dayNum => {
      if (dayMap[dayNum] && !parsedDays.includes(dayMap[dayNum])) {
        parsedDays.push(dayMap[dayNum]);
      }
    });
    if (parsedDays.length > 0) {
      result.days = parsedDays;
    }
  }

  // Parse time: "@t 08:00 ص - 09:40 ص" or "@t 08:00 م - 09:40 م"
  // ص = AM (صبح), م = PM (مساء)
  const timeMatch = slotText.match(/@t\s+(\d{1,2}):(\d{2})\s*([صم])?\s*-\s*(\d{1,2}):(\d{2})\s*([صم])?/i);
  if (timeMatch) {
    let startHour = parseInt(timeMatch[1]);
    const startMinute = timeMatch[2];
    const startPeriod = timeMatch[3]; // ص or م
    
    let endHour = parseInt(timeMatch[4]);
    const endMinute = timeMatch[5];
    const endPeriod = timeMatch[6]; // ص or م
    
    // Convert PM times to 24-hour format
    // م = PM (مساء), ص = AM (صبح)
    if (startPeriod === 'م') {
      // PM: add 12 hours (except for 12:xx PM which stays 12)
      if (startHour !== 12) {
        startHour += 12;
      }
    } else if (startPeriod === 'ص') {
      // AM: 12:xx AM becomes 00:xx
      if (startHour === 12) {
        startHour = 0;
      }
    }
    
    if (endPeriod === 'م') {
      // PM: add 12 hours (except for 12:xx PM which stays 12)
      if (endHour !== 12) {
        endHour += 12;
      }
    } else if (endPeriod === 'ص') {
      // AM: 12:xx AM becomes 00:xx
      if (endHour === 12) {
        endHour = 0;
      }
    }
    
    result.startTime = `${startHour.toString().padStart(2, '0')}:${startMinute}`;
    result.endTime = `${endHour.toString().padStart(2, '0')}:${endMinute}`;
  }

  // Parse location: "@r 5132 كلية اللغات" or "@r COC-307COE"
  // Stop at @n, @t, or end of string
  const locationMatch = slotText.match(/@r\s+(.+?)(?:\s*$|@n|@t|@)/);
  if (locationMatch) {
    result.location = locationMatch[1].trim();
  }

  return result;
}

/**
 * Parse section details from QU portal format - handles multiple time slots
 * Format: " 1 @t 08:00 ص - 09:40 ص @r 5132 كلية اللغات 3 @t 10:00 ص - 11:40 ص @r 5132 كلية اللغات"
 * Format: " 2 4 @t 09:45 ص - 11:00 ص @r COC-303COE" (multiple days, same time)
 * Returns: Array of time slots with days, times, and locations
 */
function parseSectionDetails(sectionDetails: string): Array<{
  days: string[];
  startTime: string;
  endTime: string;
  location?: string;
}> {
  const slots: Array<{ days: string[]; startTime: string; endTime: string; location?: string }> = [];

  if (!sectionDetails) return slots;

  // Check if there's an @n separator (indicates multiple distinct time slots)
  // Format: "3 @t 12:50 م - 02:05 م @r COC-307COE @n 1 @t 01:15 م - 02:30 م @r COC-307COE"
  if (sectionDetails.includes('@n')) {
    // Split by @n and parse each part separately
    const parts = sectionDetails.split(/@n\s*/).filter(p => p.trim());
    for (const part of parts) {
      const slot = parseTimeSlot(part.trim());
      if (slot.days.length > 0 && slot.startTime && slot.endTime) {
        slots.push(slot);
      }
    }
    return slots;
  }

  // No @n separator - use pattern matching for slots that share the same format
  // Pattern matches "1 @t", "2 4 @t", "3 @t", etc.
  const slotPattern = /((?:\d+\s*)+)@t[\s\S]*?(?=(?:\d+\s*)+@t|$)/g;
  const matches = Array.from(sectionDetails.matchAll(slotPattern));

  for (const match of matches) {
    const slotText = match[0];
    const slot = parseTimeSlot(slotText);
    if (slot.days.length > 0 && slot.startTime && slot.endTime) {
      slots.push(slot);
    }
  }

  // If no slots found with pattern matching, try to parse as single slot
  if (slots.length === 0) {
    const singleSlot = parseTimeSlot(sectionDetails);
    if (singleSlot.days.length > 0 && singleSlot.startTime && singleSlot.endTime) {
      slots.push(singleSlot);
    }
  }

  return slots;
}

/**
 * Parse Arabic day text to English day abbreviation
 */
function parseArabicDay(dayText: string): string[] {
  const arabicDayMap: Record<string, string> = {
    'أحد': 'Sun',
    'اثنين': 'Mon',
    'ثلاثاء': 'Tue',
    'أربعاء': 'Wed',
    'خميس': 'Thu', 'خ': 'Thu',
    'جمعة': 'Fri', 'ج': 'Fri',
    'سبت': 'Sat', 'س': 'Sat',
  };

  const days: string[] = [];
  for (const [key, value] of Object.entries(arabicDayMap)) {
    if (dayText.includes(key) && !days.includes(value)) {
      days.push(value);
    }
  }
  return days;
}

/**
 * Extract courses from the DOM - QU Portal specific implementation
 */
export function extractCoursesFromDom(doc: Document): Course[] {
  const courses: Course[] = [];
  
  try {
    console.log('Extracting courses from QU portal:', window.location.href);
    
    // Find table rows with class ROW1, ROW2, etc.
    const rows = doc.querySelectorAll('tbody tr[class^="ROW"]');
    console.log(`Found ${rows.length} course rows`);

    let skippedRows = 0;
    let errorRows = 0;
    
    // Convert NodeList to Array to get accurate indices
    const rowsArray = Array.from(rows);
    
    rowsArray.forEach((row, arrayIndex) => {
      try {
        const cells = row.querySelectorAll('td');
        if (cells.length < 8) {
          console.warn(`Row ${arrayIndex} has insufficient cells (${cells.length}), expected 8`);
          skippedRows++;
          return;
        }

        // Extract the actual DOM index from the form name (e.g., "myForm:offeredCoursesTable:0:details" -> 0)
        // This ensures we preserve the exact website order, not the array index
        let domIndex: number | null = null;
        const detailsCell = cells[7];
        
        if (detailsCell) {
          // Strategy 1: Try to find the link by name or id attribute
          const detailsLink = detailsCell.querySelector<HTMLAnchorElement>('a[name*="details"], a[id*="details"]');
          if (detailsLink) {
            const nameAttr = detailsLink.getAttribute('name') || detailsLink.getAttribute('id') || '';
            const indexMatch = nameAttr.match(/offeredCoursesTable:(\d+):/);
            if (indexMatch) {
              domIndex = parseInt(indexMatch[1], 10);
            }
          }
          
          // Strategy 2: If link didn't work, try all inputs in the details cell
          if (domIndex === null) {
            const allInputs = detailsCell.querySelectorAll('input[name*="offeredCoursesTable"]');
            for (let i = 0; i < allInputs.length; i++) {
              const input = allInputs[i] as HTMLInputElement;
              const inputName = input.getAttribute('name') || '';
              const inputIndexMatch = inputName.match(/offeredCoursesTable:(\d+):/);
              if (inputIndexMatch) {
                domIndex = parseInt(inputIndexMatch[1], 10);
                break;
              }
            }
          }
        }
        
        // Fallback: Use array index if extraction failed
        if (domIndex === null) {
          domIndex = arrayIndex;
          if (arrayIndex < 3) {
            console.warn(`⚠️ Could not extract DOM index for row ${arrayIndex}, using array index as fallback`);
          }
        } else if (arrayIndex < 3) {
          console.log(`✅ Extracted DOM index ${domIndex} for row ${arrayIndex}`);
        }

        // Column 0: Course code (رمز المقرر)
        const code = cells[0]?.textContent?.trim() || `COURSE-${domIndex}`;

        // Column 1: Course name (اسم المقرر)
        const name = cells[1]?.textContent?.trim() || 'Unknown Course';

        // Column 3: Section number (الشعبة)
        const sectionNumber = cells[3]?.textContent?.trim() || '01';

        // Column 4: Activity type (النشاط) - نظري, عملي, etc.
        const activityType = cells[4]?.textContent?.trim() || '';
        let classType: 'practical' | 'theoretical' | 'exercise' | undefined;
        if (activityType.includes('نظري') || activityType.toLowerCase().includes('theoretical')) {
          classType = 'theoretical';
        } else if (activityType.includes('عملي') || activityType.toLowerCase().includes('practical')) {
          classType = 'practical';
        } else if (activityType.includes('تمرين') || activityType.toLowerCase().includes('exercise')) {
          classType = 'exercise';
        }

        // Column 6: Status (الحالة) - مفتوحة or مغلقة
        const statusText = cells[6]?.textContent?.trim() || '';
        const status = statusText.includes('مغلقة') || statusText.toLowerCase().includes('closed')
          ? 'closed' as const
          : statusText.includes('مفتوحة') || statusText.toLowerCase().includes('open')
          ? 'open' as const
          : undefined;

        // Column 7: Details (التفاصيل) - contains hidden inputs (already have detailsCell from above)
        let instructor = '';
        let examPeriod = '';

        // Find hidden inputs in the details cell
        if (detailsCell) {
          // Instructor input
          const instructorInput = detailsCell.querySelector<HTMLInputElement>('input[name*="instructor"]');
          if (instructorInput) {
            instructor = instructorInput.value.trim();
          }

          // Exam period input
          const examPeriodInput = detailsCell.querySelector<HTMLInputElement>('input[name*="examPeriod"]');
          if (examPeriodInput) {
            examPeriod = examPeriodInput.value.trim();
          }

          // Section details input - contains multiple time slots
          const sectionInput = detailsCell.querySelector<HTMLInputElement>('input[name*="section"]');
          if (sectionInput && sectionInput.value) {
            const timeSlots = parseSectionDetails(sectionInput.value);
            
            if (timeSlots.length === 0) {
              // No time slots found, create a default course
              const course: Course & { __originalIndex?: number } = {
                id: `${code}-${sectionNumber}-${domIndex}`,
                code,
                name,
                section: sectionNumber,
                days: ['Sun'],
                startTime: '08:00',
                endTime: '09:30',
                instructor: instructor || undefined,
                status,
                classType,
                finalExam: examPeriod ? { day: 'Sun', startTime: '08:00', endTime: '10:00' } : undefined,
                __originalIndex: domIndex, // Preserve DOM order (use index from form name)
              };
              courses.push(course);
            } else {
              // Combine all time slots into one course entry for the same section
              // Create time slot objects
              const courseTimeSlots: TimeSlot[] = timeSlots.map(slot => ({
                days: slot.days,
                startTime: slot.startTime,
                endTime: slot.endTime,
                location: slot.location || undefined,
              }));

              // Combine all unique days from all time slots
              const allDays = new Set<string>();
              timeSlots.forEach(slot => {
                slot.days.forEach(day => allDays.add(day));
              });

              // Use first time slot for backwards compatibility (days, startTime, endTime, location)
              const firstSlot = timeSlots[0];
              
              const course: Course & { __originalIndex?: number } = {
                id: `${code}-${sectionNumber}-${domIndex}`,
                code,
                name,
                section: sectionNumber,
                days: Array.from(allDays), // Combined unique days from all time slots
                startTime: firstSlot.startTime,
                endTime: firstSlot.endTime,
                location: firstSlot.location || undefined,
                timeSlots: courseTimeSlots.length > 1 ? courseTimeSlots : undefined, // Only store if multiple time slots
                instructor: instructor || undefined,
                status,
                classType,
                finalExam: examPeriod ? { 
                  day: firstSlot.days[0] || 'Sun', // Use first day for exam day
                  startTime: '08:00', 
                  endTime: '10:00',
                  date: examPeriod // Store exam period as date for now
                } : undefined,
                __originalIndex: domIndex, // Preserve DOM order (use index from form name)
              };
              console.log(`Extracted course with ${timeSlots.length} time slot(s):`, course);
              courses.push(course);
            }
          } else {
            // No section input found, create a default course
            const course: Course & { __originalIndex?: number } = {
              id: `${code}-${sectionNumber}-${domIndex}`,
              code,
              name,
              section: sectionNumber,
              days: ['Sun'],
              startTime: '08:00',
              endTime: '09:30',
              instructor: instructor || undefined,
              status,
              classType,
              finalExam: examPeriod ? { day: 'Sun', startTime: '08:00', endTime: '10:00' } : undefined,
              __originalIndex: domIndex, // Preserve DOM order (use index from form name)
            };
            courses.push(course);
          }
        } else {
          // No details cell, create a minimal course
          const course: Course & { __originalIndex?: number } = {
            id: `${code}-${sectionNumber}-${domIndex}`,
            code,
            name,
            section: sectionNumber,
            days: ['Sun'],
            startTime: '08:00',
            endTime: '09:30',
            status,
            classType,
            __originalIndex: domIndex, // Preserve DOM order (use index from form name)
          };
          courses.push(course);
        }
      } catch (error) {
        console.error(`Error parsing course row ${domIndex}:`, error, row);
        errorRows++;
      }
    });

    console.log(`Successfully extracted ${courses.length} courses from ${rows.length} rows (${skippedRows} skipped, ${errorRows} errors)`);
    if (courses.length < rows.length * 0.5) {
      console.warn(`⚠️ Warning: Only extracted ${courses.length} courses from ${rows.length} rows. This might indicate a parsing issue.`);
    }
    
    // Log first few courses to verify __originalIndex is set correctly
    if (courses.length > 0) {
      console.log('First 5 extracted courses with __originalIndex:', 
        courses.slice(0, 5).map((c: any) => ({
          code: c.code,
          section: c.section,
          __originalIndex: c.__originalIndex,
          id: c.id
        }))
      );
    }
  } catch (error) {
    console.error('Error extracting courses:', error);
  }

  return courses;
}

