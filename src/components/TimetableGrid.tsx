import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import { Course, TimetableEntry } from '../types';
import Icon from './Icon';
import { getCourseTheme, coursesLabel, sectionsLabel, hasSchedule, noTimeLabel, formatDays, formatExam } from '../lib/courseTheme';
import { exportScheduleImage, exportSchedulePdf, sectionsFromTimetable } from '../lib/scheduleExport';
import './TimetableGrid.css';

const TimetableGrid: React.FC = () => {
  const { t, language } = useLanguage();
  const { timetable, removeCourse, removeAllCourses, hasConflict, hoveredCourse } = useTimetable();
  const [showSummary, setShowSummary] = React.useState(false);
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [selectedCourse, setSelectedCourse] = React.useState<Course | null>(null);

  // One summary row per section. A section's separate meeting times share a row,
  // but different courses that happen to have the same section number stay apart.
  const groupTimetableBySection = () => {
    const groups = new Map<string, typeof timetable>();
    timetable.forEach((entry) => {
      const key = `${entry.course.code}|${entry.course.section || 'N/A'}`;
      groups.set(key, [...(groups.get(key) || []), entry]);
    });
    return Array.from(groups, ([key, entries]) => ({
      key,
      section: entries[0].course.section || 'N/A',
      entries,
    }));
  };

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

  // PDF and image: the same look as the Qu Student app (see lib/scheduleExport.ts)
  const [exporting, setExporting] = React.useState<'pdf' | 'image' | null>(null);
  const runExport = async (kind: 'pdf' | 'image') => {
    if (exporting) return;
    setExporting(kind);
    try {
      const sections = sectionsFromTimetable(timetable);
      if (kind === 'pdf') await exportSchedulePdf(sections, language);
      else await exportScheduleImage(sections, language);
    } catch (error) {
      console.error('Export failed:', error);
      alert(language === 'en' ? 'Export failed. Please try again.' : 'تعذّر التصدير، حاول مرة أخرى.');
    } finally {
      setExporting(null);
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
          `"${formatDays(course.days, t, language) || '-'}"`,
          `"${hasSchedule(course) ? `${course.startTime} - ${course.endTime}` : noTimeLabel(language)}"`,
          `"${course.location || '-'}"`,
          `"${course.instructor || '-'}"`,
          `"${course.finalExam?.date ? `${language === 'en' ? 'Period' : 'الفترة'} ${course.finalExam.date}` : '-'}"`,
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
      // Sections without a lecture time have nothing to put on a calendar
      if (!hasSchedule(course)) return;
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

  // Totals shown next to the title
  const ttUniqueCourses = new Set(timetable.map((entry) => entry.course.code)).size;
  // A section with several lecture times is stored once per time (id-slot-N): count it once
  const sectionId = (entry: TimetableEntry) => entry.courseId.split('-slot-')[0];
  const ttTotalSections = new Set(timetable.map(sectionId)).size;
  const ttTotalConflicts = new Set(timetable.filter((entry) => entry.isConflictSection).map(sectionId)).size;
  const ttCourseHours = new Map<string, number>();
  timetable.forEach((entry) => {
    if (entry.course.hours && !ttCourseHours.has(entry.course.code)) {
      ttCourseHours.set(entry.course.code, parseFloat(entry.course.hours) || 0);
    }
  });
  const ttTotalHours = Array.from(ttCourseHours.values()).reduce((sum, hours) => sum + hours, 0);
  const isAr = language === 'ar';
  // Added sections that have no lecture time: shown below the grid, not on it
  const noTimeEntries = timetable.filter((entry) => !hasSchedule(entry.course));

  // Hovered section (from the course list): which timetable entries each of its class times
  // overlaps. A clashing preview is drawn on top of those courses, and they get an outline.
  const toMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const isHoveredEntry = (entryId: string) =>
    !!hoveredCourse && (entryId === hoveredCourse.id || entryId.startsWith(`${hoveredCourse.id}-slot-`));
  const clashesAt = (day: string, startTime: string, endTime: string) =>
    !startTime || !endTime
      ? []
      : timetable.filter(
          (entry) =>
            !isHoveredEntry(entry.courseId) &&
            entry.course.days.includes(day) &&
            !!entry.course.startTime &&
            toMinutes(startTime) < toMinutes(entry.course.endTime) &&
            toMinutes(entry.course.startTime) < toMinutes(endTime)
        );
  const hoverSlots: { days: string[]; startTime: string; endTime: string }[] = hoveredCourse
    ? hoveredCourse.timeSlots && hoveredCourse.timeSlots.length > 1
      ? hoveredCourse.timeSlots
      : [{ days: hoveredCourse.days, startTime: hoveredCourse.startTime, endTime: hoveredCourse.endTime }]
    : [];
  const hoverClashIds = new Set(
    hoverSlots.flatMap((slot) =>
      slot.days.flatMap((day) => clashesAt(day, slot.startTime, slot.endTime).map((entry) => entry.courseId))
    )
  );

  /** The hovered section's block for one class time; on a clash it sits over the course it clashes with. */
  const renderHoverPreview = (key: string, day: string, startTime: string, endTime: string, location?: string) => {
    if (!hoveredCourse) return null;
    const style = getCourseBlockStyle(startTime, endTime);
    const theme = getCourseTheme(hoveredCourse.code);
    const clashes = clashesAt(day, startTime, endTime);
    const clashCodes = [...new Set(clashes.map((entry) => entry.course.code))].join(isAr ? '، ' : ', ');
    return (
      <div
        key={key}
        className={`course-block hover-preview ${clashes.length ? 'hover-conflict' : ''}`}
        style={{
          ...style,
          ...(clashes.length ? {} : { background: theme.bg, color: theme.text, borderColor: theme.text }),
        }}
      >
        <div className="course-block-header">
          <div>
            <div className="course-block-code">{hoveredCourse.code}</div>
            <div className="course-block-time">
              {startTime} - {endTime}
            </div>
          </div>
        </div>
        {clashes.length ? (
          <div className="hover-conflict-label">
            <Icon name="alert" size={12} />
            {isAr ? `تعارض مع ${clashCodes}` : `Clashes with ${clashCodes}`}
          </div>
        ) : (
          location && <div className="course-block-location">{location}</div>
        )}
      </div>
    );
  };

  return (
    <section className="timetable-section qs-card" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="timetable-header">
        <div className="timetable-heading">
          <h2 className="timetable-title">{isAr ? 'أسبوعك' : 'Your week'}</h2>
          {timetable.length > 0 ? (
            <div className="timetable-stats">
              <span className="tt-chip">{coursesLabel(ttUniqueCourses, language)}</span>
              {ttTotalHours > 0 && (
                <span className="tt-chip">{isAr ? `${ttTotalHours} ساعة` : `${ttTotalHours} credit hours`}</span>
              )}
              <span className="tt-chip">{sectionsLabel(ttTotalSections, language)}</span>
              {ttTotalConflicts > 0 && (
                <span className="tt-chip tt-chip-warn">
                  <Icon name="alert" size={14} />
                  {isAr ? `${ttTotalConflicts} تعارض` : `${ttTotalConflicts} ${ttTotalConflicts === 1 ? 'clash' : 'clashes'}`}
                </span>
              )}
            </div>
          ) : (
            <p className="timetable-subtitle">
              {isAr ? 'أضف شعبة من قائمة المقررات لتظهر هنا' : 'Add a section from the course list to see it here'}
            </p>
          )}
        </div>
        {timetable.length > 0 && (
          <div className="timetable-actions">
            <button type="button" className="qs-btn qs-btn-ghost" onClick={() => setShowSummary(true)}>
              <Icon name="fileText" />
              {t.summary}
            </button>
            <div className="export-menu-container">
              <button
                type="button"
                className="qs-btn qs-btn-dark"
                aria-haspopup="menu"
                aria-expanded={showExportMenu}
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                <Icon name="share" />
                {t.export}
                <Icon name="chevronDown" size={14} />
              </button>
              {showExportMenu && (
                <div className="export-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="export-menu-item"
                    onClick={() => {
                      runExport('pdf');
                      setShowExportMenu(false);
                    }}
                  >
                    <Icon name="fileText" />
                    {t.exportToPDF}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="export-menu-item"
                    onClick={() => {
                      runExport('image');
                      setShowExportMenu(false);
                    }}
                  >
                    <Icon name="image" />
                    {t.exportToJPG}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="export-menu-item"
                    onClick={() => {
                      exportToExcel();
                      setShowExportMenu(false);
                    }}
                  >
                    <Icon name="table" />
                    {t.exportToExcel}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="export-menu-item"
                    onClick={() => {
                      exportToCalendar();
                      setShowExportMenu(false);
                    }}
                  >
                    <Icon name="calendar" />
                    {t.exportToCalendar}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="qs-btn qs-btn-danger-text"
              onClick={() => {
                if (window.confirm(isAr
                  ? 'هل أنت متأكد من إزالة جميع المقررات من الجدول؟'
                  : 'Are you sure you want to remove all courses from the timetable?')) {
                  removeAllCourses();
                }
              }}
            >
              <Icon name="trash" />
              {t.removeAll}
            </button>
          </div>
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
            <div className="summary-totals">
              {(() => {
                const uniqueCourses = new Set(timetable.map(entry => entry.course.code)).size;
                const totalSections = ttTotalSections;
                const totalConflicts = ttTotalConflicts;
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
                      <span className="summary-total-label">{language === 'en' ? 'Total Courses' : 'إجمالي المقررات'}:</span>
                      <span className="summary-total-value">{uniqueCourses}</span>
                    </div>
                    {totalHours > 0 && (
                      <div className="summary-total-item">
                        <span className="summary-total-label">{language === 'en' ? 'Total Hours' : 'إجمالي الساعات'}:</span>
                        <span className="summary-total-value">{totalHours}</span>
                      </div>
                    )}
                    <div className="summary-total-item">
                      <span className="summary-total-label">{language === 'en' ? 'Total Sections' : 'عدد الشعب'}:</span>
                      <span className="summary-total-value">{totalSections}</span>
                    </div>
                    {totalConflicts > 0 && (
                      <div className="summary-total-item summary-total-conflict">
                        <span className="summary-total-label">{language === 'en' ? 'Conflicts' : 'التعارضات'}:</span>
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
                    <th>{language === 'en' ? 'Hours' : 'الساعات'}</th>
                    <th>{t.days}</th>
                    <th>{t.time}</th>
                    <th>{t.location}</th>
                    <th>{t.instructor}</th>
                    <th>{t.finalExam}</th>
                    <th>{t.status}</th>
                    <th>{t.classType}</th>
                    <th>{language === 'en' ? 'Actions' : 'الإجراءات'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    return groupTimetableBySection().map(({ key, section, entries }) => {
                      const codes = [...new Set(entries.map(e => e.course.code))].join(', ');
                      const names = [...new Set(entries.map(e => e.course.name))].join(', ');
                      const hours = entries.find(e => e.course.hours)?.course.hours;
                      const days = formatDays([...new Set(entries.flatMap(e => e.course.days))], t, language) || '-';
                      const times = [...new Set(entries.map(e => hasSchedule(e.course) ? `${e.course.startTime} - ${e.course.endTime}` : noTimeLabel(language)))].join(', ');
                      const locations = [...new Set(entries.map(e => e.course.location).filter(Boolean))].join(', ');
                      const instructors = [...new Set(entries.map(e => e.course.instructor).filter(Boolean))].join(', ');
                      const finalExams = [...new Set(entries.map(e => e.course.finalExam?.date).filter(Boolean))].map(d => `${language === 'en' ? 'Period' : 'الفترة'} ${d}`).join(', ');
                      const statuses = [...new Set(entries.map(e => e.course.status).filter(Boolean))];
                      const classTypes = [...new Set(entries.map(e => e.course.classType).filter(Boolean))];

                      return (
                        <tr key={key}>
                          <td>{codes}</td>
                          <td>{names}</td>
                          <td>{section}</td>
                          <td>{hours || '-'}</td>
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
                              title={language === 'en' ? 'Remove from timetable' : 'إزالة من الجدول'}
                              aria-label={language === 'en' ? 'Remove from timetable' : 'إزالة من الجدول'}
                            >
                              <Icon name="trash" size={16} />
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
              <h3>{language === 'en' ? 'Course Details' : 'تفاصيل المقرر'}</h3>
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
                <div className="course-details-label">{language === 'en' ? 'Campus' : 'المقر'}:</div>
                <div className="course-details-value">{selectedCourse.campus || '-'}</div>
              </div>
              <div className="course-details-row">
                <div className="course-details-label">{language === 'en' ? 'Hours' : 'الساعات'}:</div>
                <div className="course-details-value">{selectedCourse.hours || '-'}</div>
              </div>
              {selectedCourse.timeSlots && selectedCourse.timeSlots.length > 0 ? (
                <div className="course-details-row">
                  <div className="course-details-label">{t.days} & {t.time}:</div>
                  <div className="course-details-value">
                    {selectedCourse.timeSlots.map((slot, index) => (
                      <div key={index} className="time-slot-detail">
                        <strong>{formatDays(slot.days, t, language)}</strong>: {slot.startTime} - {slot.endTime}
                        {slot.location && ` (${slot.location})`}
                      </div>
                    ))}
                  </div>
                </div>
              ) : hasSchedule(selectedCourse) ? (
                <>
                  <div className="course-details-row">
                    <div className="course-details-label">{t.days}:</div>
                    <div className="course-details-value">{formatDays(selectedCourse.days, t, language)}</div>
                  </div>
                  <div className="course-details-row">
                    <div className="course-details-label">{t.time}:</div>
                    <div className="course-details-value">{selectedCourse.startTime} - {selectedCourse.endTime}</div>
                  </div>
                </>
              ) : (
                <div className="course-details-row">
                  <div className="course-details-label">{t.time}:</div>
                  <div className="course-details-value">{noTimeLabel(language)}</div>
                </div>
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
                    {formatExam(selectedCourse.finalExam, t, language) || '-'}
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
            <div className="empty-state-icon">
              <Icon name="calendar" size={32} />
            </div>
            <h3>{language === 'en' ? 'Your timetable is empty' : 'جدولك فارغ'}</h3>
            <p>{language === 'en'
              ? 'Pick a section from the offered courses list and it will appear here.'
              : 'اختر شعبة من قائمة المقررات المطروحة وستظهر هنا مباشرة.'}</p>
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
              {/* One label per hour row (07:00 – 19:00); the grid ends at 20:00 */}
              {timeSlots.slice(0, -1).map((time) => (
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
                      const slotId = `${hoveredCourse.id}-slot-${hoveredCourse.timeSlots!.indexOf(slot)}`;
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
                        const isConflictSection = entry.isConflictSection;
                        const style = getCourseBlockStyle(course.startTime, course.endTime);
                        const theme = getCourseTheme(course.code);

                        // Make conflict sections smaller (reduce height by 30%)
                        const adjustedStyle = isConflictSection
                          ? { ...style, height: `calc(${style.height} * 0.7)` }
                          : style;

                        return (
                          <div
                            key={entry.courseId}
                            className={`course-block ${isConflictSection ? 'conflict-section' : ''} ${
                              hoverClashIds.has(entry.courseId) ? 'hover-clash-target' : ''
                            }`}
                            style={{
                              ...adjustedStyle,
                              background: theme.bg,
                              color: theme.text,
                              borderColor: isConflictSection ? undefined : theme.border,
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`${course.code} ${course.section ? `(${language === 'en' ? 'Section' : 'الشعبة'} ${course.section})` : ''} ${course.startTime} - ${course.endTime}`}
                            onClick={() => setSelectedCourse(course)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedCourse(course);
                              }
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
                                onMouseDown={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                title={language === 'en' ? 'Remove course' : 'إزالة المقرر'}
                                aria-label={language === 'en' ? `Remove ${course.code}` : `إزالة ${course.code}`}
                              >
                                <Icon name="x" size={14} />
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
                              return renderHoverPreview(
                                `hovered-${slotId}`,
                                day,
                                slot.startTime,
                                slot.endTime,
                                slot.location || hoveredCourse.location
                              );
                            })
                            .filter(Boolean);
                        }
                        // Single time slot course
                        return renderHoverPreview(
                          `hovered-${hoveredCourse.id}`,
                          day,
                          hoveredCourse.startTime,
                          hoveredCourse.endTime,
                          hoveredCourse.location
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {noTimeEntries.length > 0 && (
        <div className="tt-notime">
          <div className="tt-notime-head">
            <Icon name="clock" size={16} />
            <span className="tt-notime-title">
              {isAr ? 'مقررات بدون وقت محدد' : 'Courses without a set time'}
            </span>
            <span className="tt-notime-hint">
              {isAr ? 'لا تظهر في الجدول، وتُحسب في الملخص' : 'Not placed on the grid; included in the summary'}
            </span>
          </div>
          <ul className="tt-notime-list">
            {noTimeEntries.map((entry) => {
              const theme = getCourseTheme(entry.course.code);
              return (
                <li key={entry.courseId} className="tt-notime-chip" style={{ background: theme.bg, color: theme.text }}>
                  <button
                    type="button"
                    className="tt-notime-open"
                    onClick={() => setSelectedCourse(entry.course)}
                    title={entry.course.name}
                  >
                    <span dir="ltr">{entry.course.code}</span>
                    {entry.course.section && (
                      <span>· {isAr ? 'شعبة' : 'Sec'} {entry.course.section}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="tt-notime-remove"
                    onClick={() => removeCourse(entry.courseId)}
                    aria-label={isAr ? `إزالة ${entry.course.code}` : `Remove ${entry.course.code}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

export default TimetableGrid;

