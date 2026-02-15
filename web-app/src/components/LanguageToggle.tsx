import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './LanguageToggle.css';

const LanguageToggle: React.FC = () => {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="language-toggle">
      <button
        className={`lang-btn ${''}`}
        onClick={() => setLanguage('en')}
      >
        EN
      </button>
      <span className="lang-separator">|</span>
      <button
        className={`lang-btn ${language === 'ar' ? 'active' : ''}`}
        onClick={() => setLanguage('ar')}
      >
        AR
      </button>
    </div>
  );
};

export default LanguageToggle;

