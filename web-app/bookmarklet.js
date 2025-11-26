/**
 * Bookmarklet for Qu Student Web App
 * Extracts courses from QU portal and saves to localStorage
 * 
 * To use: Copy the minified version and create a bookmark with it as the URL
 */

(function() {
  'use strict';
  
  // Define all functions first to ensure they're available
  var parseSingleTimeSlot, parseTimeSlots, extractCoursesFromPage;
  
  // Helper function to parse a single time slot string
  parseSingleTimeSlot = function(slotText, dayMap) {
    if (!slotText) return null;
    
    const dayMapLocal = dayMap || { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu' };
    
    // Parse day numbers
    const dayNumbersMatch = slotText.match(/^\s*((?:\d+\s*)+)/);
    if (!dayNumbersMatch) return null;
    
    const dayNumbers = dayNumbersMatch[1].trim().split(/\s+/)
      .map(n => parseInt(n))
      .filter(n => !isNaN(n));
    const days = dayNumbers.map(n => dayMapLocal[n]).filter(Boolean);
    
    if (days.length === 0) return null;
    
    // Parse time
    const timeMatch = slotText.match(/@t\s+(\d{1,2}):(\d{2})\s*([صم])?\s*-\s*(\d{1,2}):(\d{2})\s*([صم])?/i);
    if (!timeMatch) return null;
    
    let startHour = parseInt(timeMatch[1]);
    const startMin = timeMatch[2];
    const startPeriod = timeMatch[3];
    let endHour = parseInt(timeMatch[4]);
    const endMin = timeMatch[5];
    const endPeriod = timeMatch[6];
    
    // Convert to 24-hour format
    if (startPeriod === 'م' && startHour !== 12) startHour += 12;
    if (startPeriod === 'ص' && startHour === 12) startHour = 0;
    if (endPeriod === 'م' && endHour !== 12) endHour += 12;
    if (endPeriod === 'ص' && endHour === 12) endHour = 0;
    
    // Extract location - stop at @n, @t, or end
    const locationMatch = slotText.match(/@r\s+(.+?)(?:\s*$|@n|@t|@)/);
    const location = locationMatch ? locationMatch[1].trim() : undefined;
    
    return {
      days: days,
      startTime: `${startHour.toString().padStart(2, '0')}:${startMin}`,
      endTime: `${endHour.toString().padStart(2, '0')}:${endMin}`,
      location: location
    };
  };
  
  // Parse time slots from section input value (format: "1 2@t 08:00 ص - 09:30 ص@r Location")
  // Also handles: "3 @t 12:50 م - 02:05 م @r COC-307COE @n 1 @t 01:15 م - 02:30 م @r COC-307COE"
  parseTimeSlots = function(input) {
    const slots = [];
    if (!input) return slots;
    
    // If there's an @n separator, split and parse each part
    if (input.includes('@n')) {
      const dayMap = { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu' };
      const parts = input.split(/@n\s*/).filter(p => p.trim());
      for (const part of parts) {
        const slot = parseSingleTimeSlot(part.trim(), dayMap);
        if (slot && slot.days.length > 0) {
          slots.push(slot);
        }
      }
      return slots;
    }
    
    // Match pattern: (days)@t (start time) - (end time)@r (location)
    const pattern = /((?:\d+\s*)+)@t\s+(\d{1,2}):(\d{2})\s*([صم])?\s*-\s*(\d{1,2}):(\d{2})\s*([صم])?/gi;
    const matches = input.matchAll(pattern);
    
    const dayMap = { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu' };
    
    for (const match of matches) {
      const slot = parseSingleTimeSlot(match[0], dayMap);
      if (slot && slot.days.length > 0) {
        slots.push(slot);
      }
    }
    
    // If no matches found, try to parse a single time slot
    if (slots.length === 0) {
      const slot = parseSingleTimeSlot(input, dayMap);
      if (slot && slot.days.length > 0) {
        slots.push(slot);
      }
    }
    
    return slots;
  };
  
  // Extract course data from the page
  extractCoursesFromPage = function() {
    const courses = [];
    let skippedRows = 0;
    let errorRows = 0;
    
    try {
      console.log('Extracting courses from QU portal:', window.location.href);
      
      // Find course rows - same selector as extension
      const rows = document.querySelectorAll('tbody tr[class^="ROW"]');
      console.log(`Found ${rows.length} course rows`);
      
      rows.forEach((row, index) => {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 8) {
            console.warn(`Row ${index} has insufficient cells (${cells.length}), expected 8`);
            skippedRows++;
            return;
          }
          
          // Extract course information
          const code = (cells[0]?.textContent?.trim()) || `COURSE-${index}`;
          const name = (cells[1]?.textContent?.trim()) || 'Unknown Course';
          const section = (cells[3]?.textContent?.trim()) || '01';
          const classTypeText = (cells[4]?.textContent?.trim()) || '';
          
          // Determine class type
          let classType;
          if (classTypeText.includes('نظري') || classTypeText.toLowerCase().includes('theoretical')) {
            classType = 'theoretical';
          } else if (classTypeText.includes('عملي') || classTypeText.toLowerCase().includes('practical')) {
            classType = 'practical';
          } else if (classTypeText.includes('تمرين') || classTypeText.toLowerCase().includes('exercise')) {
            classType = 'exercise';
          }
          
          // Determine status
          const statusText = (cells[6]?.textContent?.trim()) || '';
          const status = statusText.includes('مغلقة') || statusText.toLowerCase().includes('closed')
            ? 'closed'
            : statusText.includes('مفتوحة') || statusText.toLowerCase().includes('open')
            ? 'open'
            : undefined;
          
          // Extract instructor and exam period from last cell
          const lastCell = cells[7];
          let instructor = '';
          let examPeriod = '';
          let timeSlots = [];
          
          if (lastCell) {
            const instructorInput = lastCell.querySelector('input[name*="instructor"]');
            if (instructorInput) {
              instructor = instructorInput.value.trim();
            }
            
            const examInput = lastCell.querySelector('input[name*="examPeriod"]');
            if (examInput) {
              examPeriod = examInput.value.trim();
            }
            
            // Extract time slots from section input
            const sectionInput = lastCell.querySelector('input[name*="section"]');
            if (sectionInput && sectionInput.value) {
              try {
                timeSlots = parseTimeSlots(sectionInput.value);
              } catch (parseError) {
                console.warn(`Error parsing time slots for row ${index}:`, parseError, 'Section value:', sectionInput.value);
                timeSlots = [];
              }
            }
          }
          
          // Always create a course, even if time slots couldn't be parsed
          let course;
          if (timeSlots.length > 0) {
            // Create course with time slots
            const allDays = new Set();
            timeSlots.forEach(ts => ts.days.forEach(d => allDays.add(d)));
            
            const firstSlot = timeSlots[0];
            course = {
              id: `${code}-${section}-${index}`,
              code: code,
              name: name,
              section: section,
              days: Array.from(allDays),
              startTime: firstSlot.startTime,
              endTime: firstSlot.endTime,
              location: firstSlot.location || undefined,
              timeSlots: timeSlots.length > 1 ? timeSlots.map(ts => ({
                days: ts.days,
                startTime: ts.startTime,
                endTime: ts.endTime,
                location: ts.location || undefined
              })) : undefined,
              instructor: instructor || undefined,
              status: status,
              classType: classType,
              finalExam: examPeriod ? {
                day: firstSlot.days[0] || 'Sun',
                startTime: '08:00',
                endTime: '10:00',
                date: examPeriod
              } : undefined
            };
          } else {
            // Fallback: create course with default time
            course = {
              id: `${code}-${section}-${index}`,
              code: code,
              name: name,
              section: section,
              days: ['Sun'],
              startTime: '08:00',
              endTime: '09:30',
              instructor: instructor || undefined,
              status: status,
              classType: classType,
              finalExam: examPeriod ? {
                day: 'Sun',
                startTime: '08:00',
                endTime: '10:00',
                date: examPeriod
              } : undefined
            };
          }
          
          courses.push(course);
        } catch (error) {
          console.error(`Error parsing course row ${index}:`, error, row);
          errorRows++;
        }
      });
      
      console.log(`Successfully extracted ${courses.length} courses from ${rows.length} rows (${skippedRows} skipped, ${errorRows} errors)`);
      if (courses.length < rows.length * 0.5) {
        console.warn(`⚠️ Warning: Only extracted ${courses.length} courses from ${rows.length} rows. This might indicate a parsing issue.`);
      }
      return courses;
    } catch (error) {
      console.error('Error extracting courses:', error);
      return [];
    }
  };
  
  // Main execution
  try {
    const courses = extractCoursesFromPage();
    
    if (!courses || courses.length === 0) {
      alert('No courses found on this page. Make sure you are on the QU student portal course page and that courses are visible.');
      console.error('No courses extracted. Check the page structure.');
      return;
    }
    
    // Validate courses before saving
    const validCourses = courses.filter(c => c && c.code && c.name);
    if (validCourses.length === 0) {
      alert('Error: Extracted courses are invalid. Check console for details.');
      console.error('Invalid courses:', courses);
      return;
    }
    
    // Encode courses data for URL
    const coursesJson = JSON.stringify(validCourses);
    const encodedCourses = encodeURIComponent(coursesJson);
    
    // Try to save to localStorage (may fail due to cross-origin)
    try {
      localStorage.setItem('qu-student-courses', coursesJson);
      localStorage.setItem('qu-student-courses-timestamp', Date.now().toString());
      console.log('Saved '+validCourses.length+' courses to localStorage');
    } catch (storageError) {
      console.warn('Could not save to localStorage (cross-origin):', storageError);
      // Continue anyway - we'll pass via URL
    }
    
    // Show success message
    const message = '✅ Successfully extracted '+validCourses.length+' courses!\n\nRedirecting to table maker...';
    alert(message);
    
    // Automatically redirect to web app with course data in hash
    const webAppUrl = 'https://SSaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/';
    const urlWithData = webAppUrl + '#courses=' + encodedCourses;
    
    console.log('Opening web app with courses data in URL');
    window.location.href = urlWithData;
  } catch (error) {
    console.error('Bookmarklet error:', error);
    console.error('Error stack:', error.stack);
    alert('Error extracting courses: ' + (error.message || String(error)));
  }
})();

