import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageToggle from './LanguageToggle';
import './NavBar.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

interface NavBarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onShowReviewHelper: () => void;
}

const NavBar: React.FC<NavBarProps> = ({ currentView, onViewChange, onShowReviewHelper }) => {
  const { t } = useLanguage();

  return (
    <>
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <span className="navbar-title">{t.appTitle}</span>
          </div>
          <div className="navbar-menu">
            <button 
              className={`navbar-item ${currentView === 'timetable' ? 'active' : ''}`}
              onClick={() => onViewChange('timetable')}
            >
              <span className="navbar-icon">📅</span>
              <span className="navbar-text">{t.timetable}</span>
            </button>
            <button 
              className={`navbar-item ${currentView === 'gpa' ? 'active' : ''}`}
              onClick={() => onViewChange('gpa')}
            >
              <span className="navbar-icon">💯</span>
              <span className="navbar-text">{t.gpaCalculator}</span>
            </button>
            <button 
              className={`navbar-item ${currentView === 'absence' ? 'active' : ''}`}
              onClick={() => onViewChange('absence')}
            >
              <span className="navbar-icon">📊</span>
              <span className="navbar-text">{t.absenceCalculator}</span>
            </button>
            <button 
              className="navbar-item review-helper-nav-btn"
              onClick={onShowReviewHelper}
            >
              <span className="navbar-icon">📝</span>
              <span className="navbar-text">{t.courseReviewHelper}</span>
            </button>
            <LanguageToggle />
          </div>
        </div>
      </nav>
    </>
  );
};

export default NavBar;

