// Bookmarklet code - loaded by bookmarklet-loader.js
(function() {
  'use strict';
  
  // Check if already executed (use different flag to avoid conflicts)
  if (window.__QU_BOOKMARKLET_EXECUTED_V2__) {
    console.log('Bookmarklet already executed, skipping...');
    return;
  }
  window.__QU_BOOKMARKLET_EXECUTED_V2__ = true;
  
  console.log('🔵 Bookmarklet starting execution...');
  console.log('🔵 Current page URL:', window.location.href);
  console.log('🔵 Current page title:', document.title);
  console.log('Bookmarklet code executing...');
  console.log('Current page URL:', window.location.href);
  console.log('Page title:', document.title);
  
  var parseSingleTimeSlot, parseTimeSlots, extractCoursesFromPage;
  
  parseSingleTimeSlot = function(slotText, dayMap) {
    if (!slotText) return null;
    const dayMapLocal = dayMap || { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu' };
    const dayNumbersMatch = slotText.match(/^\s*((?:\d+\s*)+)/);
    if (!dayNumbersMatch) return null;
    const dayNumbers = dayNumbersMatch[1].trim().split(/\s+/).map(n => parseInt(n)).filter(n => !isNaN(n));
    const days = dayNumbers.map(n => dayMapLocal[n]).filter(Boolean);
    if (days.length === 0) return null;
    const timeMatch = slotText.match(/@t\s+(\d{1,2}):(\d{2})\s*([صم])?\s*-\s*(\d{1,2}):(\d{2})\s*([صم])?/i);
    if (!timeMatch) return null;
    let startHour = parseInt(timeMatch[1]);
    const startMin = timeMatch[2];
    const startPeriod = timeMatch[3];
    let endHour = parseInt(timeMatch[4]);
    const endMin = timeMatch[5];
    const endPeriod = timeMatch[6];
    if (startPeriod === 'م' && startHour !== 12) startHour += 12;
    if (startPeriod === 'ص' && startHour === 12) startHour = 0;
    if (endPeriod === 'م' && endHour !== 12) endHour += 12;
    if (endPeriod === 'ص' && endHour === 12) endHour = 0;
    const locationMatch = slotText.match(/@r\s+(.+?)(?:\s*$|@n|@t|@)/);
    const location = locationMatch ? locationMatch[1].trim() : undefined;
    return {
      days: days,
      startTime: `${startHour.toString().padStart(2, '0')}:${startMin}`,
      endTime: `${endHour.toString().padStart(2, '0')}:${endMin}`,
      location: location
    };
  };
  
  parseTimeSlots = function(input) {
    const slots = [];
    if (!input) return slots;
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
    const pattern = /((?:\d+\s*)+)@t\s+(\d{1,2}):(\d{2})\s*([صم])?\s*-\s*(\d{1,2}):(\d{2})\s*([صم])?/gi;
    const matches = input.matchAll(pattern);
    const dayMap = { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu' };
    for (const match of matches) {
      const slot = parseSingleTimeSlot(match[0], dayMap);
      if (slot && slot.days.length > 0) {
        slots.push(slot);
      }
    }
    if (slots.length === 0) {
      const slot = parseSingleTimeSlot(input, dayMap);
      if (slot && slot.days.length > 0) {
        slots.push(slot);
      }
    }
    return slots;
  };
  
  extractCoursesFromPage = function() {
    const courses = [];
    let skippedRows = 0;
    let errorRows = 0;
    try {
      console.log('🔵 Extracting courses from QU portal:', window.location.href);
      const rows = document.querySelectorAll('tbody tr[class^="ROW"]');
      console.log(`🔵 Found ${rows.length} course rows`);
      
      if (rows.length === 0) {
        console.error('❌ NO ROWS FOUND! Trying alternative selectors...');
        // Try alternative selectors
        const altSelectors = [
          'tbody tr',
          'table tbody tr',
          'tr[class*="ROW"]',
          'tr[class*="row"]',
          '.dataTable tbody tr',
          'table tr'
        ];
        for (const selector of altSelectors) {
          const altRows = document.querySelectorAll(selector);
          console.log(`  Trying "${selector}": ${altRows.length} rows`);
          if (altRows.length > 0) {
            console.warn(`⚠️ Found ${altRows.length} rows with alternative selector: ${selector}`);
            // Don't use it, just log it for debugging
          }
        }
        console.error('❌ No course rows found with any selector!');
        return []; // Return empty array - this will trigger the "no courses" alert
      }
      rows.forEach((row, index) => {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 8) {
            console.warn(`Row ${index} has insufficient cells (${cells.length}), expected 8`);
            skippedRows++;
            return;
          }
          const code = (cells[0]?.textContent?.trim()) || `COURSE-${index}`;
          const name = (cells[1]?.textContent?.trim()) || 'Unknown Course';
          const section = (cells[3]?.textContent?.trim()) || '01';
          const classTypeText = (cells[4]?.textContent?.trim()) || '';
          let classType;
          if (classTypeText.includes('نظري') || classTypeText.toLowerCase().includes('theoretical')) {
            classType = 'theoretical';
          } else if (classTypeText.includes('عملي') || classTypeText.toLowerCase().includes('practical')) {
            classType = 'practical';
          } else if (classTypeText.includes('تمرين') || classTypeText.toLowerCase().includes('exercise')) {
            classType = 'exercise';
          }
          const statusText = (cells[6]?.textContent?.trim()) || '';
          const status = statusText.includes('مغلقة') || statusText.toLowerCase().includes('closed')
            ? 'closed'
            : statusText.includes('مفتوحة') || statusText.toLowerCase().includes('open')
            ? 'open'
            : undefined;
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
          let course;
          if (timeSlots.length > 0) {
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
              } : undefined,
              __originalIndex: index // Preserve DOM order (use row index from DOM)
            };
            // Ensure __originalIndex is set
            if (course.__originalIndex === undefined) {
              course.__originalIndex = index;
            }
          } else {
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
              } : undefined,
              __originalIndex: index // Preserve DOM order (use row index from DOM)
            };
            // Ensure __originalIndex is set
            if (course.__originalIndex === undefined) {
              course.__originalIndex = index;
            }
          }
          courses.push(course);
        } catch (error) {
          console.error(`Error parsing course row ${index}:`, error, row);
          errorRows++;
        }
      });
      console.log(`🔵 Successfully extracted ${courses.length} courses from ${rows.length} rows (${skippedRows} skipped, ${errorRows} errors)`);
      if (courses.length === 0) {
        console.error('❌❌❌ EXTRACTION RETURNED 0 COURSES! ❌❌❌');
        console.error('❌ Rows found:', rows.length);
        console.error('❌ Skipped rows:', skippedRows);
        console.error('❌ Error rows:', errorRows);
      }
      if (courses.length < rows.length * 0.5) {
        console.warn(`⚠️ Warning: Only extracted ${courses.length} courses from ${rows.length} rows. This might indicate a parsing issue.`);
      }
      console.log('🔵 Returning courses array with length:', courses.length);
      return courses;
    } catch (error) {
      console.error('Error extracting courses:', error);
      return [];
    }
  };
  
  try {
    // Get language preference from web app's dashboard
    // Try multiple methods to get the language preference
    
    var isArabic = null;
    
    // Method 1: Check if language was set by bookmarklet loader
    if (typeof window.__QU_BOOKMARKLET_LANG__ !== 'undefined' && window.__QU_BOOKMARKLET_LANG__ !== null) {
      isArabic = window.__QU_BOOKMARKLET_LANG__ === true;
    }
    
    // Method 2: Try to read from localStorage (works if same origin)
    if (isArabic === null) {
      try {
        var saved = localStorage.getItem('qu-student-language');
        if (saved === 'ar') {
          isArabic = true;
        } else if (saved === 'en') {
          isArabic = false;
        }
      } catch (e) {
        // localStorage not accessible (cross-origin), continue to next method
      }
    }
    
    // Method 3: Check URL hash for language parameter (if passed from web app)
    if (isArabic === null) {
      try {
        var hash = window.location.hash;
        if (hash) {
          var langMatch = hash.match(/[#&]lang=([^&]+)/);
          if (langMatch && langMatch[1] === 'ar') {
            isArabic = true;
          } else if (langMatch && langMatch[1] === 'en') {
            isArabic = false;
          }
        }
      } catch (e) {
        // URL check failed, continue
      }
    }
    
    // Method 4: Fall back to detecting from page/browser
    if (isArabic === null) {
      isArabic = navigator.language.startsWith('ar') || document.documentElement.lang === 'ar' || document.documentElement.dir === 'rtl';
    }
    
    console.log('🔵🔵🔵 CALLING extractCoursesFromPage() 🔵🔵🔵');
    const courses = extractCoursesFromPage();
    console.log('🔵🔵🔵 EXTRACTION COMPLETE 🔵🔵🔵');
    console.log('🔵 Extracted courses:', courses);
    console.log('🔵 Number of courses extracted:', courses ? courses.length : 0);
    console.log('🔵 Courses is array?', Array.isArray(courses));
    console.log('🔵 Courses type:', typeof courses);
    
    if (!courses || courses.length === 0) {
      const rowsFound = document.querySelectorAll('tbody tr[class^="ROW"]').length;
      console.error('No courses extracted. Check the page structure.');
      console.error('Page URL:', window.location.href);
      console.error('Page title:', document.title);
      console.error('Rows found with selector "tbody tr[class^=\\"ROW\\"]":', rowsFound);
      
      // Try alternative selectors to help debug
      const altSelectors = [
        'tbody tr',
        'table tr',
        'tr[class*="ROW"]',
        'tr[class*="row"]'
      ];
      console.log('Trying alternative selectors:');
      altSelectors.forEach(selector => {
        const count = document.querySelectorAll(selector).length;
        if (count > 0) {
          console.log(`  ${selector}: ${count} elements found`);
        }
      });
      
      const message = isArabic 
        ? `لم يتم العثور على مقررات في هذه الصفحة.\n\nالصفحة: ${document.title}\nالعنوان: ${window.location.href}\nالصفوف الموجودة: ${rowsFound}\n\nتأكد من أنك في صفحة المقررات المطروحة في بوابة الطالب وأن المقررات مرئية.`
        : `No courses found on this page.\n\nPage: ${document.title}\nURL: ${window.location.href}\nRows found: ${rowsFound}\n\nMake sure you are on the QU student portal course page (offeredCourses page) and that courses are visible.`;
      alert(message);
      console.error('Stopping execution - no courses to extract');
      return; // IMPORTANT: Don't redirect if no courses found
    }
    
    const validCourses = courses.filter(c => c && c.code && c.name);
    console.log('Valid courses after filtering:', validCourses.length);
    
    if (!validCourses || validCourses.length === 0) {
      const message = isArabic
        ? 'خطأ: المقررات المستخرجة غير صالحة. تحقق من وحدة التحكم للتفاصيل.'
        : 'Error: Extracted courses are invalid. Check console for details.';
      alert(message);
      console.error('Invalid courses:', courses);
      console.error('Stopping execution - no valid courses');
      console.error('❌ NOT REDIRECTING - No valid courses found');
      return; // IMPORTANT: Don't redirect if no valid courses
    }
    
    console.log('✅ Valid courses found:', validCourses.length);
    console.log('✅ Proceeding with redirect...');
    
    const coursesJson = JSON.stringify(validCourses);
    const encodedCourses = encodeURIComponent(coursesJson);
    console.log('Courses JSON length:', coursesJson.length);
    console.log('Encoded courses length:', encodedCourses.length);
    console.log('Number of courses:', validCourses.length);
    console.log('First course sample:', validCourses[0]);
    
    try {
      localStorage.setItem('qu-student-courses', coursesJson);
      localStorage.setItem('qu-student-courses-timestamp', Date.now().toString());
      console.log('Saved ' + validCourses.length + ' courses to localStorage');
    } catch (storageError) {
      console.warn('Could not save to localStorage (cross-origin):', storageError);
      // Continue anyway - we'll pass via URL
    }
    // Get current language preference to pass to web app
    var currentLang = isArabic ? 'ar' : 'en';
    // Detect if we're on localhost or production
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const webAppUrl = isLocalhost 
      ? window.location.origin + '/'  // Use localhost for testing
      : 'https://SSaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/';
    // CRITICAL VALIDATION: Ensure we have valid encoded courses data
    if (!encodedCourses || encodedCourses === 'null' || encodedCourses === 'undefined' || encodedCourses.length < 10) {
      const message = isArabic
        ? 'خطأ: لا توجد بيانات مقررات صالحة للتحويل. تحقق من وحدة التحكم.'
        : 'Error: No valid course data to redirect with. Check console.';
      alert(message);
      console.error('❌ CRITICAL ERROR: Encoded courses is invalid');
      console.error('❌ encodedCourses:', encodedCourses);
      console.error('❌ encodedCourses length:', encodedCourses?.length);
      console.error('❌ validCourses:', validCourses);
      console.error('❌ NOT REDIRECTING - Invalid course data');
      return;
    }
    
    const urlWithData = webAppUrl + '#courses=' + encodedCourses + '&lang=' + currentLang;
    console.log('✅ Web app URL:', webAppUrl);
    console.log('✅ Is localhost:', isLocalhost);
    console.log('✅ Opening web app with courses data in URL');
    console.log('✅ URL length:', urlWithData.length);
    console.log('✅ Encoded courses length:', encodedCourses.length);
    console.log('✅ URL preview (first 200 chars):', urlWithData.substring(0, 200));
    console.log('✅ About to redirect with', validCourses.length, 'courses');
    
    // Double-check: if URL is too long, it might be truncated by browser
    if (urlWithData.length > 2000000) {
      console.warn('⚠️ Warning: URL is very long (' + urlWithData.length + ' chars). Some browsers may truncate URLs over 2MB.');
    }
    
    // Detect Safari browser
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || 
                     (navigator.vendor && navigator.vendor.indexOf('Apple') > -1 && navigator.userAgent && !navigator.userAgent.match('CriOS') && !navigator.userAgent.match('FxiOS'));
    
    if (isSafari) {
      // Safari: Use location.href directly (Safari blocks window.open from bookmarklets)
      const message = isArabic
        ? '✅ تم استخراج ' + validCourses.length + ' مقرر بنجاح!\n\nجاري إعادة التوجيه إلى صانع الجدول...'
        : '✅ Successfully extracted ' + validCourses.length + ' courses!\n\nRedirecting to table maker...';
      alert(message);
      window.location.href = urlWithData;
    } else {
      // Chrome and other browsers: Try to open in new tab
      const message = isArabic
        ? '✅ تم استخراج ' + validCourses.length + ' مقرر بنجاح!\n\nجاري فتح صانع الجدول في تبويب جديد...'
        : '✅ Successfully extracted ' + validCourses.length + ' courses!\n\nOpening table maker in new tab...';
      alert(message);
      const newWindow = window.open(urlWithData, '_blank');
      // If popup was blocked, fall back to redirect
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        window.location.href = urlWithData;
      }
    }
  } catch (error) {
    console.error('Bookmarklet error:', error);
    console.error('Error stack:', error.stack);
    const errorMessage = isArabic
      ? 'خطأ في استخراج المقررات: ' + (error.message || String(error))
      : 'Error extracting courses: ' + (error.message || String(error));
    alert(errorMessage);
  }
})();

