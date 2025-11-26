import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import './TimetableGrid.css';

const TimetableGrid: React.FC = () => {
  const { t, language } = useLanguage();
  const { timetable, removeCourse, removeAllCourses, hasConflict } = useTimetable();
  const [showSummary, setShowSummary] = React.useState(false);
  const [showExportMenu, setShowExportMenu] = React.useState(false);

  // Generate time slots (8:00 to 20:00 in 30-minute intervals)
  const timeSlots: string[] = [];
  for (let hour = 8; hour < 20; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      timeSlots.push(timeStr);
    }
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
  const dayLabels = [t.sunday, t.monday, t.tuesday, t.wednesday, t.thursday];

  // Calculate position and height for a course block
  const getCourseBlockStyle = (startTime: string, endTime: string) => {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    const startSlot = Math.floor((startMinutes - 480) / 30); // 8:00 = 480 minutes
    const duration = (endMinutes - startMinutes) / 30;
    const topPercent = (startSlot / timeSlots.length) * 100;
    const heightPercent = (duration / timeSlots.length) * 100;

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
    <section className="timetable-section">
      <div className="timetable-header">
        <h2 className="section-title">{t.timetable}</h2>
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
                  {timetable.map((entry) => {
                    const course = entry.course;
                    return (
                      <tr key={entry.courseId}>
                        <td>{course.code}</td>
                        <td>{course.name}</td>
                        <td>{course.section}</td>
                        <td>{course.days.join(', ')}</td>
                        <td>{course.startTime} - {course.endTime}</td>
                        <td>{course.location || '-'}</td>
                        <td>{course.instructor || '-'}</td>
                        <td>{course.finalExam?.date ? `Period ${course.finalExam.date}` : '-'}</td>
                        <td>
                          {course.status ? (
                            <span className={`status-badge ${course.status}`}>
                              {course.status === 'open' ? t.open : t.closed}
                            </span>
                          ) : '-'}
                        </td>
                        <td>
                          {course.classType ? (
                            <span className="class-type-badge">
                              {course.classType === 'practical' ? t.practical :
                               course.classType === 'theoretical' ? t.theoretical :
                               t.exercise}
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    );
                  })}
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
            {/* Time column */}
            <div className="time-column">
              {timeSlots.filter((_, i) => i % 2 === 0).map((time) => (
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

                return (
                  <div key={day} className={`day-column ${day === 'Wed' ? 'wednesday-column' : ''}`}>
                    <div className="day-header">{dayLabels[dayIndex]}</div>
                    <div className="day-content">
                      {dayCourses.map((entry) => {
                        const course = entry.course;
                        const conflict = hasConflict(course);
                        const style = getCourseBlockStyle(course.startTime, course.endTime);

                        return (
                          <div
                            key={entry.courseId}
                            className={`course-block ${conflict ? 'conflict' : ''}`}
                            style={style}
                          >
                            <div className="course-block-header">
                              <div>
                                <div className="course-block-code">{course.code}</div>
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

