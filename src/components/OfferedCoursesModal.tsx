import React, { useState, useMemo } from 'react';
import { Course } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import ConfirmationModal from './ConfirmationModal';
import Icon from './Icon';
import { getCourseTheme, formatDays, hasSchedule, noTimeLabel } from '../lib/courseTheme';
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

  // Get unique course codes for dropdown
  const uniqueCourseCodes = useMemo(() => {
    const codes = new Set(courses.map(course => course.code));
    return Array.from(codes).sort();
  }, [courses]);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmationModal, setConfirmationModal] = useState<{ isOpen: boolean; message: string; course: Course | null }>({
    isOpen: false,
    message: '',
    course: null
  });

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
        
        setConfirmationModal({
          isOpen: true,
          message: confirmMessage,
          course: course
        });
        return;
      }
    }

    // No conflicts - add course to timetable
    const added = addCourse(course);
    if (added) {
      const noTime = !hasSchedule(course) && !(course.timeSlots && course.timeSlots.length > 1);
      setNotification({
        message: noTime
          ? (language === 'en'
              ? `${course.code} has no set time, so it was added to the summary only`
              : `${course.code} بدون وقت محدد، لذلك أُضيف إلى الملخص فقط`)
          : (language === 'en'
              ? `${course.code} added to timetable`
              : `تم إضافة ${course.code} إلى الجدول`),
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

  const isAr = language === 'ar';

  const typeLabel = (course: Course): string | null => {
    if (course.classType === 'practical') return t.practical;
    if (course.classType === 'theoretical') return t.theoretical;
    if (course.classType === 'exercise') return t.exercise;
    return null;
  };

  const statusOptions: { key: typeof statusFilter; label: string }[] = [
    { key: 'all', label: t.all },
    { key: 'open', label: t.open },
    { key: 'closed', label: t.closed },
  ];

  const typeOptions: { key: typeof typeFilter; label: string }[] = [
    { key: 'all', label: t.all },
    { key: 'theoretical', label: t.theoretical },
    { key: 'practical', label: t.practical },
    { key: 'exercise', label: t.exercise },
  ];

  const hasActiveFilters = searchQuery.trim() !== '' || codeFilter !== 'all' || statusFilter !== 'all' || typeFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setCodeFilter('all');
    setStatusFilter('all');
    setTypeFilter('all');
  };

  return (
    <>
      <div className="qs-modal-overlay" onClick={onClose}>
        <div
          className="qs-modal oc-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="oc-title"
          dir={isAr ? 'rtl' : 'ltr'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="qs-modal-header">
            <div className="oc-title-wrap">
              <span className="oc-title-icon">
                <Icon name="list" size={22} />
              </span>
              <div>
                <h2 id="oc-title">{t.offeredCourses}</h2>
                <p className="oc-subtitle">
                  {isAr
                    ? `عرض ${filteredCourses.length} من ${courses.length} شعبة`
                    : `Showing ${filteredCourses.length} of ${courses.length} sections`}
                </p>
              </div>
            </div>
            <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={onClose}>
              {t.close}
            </button>
          </div>

          {notification && (
            <div className={`qs-toast ${notification.type}`} role="status">
              <Icon name={notification.type === 'success' ? 'check' : 'alert'} />
              {notification.message}
            </div>
          )}

          <div className="oc-toolbar">
            <div className="oc-toolbar-row">
              <div className="qs-search oc-search">
                <Icon name="search" size={20} />
                <input
                  type="search"
                  className="qs-search-input"
                  aria-label={t.search}
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="oc-code-filter">
                <label htmlFor="oc-code-select">{t.courseCode}</label>
                <select
                  id="oc-code-select"
                  className="qs-select"
                  value={codeFilter}
                  onChange={(e) => setCodeFilter(e.target.value)}
                >
                  <option value="all">{t.all}</option>
                  {uniqueCourseCodes.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="oc-toolbar-row">
              <div className="oc-filter">
                <span className="oc-filter-label" id="oc-status-label">{t.status}</span>
                <div className="qs-segmented" role="group" aria-labelledby="oc-status-label">
                  {statusOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={statusFilter === option.key ? 'active' : ''}
                      aria-pressed={statusFilter === option.key}
                      onClick={() => setStatusFilter(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="oc-filter">
                <span className="oc-filter-label" id="oc-type-label">{t.classType}</span>
                <div className="qs-segmented" role="group" aria-labelledby="oc-type-label">
                  {typeOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={typeFilter === option.key ? 'active' : ''}
                      aria-pressed={typeFilter === option.key}
                      onClick={() => setTypeFilter(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {hasActiveFilters && (
                <button type="button" className="qs-btn qs-btn-text qs-btn-sm oc-clear" onClick={clearFilters}>
                  <Icon name="x" size={16} />
                  {isAr ? 'مسح التصفية' : 'Clear filters'}
                </button>
              )}
            </div>
          </div>

          <div className="oc-content">
            {courses.length === 0 ? (
              <div className="oc-empty">
                <span className="qs-empty-icon">
                  <Icon name="book" size={30} />
                </span>
                <h3>{isAr ? 'لا توجد مقررات بعد' : 'No courses yet'}</h3>
                <p>
                  {isAr
                    ? 'استخرج المقررات من صفحة «المقررات المطروحة وفق الخطة» في بوابة الطالب لتظهر هنا.'
                    : 'Extract courses from the “Offered Courses According to Plan” page on the student portal to see them here.'}
                </p>
              </div>
            ) : filteredCourses.length === 0 ? (
              <div className="qs-no-results">
                <Icon name="search" size={22} />
                <span>{isAr ? 'لم يتم العثور على مقررات' : 'No courses found'}</span>
              </div>
            ) : (
              <div className="oc-grid">
                {filteredCourses.map((course) => {
                  const theme = getCourseTheme(course.code);
                  const inTimetable = isInTimetable(course.id);
                  const isClosed = course.status === 'closed';
                  const conflictInfo = !inTimetable && hasConflict(course) ? getConflictInfo(course) : null;
                  const conflictCode = conflictInfo && conflictInfo.type === 'schedule' ? conflictInfo.conflictingCourse.code : null;
                  const type = typeLabel(course);
                  const slots = course.timeSlots && course.timeSlots.length > 1
                    ? course.timeSlots
                    : [{ days: course.days, startTime: course.startTime, endTime: course.endTime, location: course.location }];

                  return (
                    <article
                      key={course.id}
                      className={`oc-card ${inTimetable ? 'is-added' : ''} ${conflictCode ? 'is-conflict' : ''} ${isClosed ? 'is-closed' : ''}`}
                    >
                      <div className="oc-card-top">
                        <span className="qs-code-chip" style={{ background: theme.bg, color: theme.text }}>
                          {course.code}
                        </span>
                        <span className="oc-card-section">
                          {t.section} {course.section}
                        </span>
                      </div>

                      <h3 className="oc-card-name">{course.name}</h3>

                      <div className="oc-card-tags">
                        {course.status && (
                          <span className={`status-badge ${course.status}`}>
                            {isClosed && <Icon name="lock" size={12} />}
                            {course.status === 'open' ? t.open : t.closed}
                          </span>
                        )}
                        {type && <span className="class-type-badge">{type}</span>}
                        {course.hours && (
                          <span className="class-type-badge">
                            {isAr ? `الساعات: ${course.hours}` : `Hours: ${course.hours}`}
                          </span>
                        )}
                      </div>

                      <ul className="oc-card-meta">
                        {slots.length === 1 && !hasSchedule(slots[0]) ? (
                          <li>
                            <Icon name="clock" size={15} />
                            <span>
                              {noTimeLabel(language)}
                              <span className="oc-card-note">{isAr ? ' — يُضاف إلى الملخص فقط' : ' — summary only'}</span>
                            </span>
                          </li>
                        ) : slots.map((slot, index) => (
                          <li key={index}>
                            <Icon name="clock" size={15} />
                            <span>
                              {formatDays(slot.days, t, language)} · {slot.startTime} – {slot.endTime}
                              {slots.length > 1 && slot.location ? ` · ${slot.location}` : ''}
                            </span>
                          </li>
                        ))}
                        {slots.length === 1 && course.location && (
                          <li>
                            <Icon name="mapPin" size={15} />
                            <span>{course.location}</span>
                          </li>
                        )}
                        {course.instructor && (
                          <li>
                            <Icon name="user" size={15} />
                            <span>{course.instructor}</span>
                          </li>
                        )}
                      </ul>

                      {conflictCode && (
                        <div className="oc-card-warning">
                          <Icon name="alert" size={14} />
                          {isAr ? `تتعارض مع ${conflictCode}` : `Clashes with ${conflictCode}`}
                        </div>
                      )}

                      <div className="oc-card-action">
                        {inTimetable ? (
                          <span className="oc-in-timetable">
                            <Icon name="check" size={16} />
                            {isAr ? 'في الجدول' : 'In timetable'}
                          </span>
                        ) : isClosed ? (
                          <button type="button" className="qs-btn qs-btn-outline qs-btn-sm" disabled>
                            <Icon name="lock" size={14} />
                            {isAr ? 'الشعبة مغلقة' : 'Section closed'}
                          </button>
                        ) : conflictCode ? (
                          <button
                            type="button"
                            className="qs-btn qs-btn-warning qs-btn-sm"
                            onClick={() => handleAddToTimetable(course)}
                            title={isAr ? 'تُضاف كشعبة متعارضة بإطار برتقالي في الجدول' : 'Added as a clashing section with an orange border'}
                          >
                            <Icon name="alert" size={14} />
                            {isAr ? 'إضافة رغم التعارض' : 'Add anyway'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="qs-btn qs-btn-primary qs-btn-sm"
                            onClick={() => handleAddToTimetable(course)}
                          >
                            <Icon name="plus" size={14} />
                            {t.addToTimetable}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmationModal.isOpen}
        message={confirmationModal.message}
        onConfirm={() => {
          if (confirmationModal.course) {
            const added = addCourse(confirmationModal.course, true);
            if (added) {
              setNotification({
                message: language === 'en'
                  ? `${confirmationModal.course.code} added to timetable`
                  : `تم إضافة ${confirmationModal.course.code} إلى الجدول`,
                type: 'success'
              });
              setTimeout(() => setNotification(null), 3000);
            }
          }
          setConfirmationModal({ isOpen: false, message: '', course: null });
        }}
        onCancel={() => {
          setConfirmationModal({ isOpen: false, message: '', course: null });
        }}
      />
    </>
  );
};

export default OfferedCoursesModal;
