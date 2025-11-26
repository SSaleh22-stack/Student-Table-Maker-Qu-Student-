import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageToggle from './LanguageToggle';
import './NavBar.css';

interface NavBarProps {
  onShowReviewHelper: () => void;
}

const NavBar: React.FC<NavBarProps> = ({ onShowReviewHelper }) => {
  const { t } = useLanguage();

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand">
          <span className="navbar-title">{t.appTitle}</span>
        </div>
        <div className="navbar-menu">
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
  );
};

export default NavBar;

