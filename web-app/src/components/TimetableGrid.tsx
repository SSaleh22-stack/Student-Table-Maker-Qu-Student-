import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import { Course } from '../types';
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
  const { t, language } = useLanguage();
  const { timetable, removeCourse, removeAllCourses, hasConflict, hoveredCourse } = useTimetable();
  const [showSummary, setShowSummary] = React.useState(false);
  const [showExportMenu, setShowExportMenu] = React.useState(false);

  // Generate time slots (8:00 to 20:00 in 1-hour intervals)
  const timeSlots: string[] = [];
  for (let hour = 8; hour <= 20; hour++) {
    const timeStr = `${hour.toString().padStart(2, '0')}:00`;
    timeSlots.push(timeStr);
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
  const dayLabels = [t.sunday, t.monday, t.tuesday, t.wednesday, t.thursday];

  // Calculate position and height for a course block
  const getCourseBlockStyle = (startTime: string, endTime: string) => {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    // 8:00 = 480 minutes (8*60)
    const baseMinutes = 480;
    // Calculate position relative to 8:00, in minutes
    const startOffsetMinutes = startMinutes - baseMinutes;
    const durationMinutes = endMinutes - startMinutes;
    // Total time span: 8:00 to 20:00 = 12 hours = 720 minutes
    const totalMinutes = 12 * 60; // 720 minutes
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
    // Use the same approach as print, but user can save as PDF
    const htmlContent = `
<!DOCTYPE html>
<html lang="${language}">
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
      padding: 2rem;
      color: #333;
      direction: ${language === 'ar' ? 'rtl' : 'ltr'};
    }
    .print-header {
      text-align: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #667eea;
    }
    .print-header h1 {
      font-size: 2rem;
      color: #667eea;
      margin-bottom: 0.5rem;
    }
    .print-header h2 {
      font-size: 1.5rem;
      color: #666;
      font-weight: normal;
    }
    .print-timetable {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 2rem;
    }
    .print-timetable thead {
      background: #f8f9fa;
    }
    .print-timetable th {
      padding: 0.75rem;
      text-align: ${language === 'ar' ? 'right' : 'left'};
      border: 1px solid #e0e0e0;
      font-weight: 600;
      color: #333;
    }
    .print-timetable td {
      padding: 0.75rem;
      border: 1px solid #e0e0e0;
      color: #555;
    }
    .print-timetable tbody tr:nth-child(even) {
      background: #fafafa;
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
        padding: 1rem;
      }
      .print-footer {
        position: fixed;
        bottom: 0;
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${t.appTitle}</h1>
    <h2>${t.timetable}</h2>
  </div>
  <table class="print-timetable">
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
      </tr>
    </thead>
    <tbody>
      ${(() => {
        // Group courses by code, name, and section
        const grouped = new Map<string, typeof timetable>();
        timetable.forEach((entry) => {
          const course = entry.course;
          const key = `${course.code}|${course.name}|${course.section}`;
          if (!grouped.has(key)) {
            grouped.set(key, []);
          }
          grouped.get(key)!.push(entry);
        });

        // Generate rows for grouped courses
        return Array.from(grouped.values()).map((entries) => {
          const firstCourse = entries[0].course;
          
          // Collect all days and times for this section
          const allDays = new Set<string>();
          const timeSlots: Array<{ days: string; time: string; location?: string }> = [];
          
          entries.forEach((entry) => {
            const course = entry.course;
            course.days.forEach(day => allDays.add(day));
            timeSlots.push({
              days: course.days.join(', '),
              time: `${course.startTime} - ${course.endTime}`,
              location: course.location
            });
          });

          // Combine days
          const combinedDays = Array.from(allDays).sort().join(', ');
          
          // Combine times (show each time slot on a new line if multiple)
          const combinedTimes = timeSlots.length > 1
            ? timeSlots.map(ts => `${ts.days}: ${ts.time}`).join('; ')
            : timeSlots[0].time;
          
          // Get location (use first one if all are the same, otherwise show multiple)
          const locations = timeSlots.map(ts => ts.location).filter(Boolean);
          const uniqueLocations = Array.from(new Set(locations));
          const combinedLocation = uniqueLocations.length === 1
            ? uniqueLocations[0]
            : uniqueLocations.length > 1
            ? uniqueLocations.join('; ')
            : '-';

          return `
            <tr>
              <td>${firstCourse.code}</td>
              <td>${firstCourse.name}</td>
              <td>${firstCourse.section}</td>
              <td>${combinedDays}</td>
              <td>${combinedTimes}</td>
              <td>${combinedLocation}</td>
              <td>${firstCourse.instructor || '-'}</td>
              <td>${firstCourse.finalExam?.date ? `${language === 'en' ? 'Period' : 'فترة'} ${firstCourse.finalExam.date}` : '-'}</td>
            </tr>
          `;
        }).join('');
      })()}
    </tbody>
  </table>
  <div class="print-footer">
    ${language === 'en' ? `Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : `تم الإنشاء في ${new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}`}
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
          `"${course.finalExam?.date ? `${language === 'en' ? 'Period' : 'فترة'} ${course.finalExam.date}` : '-'}"`,
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
    <section className="timetable-section" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="timetable-header">
        {language === 'ar' ? (
          <>
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
                          if (window.confirm(language === 'en' 
                            ? 'Are you sure you want to remove all courses from the timetable?' 
                            : 'هل أنت متأكد من إزالة جميع المقررات من الجدول؟')) {
                            removeAllCourses();
                          }
                        }}
                        title={language === 'en' ? 'Remove all courses' : 'إزالة جميع المقررات'}
                      >
                        🗑️ {language === 'en' ? 'Remove All' : 'إزالة الكل'}
                      </button>
                </>
              )}
            </div>
            <h2 className="timetable-title">
              الجدول الأسبوعي {timetable.length > 0 && (() => {
                const uniqueCourses = new Set(timetable.map(entry => entry.course.code)).size;
                const totalSections = timetable.length;
                const totalConflicts = timetable.filter(entry => entry.isConflictSection).length;
                return (
                  <>
                    <span className="total-courses-text">إجمالي المقررات {uniqueCourses}</span>
                    <span className="total-sections-text">عدد الشعب {totalSections}</span>
                    {totalConflicts > 0 && (
                      <span className="total-conflicts-text">التعارضات {totalConflicts}</span>
                    )}
                  </>
                );
              })()}
            </h2>
          </>
        ) : (
          <>
            <h2 className="timetable-title">
              Weekly Schedule {timetable.length > 0 && (() => {
                const uniqueCourses = new Set(timetable.map(entry => entry.course.code)).size;
                const totalSections = timetable.length;
                const totalConflicts = timetable.filter(entry => entry.isConflictSection).length;
                return (
                  <>
                    <span className="total-courses-text">total courses {uniqueCourses}</span>
                    <span className="total-sections-text">sections {totalSections}</span>
                    {totalConflicts > 0 && (
                      <span className="total-conflicts-text">conflicts {totalConflicts}</span>
                    )}
                  </>
                );
              })()}
            </h2>
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
                  💾 {t.export} <span className="dropdown-arrow">▼</span>
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
                          if (window.confirm(
                            language === 'en'
                              ? 'Are you sure you want to remove all courses from the timetable?'
                              : 'هل أنت متأكد من إزالة جميع المقررات من الجدول؟'
                          )) {
                            removeAllCourses();
                          }
                        }}
                      >
                        🗑️ {t.removeAll}
                      </button>
            </> 
          )}
        </div>
          </>
        )}
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
      <div className="timetable-container">
        {timetable.length === 0 ? (
          <div className="timetable-empty">
            <div className="empty-state-icon">📅</div>
            <h3>{language === 'en' ? 'Empty Timetable' : 'جدول فارغ'}</h3>
            <p>{language === 'en' 
              ? 'Add courses from the list on the right to build your weekly schedule.'
              : 'أضف المقررات من القائمة على اليمين لبناء جدولك الأسبوعي.'}</p>
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
                          >
                            <div className="course-block-header">
                              <div>
                                <div className="course-block-code">{course.code}</div>
                                {course.section && (
                                  <div className="course-block-section">{language === 'en' ? 'Section' : 'الشعبة'}: {course.section}</div>
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
                                title={language === 'en' ? 'Remove course' : 'إزالة المقرر'}
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
