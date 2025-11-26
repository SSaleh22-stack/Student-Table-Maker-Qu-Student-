import React, { useState, useMemo } from 'react';
import { Course } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import './OfferedCoursesModal.css';

interface OfferedCoursesModalProps {
  courses: Course[];
  isOpen: boolean;
  onClose: () => void;
}

const OfferedCoursesModal: React.FC<OfferedCoursesModalProps> = ({ courses, isOpen, onClose }) => {
  const { t, language } = useLanguage();
  const { addCourse, isInTimetable, hasConflict, getConflictInfo } = useTimetable();
  const [searchQuery, setSearchQuery] = useState('');
  const [codeFilter, setCodeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'theoretical' | 'practical' | 'exercise'>('all');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Get unique course codes for dropdown
  const uniqueCourseCodes = useMemo(() => {
    const codes = new Set(courses.map(course => course.code));
    return Array.from(codes).sort();
  }, [courses]);

  // Filter courses based on search query and filters
  const filteredCourses = useMemo(() => {
    let filtered = courses;
    
    // Course code filter
    if (codeFilter !== 'all') {
      filtered = filtered.filter((course) => 
        course.code === codeFilter
      );
    }
    
    // Search filter (for name and section)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((course) => {
        const nameMatch = course.name.toLowerCase().includes(query);
        const sectionMatch = course.section.toLowerCase().includes(query);
        return nameMatch || sectionMatch;
      });
    }
    
    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((course) => course.status === statusFilter);
    }
    
    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter((course) => course.classType === typeFilter);
    }
    
    return filtered;
  }, [courses, codeFilter, searchQuery, statusFilter, typeFilter]);

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

  if (!isOpen) return null;

  return (
    <div className="offered-courses-modal-overlay" onClick={onClose}>
      <div className="offered-courses-modal" onClick={(e) => e.stopPropagation()}>
        <div className="offered-courses-modal-header">
          <h2>{t.offeredCourses}</h2>
          <button className="close-modal-btn" onClick={onClose}>
            {t.close}
          </button>
        </div>
        
        {notification && (
          <div className={`notification ${notification.type}`}>
            {notification.message}
          </div>
        )}

        <div className="offered-courses-filters">
          <div className="offered-courses-search-row">
            <div className="offered-courses-search">
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
          </div>
          
          <div className="filter-buttons">
            <div className="filter-group">
              <span className="filter-label">{t.filterByCode}:</span>
              <div className="filter-options">
                <select
                  value={codeFilter}
                  onChange={(e) => setCodeFilter(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">{t.all}</option>
                  {uniqueCourseCodes.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="filter-group">
              <span className="filter-label">{t.filterByStatus}:</span>
              <div className="filter-options">
                <button
                  className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('all')}
                >
                  {t.all}
                </button>
                <button
                  className={`filter-btn ${statusFilter === 'open' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('open')}
                >
                  {t.open}
                </button>
                <button
                  className={`filter-btn ${statusFilter === 'closed' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('closed')}
                >
                  {t.closed}
                </button>
              </div>
            </div>
            
            <div className="filter-group">
              <span className="filter-label">{t.filterByType}:</span>
              <div className="filter-options">
                <button
                  className={`filter-btn ${typeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('all')}
                >
                  {t.all}
                </button>
                <button
                  className={`filter-btn ${typeFilter === 'theoretical' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('theoretical')}
                >
                  {t.theoretical}
                </button>
                <button
                  className={`filter-btn ${typeFilter === 'practical' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('practical')}
                >
                  {t.practical}
                </button>
                <button
                  className={`filter-btn ${typeFilter === 'exercise' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('exercise')}
                >
                  {t.exercise}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="offered-courses-content">
          <div className="offered-courses-count">
            {language === 'en' 
              ? `Showing ${filteredCourses.length} of ${courses.length} courses`
              : `عرض ${filteredCourses.length} من ${courses.length} مقرر`}
          </div>
          
          {filteredCourses.length === 0 ? (
            <div className="no-courses-found">
              {language === 'en' ? 'No courses found' : 'لم يتم العثور على مقررات'}
            </div>
          ) : (
            <div className="offered-courses-list">
              {filteredCourses.map((course) => (
                <div key={course.id} className="offered-course-item">
                  <div className="offered-course-info">
                    <div className="offered-course-header">
                      <span className="offered-course-code">{course.code}</span>
                      <span className="offered-course-section">Section {course.section}</span>
                    </div>
                    <div className="offered-course-name">{course.name}</div>
                    {course.timeSlots && course.timeSlots.length > 1 ? (
                      <div className="offered-course-times">
                        {course.timeSlots.map((slot, index) => (
                          <div key={index} className="time-slot-info">
                            <span>{slot.days.join(', ')}</span>
                            <span>{slot.startTime} - {slot.endTime}</span>
                            {slot.location && <span>{slot.location}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="offered-course-times">
                        <span className="course-days">{course.days.join(', ')}</span>
                        <span className="course-time">{course.startTime} - {course.endTime}</span>
                        {course.location && <span className="course-location">{course.location}</span>}
                      </div>
                    )}
                    {course.instructor && (
                      <div className="offered-course-instructor">{t.instructor}: {course.instructor}</div>
                    )}
                    <div className="offered-course-badges">
                      {course.status && (
                        <span className={`status-badge ${course.status}`}>
                          {course.status === 'open' ? t.open : t.closed}
                        </span>
                      )}
                      {course.classType && (
                        <span className={`class-type-badge ${course.classType}`}>
                          {course.classType === 'practical' ? t.practical :
                           course.classType === 'theoretical' ? t.theoretical :
                           t.exercise}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="offered-course-actions">
                    {isInTimetable(course.id) ? (
                      <button className="in-timetable-badge" disabled>
                        {language === 'en' ? 'In Timetable' : 'في الجدول'}
                      </button>
                    ) : (
                      <button
                        className={`add-course-btn ${hasConflict(course) && getConflictInfo(course)?.type === 'schedule' ? 'conflict' : ''}`}
                        onClick={() => handleAddToTimetable(course)}
                        disabled={(hasConflict(course) && getConflictInfo(course)?.type === 'schedule')}
                      >
                        {hasConflict(course) && getConflictInfo(course)?.type === 'schedule'
                          ? (language === 'en' ? 'Conflict' : 'تعارض')
                          : t.addToTimetable}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfferedCoursesModal;
