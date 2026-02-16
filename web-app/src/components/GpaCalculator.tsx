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
import './GpaCalculator.css';

const GpaCalculator: React.FC = () => {
  const { t } = useLanguage();
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

  // Load saved data on mount
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // Extension: Load from chrome.storage.sync
          chrome.storage.sync.get(
            [
              'gpaScale',
              'gpaPrevGpa',
              'gpaPrevHours',
              'gpaCourses',
              'gpaGradePointMap',
            ],
            (result) => {
              if (result.gpaScale) setScale(result.gpaScale);
              if (result.gpaPrevGpa !== undefined) setPrevGpa(result.gpaPrevGpa);
              if (result.gpaPrevHours !== undefined) setPrevHours(result.gpaPrevHours);
              if (result.gpaCourses) setCourses(result.gpaCourses);
              if (result.gpaGradePointMap) setGradePointMap(result.gpaGradePointMap);
            }
          );
        } else {
          // Webapp: Load from localStorage
          const savedScale = localStorage.getItem('gpaScale');
          const savedPrevGpa = localStorage.getItem('gpaPrevGpa');
          const savedPrevHours = localStorage.getItem('gpaPrevHours');
          const savedCourses = localStorage.getItem('gpaCourses');
          const savedGradeMap = localStorage.getItem('gpaGradePointMap');

          if (savedScale) setScale(parseInt(savedScale) as GPAScale);
          if (savedPrevGpa) setPrevGpa(parseFloat(savedPrevGpa));
          if (savedPrevHours) setPrevHours(parseFloat(savedPrevHours));
          if (savedCourses) setCourses(JSON.parse(savedCourses));
          if (savedGradeMap) setGradePointMap(JSON.parse(savedGradeMap));
        }
      } catch (error) {
        console.error('Error loading saved GPA data:', error);
      }
    };

    loadSavedData();
  }, []);

  // Update grade point map when scale changes
  useEffect(() => {
    setGradePointMap(getDefaultGradePoints(scale));
  }, [scale]);

  // Save data when it changes
  useEffect(() => {
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
  }, [scale, prevGpa, prevHours, courses, gradePointMap]);

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

  return (
    <div className="gpa-calculator" dir="rtl">
      <div className="gpa-header">
        <h1 className="gpa-title">{t.gpaCalculator || 'GPA Calculator'}</h1>
        <button
          className="gpa-advanced-btn"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {t.gpaAdvanced || 'Advanced'}
        </button>
      </div>

      {/* Card 1: Scale + Previous GPA + Previous Hours */}
      <div className="gpa-card">
        <h2 className="gpa-card-title">{t.gpaSettings || 'Settings'}</h2>
        <div className="gpa-settings-grid">
          <div className="gpa-setting-item">
            <label>{t.gpaScale || 'GPA Scale'}</label>
            <select
              value={scale}
              onChange={(e) => setScale(parseInt(e.target.value) as GPAScale)}
              className="gpa-select"
            >
              <option value={5}>5.0</option>
              <option value={4}>4.0</option>
            </select>
          </div>
          <div className="gpa-setting-item">
            <label>{t.gpaPrevGpa || 'Previous GPA'}</label>
            <input
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
              className="gpa-input"
            />
          </div>
          <div className="gpa-setting-item">
            <label>{t.gpaPrevHours || 'Previous Hours'}</label>
            <input
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
              className="gpa-input"
            />
          </div>
        </div>
      </div>

      {/* Card 2: Current Courses Table */}
      <div className="gpa-card">
        <div className="gpa-card-header">
          <h2 className="gpa-card-title">{t.gpaCurrentCourses || 'Current Courses'}</h2>
          <div className="gpa-card-actions">
            <button className="gpa-btn gpa-btn-secondary" onClick={handleAddCourse}>
              + {t.gpaAddCourse || 'Add Course'}
            </button>
            <button className="gpa-btn gpa-btn-danger" onClick={handleClearAll}>
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
                <th>{t.gpaActions || 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => {
                const coursePoints = course.grade && course.hours > 0
                  ? (gradePointMap[course.grade] || 0) * course.hours
                  : 0;
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
                        className="gpa-input gpa-input-text"
                      />
                    </td>
                    <td>
                      <select
                        value={course.grade}
                        onChange={(e) =>
                          handleCourseChange(course.id, 'grade', e.target.value as GradeLetter)
                        }
                        className="gpa-select"
                      >
                        {gradeOptions.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade || 'غير محدد'}
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
                        className="gpa-input gpa-input-number"
                      />
                    </td>
                    <td className="gpa-points-cell">
                      {coursePoints.toFixed(2)}
                    </td>
                    <td>
                      <div className="gpa-row-actions">
                        <button
                          className="gpa-btn-icon"
                          onClick={() => handleDuplicateCourse(course)}
                          title={t.gpaDuplicate || 'Duplicate'}
                        >
                          📋
                        </button>
                        <button
                          className="gpa-btn-icon gpa-btn-danger"
                          onClick={() => handleRemoveCourse(course.id)}
                          disabled={courses.length === 1}
                          title={t.gpaRemove || 'Remove'}
                        >
                          ×
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
            <h3>{t.gpaSemesterResults || 'Semester Results'}</h3>
            <div className="gpa-result-item">
              <span className="gpa-result-label">{t.gpaCurrentHours || 'Current Hours'}</span>
              <span className="gpa-result-value">{currentHours.toFixed(1)}</span>
            </div>
            <div className="gpa-result-item">
              <span className="gpa-result-label">{t.gpaCurrentPoints || 'Current Quality Points'}</span>
              <span className="gpa-result-value">{currentQualityPoints.toFixed(2)}</span>
            </div>
            <div className="gpa-result-item gpa-result-highlight">
              <span className="gpa-result-label">{t.gpaSemesterGpa || 'Semester GPA'}</span>
              <span className="gpa-result-value gpa-result-big">
                {semesterGpa !== null ? semesterGpa.toFixed(2) : '—'}
              </span>
            </div>
          </div>
          <div className="gpa-result-section">
            <h3>{t.gpaCumulativeResults || 'Cumulative Results'}</h3>
            <div className="gpa-result-item">
              <span className="gpa-result-label">{t.gpaTotalHours || 'Total Hours'}</span>
              <span className="gpa-result-value">{(prevHours + currentHours).toFixed(1)}</span>
            </div>
            <div className="gpa-result-item">
              <span className="gpa-result-label">{t.gpaTotalPoints || 'Total Quality Points'}</span>
              <span className="gpa-result-value">
                {(prevGpa * prevHours + currentQualityPoints).toFixed(2)}
              </span>
            </div>
            <div className="gpa-result-item gpa-result-highlight">
              <span className="gpa-result-label">{t.gpaNewCumulativeGpa || 'New Cumulative GPA'}</span>
              <span className="gpa-result-value gpa-result-big">
                {cumulativeGpa !== null ? cumulativeGpa.toFixed(2) : '—'}
              </span>
            </div>
          </div>
        </div>
        {currentHours === 0 && (
          <div className="gpa-warning">
            {t.gpaNoHoursWarning || 'Please add courses with credit hours to calculate GPA.'}
          </div>
        )}
      </div>

      {/* Advanced Modal */}
      {showAdvanced && (
        <div className="gpa-modal-overlay" onClick={() => setShowAdvanced(false)}>
          <div className="gpa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gpa-modal-header">
              <h2>{t.gpaAdvancedGradeMapping || 'Advanced Grade Mapping'}</h2>
              <button
                className="gpa-modal-close"
                onClick={() => setShowAdvanced(false)}
              >
                ×
              </button>
            </div>
            <div className="gpa-modal-content">
              <p className="gpa-modal-description">
                {t.gpaAdvancedDescription || 'Customize grade point values for the selected scale.'}
              </p>
              <div className="gpa-grade-map-grid">
                {gradeOptions.filter(g => g !== '').map((grade) => (
                  <div key={grade} className="gpa-grade-map-item">
                    <label>{grade}</label>
                    <input
                      type="number"
                      min="0"
                      max={scale}
                      step="0.01"
                      value={gradePointMap[grade]}
                      onChange={(e) =>
                        handleGradeMapChange(grade, parseFloat(e.target.value) || 0)
                      }
                      className="gpa-input"
                    />
                  </div>
                ))}
              </div>
              <div className="gpa-modal-actions">
                <button
                  className="gpa-btn gpa-btn-secondary"
                  onClick={handleResetGradeMap}
                >
                  {t.gpaResetToDefaults || 'Reset to Defaults'}
                </button>
                <button
                  className="gpa-btn gpa-btn-primary"
                  onClick={() => setShowAdvanced(false)}
                >
                  {t.gpaClose || 'Close'}
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

