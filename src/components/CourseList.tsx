import React, { useState, useMemo } from 'react';
import { Course } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import './CourseList.css';

interface CourseListProps {
  courses: Course[];
}

type ViewMode = 'detailed' | 'compact';

const CourseList: React.FC<CourseListProps> = ({ courses }) => {
  const { t, language } = useLanguage();
  const { addCourse, removeCourse, isInTimetable, hasConflict, getConflictInfo, setHoveredCourse } = useTimetable();
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // Detect if device is a touch device (iPad, iPhone, etc.)
  // Only disable hover on primary touch devices, not laptops with touchscreens
  const isTouchDevice = React.useMemo(() => {
    // Check if it's a mobile/tablet device (not a laptop with touchscreen)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    // Only disable hover on mobile devices, not laptops
    return isMobile && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Display courses sorted by website order (__originalIndex)
  // This preserves the original order from the website, NOT by section
  const coursesInOrder = useMemo(() => {
    // If no courses, return empty array
    if (courses.length === 0) {
      return courses;
    }
    
    // Log incoming courses order BEFORE sorting
    console.log('CourseList: Received courses (BEFORE sorting):', 
      courses.slice(0, 10).map((c: any, idx) => ({ 
        position: idx,
        code: c.code, 
        section: c.section, 
        index: c.__originalIndex,
        id: c.id 
      }))
    );
    
    // Check if all courses have __originalIndex
    const coursesWithoutIndex = courses.filter((c: any) => c.__originalIndex === undefined);
    if (coursesWithoutIndex.length > 0) {
      console.warn(`⚠️ ${coursesWithoutIndex.length} courses are missing __originalIndex:`, 
        coursesWithoutIndex.map((c: any) => ({ code: c.code, section: c.section })));
      // Still try to sort the ones that have it
    }
    
    // Create a copy and sort ONLY by __originalIndex
    // Do NOT sort by section, course code, or anything else
    const sorted = [...courses].sort((a: any, b: any) => {
      const aIndex = a.__originalIndex ?? Infinity;
      const bIndex = b.__originalIndex ?? Infinity;
      
      // Simple numeric comparison - this preserves website order
      const result = aIndex - bIndex;
      
      // Log if we're comparing courses with same index but different sections
      if (aIndex === bIndex && aIndex !== Infinity && a.section !== b.section) {
        console.warn(`⚠️ Two courses have same __originalIndex ${aIndex}:`, {
          a: { code: a.code, section: a.section },
          b: { code: b.code, section: b.section }
        });
      }
      
      return result;
    });
    
    // Debug: Log the order AFTER sorting to verify it matches website order
    console.log('CourseList: Sorted courses (AFTER sorting by __originalIndex):', 
      sorted.slice(0, 10).map((c: any) => ({ 
        code: c.code, 
        section: c.section, 
        index: c.__originalIndex,
        id: c.id 
      })));
    
    // Check if courses are accidentally sorted by section
    // Only warn if courses with same __originalIndex are sorted by section
    const firstFew = sorted.slice(0, 10);
    if (firstFew.length > 3) {
      const sameCode = firstFew.every((c: any) => c.code === firstFew[0].code);
      if (sameCode) {
        // Check if they have the same __originalIndex
        const sameIndex = firstFew.every((c: any) => (c as any).__originalIndex === (firstFew[0] as any).__originalIndex);
        if (sameIndex) {
          // Only warn if sections are sorted AND they have the same index
          // This means they were sorted by section instead of preserving order
          const sections = firstFew.map((c: any) => parseInt(c.section) || 0);
          const sectionsSorted = sections.every((val, i, arr) => i === 0 || arr[i - 1] <= val);
          if (sectionsSorted && firstFew.length > 1) {
            // This is actually fine - courses with same index can be in any order
            // But if they're sorted by section, it suggests the original order was lost
            const indices = firstFew.map((c: any) => (c as any).__originalIndex);
            const allSameIndex = indices.every(idx => idx === indices[0]);
            if (allSameIndex && sectionsSorted) {
              // Only log as warning, not error - this might be expected
              console.warn('⚠️ Courses with same __originalIndex appear sorted by section:', 
                firstFew.map((c: any) => ({ 
                  code: c.code, 
                  section: c.section, 
                  index: (c as any).__originalIndex 
                }))
              );
            }
          }
        }
      }
    }
    
    return sorted;
  }, [courses]);

  // Group courses by course code and name (for compact view)
  // This must be at component level, not inside renderCompactView
  const groupedCourses = useMemo(() => {
    const groups: Record<string, Course[]> = {};
    coursesInOrder.forEach(course => {
      const key = `${course.code}-${course.name}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(course);
    });
    return groups;
  }, [coursesInOrder]);

  const handleAddToTimetable = (course: Course, forceWithConflict: boolean = false) => {
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
      // Schedule conflict - add as conflict section automatically
      if (conflictInfo.type === 'schedule') {
        // Automatically add as conflict section without confirmation
        const added = addCourse(course, false, true);
        if (added) {
          setNotification({
            message: language === 'en'
              ? `${course.code} added as conflict section`
              : `تم إضافة ${course.code} كشعبة متعارضة`,
            type: 'success'
          });
          setTimeout(() => setNotification(null), 3000);
        }
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

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const toggleExpandAll = () => {
    const allKeys = Object.keys(groupedCourses);
    const allExpanded = allKeys.length > 0 && allKeys.every(key => expandedGroups.has(key));
    
    if (allExpanded) {
      // Collapse all
      setExpandedGroups(new Set());
    } else {
      // Expand all
      setExpandedGroups(new Set(allKeys));
    }
  };

  const renderCompactView = () => {
    return (
      <div className="compact-course-groups">
        {Object.entries(groupedCourses).map(([key, courseGroup]) => {
          const firstCourse = courseGroup[0];
          const isExpanded = expandedGroups.has(key);
          
          return (
            <div key={key} className="compact-course-group">
              <div 
                className="compact-group-header"
                onClick={() => toggleGroup(key)}
              >
                <div className="compact-group-title">
                  <h3 className="course-code">{firstCourse.code}</h3>
                  <p className="course-name">{firstCourse.name}</p>
                </div>
                <div className="compact-group-info">
                  <span className="section-count">{courseGroup.length} {language === 'en' ? 'sections' : 'شعب'}</span>
                  <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>
              </div>
              {isExpanded && (
                <div className="compact-course-grid">
                  {courseGroup.map((course, index) => {
                    const inTimetable = isInTimetable(course.id);
                    const conflict = hasConflict(course) && getConflictInfo(course)?.type === 'schedule';
                    const isClosed = course.status === 'closed';
                    
                    return (
                      <div
                        key={`${course.id}-${index}`}
                        className={`compact-course-box ${inTimetable ? 'in-timetable' : ''} ${conflict ? 'has-conflict' : ''} ${isClosed ? 'closed' : ''}`}
                        {...(!isTouchDevice && {
                          onMouseEnter: () => setHoveredCourse(course),
                          onMouseLeave: () => setHoveredCourse(null)
                        })}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!inTimetable) {
                            handleAddToTimetable(course);
                          } else if (inTimetable) {
                            handleRemoveFromTimetable(course);
                          }
                        }}
                        title={inTimetable 
                          ? (language === 'en' 
                              ? `✓ In timetable\n${course.days.join(', ')} ${course.startTime}-${course.endTime}\n${course.location || ''}` 
                              : `✓ في الجدول\n${course.days.join(', ')} ${course.startTime}-${course.endTime}\n${course.location || ''}`)
                          : conflict
                          ? (language === 'en' ? 'Schedule conflict' : 'تعارض في الجدول')
                          : (language === 'en' 
                              ? `Click to add\n${course.days.join(', ')} ${course.startTime}-${course.endTime}\n${course.location || ''}` 
                              : `انقر للإضافة\n${course.days.join(', ')} ${course.startTime}-${course.endTime}\n${course.location || ''}`)
                        }
                      >
                        <div className="compact-course-header">
                          <span className="compact-course-section-number">{course.section}</span>
                          {isClosed && <span className="compact-lock-icon">🔒</span>}
                          {inTimetable && <span className="compact-added-badge">✓</span>}
                          {conflict && <span className="compact-conflict-badge">⚠</span>}
                        </div>
                        <div className="compact-course-type">
                          {course.classType 
                            ? (course.classType === 'practical' ? t.practical :
                               course.classType === 'theoretical' ? t.theoretical :
                               t.exercise)
                            : '-'}
                        </div>
                        <div className="compact-course-instructor">
                          {course.instructor || '-'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };


  return (
    <section className="course-list-section">
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}
      <div className="section-header-with-toggle">
        <h2 className="section-title">
          {t.courses} ({courses.length} {language === 'en' ? 'total' : 'إجمالي'})
        </h2>
        {language === 'en' && (
          <div className="view-controls">
            <div className="view-select-container">
              <label htmlFor="view-mode-select" className="view-select-label">
                {language === 'en' ? 'View:' : 'العرض:'}
              </label>
              <select
                id="view-mode-select"
                className="view-mode-select"
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
              >
                <option value="detailed">{language === 'en' ? '📋 Detailed' : '📋 مفصل'}</option>
                <option value="compact">{language === 'en' ? '🔲 Compact' : '🔲 مضغوط'}</option>
              </select>
            </div>
            {Object.keys(groupedCourses).length > 0 && (() => {
              const allKeys = Object.keys(groupedCourses);
              const allExpanded = allKeys.length > 0 && allKeys.every(key => expandedGroups.has(key));
              return (
                <button
                  className={`expand-collapse-btn ${allExpanded ? 'collapse-all-btn' : 'expand-all-btn'}`}
                  onClick={toggleExpandAll}
                  title={allExpanded 
                    ? (language === 'en' ? 'Collapse all' : 'طي الكل')
                    : (language === 'en' ? 'Expand all' : 'توسيع الكل')}
                >
                  {allExpanded 
                    ? (language === 'en' ? '▼ Collapse All' : '▼ طي الكل')
                    : (language === 'en' ? '▶ Expand All' : '▶ توسيع الكل')}
                </button>
              );
            })()}
          </div>
        )}
      </div>
      {language === 'ar' && (
        <div className="view-controls-arabic">
          <div className="view-select-container">
            <label htmlFor="view-mode-select-ar" className="view-select-label">
              العرض:
            </label>
            <select
              id="view-mode-select-ar"
              className="view-mode-select"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
            >
              <option value="detailed">📋 مفصل</option>
              <option value="compact">🔲 مضغوط</option>
            </select>
          </div>
          {Object.keys(groupedCourses).length > 0 && (() => {
            const allKeys = Object.keys(groupedCourses);
            const allExpanded = allKeys.length > 0 && allKeys.every(key => expandedGroups.has(key));
            return (
              <button
                className={`expand-collapse-btn ${allExpanded ? 'collapse-all-btn' : 'expand-all-btn'}`}
                onClick={toggleExpandAll}
                title={allExpanded ? 'طي الكل' : 'توسيع الكل'}
              >
                {allExpanded ? '▼ طي الكل' : '▶ توسيع الكل'}
              </button>
            );
          })()}
        </div>
      )}
      {viewMode === 'compact' ? renderCompactView() : (
      <div className="course-groups">
        {Object.entries(groupedCourses).map(([key, courseGroup]) => {
          const firstCourse = courseGroup[0];
          const isExpanded = expandedGroups.has(key);
          
          return (
            <div key={key} className="course-group">
              <div 
                className="course-group-header"
                onClick={() => toggleGroup(key)}
              >
                <div className="course-group-title">
                  <h3 className="course-code">{firstCourse.code}</h3>
                  <p className="course-name">{firstCourse.name}</p>
                </div>
                <div className="course-group-info">
                  <span className="section-count">{courseGroup.length} {language === 'en' ? 'sections' : 'شعب'}</span>
                  <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>
              </div>
              {isExpanded && (
              <div className="course-sections">
                {courseGroup.map((course, index) => (
                <div key={`${course.id}-${index}`} className="course-section-item">
                <div className="section-header">
                  <div className="section-info">
                    <span className="section-badge">{language === 'en' ? 'Section' : 'الشعبة'}: {course.section}</span>
                  </div>
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
                        className={`add-section-btn ${hasConflict(course) && getConflictInfo(course)?.type === 'schedule' ? 'conflict-add' : ''}`}
                        onClick={() => handleAddToTimetable(course)}
                        title={hasConflict(course) && getConflictInfo(course)?.type === 'schedule' 
                          ? (language === 'en' ? 'Add as conflict section (smaller, red flashing border)' : 'إضافة كشعبة متعارضة (أصغر، حدود حمراء متوهجة)')
                          : undefined}
                      >
                        {hasConflict(course) && getConflictInfo(course)?.type === 'schedule'
                          ? (language === 'en' ? '⚠️ Add Conflict' : '⚠️ إضافة تعارض')
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
                ))}
              </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
};

export default CourseList;

