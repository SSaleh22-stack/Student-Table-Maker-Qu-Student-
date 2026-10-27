import React, { useState, useMemo } from 'react';
import { Course } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import ConfirmationModal from './ConfirmationModal';
import Icon from './Icon';
import { getCourseTheme, formatDays, sectionsLabel, coursesLabel, hasSchedule, noTimeLabel, formatExam } from '../lib/courseTheme';
import './CourseList.css';

interface CourseListProps {
  courses: Course[];
}

type ViewMode = 'detailed' | 'compact';
type CourseFilter = 'all' | 'open' | 'added';

const CourseList: React.FC<CourseListProps> = ({ courses }) => {
  const { t, language } = useLanguage();
  const { addCourse, removeCourse, isInTimetable, hasConflict, getConflictInfo, setHoveredCourse } = useTimetable();
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<CourseFilter>('all');
  const [confirmationModal, setConfirmationModal] = useState<{ isOpen: boolean; message: string; course: Course | null }>({
    isOpen: false,
    message: '',
    course: null
  });
  
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
    // Courses saved without an order index keep their array position
    const coursesWithIndex = courses.map((c: any, idx) =>
      c.__originalIndex === undefined || c.__originalIndex === null ? { ...c, __originalIndex: idx } : c
    );
    const sorted = [...coursesWithIndex].sort((a: any, b: any) => {
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

  // Filter courses by the search box and the All / Open / Added chips
  const filteredCourses = useMemo(() => {
    let result = coursesInOrder;
    if (statusFilter === 'open') {
      result = result.filter(course => course.status !== 'closed');
    } else if (statusFilter === 'added') {
      result = result.filter(course => isInTimetable(course.id));
    }
    if (!searchQuery.trim()) {
      return result;
    }
    const query = searchQuery.toLowerCase().trim();
    return result.filter(course => {
      const codeMatch = course.code.toLowerCase().includes(query);
      const nameMatch = course.name.toLowerCase().includes(query);
      const sectionMatch = course.section.toLowerCase().includes(query);
      const instructorMatch = course.instructor?.toLowerCase().includes(query);
      return codeMatch || nameMatch || sectionMatch || instructorMatch;
    });
  }, [coursesInOrder, searchQuery, statusFilter, isInTimetable]);

  // Numbers shown on the filter chips
  const filterCounts = useMemo(() => ({
    all: coursesInOrder.length,
    open: coursesInOrder.filter(course => course.status !== 'closed').length,
    added: coursesInOrder.filter(course => isInTimetable(course.id)).length,
  }), [coursesInOrder, isInTimetable]);

  // Group courses by course code and name (for compact view)
  // This must be at component level, not inside renderCompactView
  const groupedCourses = useMemo(() => {
    const groups: Record<string, Course[]> = {};
    filteredCourses.forEach(course => {
      const key = `${course.code}-${course.name}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(course);
    });
    return groups;
  }, [filteredCourses]);

  const handleAddToTimetable = (course: Course, forceWithConflict: boolean = false) => {
    // If course is already in timetable, remove it instead
    if (isInTimetable(course.id)) {
      handleRemoveFromTimetable(course);
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

  const handleRemoveFromTimetable = (course: Course) => {
    // Remove the course from timetable
    removeCourse(course.id);
    
    // If course has multiple time slots, also remove all time slot entries
    if (course.timeSlots && course.timeSlots.length > 1) {
      course.timeSlots.forEach((_, slotIndex) => {
        removeCourse(`${course.id}-slot-${slotIndex}`);
      });
    }
    
    setNotification({
      message: language === 'en'
        ? `${course.code} removed from timetable`
        : `تم إزالة ${course.code} من الجدول`,
      type: 'success'
    });
    setTimeout(() => setNotification(null), 3000);
  };

  const isAr = language === 'ar';

  if (courses.length === 0) {
    return (
      <section className="qs-courses qs-card" aria-label={isAr ? 'المقررات المطروحة' : 'Offered courses'}>
        <div className="qs-courses-empty">
          <div className="qs-empty-icon">
            <Icon name="book" size={30} />
          </div>
          <h3>{isAr ? 'لا توجد مقررات بعد' : 'No courses yet'}</h3>
          <p>
            {isAr
              ? 'استخرج المقررات من صفحة «المقررات المطروحة وفق الخطة» في بوابة الطالب، أو أضف مقرراً يدوياً.'
              : 'Extract courses from the “Offered Courses According to Plan” page on the student portal, or add one manually.'}
          </p>
        </div>
      </section>
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

  const groupKeys = Object.keys(groupedCourses);
  const allExpanded = groupKeys.length > 0 && groupKeys.every(key => expandedGroups.has(key));

  const toggleExpandAll = () => {
    setExpandedGroups(allExpanded ? new Set() : new Set(groupKeys));
  };

  const typeLabel = (course: Course): string | null => {
    if (course.classType === 'practical') return t.practical;
    if (course.classType === 'theoretical') return t.theoretical;
    if (course.classType === 'exercise') return t.exercise;
    return null;
  };

  // Hover preview on the timetable (skipped on phones/tablets)
  const hoverProps = (course: Course) =>
    isTouchDevice
      ? {}
      : {
          onMouseEnter: () => setHoveredCourse(course),
          onMouseLeave: () => setHoveredCourse(null),
        };

  const scheduleConflictWith = (course: Course): string | null => {
    if (!hasConflict(course)) return null;
    const info = getConflictInfo(course);
    return info && info.type === 'schedule' ? info.conflictingCourse.code : null;
  };

  const days = (list: string[]) => formatDays(list, t, language);

  const getSlots = (course: Course) =>
    course.timeSlots && course.timeSlots.length > 1
      ? course.timeSlots
      : [{ days: course.days, startTime: course.startTime, endTime: course.endTime, location: course.location }];

  const tileTitle = (course: Course, inTimetable: boolean, conflictCode: string | null) => {
    const slots = hasSchedule(course) || (course.timeSlots && course.timeSlots.length > 1)
      ? getSlots(course)
          .map((slot) => `${days(slot.days)} ${slot.startTime}-${slot.endTime}${slot.location ? `\n${slot.location}` : ''}`)
          .join('\n')
      : `${noTimeLabel(language)}${isAr ? ' (يُضاف إلى الملخص فقط)' : ' (summary only)'}`;
    if (inTimetable) return `${isAr ? 'في الجدول — اضغط للإزالة' : 'In timetable — click to remove'}\n${slots}`;
    if (conflictCode) return `${isAr ? `تتعارض مع ${conflictCode}` : `Clashes with ${conflictCode}`}\n${slots}`;
    return `${isAr ? 'اضغط للإضافة' : 'Click to add'}\n${slots}`;
  };

  const renderGroupHeader = (key: string, courseGroup: Course[], isExpanded: boolean) => {
    const firstCourse = courseGroup[0];
    const theme = getCourseTheme(firstCourse.code);
    const added = courseGroup.filter((course) => isInTimetable(course.id));
    const allClash = added.length === 0 && courseGroup.every((course) => scheduleConflictWith(course));

    return (
      <button
        type="button"
        className="qs-group-header"
        aria-expanded={isExpanded}
        onClick={() => toggleGroup(key)}
      >
        <span className="qs-code-chip" style={{ background: theme.bg, color: theme.text }}>
          {firstCourse.code}
        </span>
        <span className="qs-group-name">{firstCourse.name}</span>
        {added.length > 0 ? (
          <span className="qs-group-tag qs-group-tag-added">
            <Icon name="check" size={14} />
            {isAr ? 'شعبة' : 'Sec'} {added.map((course) => course.section).join(isAr ? '، ' : ', ')}
          </span>
        ) : allClash ? (
          <span className="qs-group-tag qs-group-tag-warn">
            <Icon name="alert" size={14} />
            {isAr ? 'تعارض' : 'Clash'}
          </span>
        ) : (
          <span className="qs-group-count">{sectionsLabel(courseGroup.length, language)}</span>
        )}
        <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} className="qs-group-chevron" />
      </button>
    );
  };

  const renderDetailedSection = (course: Course, index: number) => {
    const inTimetable = isInTimetable(course.id);
    const conflictCode = inTimetable ? null : scheduleConflictWith(course);
    const isClosed = course.status === 'closed';
    const slots = getSlots(course);
    const type = typeLabel(course);

    return (
      <li
        key={`${course.id}-${index}`}
        className={`qs-section ${inTimetable ? 'is-added' : ''} ${conflictCode ? 'is-conflict' : ''} ${isClosed ? 'is-closed' : ''}`}
        {...hoverProps(course)}
      >
        <div className="qs-section-top">
          <span className="qs-section-title">
            {t.section} {course.section}
          </span>
          {course.status && (
            <span className={`status-badge ${course.status}`}>
              {isClosed && <Icon name="lock" size={12} />}
              {course.status === 'open' ? t.open : t.closed}
            </span>
          )}
          {type && <span className="class-type-badge">{type}</span>}
          <span className="qs-section-action">
            {inTimetable ? (
              <button
                type="button"
                className="qs-btn qs-btn-outline qs-btn-sm"
                onClick={() => handleRemoveFromTimetable(course)}
              >
                <Icon name="x" size={14} />
                {t.removeFromTimetable}
              </button>
            ) : (
              <button
                type="button"
                className={`qs-btn qs-btn-sm ${conflictCode ? 'qs-btn-warning' : 'qs-btn-primary'}`}
                onClick={() => handleAddToTimetable(course)}
                title={conflictCode
                  ? (isAr ? 'إضافة كشعبة متعارضة (تظهر بإطار برتقالي في الجدول)' : 'Add as a clashing section (shown with an orange border)')
                  : undefined}
              >
                <Icon name={conflictCode ? 'alert' : 'plus'} size={14} />
                {conflictCode ? (isAr ? 'إضافة رغم التعارض' : 'Add anyway') : (isAr ? 'إضافة' : 'Add')}
              </button>
            )}
          </span>
        </div>

        {conflictCode && (
          <div className="qs-section-warning">
            <Icon name="alert" size={14} />
            {isAr ? `تتعارض مع ${conflictCode}` : `Clashes with ${conflictCode}`}
          </div>
        )}

        <dl className="qs-section-details">
          {slots.length > 1 ? (
            <div className="qs-detail qs-detail-wide">
              <dt>{isAr ? 'المواعيد' : 'Schedule'}</dt>
              <dd>
                {slots.map((slot, slotIndex) => (
                  <span key={slotIndex} className="qs-slot-line">
                    {days(slot.days)} · {slot.startTime} – {slot.endTime}
                    {slot.location ? ` · ${slot.location}` : ''}
                  </span>
                ))}
              </dd>
            </div>
          ) : !hasSchedule(course) ? (
            <>
              <div className="qs-detail qs-detail-wide">
                <dt>{t.time}</dt>
                <dd>
                  {noTimeLabel(language)}
                  <span className="qs-detail-note">
                    {isAr ? ' — يُضاف إلى الملخص فقط' : ' — added to the summary only'}
                  </span>
                </dd>
              </div>
              {course.location && (
                <div className="qs-detail">
                  <dt>{t.location}</dt>
                  <dd>{course.location}</dd>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="qs-detail">
                <dt>{t.days}</dt>
                <dd>{days(course.days)}</dd>
              </div>
              <div className="qs-detail">
                <dt>{t.time}</dt>
                <dd>{course.startTime} – {course.endTime}</dd>
              </div>
              {course.location && (
                <div className="qs-detail">
                  <dt>{t.location}</dt>
                  <dd>{course.location}</dd>
                </div>
              )}
            </>
          )}
          {course.instructor && (
            <div className="qs-detail">
              <dt>{t.instructor}</dt>
              <dd>{course.instructor}</dd>
            </div>
          )}
        </dl>

        {formatExam(course.finalExam, t, language) && (
          <div className="qs-section-exam">
            <span className="qs-section-exam-label">{t.finalExam}:</span>{' '}
            {formatExam(course.finalExam, t, language)}
          </div>
        )}
      </li>
    );
  };

  const renderCompactTile = (course: Course, index: number) => {
    const inTimetable = isInTimetable(course.id);
    const conflictCode = inTimetable ? null : scheduleConflictWith(course);
    const isClosed = course.status === 'closed';

    return (
      <button
        type="button"
        key={`${course.id}-${index}`}
        className={`qs-tile ${inTimetable ? 'is-added' : ''} ${conflictCode ? 'is-conflict' : ''} ${isClosed ? 'is-closed' : ''}`}
        aria-pressed={inTimetable}
        title={tileTitle(course, inTimetable, conflictCode)}
        onClick={() => {
          if (inTimetable) {
            handleRemoveFromTimetable(course);
          } else {
            handleAddToTimetable(course);
          }
        }}
        {...hoverProps(course)}
      >
        <span className="qs-tile-top">
          <span className="qs-tile-num">{course.section}</span>
          <span className="qs-tile-badge">
            {inTimetable ? (
              <Icon name="check" size={12} />
            ) : isClosed ? (
              <Icon name="lock" size={14} />
            ) : conflictCode ? (
              <Icon name="alert" size={16} />
            ) : (
              <Icon name="plus" size={12} />
            )}
          </span>
        </span>
        <span className="qs-tile-type">
          {conflictCode
            ? (isAr ? 'تعارض' : 'Clash')
            : isClosed
            ? t.closed
            : !hasSchedule(course) && !(course.timeSlots && course.timeSlots.length > 1)
            ? noTimeLabel(language)
            : (typeLabel(course) || '-')}
        </span>
        <span className="qs-tile-instructor">{course.instructor || '-'}</span>
      </button>
    );
  };

  const totalGroups = new Set(coursesInOrder.map((course) => `${course.code}-${course.name}`)).size;

  const filterOptions: { key: CourseFilter; label: string; count: number }[] = [
    { key: 'all', label: t.all, count: filterCounts.all },
    { key: 'open', label: isAr ? 'المفتوحة' : 'Open', count: filterCounts.open },
    { key: 'added', label: isAr ? 'المضافة' : 'Added', count: filterCounts.added },
  ];

  return (
    <section className="qs-courses qs-card" aria-label={isAr ? 'المقررات المطروحة' : 'Offered courses'}>
      {notification && (
        <div className={`qs-toast ${notification.type}`} role="status">
          <Icon name={notification.type === 'success' ? 'check' : 'alert'} />
          {notification.message}
        </div>
      )}

      <div className="qs-courses-head">
        <h2 className="qs-courses-title">{isAr ? 'المقررات المطروحة' : 'Offered courses'}</h2>
        <span className="qs-courses-count">
          {coursesLabel(totalGroups, language)} · {sectionsLabel(coursesInOrder.length, language)}
        </span>
      </div>

      <div className="qs-search">
        <Icon name="search" size={20} />
        <input
          type="search"
          className="qs-search-input"
          aria-label={isAr ? 'البحث في المقررات المطروحة' : 'Search offered courses'}
          placeholder={isAr ? 'ابحث باسم المقرر أو رمزه أو الشعبة أو المحاضر' : 'Search by course, code, section or instructor'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="qs-filter-chips" role="group" aria-label={isAr ? 'تصفية' : 'Filter'}>
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`qs-filter-chip ${statusFilter === option.key ? 'active' : ''}`}
            aria-pressed={statusFilter === option.key}
            onClick={() => setStatusFilter(option.key)}
          >
            {option.label} · {option.count}
          </button>
        ))}
      </div>

      <div className="qs-view-row">
        <div className="qs-view-switch">
          <span className="qs-view-label" id="qs-view-label">{isAr ? 'العرض' : 'View'}</span>
          <div className="qs-segmented" role="group" aria-labelledby="qs-view-label">
            <button
              type="button"
              className={viewMode === 'detailed' ? 'active' : ''}
              aria-pressed={viewMode === 'detailed'}
              onClick={() => setViewMode('detailed')}
            >
              <Icon name="list" size={16} />
              {isAr ? 'مفصّل' : 'Detailed'}
            </button>
            <button
              type="button"
              className={viewMode === 'compact' ? 'active' : ''}
              aria-pressed={viewMode === 'compact'}
              onClick={() => setViewMode('compact')}
            >
              <Icon name="grid" size={16} />
              {isAr ? 'مضغوط' : 'Compact'}
            </button>
          </div>
        </div>
        {groupKeys.length > 0 && (
          <button type="button" className="qs-btn qs-btn-text qs-btn-sm" onClick={toggleExpandAll}>
            <Icon name={allExpanded ? 'collapse' : 'expand'} size={16} />
            {allExpanded ? (isAr ? 'طي الكل' : 'Collapse all') : (isAr ? 'توسيع الكل' : 'Expand all')}
          </button>
        )}
      </div>

      {groupKeys.length === 0 ? (
        <div className="qs-no-results">
          <Icon name="search" size={22} />
          <span>{isAr ? 'لا توجد نتائج مطابقة' : 'No matching courses'}</span>
        </div>
      ) : (
        <div className={`qs-groups ${viewMode === 'compact' ? 'is-compact' : 'is-detailed'}`}>
          {Object.entries(groupedCourses).map(([key, courseGroup]) => {
            const isExpanded = expandedGroups.has(key);
            const groupClash = courseGroup.every((course) => !isInTimetable(course.id) && scheduleConflictWith(course));
            return (
              <div key={key} className={`qs-group ${groupClash ? 'is-warn' : ''}`}>
                {renderGroupHeader(key, courseGroup, isExpanded)}
                {isExpanded && (
                  viewMode === 'compact' ? (
                    <div className="qs-tiles" role="group" aria-label={courseGroup[0].code}>
                      {courseGroup.map((course, index) => renderCompactTile(course, index))}
                    </div>
                  ) : (
                    <ul className="qs-sections">
                      {courseGroup.map((course, index) => renderDetailedSection(course, index))}
                    </ul>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

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
    </section>
  );
};

export default CourseList;
