import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  AbsenceInput,
  calculateAbsence,
  validateAbsenceInput,
} from '../lib/absence';
import Icon from './Icon';
import './AbsenceCalculator.css';

const AbsenceCalculator: React.FC = () => {
  const { language, t } = useLanguage();
  const [studyWeeks, setStudyWeeks] = useState<number>(15);
  const [hoursPerWeek, setHoursPerWeek] = useState<number>(3);
  const [hoursAbsent, setHoursAbsent] = useState<number>(0);
  const [maxAbsencePercent, setMaxAbsencePercent] = useState<number>(25);

  // Load saved data on mount
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.sync.get(
            [
              'absenceStudyWeeks',
              'absenceHoursPerWeek',
              'absenceHoursAbsent',
              'absenceMaxPercent',
            ],
            (result) => {
              if (result.absenceStudyWeeks) setStudyWeeks(result.absenceStudyWeeks);
              if (result.absenceHoursPerWeek) setHoursPerWeek(result.absenceHoursPerWeek);
              if (result.absenceHoursAbsent !== undefined) setHoursAbsent(result.absenceHoursAbsent);
              if (result.absenceMaxPercent) setMaxAbsencePercent(result.absenceMaxPercent);
            }
          );
        } else {
          // Webapp: Load from localStorage
          const savedStudyWeeks = localStorage.getItem('absenceStudyWeeks');
          const savedHoursPerWeek = localStorage.getItem('absenceHoursPerWeek');
          const savedHoursAbsent = localStorage.getItem('absenceHoursAbsent');
          const savedMaxPercent = localStorage.getItem('absenceMaxPercent');

          if (savedStudyWeeks) setStudyWeeks(parseInt(savedStudyWeeks));
          if (savedHoursPerWeek) setHoursPerWeek(parseInt(savedHoursPerWeek));
          if (savedHoursAbsent) setHoursAbsent(parseInt(savedHoursAbsent));
          if (savedMaxPercent) setMaxAbsencePercent(parseInt(savedMaxPercent));
        }
      } catch (error) {
        console.error('Error loading saved absence data:', error);
      }
    };

    loadSavedData();
  }, []);

  // Save data when it changes
  useEffect(() => {
    const saveData = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.sync.set({
            absenceStudyWeeks: studyWeeks,
            absenceHoursPerWeek: hoursPerWeek,
            absenceHoursAbsent: hoursAbsent,
            absenceMaxPercent: maxAbsencePercent,
          });
        } else {
          localStorage.setItem('absenceStudyWeeks', studyWeeks.toString());
          localStorage.setItem('absenceHoursPerWeek', hoursPerWeek.toString());
          localStorage.setItem('absenceHoursAbsent', hoursAbsent.toString());
          localStorage.setItem('absenceMaxPercent', maxAbsencePercent.toString());
        }
      } catch (error) {
        console.error('Error saving absence data:', error);
      }
    };

    saveData();
  }, [studyWeeks, hoursPerWeek, hoursAbsent, maxAbsencePercent]);

  // Calculate results
  const input: AbsenceInput = useMemo(
    () => ({
      studyWeeks,
      hoursPerWeek,
      hoursAbsent,
      maxAbsencePercent,
    }),
    [studyWeeks, hoursPerWeek, hoursAbsent, maxAbsencePercent]
  );

  const validation = useMemo(() => validateAbsenceInput(input), [input]);
  const result = useMemo(() => {
    if (!validation.valid) {
      return null;
    }
    return calculateAbsence(input);
  }, [input, validation.valid]);

  const getStatusText = (warningLevel: string) => {
    switch (warningLevel) {
      case 'safe':
        return t.absenceSafe || 'Safe';
      case 'warning':
        return t.absenceWarning || 'Warning';
      case 'danger':
        return t.absenceDanger || 'Danger';
      case 'exceeded':
        return t.absenceExceeded || 'Exceeded';
      default:
        return '';
    }
  };

  const isAr = language === 'ar';
  // How much of the allowed absence is used (0–100%)
  const usedOfLimit = result
    ? Math.min(100, Math.max(0, (result.absencePercent / maxAbsencePercent) * 100))
    : 0;

  return (
    <div className="absence-calculator" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="absence-header">
        <h1 className="absence-title">{t.absenceCalculator || 'Absence Calculator'}</h1>
        <p className="absence-subtitle">
          {isAr
            ? 'اعرف نسبة غيابك وكم ساعة تبقّى لك قبل الوصول إلى الحد المسموح.'
            : 'See your absence percentage and how many hours you have left before the limit.'}
        </p>
      </div>

      {/* Input Card */}
      <div className="absence-card">
        <h2 className="absence-card-title">{isAr ? 'معلومات المقرر' : 'Course Information'}</h2>
        <div className="absence-input-grid">
          <div className="qs-field">
            <label className="qs-label" htmlFor="abs-weeks">{t.absenceStudyWeeks || 'Study Weeks'}</label>
            <input
              id="abs-weeks"
              type="number"
              min="1"
              max="20"
              value={studyWeeks}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 1;
                if (value > 0) {
                  setStudyWeeks(value);
                }
              }}
              className="qs-input"
            />
          </div>
          <div className="qs-field">
            <label className="qs-label" htmlFor="abs-hours-week">{t.absenceHoursPerWeek || 'Hours Per Week'}</label>
            <input
              id="abs-hours-week"
              type="number"
              min="1"
              max="20"
              step="0.5"
              value={hoursPerWeek}
              onChange={(e) => {
                const value = parseFloat(e.target.value) || 1;
                if (value > 0) {
                  setHoursPerWeek(value);
                }
              }}
              className="qs-input"
            />
          </div>
          <div className="qs-field">
            <label className="qs-label" htmlFor="abs-absent">{t.absenceHoursAbsent || 'Hours Absent'}</label>
            <input
              id="abs-absent"
              type="number"
              min="0"
              step="0.5"
              value={hoursAbsent}
              onChange={(e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value >= 0) {
                  setHoursAbsent(value);
                }
              }}
              className="qs-input"
            />
          </div>
          <div className="qs-field">
            <label className="qs-label" htmlFor="abs-max">{t.absenceMaxPercent || 'Max Absence Percent'}</label>
            <select
              id="abs-max"
              value={maxAbsencePercent}
              onChange={(e) => setMaxAbsencePercent(parseInt(e.target.value))}
              className="qs-select"
            >
              {[15, 20, 25, 30, 35, 40, 45, 50].map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </select>
          </div>
        </div>
        {!validation.valid && validation.error && (
          <div className="qs-alert qs-alert-error absence-error" role="alert">
            <Icon name="alert" />
            <span>{validation.error}</span>
          </div>
        )}
      </div>

      {/* Results Card */}
      {result && (
        <div className="absence-card">
          <div className="absence-results-head">
            <h2 className="absence-card-title">{t.absenceResults || 'Results'}</h2>
            <span className={`absence-badge is-${result.warningLevel}`}>
              {getStatusText(result.warningLevel)}
            </span>
          </div>

          <div className="absence-meter" aria-hidden="true">
            <div className={`absence-meter-fill is-${result.warningLevel}`} style={{ width: `${usedOfLimit}%` }} />
          </div>
          <p className="absence-meter-text">
            {isAr
              ? `استخدمت ${usedOfLimit.toFixed(0)}% من الغياب المسموح (${maxAbsencePercent}%)`
              : `You have used ${usedOfLimit.toFixed(0)}% of the allowed absence (${maxAbsencePercent}%)`}
          </p>

          <div className="absence-results-grid">
            <div className="absence-stat">
              <span className="absence-stat-label">{t.absenceTotalHours || 'Total Hours'}</span>
              <span className="absence-stat-value">{result.totalHours.toFixed(1)}</span>
            </div>
            <div className={`absence-stat is-${result.warningLevel}`}>
              <span className="absence-stat-label">{t.absencePercent || 'Absence Percent'}</span>
              <span className="absence-stat-value">{result.absencePercent.toFixed(2)}%</span>
            </div>
            <div className={`absence-stat ${result.hoursRemaining > 0 ? 'is-safe' : 'is-exceeded'}`}>
              <span className="absence-stat-label">{t.absenceHoursRemaining || 'Hours Remaining'}</span>
              <span className="absence-stat-value">{result.hoursRemaining.toFixed(1)}</span>
            </div>
          </div>

          <div className={`absence-status-message is-${result.warningLevel}`} role="status">
            <span className="absence-status-icon">
              <Icon name={result.canStillAttend ? 'check' : 'x'} size={18} />
            </span>
            <div>
              <strong>
                {result.canStillAttend
                  ? (t.absenceCanStillAttend || 'You can still attend')
                  : (t.absenceCannotAttend || 'You cannot attend (exceeded limit)')}
              </strong>
              <p>
                {result.canStillAttend
                  ? (isAr
                      ? `لديك ${result.hoursRemaining.toFixed(1)} ساعة متبقية قبل الوصول إلى حد ${maxAbsencePercent}%.`
                      : `You have ${result.hoursRemaining.toFixed(1)} hours remaining before reaching the ${maxAbsencePercent}% limit.`)
                  : (isAr
                      ? `لقد تجاوزت حد الغياب ${maxAbsencePercent}% بمقدار ${Math.abs(result.hoursRemaining).toFixed(1)} ساعة.`
                      : `You have exceeded the ${maxAbsencePercent}% absence limit by ${Math.abs(result.hoursRemaining).toFixed(1)} hours.`)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AbsenceCalculator;
