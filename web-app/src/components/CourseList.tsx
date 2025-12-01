import React, { useState, useMemo } from 'react';
import { Course } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import './CourseList.css';

interface CourseListProps {
  courses: Course[];
}

const CourseList: React.FC<CourseListProps> = ({ courses }) => {
  const { t, language } = useLanguage();
  const { addCourse, removeCourse, isInTimetable, hasConflict, getConflictInfo } = useTimetable();
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Display courses in exact DOM order without grouping
  // This preserves the original order from the website
  const coursesInOrder = useMemo(() => {
    return courses; // Use courses array directly as it's already in DOM order
  }, [courses]);

  const handleAddToTimetable = (course: Course) => {
    if (isInTimetable(course.id)) {
      setNotification({
        message: language === 'en' 
          ? `${course.code} is already in your timetable` 
          : `${course.code} موجود بالفعل في الجدول`,
        type: 'error'
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Check for conflicts
    const conflictInfo = getConflictInfo(course);
    
    if (conflictInfo) {
      // Schedule conflict - don't allow
      if (conflictInfo.type === 'schedule') {
        setNotification({
          message: language === 'en'
            ? `Schedule conflict: ${course.code} overlaps with ${conflictInfo.conflictingCourse.code} on ${conflictInfo.conflictingCourse.days.join(', ')}`
            : `تعارض في الجدول: ${course.code} يتداخل مع ${conflictInfo.conflictingCourse.code} في ${conflictInfo.conflictingCourse.days.join(', ')}`,
          type: 'error'
        });
        setTimeout(() => setNotification(null), 3000);
        return;
      }
      
      // Exam period conflict - show warning and ask for confirmation
      if (conflictInfo.type === 'exam-period' && conflictInfo.canProceed === true) {
        const confirmMessage = language === 'en'
          ? `${course.code} has the same exam period (${course.finalExam?.date}) as ${conflictInfo.conflictingCourse.code}. Are you sure you want to add it?`
          : `${course.code} له نفس فترة الامتحان (${course.finalExam?.date}) مثل ${conflictInfo.conflictingCourse.code}. هل أنت متأكد من إضافته؟`;
        
        if (window.confirm(confirmMessage)) {
          const added = addCourse(course, true);
          if (added) {
            setNotification({
              message: language === 'en'
                ? `${course.code} added to timetable`
                : `تم إضافة ${course.code} إلى الجدول`,
              type: 'success'
            });
            setTimeout(() => setNotification(null), 3000);
          }
        }
        return;
      }
    }

    // No conflicts - add course to timetable
    const added = addCourse(course);
    if (added) {
      setNotification({
        message: language === 'en'
          ? `${course.code} added to timetable`
          : `تم إضافة ${course.code} إلى الجدول`,
        type: 'success'
      });
      setTimeout(() => setNotification(null), 3000);
    } else {
      setNotification({
        message: language === 'en'
          ? `Failed to add ${course.code} - schedule conflict`
          : `فشل إضافة ${course.code} - تعارض في الجدول`,
        type: 'error'
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleRemoveFromTimetable = (course: Course) => {
    // If course has multiple time slots, remove all of them
    if (course.timeSlots && course.timeSlots.length > 1) {
      // Remove all time slot entries
      course.timeSlots.forEach((_, slotIndex) => {
        removeCourse(`${course.id}-slot-${slotIndex}`);
      });
    } else {
      removeCourse(course.id);
    }
    setNotification({
      message: language === 'en'
        ? `${course.code} removed from timetable`
        : `تم إزالة ${course.code} من الجدول`,
      type: 'success'
    });
    setTimeout(() => setNotification(null), 3000);
  };

  if (courses.length === 0) {
    return (
      <div className="course-list-empty">
        <div className="empty-state-icon">📚</div>
        <h3>{language === 'en' ? 'No Courses Yet' : 'لا توجد مقررات بعد'}</h3>
        <p>{t.noCourses}</p>
        <p className="empty-state-hint">
          {language === 'en' 
            ? 'Click the "المقررات المطروحة وفق الخطة" button above to view available courses.'
            : 'انقر على زر "المقررات المطروحة وفق الخطة" أعلاه لعرض المقررات المتاحة.'}
        </p>
      </div>
    );
  }

  return (
    <section className="course-list-section">
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}
      <h2 className="section-title">
        {t.courses} ({courses.length} {language === 'en' ? 'total' : 'إجمالي'})
      </h2>
      <div className="course-groups">
        {coursesInOrder.map((course) => (
          <div key={course.id} className="course-group">
            <div className="course-group-header">
              <div className="course-group-title">
                <h3 className="course-code">{course.code}</h3>
                <p className="course-name">{course.name}</p>
              </div>
              <div className="course-group-info">
                <span className="section-badge">{t.section}: {course.section}</span>
              </div>
            </div>
            <div className="course-sections">
              <div className="course-section-item">
                <div className="section-header">
                  <div className="section-actions">
                    {isInTimetable(course.id) ? (
                      <button
                        className="remove-section-btn"
                        onClick={() => handleRemoveFromTimetable(course)}
                        title={language === 'en' ? 'Remove from timetable' : 'إزالة من الجدول'}
                      >
                        {language === 'en' ? '🗑️ Remove' : '🗑️ إزالة'}
                      </button>
                    ) : (
                      <button
                        className={`add-section-btn ${hasConflict(course) && getConflictInfo(course)?.type === 'schedule' ? 'conflict' : ''}`}
                        onClick={() => handleAddToTimetable(course)}
                        disabled={hasConflict(course) && getConflictInfo(course)?.type === 'schedule'}
                      >
                        {hasConflict(course) && getConflictInfo(course)?.type === 'schedule'
                          ? (language === 'en' ? '⚠️ Conflict' : '⚠️ تعارض')
                          : `➕ ${t.addToTimetable}`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="section-details">
                  {/* Display multiple time slots if they exist */}
                  {course.timeSlots && course.timeSlots.length > 1 ? (
                    <>
                      <span className="detail-label">{t.time}:</span>
                      <div className="time-slots-list">
                        {course.timeSlots.map((slot, slotIndex) => (
                          <div key={slotIndex} className="time-slot-item">
                            <span className="time-slot-days">{slot.days.join(', ')}</span>
                            <span className="time-slot-time">{slot.startTime} - {slot.endTime}</span>
                            {slot.location && (
                              <span className="time-slot-location">{slot.location}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="detail-label">{t.days}:</span>
                      <span className="detail-value">{course.days.join(', ')}</span>
                      <span className="detail-label">{t.time}:</span>
                      <span className="detail-value">{course.startTime} - {course.endTime}</span>
                      {course.location && (
                        <>
                          <span className="detail-label">{t.location}:</span>
                          <span className="detail-value">{course.location}</span>
                        </>
                      )}
                    </>
                  )}
                  {course.instructor && (
                    <>
                      <span className="detail-label">{t.instructor}:</span>
                      <span className="detail-value">{course.instructor}</span>
                    </>
                  )}
                  {course.status && (
                    <>
                      <span className="detail-label">{t.status}:</span>
                      <span className={`status-badge ${course.status}`}>
                        {course.status === 'open' ? t.open : t.closed}
                      </span>
                    </>
                  )}
                  {course.classType && (
                    <>
                      <span className="detail-label">{t.classType}:</span>
                      <span className={`class-type-badge ${course.classType}`}>
                        {course.classType === 'practical' ? t.practical :
                         course.classType === 'theoretical' ? t.theoretical :
                         t.exercise}
                      </span>
                    </>
                  )}
                  {course.finalExam && (
                    <div className="section-detail-row exam-info">
                      <span className="detail-label">{t.finalExam}:</span>
                      <span className="detail-value">
                        {course.finalExam.date ? `Period ${course.finalExam.date}` : 'N/A'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default CourseList;
