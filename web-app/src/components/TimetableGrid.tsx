import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import { Course } from '../types';
import html2canvas from 'html2canvas';
import './TimetableGrid.css';

// Color palette for courses - Darker colors
const courseColors = [
  ['#4c63d2', '#5a3d8f'], // Dark purple gradient
  ['#c41d7a', '#c02d4a'], // Dark pink gradient
  ['#2d7fc8', '#0085a8'], // Dark blue gradient
  ['#2db85c', '#1fb8a3'], // Dark green gradient
  ['#d64a6e', '#d4a01a'], // Dark pink-yellow gradient
  ['#1fa5a6', '#1f0442'], // Dark cyan-purple gradient
  ['#6bb3b0', '#c99ba8'], // Dark blue-pink gradient
  ['#cc5a6e', '#c97ba8'], // Dark coral-pink gradient
  ['#cc9a6e', '#c97a5f'], // Dark orange gradient
  ['#cc4a40', '#b84400'], // Dark red-orange gradient
  ['#4fa870', '#5fa3b4'], // Dark green-blue gradient
  ['#5a7dbd', '#7ba3cb'], // Dark blue gradient
  ['#cc9a4b', '#0f2b4b'], // Dark yellow-blue gradient
  ['#b80559', '#cc4a00'], // Dark pink-orange gradient
  ['#0d3a5a', '#4fa097'], // Dark blue-teal gradient
];

// Generate a consistent color for a course based on its code
const getCourseColor = (courseCode: string): string[] => {
  // Simple hash function to get consistent color for same course code
  let hash = 0;
  for (let i = 0; i < courseCode.length; i++) {
    hash = courseCode.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % courseColors.length;
  return courseColors[index];
};

// Convert hex color to RGB for rgba usage
const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '102, 126, 234'; // Default purple
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
};

const TimetableGrid: React.FC = () => {
  const { t } = useLanguage();
  const { timetable, removeCourse, removeAllCourses, hasConflict, hoveredCourse } = useTimetable();
  const [showSummary, setShowSummary] = React.useState(false);
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [selectedCourse, setSelectedCourse] = React.useState<Course | null>(null);

  // Generate time slots (7:00 to 20:00 in 1-hour intervals)
  const timeSlots: string[] = [];
  for (let hour = 7; hour <= 20; hour++) {
    const timeStr = `${hour.toString().padStart(2, '0')}:00`;
    timeSlots.push(timeStr);
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
  const dayLabels = [t.sunday, t.monday, t.tuesday, t.wednesday, t.thursday];

  // Calculate position and height for a course block
  const getCourseBlockStyle = (startTime: string, endTime: string) => {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    // 7:00 = 420 minutes (7*60)
    const baseMinutes = 420;
    // Calculate position relative to 7:00, in minutes
    const startOffsetMinutes = startMinutes - baseMinutes;
    const durationMinutes = endMinutes - startMinutes;
    // Total time span: 7:00 to 20:00 = 13 hours = 780 minutes
    const totalMinutes = 13 * 60; // 780 minutes
    const topPercent = (startOffsetMinutes / totalMinutes) * 100;
    const heightPercent = (durationMinutes / totalMinutes) * 100;

    return {
      top: `${topPercent}%`,
      height: `${heightPercent}%`,
    };
  };

  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Export timetable as PDF
  const exportToPDF = () => {
    // Generate summary table HTML
    const generateSummaryTable = () => {
      // Group courses by section number
      const groupedBySection: Record<string, typeof timetable> = {};
      timetable.forEach(entry => {
        const section = entry.course.section || 'N/A';
        if (!groupedBySection[section]) {
          groupedBySection[section] = [];
        }
        groupedBySection[section].push(entry);
      });

      // Generate rows for grouped courses
      return Object.entries(groupedBySection).map(([section, entries]) => {
        const codes = [...new Set(entries.map(e => e.course.code))].join(', ');
        const names = [...new Set(entries.map(e => e.course.name))].join(', ');
        const days = [...new Set(entries.flatMap(e => e.course.days))].join(', ');
        const times = [...new Set(entries.map(e => `${e.course.startTime} - ${e.course.endTime}`))].join(', ');
        const locations = [...new Set(entries.map(e => e.course.location).filter(Boolean))].join(', ');
        const instructors = [...new Set(entries.map(e => e.course.instructor).filter(Boolean))].join(', ');
        const finalExams = [...new Set(entries.map(e => e.course.finalExam?.date).filter(Boolean))].map(d => `${'فترة'} ${d}`).join(', ');
        const statuses = [...new Set(entries.map(e => e.course.status).filter(Boolean))];
        const classTypes = [...new Set(entries.map(e => e.course.classType).filter(Boolean))];

        const statusText = statuses.length > 0 
          ? (statuses[0] === 'open' ? t.open : t.closed)
          : '-';
        
        const classTypeText = classTypes.length > 0
          ? (classTypes[0] === 'practical' ? t.practical :
             classTypes[0] === 'theoretical' ? t.theoretical :
             t.exercise)
          : '-';

        return `
          <tr>
            <td>${codes}</td>
            <td>${names}</td>
            <td>${section}</td>
            <td>${days}</td>
            <td>${times}</td>
            <td>${locations || '-'}</td>
            <td>${instructors || '-'}</td>
            <td>${finalExams || '-'}</td>
            <td>${statusText}</td>
            <td>${classTypeText}</td>
          </tr>
        `;
      }).join('');
    };

    // Generate visual timetable grid HTML with blocks
    const generateVisualTimetableGrid = () => {
      // Keep days in normal order - CSS will reverse them visually
      const pdfDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
      const pdfDayLabels = [t.sunday, t.monday, t.tuesday, t.wednesday, t.thursday];
      
      // Generate time slots HTML
      const timeSlotsHtml = timeSlots.map(time => 
        `<div class="pdf-time-slot">${time}</div>`
      ).join('');

      // Generate day headers in normal order (will be reversed by flex-direction)
      const dayHeadersHtml = pdfDayLabels.map(label => 
        `<div class="pdf-day-header">${label}</div>`
      ).join('');

      // Generate course blocks for each day
      const generateDayColumn = (day: string) => {
        const dayCourses = timetable.filter(entry => entry.course.days.includes(day));
        
        const blocksHtml = dayCourses.map(entry => {
          const course = entry.course;
          const style = getCourseBlockStyle(course.startTime, course.endTime);
          const [color1, color2] = getCourseColor(course.code);
          const rgb1 = hexToRgb(color1);
          const rgb2 = hexToRgb(color2);
          
          return `
            <div class="pdf-course-block ${entry.isConflictSection ? 'pdf-conflict' : ''}" 
                 style="top: ${style.top}; height: ${style.height}; background: linear-gradient(135deg, rgb(${rgb1}) 0%, rgb(${rgb2}) 100%);">
              <div class="pdf-course-code">${course.code}</div>
              ${course.section ? `<div class="pdf-course-section">${'ش'} ${course.section}</div>` : ''}
              <div class="pdf-course-time">${course.startTime} - ${course.endTime}</div>
              ${course.location ? `<div class="pdf-course-location">${course.location}</div>` : ''}
            </div>
          `;
        }).join('');

        return `<div class="pdf-day-column">${blocksHtml}</div>`;
      };

      // Generate day columns in normal order (will be reversed by flex-direction)
      const dayColumnsHtml = pdfDays.map(day => generateDayColumn(day)).join('');

      // Apply RTL class for Arabic
      const rtlClass = 'pdf-rtl';
      return `
        <div class="pdf-timetable-grid ${rtlClass}">
          <div class="pdf-days-header">${dayHeadersHtml}</div>
          <div class="pdf-days-container">${dayColumnsHtml}</div>
          <div class="pdf-time-column">${timeSlotsHtml}</div>
        </div>
      `;
    };

    // Use the same approach as print, but user can save as PDF
    const htmlContent = `
<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.timetable} - ${t.appTitle}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      padding: 1rem;
      color: #333;
      direction: rtl;
    }
    .print-header {
      text-align: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 2px solid #667eea;
    }
    .print-header h1 {
      font-size: 1.75rem;
      color: #667eea;
      margin-bottom: 0.25rem;
    }
    .print-header h2 {
      font-size: 1.25rem;
      color: #666;
      font-weight: normal;
    }
    .section-title {
      font-size: 1.2rem;
      color: #667eea;
      margin: 1rem 0 0.75rem 0;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e0e0e0;
    }
    .summary-section {
      margin-bottom: 1rem;
    }
    .print-totals {
      padding: 1rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid #e0e0e0;
      background: #f8f9fa;
    }
    .print-totals-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
    }
    .print-total-item {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: white;
      border-radius: 0.4rem;
      border: 1px solid #e0e0e0;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      font-size: 0.85rem;
    }
    .print-total-label {
      font-weight: 600;
      color: #667eea;
    }
    .print-total-value {
      font-weight: 700;
      color: #333;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
    }
    .print-total-conflict .print-total-label {
      color: #e53e3e;
    }
    .print-total-conflict .print-total-value {
      background: linear-gradient(135deg, rgba(229, 62, 62, 0.1) 0%, rgba(197, 48, 48, 0.1) 100%);
      color: #e53e3e;
    }
    .print-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
      font-size: 0.85rem;
    }
    .print-table thead {
      background: #f8f9fa;
    }
    .print-table th {
      padding: 0.5rem;
      text-align: right;
      border: 1px solid #e0e0e0;
      font-weight: 600;
      color: #333;
      font-size: 0.8rem;
    }
    .print-table td {
      padding: 0.5rem;
      border: 1px solid #e0e0e0;
      color: #555;
      font-size: 0.75rem;
    }
    .print-table tbody tr:nth-child(even) {
      background: #fafafa;
    }
    .pdf-timetable-grid {
      display: grid;
      grid-template-columns: 1fr 70px;
      grid-template-rows: auto 1fr;
      min-width: 720px;
      max-width: 92%;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 0.4rem;
      overflow: hidden;
      margin-bottom: 1rem;
      direction: ltr;
    }
    .pdf-timetable-grid.pdf-rtl {
      grid-template-columns: 1fr 70px;
      direction: ltr;
    }
    .pdf-time-column {
      grid-column: 2;
      grid-row: 2;
      width: 70px;
      border-left: 1px solid #e0e0e0;
      background: white;
      display: flex;
      flex-direction: column;
    }
    .pdf-time-slot {
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      font-size: 0.75rem;
      color: #666;
      padding-right: 0.45rem;
      border-bottom: 1px solid #f0f0f0;
      text-align: right;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-time-slot {
      justify-content: flex-end;
      padding-right: 0.45rem;
      padding-left: 0;
      text-align: right;
    }
    .pdf-days-header {
      grid-column: 1;
      grid-row: 1;
      display: flex;
      flex-direction: row;
      background: white;
      border-bottom: 1px solid #e0e0e0;
      direction: ltr;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-days-header {
      flex-direction: row-reverse;
    }
    .pdf-day-header {
      flex: 1;
    }
    .pdf-day-header {
      flex: 1;
      padding: 0.5rem;
      text-align: center;
      font-weight: 600;
      font-size: 0.85rem;
      color: #333;
      border-right: 1px solid #e0e0e0;
    }
    .pdf-day-header:first-child {
      border-right: none;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-day-header:first-child {
      border-right: 1px solid #e0e0e0;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-day-header:last-child {
      border-right: none;
    }
    .pdf-days-container {
      grid-column: 1;
      grid-row: 2;
      display: flex;
      flex-direction: row;
      border-top: 1px solid #e0e0e0;
      background: white;
      direction: ltr;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-days-container {
      flex-direction: row-reverse;
    }
    .pdf-day-column {
      flex: 1;
      position: relative;
      min-height: 620px;
      border-right: 1px solid #e0e0e0;
      background: white;
    }
    .pdf-day-column:first-child {
      border-right: none;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-day-column:first-child {
      border-right: 1px solid #e0e0e0;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-day-column:last-child {
      border-right: none;
    }
    .pdf-course-block {
      position: absolute;
      left: 2.5px;
      right: 2.5px;
      color: white;
      border-radius: 0.3rem;
      padding: 0.3rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.65rem;
      z-index: 5;
      text-align: left;
    }
    .pdf-timetable-grid.pdf-rtl .pdf-course-block {
      text-align: right;
    }
    .pdf-course-block.pdf-conflict {
      border: 2px solid #e53e3e;
    }
    .pdf-course-code {
      font-weight: 700;
      font-size: 0.7rem;
    }
    .pdf-course-section {
      font-size: 0.6rem;
      opacity: 0.95;
      font-weight: 500;
    }
    .pdf-course-time {
      font-size: 0.6rem;
      opacity: 0.9;
    }
    .pdf-course-location {
      font-size: 0.55rem;
      opacity: 0.85;
      margin-top: 0.06rem;
    }
    .print-footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #666;
      font-size: 0.9rem;
    }
    @media print {
      body {
        padding: 0.5rem;
      }
      .print-header {
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
      }
      .print-header h1 {
        font-size: 1.5rem;
      }
      .print-header h2 {
        font-size: 1.1rem;
      }
      .section-title {
        margin-top: 0.75rem;
        margin-bottom: 0.5rem;
        font-size: 1.1rem;
        page-break-after: avoid;
      }
      .summary-section {
        margin-bottom: 0.75rem;
      }
      .print-table {
        margin-bottom: 0.75rem;
        page-break-inside: auto;
      }
      .pdf-timetable-grid {
        margin-bottom: 0.75rem;
        page-break-inside: auto;
      }
      .print-footer {
        position: fixed;
        bottom: 0;
        width: 100%;
        margin-top: 0.5rem;
        padding-top: 0.5rem;
      }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${t.appTitle}</h1>
    <h2>${t.timetable}</h2>
  </div>
  
  <div class="print-totals">
    ${(() => {
      const uniqueCourses = new Set(timetable.map(entry => entry.course.code)).size;
      const totalSections = timetable.length;
      const totalConflicts = timetable.filter(entry => entry.isConflictSection).length;
      // Calculate total hours - sum hours from unique courses only
      const courseHoursMap = new Map<string, string>();
      timetable.forEach(entry => {
        const courseCode = entry.course.code;
        if (entry.course.hours && !courseHoursMap.has(courseCode)) {
          courseHoursMap.set(courseCode, entry.course.hours);
        }
      });
      const totalHours = Array.from(courseHoursMap.values()).reduce((sum, hours) => {
        const hoursNum = parseFloat(hours) || 0;
        return sum + hoursNum;
      }, 0);
      return `
        <div class="print-totals-container">
          <div class="print-total-item">
            <span class="print-total-label">${'إجمالي المقررات'}:</span>
            <span class="print-total-value">${uniqueCourses}</span>
          </div>
          ${totalHours > 0 ? `
          <div class="print-total-item">
            <span class="print-total-label">${'إجمالي الساعات'}:</span>
            <span class="print-total-value">${totalHours}</span>
          </div>
          ` : ''}
          <div class="print-total-item">
            <span class="print-total-label">${'عدد الشعب'}:</span>
            <span class="print-total-value">${totalSections}</span>
          </div>
          ${totalConflicts > 0 ? `
          <div class="print-total-item print-total-conflict">
            <span class="print-total-label">${'التعارضات'}:</span>
            <span class="print-total-value">${totalConflicts}</span>
          </div>
          ` : ''}
        </div>
      `;
    })()}
  </div>
  
  <div class="timetable-section">
    <h3 class="section-title">${t.timetable}</h3>
    ${generateVisualTimetableGrid()}
  </div>

  <div class="summary-section">
    <h3 class="section-title">${t.summary}</h3>
    <table class="print-table">
      <thead>
        <tr>
          <th>${t.courseCode}</th>
          <th>${t.courseName}</th>
          <th>${t.section}</th>
          <th>${t.days}</th>
          <th>${t.time}</th>
          <th>${t.location}</th>
          <th>${t.instructor}</th>
          <th>${t.finalExam}</th>
          <th>${t.status}</th>
          <th>${t.classType}</th>
        </tr>
      </thead>
      <tbody>
        ${generateSummaryTable()}
      </tbody>
    </table>
  </div>

  <div class="print-footer">
    تم الإنشاء في ${new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}
  </div>
</body>
</html>
    `;

    // Use blob URL to avoid CSP issues
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');
    
    if (printWindow) {
      // Trigger print after content loads
      printWindow.addEventListener('load', () => {
        setTimeout(() => {
          printWindow.print();
          // Clean up blob URL after a delay
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 250);
      });
    } else {
      URL.revokeObjectURL(url);
    }
  };

  // Export timetable as Excel (CSV format)
  const exportToExcel = () => {
    // Create CSV content
    const headers = [
      t.courseCode,
      t.courseName,
      t.section,
      t.days,
      t.time,
      t.location,
      t.instructor,
      t.finalExam,
      t.status,
      t.classType,
    ];

    const csvRows = [
      headers.join(','),
      ...timetable.map((entry) => {
        const course = entry.course;
        const row = [
          `"${course.code}"`,
          `"${course.name}"`,
          `"${course.section}"`,
          `"${course.days.join(', ')}"`,
          `"${course.startTime} - ${course.endTime}"`,
          `"${course.location || '-'}"`,
          `"${course.instructor || '-'}"`,
          `"${course.finalExam?.date ? `${'فترة'} ${course.finalExam.date}` : '-'}"`,
          `"${course.status === 'open' ? t.open : course.status === 'closed' ? t.closed : '-'}"`,
          `"${course.classType === 'practical' ? t.practical : course.classType === 'theoretical' ? t.theoretical : course.classType === 'exercise' ? t.exercise : '-'}"`,
        ];
        return row.join(',');
      }),
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel UTF-8 support
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `timetable_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Helper function to download canvas as JPG
  const downloadCanvasAsJPG = (canvas: HTMLCanvasElement, filename: string) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        alert('فشل إنشاء الصورة.');
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }, 'image/jpeg', 0.95);
  };

  // Export timetable as JPG image
  const exportJPGTimetable = async () => {
    const timetableGridElement = document.querySelector('.timetable-grid') as HTMLElement;
    
    if (!timetableGridElement) {
      alert('لم يتم العثور على الجدول. يرجى التأكد من وجود مقررات في جدولك.');
      return;
    }

    try {
      const canvas = await html2canvas(timetableGridElement, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: false,
      });

      downloadCanvasAsJPG(canvas, `timetable-${new Date().toISOString().split('T')[0]}.jpg`);
    } catch (error) {
      console.error('Error exporting timetable to JPG:', error);
      alert('حدث خطأ أثناء إنشاء الصورة.');
    }
  };

  // Export timetable as Calendar (.ics format)
  const exportToCalendar = () => {
    // Helper function to format date for ICS
    const formatDateForICS = (date: Date): string => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    // Helper function to get next occurrence of a day
    const getNextDayDate = (dayAbbr: string, startTime: string): Date => {
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };

      const today = new Date();
      const currentDay = today.getDay();
      const targetDay = dayMap[dayAbbr];
      let daysUntilTarget = targetDay - currentDay;

      if (daysUntilTarget < 0) {
        daysUntilTarget += 7; // Next week
      } else if (daysUntilTarget === 0) {
        // If today, check if time has passed
        const [hours, minutes] = startTime.split(':').map(Number);
        const now = new Date();
        if (now.getHours() > hours || (now.getHours() === hours && now.getMinutes() >= minutes)) {
          daysUntilTarget = 7; // Next week
        }
      }

      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysUntilTarget);
      return targetDate;
    };

    // Generate ICS content
    let icsContent = 'BEGIN:VCALENDAR\r\n';
    icsContent += 'VERSION:2.0\r\n';
    icsContent += 'PRODID:-//Student Table Maker//EN\r\n';
    icsContent += 'CALSCALE:GREGORIAN\r\n';
    icsContent += 'METHOD:PUBLISH\r\n';

    timetable.forEach((entry) => {
      const course = entry.course;
      const [startHours, startMinutes] = course.startTime.split(':').map(Number);
      const [endHours, endMinutes] = course.endTime.split(':').map(Number);

      // Create events for each day
      course.days.forEach((day) => {
        const eventDate = getNextDayDate(day, course.startTime);
        const startDateTime = new Date(eventDate);
        startDateTime.setHours(startHours, startMinutes, 0, 0);
        const endDateTime = new Date(eventDate);
        endDateTime.setHours(endHours, endMinutes, 0, 0);

        const now = new Date();
        const created = formatDateForICS(now);
        const start = formatDateForICS(startDateTime);
        const end = formatDateForICS(endDateTime);

        icsContent += 'BEGIN:VEVENT\r\n';
        icsContent += `UID:${course.id}-${day}-${Date.now()}@student-table-maker\r\n`;
        icsContent += `DTSTAMP:${created}\r\n`;
        icsContent += `DTSTART:${start}\r\n`;
        icsContent += `DTEND:${end}\r\n`;
        icsContent += `SUMMARY:${course.code} - ${course.name}\r\n`;
        icsContent += `DESCRIPTION:Section ${course.section}${course.instructor ? `\\nInstructor: ${course.instructor}` : ''}${course.finalExam?.date ? `\\nFinal Exam Period: ${course.finalExam.date}` : ''}\r\n`;
        if (course.location) {
          icsContent += `LOCATION:${course.location}\r\n`;
        }
        icsContent += `RRULE:FREQ=WEEKLY;BYDAY=${day.substring(0, 2).toUpperCase()};COUNT=15\r\n`; // 15 weeks semester
        icsContent += 'END:VEVENT\r\n';
      });
    });

    icsContent += 'END:VCALENDAR\r\n';

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `timetable_${new Date().toISOString().split('T')[0]}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="timetable-section" dir="rtl">
      <div className="timetable-header">
        <div className="timetable-actions">
          {timetable.length > 0 && (
            <>
              <button
                className="summary-btn"
                onClick={() => setShowSummary(true)}
              >
                📊 {t.summary}
              </button>
              <div className="export-menu-container">
                <button
                  className="export-btn"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  title={t.export}
                >
                  💾 {t.export}
                </button>
              {showExportMenu && (
                <div className="export-menu">
                  <button
                    className="export-menu-item"
                    onClick={() => {
                      exportToPDF();
                      setShowExportMenu(false);
                    }}
                  >
                    {t.exportToPDF}
                  </button>
                  <button
                    className="export-menu-item"
                    onClick={() => {
                      exportJPGTimetable();
                      setShowExportMenu(false);
                    }}
                  >
                    {t.exportToJPG}
                  </button>
                  <button
                    className="export-menu-item"
                    onClick={() => {
                      exportToExcel();
                      setShowExportMenu(false);
                    }}
                  >
                    {t.exportToExcel}
                  </button>
                  <button
                    className="export-menu-item"
                    onClick={() => {
                      exportToCalendar();
                      setShowExportMenu(false);
                    }}
                  >
                    {t.exportToCalendar}
                  </button>
                </div>
              )}
            </div>
            <button
              className="remove-all-btn"
              onClick={() => {
                if (window.confirm('هل أنت متأكد من إزالة جميع المقررات من الجدول؟')) {
                  removeAllCourses();
                }
              }}
              title={'إزالة جميع المقررات'}
            >
              🗑️ {'إزالة الكل'}
            </button>
          </>
          )}
        </div>
        <h2 className="timetable-title">
          {t.timetable} {timetable.length > 0 && (() => {
                const uniqueCourses = new Set(timetable.map(entry => entry.course.code)).size;
                const totalSections = timetable.length;
                const totalConflicts = timetable.filter(entry => entry.isConflictSection).length;
                // Calculate total hours - sum hours from unique courses only
                const courseHoursMap = new Map<string, string>();
                timetable.forEach(entry => {
                  const courseCode = entry.course.code;
                  if (entry.course.hours && !courseHoursMap.has(courseCode)) {
                    courseHoursMap.set(courseCode, entry.course.hours);
                  }
                });
                const totalHours = Array.from(courseHoursMap.values()).reduce((sum, hours) => {
                  const hoursNum = parseFloat(hours) || 0;
                  return sum + hoursNum;
                }, 0);
                return (
                  <>
                    <span className="total-courses-text">إجمالي المقررات {uniqueCourses}</span>
                    {totalHours > 0 && (
                      <span className="total-hours-text">إجمالي الساعات {totalHours}</span>
                    )}
                    <span className="total-sections-text">عدد الشعب {totalSections}</span>
                    {totalConflicts > 0 && (
                      <span className="total-conflicts-text">التعارضات {totalConflicts}</span>
                    )}
                  </>
                );
              })()}
            </h2>
      </div>
      {/* Close export menu when clicking outside */}
      {showExportMenu && (
        <div
          className="export-menu-overlay"
          onClick={() => setShowExportMenu(false)}
        />
      )}
      {showSummary && (
        <div className="summary-modal-overlay" onClick={() => setShowSummary(false)}>
          <div className="summary-modal" onClick={(e) => e.stopPropagation()}>
            <div className="summary-modal-header">
              <h3>{t.summary}</h3>
              <button className="close-btn" onClick={() => setShowSummary(false)}>
                {t.close}
              </button>
            </div>
            <div className="summary-totals">
              {(() => {
                const uniqueCourses = new Set(timetable.map(entry => entry.course.code)).size;
                const totalSections = timetable.length;
                const totalConflicts = timetable.filter(entry => entry.isConflictSection).length;
                // Calculate total hours - sum hours from unique courses only
                const courseHoursMap = new Map<string, string>();
                timetable.forEach(entry => {
                  const courseCode = entry.course.code;
                  if (entry.course.hours && !courseHoursMap.has(courseCode)) {
                    courseHoursMap.set(courseCode, entry.course.hours);
                  }
                });
                const totalHours = Array.from(courseHoursMap.values()).reduce((sum, hours) => {
                  const hoursNum = parseFloat(hours) || 0;
                  return sum + hoursNum;
                }, 0);
                return (
                  <div className="summary-totals-container">
                    <div className="summary-total-item">
                      <span className="summary-total-label">{'إجمالي المقررات'}:</span>
                      <span className="summary-total-value">{uniqueCourses}</span>
                    </div>
                    {totalHours > 0 && (
                      <div className="summary-total-item">
                        <span className="summary-total-label">{'إجمالي الساعات'}:</span>
                        <span className="summary-total-value">{totalHours}</span>
                      </div>
                    )}
                    <div className="summary-total-item">
                      <span className="summary-total-label">{'عدد الشعب'}:</span>
                      <span className="summary-total-value">{totalSections}</span>
                    </div>
                    {totalConflicts > 0 && (
                      <div className="summary-total-item summary-total-conflict">
                        <span className="summary-total-label">{'التعارضات'}:</span>
                        <span className="summary-total-value">{totalConflicts}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="summary-table-container">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>{t.courseCode}</th>
                    <th>{t.courseName}</th>
                    <th>{t.section}</th>
                    <th>{t.days}</th>
                    <th>{t.time}</th>
                    <th>{t.location}</th>
                    <th>{t.instructor}</th>
                    <th>{t.finalExam}</th>
                    <th>{t.status}</th>
                    <th>{t.classType}</th>
                    <th>{'الإجراءات'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Group courses by section number
                    const groupedBySection: Record<string, typeof timetable> = {};
                    timetable.forEach(entry => {
                      const section = entry.course.section || 'N/A';
                      if (!groupedBySection[section]) {
                        groupedBySection[section] = [];
                      }
                      groupedBySection[section].push(entry);
                    });

                    // Render grouped courses
                    return Object.entries(groupedBySection).map(([section, entries]) => {
                      const codes = [...new Set(entries.map(e => e.course.code))].join(', ');
                      const names = [...new Set(entries.map(e => e.course.name))].join(', ');
                      const days = [...new Set(entries.flatMap(e => e.course.days))].join(', ');
                      const times = [...new Set(entries.map(e => `${e.course.startTime} - ${e.course.endTime}`))].join(', ');
                      const locations = [...new Set(entries.map(e => e.course.location).filter(Boolean))].join(', ');
                      const instructors = [...new Set(entries.map(e => e.course.instructor).filter(Boolean))].join(', ');
                      const finalExams = [...new Set(entries.map(e => e.course.finalExam?.date).filter(Boolean))].map(d => `Period ${d}`).join(', ');
                      const statuses = [...new Set(entries.map(e => e.course.status).filter(Boolean))];
                      const classTypes = [...new Set(entries.map(e => e.course.classType).filter(Boolean))];

                      return (
                        <tr key={section}>
                          <td>{codes}</td>
                          <td>{names}</td>
                          <td>{section}</td>
                          <td>{days}</td>
                          <td>{times}</td>
                          <td>{locations || '-'}</td>
                          <td>{instructors || '-'}</td>
                          <td>{finalExams || '-'}</td>
                          <td>
                            {statuses.length > 0 ? (
                              <span className={`status-badge ${statuses[0]}`}>
                                {statuses[0] === 'open' ? t.open : t.closed}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            {classTypes.length > 0 ? (
                              <span className="class-type-badge">
                                {classTypes[0] === 'practical' ? t.practical :
                                 classTypes[0] === 'theoretical' ? t.theoretical :
                                 t.exercise}
                              </span>
                            ) : '-'}
                          </td>
                          <td>
                            <button
                              className="summary-remove-btn"
                              onClick={() => {
                                entries.forEach(entry => {
                                  removeCourse(entry.courseId);
                                });
                              }}
                              title={'إزالة من الجدول'}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {selectedCourse && (
        <div className="summary-modal-overlay" onClick={() => setSelectedCourse(null)}>
          <div className="summary-modal course-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="summary-modal-header">
              <h3>{'تفاصيل المقرر'}</h3>
              <button className="close-btn" onClick={() => setSelectedCourse(null)}>
                {t.close}
              </button>
            </div>
            <div className="course-details-content">
              <div className="course-details-row">
                <div className="course-details-label">{t.courseCode}:</div>
                <div className="course-details-value">{selectedCourse.code}</div>
              </div>
              <div className="course-details-row">
                <div className="course-details-label">{t.courseName}:</div>
                <div className="course-details-value">{selectedCourse.name}</div>
              </div>
              <div className="course-details-row">
                <div className="course-details-label">{t.section}:</div>
                <div className="course-details-value">{selectedCourse.section}</div>
              </div>
              <div className="course-details-row">
                <div className="course-details-label">{'المقر'}:</div>
                <div className="course-details-value">{selectedCourse.campus || '-'}</div>
              </div>
              <div className="course-details-row">
                <div className="course-details-label">{'الساعات'}:</div>
                <div className="course-details-value">{selectedCourse.hours || '-'}</div>
              </div>
              {selectedCourse.timeSlots && selectedCourse.timeSlots.length > 0 ? (
                <div className="course-details-row">
                  <div className="course-details-label">{t.days} & {t.time}:</div>
                  <div className="course-details-value">
                    {selectedCourse.timeSlots.map((slot, index) => (
                      <div key={index} className="time-slot-detail">
                        <strong>{slot.days.join(', ')}</strong>: {slot.startTime} - {slot.endTime}
                        {slot.location && ` (${slot.location})`}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="course-details-row">
                    <div className="course-details-label">{t.days}:</div>
                    <div className="course-details-value">{selectedCourse.days.join(', ')}</div>
                  </div>
                  <div className="course-details-row">
                    <div className="course-details-label">{t.time}:</div>
                    <div className="course-details-value">{selectedCourse.startTime} - {selectedCourse.endTime}</div>
                  </div>
                </>
              )}
              {selectedCourse.location && (
                <div className="course-details-row">
                  <div className="course-details-label">{t.location}:</div>
                  <div className="course-details-value">{selectedCourse.location}</div>
                </div>
              )}
              {selectedCourse.instructor && (
                <div className="course-details-row">
                  <div className="course-details-label">{t.instructor}:</div>
                  <div className="course-details-value">{selectedCourse.instructor}</div>
                </div>
              )}
              {selectedCourse.finalExam && (
                <div className="course-details-row">
                  <div className="course-details-label">{t.finalExam}:</div>
                  <div className="course-details-value">
                    {selectedCourse.finalExam.date 
                      ? `${'فترة'} ${selectedCourse.finalExam.date}`
                      : selectedCourse.finalExam.day
                    }
                    {selectedCourse.finalExam.startTime && ` - ${selectedCourse.finalExam.startTime} - ${selectedCourse.finalExam.endTime}`}
                    {selectedCourse.finalExam.location && ` (${selectedCourse.finalExam.location})`}
                  </div>
                </div>
              )}
              {selectedCourse.status && (
                <div className="course-details-row">
                  <div className="course-details-label">{t.status}:</div>
                  <div className="course-details-value">
                    <span className={`status-badge ${selectedCourse.status}`}>
                      {selectedCourse.status === 'open' ? t.open : t.closed}
                    </span>
                  </div>
                </div>
              )}
              {selectedCourse.classType && (
                <div className="course-details-row">
                  <div className="course-details-label">{t.classType}:</div>
                  <div className="course-details-value">
                    <span className="class-type-badge">
                      {selectedCourse.classType === 'practical' ? t.practical :
                       selectedCourse.classType === 'theoretical' ? t.theoretical :
                       t.exercise}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="timetable-container">
        {timetable.length === 0 ? (
          <div className="timetable-empty">
            <div className="empty-state-icon">📅</div>
            <h3>{'جدول فارغ'}</h3>
            <p>أضف المقررات من القائمة على اليمين لبناء جدولك الأسبوعي.</p>
          </div>
        ) : (
          <div className="timetable-grid">
            {/* Days header row */}
            <div className="days-header-row">
              {days.map((day, dayIndex) => (
                <div key={day} className="day-header-cell">
                  {dayLabels[dayIndex]}
                </div>
              ))}
            </div>
            
            {/* Time column */}
            <div className="time-column">
              {timeSlots.map((time) => (
                <div key={time} className="time-slot">
                  {time}
                </div>
              ))}
            </div>

            {/* Days columns */}
            <div className="days-container">
              {days.map((day, dayIndex) => {
                // Filter timetable entries for this day
                const dayCourses = timetable.filter((entry) =>
                  entry.course.days.includes(day)
                );

                // Check if hovered course should be shown on this day
                // Handle both single time slot and multiple time slots
                const showHoveredPreview = hoveredCourse && (() => {
                  // Check if course has multiple time slots
                  if (hoveredCourse.timeSlots && hoveredCourse.timeSlots.length > 1) {
                    // Check if any time slot includes this day and is not already in timetable
                    return hoveredCourse.timeSlots.some(slot => {
                      if (!slot.days.includes(day)) return false;
                      const slotId = `${hoveredCourse.id}-slot-${hoveredCourse.timeSlots.indexOf(slot)}`;
                      return !dayCourses.some(entry => entry.courseId === slotId);
                    });
                  } else {
                    // Single time slot course
                    return hoveredCourse.days.includes(day) &&
                      !dayCourses.some(entry => entry.courseId === hoveredCourse.id);
                  }
                })();

                return (
                  <div key={day} className={`day-column ${day === 'Wed' ? 'wednesday-column' : ''}`}>
                    <div className="day-header">{dayLabels[dayIndex]}</div>
                    <div className="day-content">
                      {dayCourses.map((entry) => {
                        const course = entry.course;
                        const conflict = hasConflict(course);
                        const isConflictSection = entry.isConflictSection;
                        const style = getCourseBlockStyle(course.startTime, course.endTime);
                        const [color1, color2] = getCourseColor(course.code);

                        // Make conflict sections smaller (reduce height by 30%)
                        const adjustedStyle = isConflictSection 
                          ? { ...style, height: `calc(${style.height} * 0.7)` }
                          : style;

                        return (
                          <div
                            key={entry.courseId}
                            className={`course-block ${isConflictSection ? 'conflict-section' : ''}`}
                            style={{
                              ...adjustedStyle,
                              background: `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`,
                            }}
                            onClick={() => setSelectedCourse(course)}
                          >
                            <div className="course-block-header">
                              <div>
                                <div className="course-block-code">{course.code}</div>
                                {course.section && (
                                  <div className="course-block-section">{'الشعبة'}: {course.section}</div>
                                )}
                                {course.instructor && (
                                  <div className="course-block-instructor">{course.instructor}</div>
                                )}
                                <div className="course-block-time">
                                  {course.startTime} - {course.endTime}
                                </div>
                              </div>
                              <button
                                className="remove-course-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeCourse(entry.courseId);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                title={'إزالة المقرر'}
                              >
                                ×
                              </button>
                            </div>
                            {course.location && (
                              <div className="course-block-location">{course.location}</div>
                            )}
                          </div>
                        );
                      })}
                      {/* Show hovered course preview */}
                      {showHoveredPreview && (() => {
                        // Handle multiple time slots
                        if (hoveredCourse.timeSlots && hoveredCourse.timeSlots.length > 1) {
                          return hoveredCourse.timeSlots
                            .map((slot, slotIndex) => {
                              if (!slot.days.includes(day)) return null;
                              const slotId = `${hoveredCourse.id}-slot-${slotIndex}`;
                              if (dayCourses.some(entry => entry.courseId === slotId)) return null;
                              
                              const style = getCourseBlockStyle(slot.startTime, slot.endTime);
                              const [color1, color2] = getCourseColor(hoveredCourse.code);
                              return (
                                <div
                                  key={`hovered-${slotId}`}
                                  className="course-block hover-preview"
                                  style={{
                                    ...style,
                                    background: `linear-gradient(135deg, rgba(${hexToRgb(color1)}, 0.6) 0%, rgba(${hexToRgb(color2)}, 0.6) 100%)`,
                                  }}
                                >
                                  <div className="course-block-header">
                                    <div>
                                      <div className="course-block-code">{hoveredCourse.code}</div>
                                      <div className="course-block-time">
                                        {slot.startTime} - {slot.endTime}
                                      </div>
                                    </div>
                                  </div>
                                  {(slot.location || hoveredCourse.location) && (
                                    <div className="course-block-location">{slot.location || hoveredCourse.location}</div>
                                  )}
                                </div>
                              );
                            })
                            .filter(Boolean);
                        } else {
                          // Single time slot course
                          const style = getCourseBlockStyle(hoveredCourse.startTime, hoveredCourse.endTime);
                          const [color1, color2] = getCourseColor(hoveredCourse.code);
                          return (
                            <div
                              key={`hovered-${hoveredCourse.id}`}
                              className="course-block hover-preview"
                              style={{
                                ...style,
                                background: `linear-gradient(135deg, rgba(${hexToRgb(color1)}, 0.6) 0%, rgba(${hexToRgb(color2)}, 0.6) 100%)`,
                              }}
                            >
                              <div className="course-block-header">
                                <div>
                                  <div className="course-block-code">{hoveredCourse.code}</div>
                                  <div className="course-block-time">
                                    {hoveredCourse.startTime} - {hoveredCourse.endTime}
                                  </div>
                                </div>
                              </div>
                              {hoveredCourse.location && (
                                <div className="course-block-location">{hoveredCourse.location}</div>
                              )}
                            </div>
                          );
                        }
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default TimetableGrid;
