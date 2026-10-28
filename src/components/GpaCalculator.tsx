import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  CourseGrade,
  GradeLetter,
  GradePointMap,
  GPAScale,
  getDefaultGradePoints,
  calcQualityPoints,
  calcTotalHours,
  calcSemesterGpa,
  calcNewCumulativeGpa,
  validateGpa,
  validateHours,
} from '../lib/gpa';
import Icon from './Icon';
import './GpaCalculator.css';

const GpaCalculator: React.FC = () => {
  const { language, t } = useLanguage();
  const [scale, setScale] = useState<GPAScale>(5);
  const [prevGpa, setPrevGpa] = useState<number>(0);
  const [prevHours, setPrevHours] = useState<number>(0);
  const [courses, setCourses] = useState<CourseGrade[]>([
    { id: '1', title: '', hours: 0, grade: '' },
  ]);
  const [gradePointMap, setGradePointMap] = useState<GradePointMap>(
    getDefaultGradePoints(5)
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Nothing is saved until stored values have loaded, so the empty defaults
  // shown on first render never overwrite what the student saved earlier.
  const [loaded, setLoaded] = useState(false);

  // Use the saved grade points when there are any, otherwise the defaults for the saved scale
  const applySavedScale = (savedScale?: GPAScale, savedMap?: GradePointMap) => {
    if (savedScale) setScale(savedScale);
    if (savedMap) setGradePointMap(savedMap);
    else if (savedScale) setGradePointMap(getDefaultGradePoints(savedScale));
  };

  // Load saved data on mount
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // First, check for GPA data from content script (chrome.storage.local)
          chrome.storage.local.get(['gpaData'], (localResult) => {
            if (localResult.gpaData) {
              // Load data from content script
              const gpaData = localResult.gpaData;
              if (gpaData.cumulativeGPA !== undefined) setPrevGpa(gpaData.cumulativeGPA);
              if (gpaData.earnedHours !== undefined) setPrevHours(gpaData.earnedHours);
              if (gpaData.courses && Array.isArray(gpaData.courses)) setCourses(gpaData.courses);
              applySavedScale(gpaData.scale, gpaData.gradePointMap);
              setLoaded(true);

              // Clear the data after loading
              chrome.storage.local.remove(['gpaData']);
            } else {
              // No data from content script, load from chrome.storage.sync (saved preferences)
              chrome.storage.sync.get(
                [
                  'gpaScale',
                  'gpaPrevGpa',
                  'gpaPrevHours',
                  'gpaCourses',
                  'gpaGradePointMap',
                ],
                (result) => {
                  if (result.gpaPrevGpa !== undefined) setPrevGpa(result.gpaPrevGpa);
                  if (result.gpaPrevHours !== undefined) setPrevHours(result.gpaPrevHours);
                  if (result.gpaCourses) setCourses(result.gpaCourses);
                  applySavedScale(result.gpaScale, result.gpaGradePointMap);
                  setLoaded(true);
                }
              );
            }
          });
        } else {
          // Webapp: Load from localStorage
          const savedScale = localStorage.getItem('gpaScale');
          const savedPrevGpa = localStorage.getItem('gpaPrevGpa');
          const savedPrevHours = localStorage.getItem('gpaPrevHours');
          const savedCourses = localStorage.getItem('gpaCourses');
          const savedGradeMap = localStorage.getItem('gpaGradePointMap');

          if (savedPrevGpa) setPrevGpa(parseFloat(savedPrevGpa));
          if (savedPrevHours) setPrevHours(parseFloat(savedPrevHours));
          if (savedCourses) setCourses(JSON.parse(savedCourses));
          applySavedScale(
            savedScale ? (parseInt(savedScale) as GPAScale) : undefined,
            savedGradeMap ? JSON.parse(savedGradeMap) : undefined
          );
          setLoaded(true);
        }
      } catch (error) {
        console.error('Error loading saved GPA data:', error);
        setLoaded(true);
      }
    };

    loadSavedData();
  }, []);

  // Switching the scale resets grade points to that scale's defaults
  const handleScaleChange = (nextScale: GPAScale) => {
    setScale(nextScale);
    setGradePointMap(getDefaultGradePoints(nextScale));
  };

  // Save data when it changes
  useEffect(() => {
    if (!loaded) return;
    const saveData = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // Extension: Save to chrome.storage.sync
          chrome.storage.sync.set({
            gpaScale: scale,
            gpaPrevGpa: prevGpa,
            gpaPrevHours: prevHours,
            gpaCourses: courses,
            gpaGradePointMap: gradePointMap,
          });
        } else {
          // Webapp: Save to localStorage
          localStorage.setItem('gpaScale', scale.toString());
          localStorage.setItem('gpaPrevGpa', prevGpa.toString());
          localStorage.setItem('gpaPrevHours', prevHours.toString());
          localStorage.setItem('gpaCourses', JSON.stringify(courses));
          localStorage.setItem('gpaGradePointMap', JSON.stringify(gradePointMap));
        }
      } catch (error) {
        console.error('Error saving GPA data:', error);
      }
    };

    saveData();
  }, [loaded, scale, prevGpa, prevHours, courses, gradePointMap]);

  // Calculate results
  const currentHours = useMemo(() => calcTotalHours(courses), [courses]);
  const currentQualityPoints = useMemo(
    () => calcQualityPoints(courses, gradePointMap),
    [courses, gradePointMap]
  );
  const semesterGpa = useMemo(
    () => calcSemesterGpa(courses, gradePointMap),
    [courses, gradePointMap]
  );
  const cumulativeGpa = useMemo(
    () => calcNewCumulativeGpa(prevGpa, prevHours, courses, gradePointMap),
    [prevGpa, prevHours, courses, gradePointMap]
  );

  // Grade options
  const gradeOptions: GradeLetter[] = ['', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'DN'];

  // Handlers
  const handleAddCourse = () => {
    const newId = Date.now().toString();
    setCourses([...courses, { id: newId, title: '', hours: 0, grade: '' }]);
  };

  const handleRemoveCourse = (id: string) => {
    if (courses.length > 1) {
      setCourses(courses.filter((c) => c.id !== id));
    }
  };

  const handleClearAll = () => {
    if (window.confirm(t.gpaClearAllConfirm || 'Are you sure you want to clear all courses?')) {
      setCourses([{ id: '1', title: '', hours: 0, grade: '' }]);
    }
  };

  const handleDuplicateCourse = (course: CourseGrade) => {
    const newId = Date.now().toString();
    setCourses([...courses, { ...course, id: newId }]);
  };

  const handleCourseChange = (id: string, field: keyof CourseGrade, value: string | number) => {
    setCourses(
      courses.map((c) =>
        c.id === id ? { ...c, [field]: value } : c
      )
    );
  };

  const handleResetGradeMap = () => {
    if (window.confirm(t.gpaResetGradeMapConfirm || 'Reset to default grade mappings?')) {
      setGradePointMap(getDefaultGradePoints(scale));
    }
  };

  const handleGradeMapChange = (grade: GradeLetter, value: number) => {
    setGradePointMap({ ...gradePointMap, [grade]: value });
  };

  const isAr = language === 'ar';

  return (
    <div className="gpa-calculator" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="gpa-header">
        <div>
          <h1 className="gpa-title">{t.gpaCalculator || 'GPA Calculator'}</h1>
          <p className="gpa-subtitle">
            {isAr
              ? 'احسب معدلك الفصلي والتراكمي الجديد من درجات وساعات مقررات هذا الفصل.'
              : "Work out your semester and new cumulative GPA from this semester's grades and hours."}
          </p>
        </div>
        <button
          type="button"
          className="qs-btn qs-btn-soft"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <Icon name="sliders" />
          {t.gpaAdvanced || 'Advanced'}
        </button>
      </div>

      {/* Card 1: Scale + Previous GPA + Previous Hours */}
      <div className="gpa-card">
        <h2 className="gpa-card-title">{t.gpaSettings || 'Settings'}</h2>
        <div className="gpa-settings-grid">
          <div className="qs-field">
            <label className="qs-label" htmlFor="gpa-scale">{t.gpaScale || 'GPA Scale'}</label>
            <select
              id="gpa-scale"
              value={scale}
              onChange={(e) => handleScaleChange(parseInt(e.target.value) as GPAScale)}
              className="qs-select"
            >
              <option value={5}>5.0</option>
              <option value={4}>4.0</option>
            </select>
          </div>
          <div className="qs-field">
            <label className="qs-label" htmlFor="gpa-prev">{t.gpaPrevGpa || 'Previous GPA'}</label>
            <input
              id="gpa-prev"
              type="number"
              min="0"
              max={scale}
              step="0.01"
              value={prevGpa}
              onChange={(e) => {
                const value = parseFloat(e.target.value) || 0;
                if (validateGpa(value, scale)) {
                  setPrevGpa(value);
                }
              }}
              className="qs-input"
            />
          </div>
          <div className="qs-field">
            <label className="qs-label" htmlFor="gpa-prev-hours">{t.gpaPrevHours || 'Previous Hours'}</label>
            <input
              id="gpa-prev-hours"
              type="number"
              min="0"
              step="0.5"
              value={prevHours}
              onChange={(e) => {
                const value = parseFloat(e.target.value) || 0;
                if (validateHours(value)) {
                  setPrevHours(value);
                }
              }}
              className="qs-input"
            />
          </div>
        </div>
      </div>

      {/* Card 2: Current Courses Table */}
      <div className="gpa-card">
        <div className="gpa-card-header">
          <h2 className="gpa-card-title">{t.gpaCurrentCourses || 'Current Courses'}</h2>
          <div className="gpa-card-actions">
            <button type="button" className="qs-btn qs-btn-soft qs-btn-sm" onClick={handleAddCourse}>
              <Icon name="plus" size={16} />
              {t.gpaAddCourse || 'Add Course'}
            </button>
            <button type="button" className="qs-btn qs-btn-danger-text qs-btn-sm" onClick={handleClearAll}>
              <Icon name="trash" size={16} />
              {t.gpaClearAll || 'Clear All'}
            </button>
          </div>
        </div>
        <div className="gpa-table-container">
          <table className="gpa-table">
            <thead>
              <tr>
                <th>{t.gpaCourseName || 'Course Name'}</th>
                <th>{t.gpaGrade || 'Grade'}</th>
                <th>{t.gpaHours || 'Hours'}</th>
                <th>{t.gpaPoints || 'Points'}</th>
                <th>
                  <span className="gpa-sr-only">{t.gpaActions || 'Actions'}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course, index) => {
                const coursePoints = course.grade && course.hours > 0
                  ? (gradePointMap[course.grade] || 0) * course.hours
                  : 0;
                const rowLabel = course.title || `${t.gpaCourseName || 'Course'} ${index + 1}`;
                return (
                  <tr key={course.id}>
                    <td>
                      <input
                        type="text"
                        value={course.title || ''}
                        onChange={(e) =>
                          handleCourseChange(course.id, 'title', e.target.value)
                        }
                        placeholder={t.gpaCourseNamePlaceholder || 'Course name'}
                        aria-label={t.gpaCourseName || 'Course name'}
                        className="qs-input gpa-cell-name"
                      />
                    </td>
                    <td>
                      <select
                        value={course.grade}
                        onChange={(e) =>
                          handleCourseChange(course.id, 'grade', e.target.value as GradeLetter)
                        }
                        aria-label={`${t.gpaGrade || 'Grade'} – ${rowLabel}`}
                        className="qs-select gpa-cell-grade"
                      >
                        {gradeOptions.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade || (isAr ? 'غير محدد' : 'Not Specified')}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={course.hours}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 0;
                          if (validateHours(value)) {
                            handleCourseChange(course.id, 'hours', value);
                          }
                        }}
                        aria-label={`${t.gpaHours || 'Hours'} – ${rowLabel}`}
                        className="qs-input gpa-cell-hours"
                      />
                    </td>
                    <td className="gpa-points-cell">
                      {coursePoints.toFixed(2)}
                    </td>
                    <td>
                      <div className="gpa-row-actions">
                        <button
                          type="button"
                          className="gpa-btn-icon"
                          onClick={() => handleDuplicateCourse(course)}
                          title={t.gpaDuplicate || 'Duplicate'}
                          aria-label={`${t.gpaDuplicate || 'Duplicate'} – ${rowLabel}`}
                        >
                          <Icon name="copy" size={16} />
                        </button>
                        <button
                          type="button"
                          className="gpa-btn-icon gpa-btn-icon-danger"
                          onClick={() => handleRemoveCourse(course.id)}
                          disabled={courses.length === 1}
                          title={t.gpaRemove || 'Remove'}
                          aria-label={`${t.gpaRemove || 'Remove'} – ${rowLabel}`}
                        >
                          <Icon name="x" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card 3: Results Summary */}
      <div className="gpa-card">
        <h2 className="gpa-card-title">{t.gpaResults || 'Results'}</h2>
        <div className="gpa-results-grid">
          <div className="gpa-result-section">
            <div className="gpa-big gpa-big-semester">
              <span className="gpa-big-label">{t.gpaSemesterGpa || 'Semester GPA'}</span>
              <span className="gpa-big-value">
                {semesterGpa !== null ? semesterGpa.toFixed(2) : '—'}
                <span className="gpa-big-scale"> / {scale}</span>
              </span>
            </div>
            <dl className="gpa-result-list">
              <div>
                <dt>{t.gpaCurrentHours || 'Current Hours'}</dt>
                <dd>{currentHours.toFixed(1)}</dd>
              </div>
              <div>
                <dt>{t.gpaCurrentPoints || 'Current Quality Points'}</dt>
                <dd>{currentQualityPoints.toFixed(2)}</dd>
              </div>
            </dl>
          </div>
          <div className="gpa-result-section">
            <div className="gpa-big gpa-big-cumulative">
              <span className="gpa-big-label">{t.gpaNewCumulativeGpa || 'New Cumulative GPA'}</span>
              <span className="gpa-big-value">
                {cumulativeGpa !== null ? cumulativeGpa.toFixed(2) : '—'}
                <span className="gpa-big-scale"> / {scale}</span>
              </span>
            </div>
            <dl className="gpa-result-list">
              <div>
                <dt>{t.gpaTotalHours || 'Total Hours'}</dt>
                <dd>{(prevHours + currentHours).toFixed(1)}</dd>
              </div>
              <div>
                <dt>{t.gpaTotalPoints || 'Total Quality Points'}</dt>
                <dd>{(prevGpa * prevHours + currentQualityPoints).toFixed(2)}</dd>
              </div>
            </dl>
          </div>
        </div>
        {currentHours === 0 && (
          <div className="qs-alert qs-alert-warning gpa-warning" role="status">
            <Icon name="alert" />
            <span>{t.gpaNoHoursWarning || 'Please add courses with credit hours to calculate GPA.'}</span>
          </div>
        )}
      </div>

      {/* Advanced Modal */}
      {showAdvanced && (
        <div className="qs-modal-overlay" onClick={() => setShowAdvanced(false)}>
          <div
            className="qs-modal gpa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gpa-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qs-modal-header">
              <h2 id="gpa-modal-title">{t.gpaAdvancedGradeMapping || 'Advanced Grade Mapping'}</h2>
              <button
                type="button"
                className="qs-btn qs-btn-ghost qs-btn-sm"
                onClick={() => setShowAdvanced(false)}
              >
                {t.close}
              </button>
            </div>
            <div className="qs-modal-body">
              <p className="gpa-modal-description">
                {t.gpaAdvancedDescription || 'Customize grade point values for the selected scale.'}
              </p>
              <div className="gpa-grade-map-grid">
                {gradeOptions.filter(g => g !== '').map((grade) => (
                  <div key={grade} className="gpa-grade-map-item">
                    <label htmlFor={`gpa-map-${grade}`} dir="ltr">{grade}</label>
                    <input
                      id={`gpa-map-${grade}`}
                      type="number"
                      min="0"
                      max={scale}
                      step="0.01"
                      value={gradePointMap[grade]}
                      onChange={(e) =>
                        handleGradeMapChange(grade, parseFloat(e.target.value) || 0)
                      }
                      className="qs-input"
                    />
                  </div>
                ))}
              </div>
              <div className="gpa-modal-actions">
                <button
                  type="button"
                  className="qs-btn qs-btn-ghost"
                  onClick={handleResetGradeMap}
                >
                  {t.gpaResetToDefaults || 'Reset to Defaults'}
                </button>
                <button
                  type="button"
                  className="qs-btn qs-btn-primary"
                  onClick={() => setShowAdvanced(false)}
                >
                  {isAr ? 'تم' : 'Done'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GpaCalculator;
