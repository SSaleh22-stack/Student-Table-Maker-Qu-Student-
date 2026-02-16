import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  AbsenceInput,
  calculateAbsence,
  validateAbsenceInput,
} from '../lib/absence';
import './AbsenceCalculator.css';

const AbsenceCalculator: React.FC = () => {
  const { t } = useLanguage();
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

  const getStatusColor = (warningLevel: string) => {
    switch (warningLevel) {
      case 'safe':
        return '#48bb78'; // Green
      case 'warning':
        return '#ed8936'; // Orange
      case 'danger':
        return '#e53e3e'; // Red
      case 'exceeded':
        return '#742a2a'; // Dark red
      default:
        return '#667eea';
    }
  };

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

  return (
    <div className="absence-calculator" dir="rtl">
      <div className="absence-header">
        <h1 className="absence-title">{t.absenceCalculator || 'Absence Calculator'}</h1>
      </div>

      {/* Input Card */}
      <div className="absence-card">
        <h2 className="absence-card-title">{'معلومات المقرر'}</h2>
        <div className="absence-input-grid">
          <div className="absence-input-item">
            <label>{t.absenceStudyWeeks || 'Study Weeks'}</label>
            <input
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
              className="absence-input"
            />
          </div>
          <div className="absence-input-item">
            <label>{t.absenceHoursPerWeek || 'Hours Per Week'}</label>
            <input
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
              className="absence-input"
            />
          </div>
          <div className="absence-input-item">
            <label>{t.absenceHoursAbsent || 'Hours Absent'}</label>
            <input
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
              className="absence-input"
            />
          </div>
          <div className="absence-input-item">
            <label>{t.absenceMaxPercent || 'Max Absence Percent'}</label>
            <select
              value={maxAbsencePercent}
              onChange={(e) => setMaxAbsencePercent(parseInt(e.target.value))}
              className="absence-select"
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
          <div className="absence-error">
            ⚠️ {validation.error}
          </div>
        )}
      </div>

      {/* Results Card */}
      {result && (
        <div className="absence-card">
          <h2 className="absence-card-title">{t.absenceResults || 'Results'}</h2>
          <div className="absence-results-grid">
            <div className="absence-result-item">
              <span className="absence-result-label">{t.absenceTotalHours || 'Total Hours'}</span>
              <span className="absence-result-value">{result.totalHours.toFixed(1)}</span>
            </div>
            <div className="absence-result-item">
              <span className="absence-result-label">{t.absencePercent || 'Absence Percent'}</span>
              <span 
                className="absence-result-value absence-result-percent"
                style={{ color: getStatusColor(result.warningLevel) }}
              >
                {result.absencePercent.toFixed(2)}%
              </span>
            </div>
            <div className="absence-result-item">
              <span className="absence-result-label">{t.absenceHoursRemaining || 'Hours Remaining'}</span>
              <span 
                className="absence-result-value"
                style={{ 
                  color: result.hoursRemaining > 0 ? '#48bb78' : '#e53e3e',
                  fontWeight: 700 
                }}
              >
                {result.hoursRemaining.toFixed(1)}
              </span>
            </div>
            <div className="absence-result-item absence-result-status">
              <span className="absence-result-label">{t.absenceStatus || 'Status'}</span>
              <span 
                className="absence-result-badge"
                style={{ 
                  backgroundColor: getStatusColor(result.warningLevel),
                  color: 'white'
                }}
              >
                {getStatusText(result.warningLevel)}
              </span>
            </div>
          </div>
          
          <div 
            className="absence-status-message"
            style={{ 
              backgroundColor: result.warningLevel === 'exceeded' ? '#fee' : 
                              result.warningLevel === 'danger' ? '#fff3cd' :
                              result.warningLevel === 'warning' ? '#fff8e1' : '#e6ffed',
              borderColor: getStatusColor(result.warningLevel),
              color: result.warningLevel === 'exceeded' ? '#742a2a' :
                     result.warningLevel === 'danger' ? '#856404' :
                     result.warningLevel === 'warning' ? '#f57c00' : '#22543d'
            }}
          >
            {result.canStillAttend ? (
              <div>
                <strong>✅ {t.absenceCanStillAttend || 'You can still attend'}</strong>
                <p>
                  {`لديك ${result.hoursRemaining.toFixed(1)} ساعة متبقية قبل الوصول إلى حد ${maxAbsencePercent}%.`}
                </p>
              </div>
            ) : (
              <div>
                <strong>❌ {t.absenceCannotAttend || 'You cannot attend (exceeded limit)'}</strong>
                <p>
                  {`لقد تجاوزت حد الغياب ${maxAbsencePercent}% بمقدار ${Math.abs(result.hoursRemaining).toFixed(1)} ساعة.`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AbsenceCalculator;

