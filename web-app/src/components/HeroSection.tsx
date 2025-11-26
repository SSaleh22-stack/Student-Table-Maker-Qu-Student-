import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './HeroSection.css';

interface HeroSectionProps {
  onExtractCourses?: () => void;
}

const HeroSection: React.FC<HeroSectionProps> = ({ onExtractCourses }) => {
  const { t, language } = useLanguage();

  return (
    <section className="hero-section">
      <div className="hero-overlay"></div>
      <div className="hero-content">
        <h1 className="hero-title">{t.appTitle}</h1>
        <p className="hero-subtitle">{t.appSubtitle}</p>
        <p className="hero-welcome">{t.welcome}</p>
        {onExtractCourses && (
          <div className="hero-buttons">
            <button 
              className="extract-btn" 
              onClick={onExtractCourses}
            >
              {t.extractCourses}
            </button>
            <a 
              href="/bookmarklet.html" 
              className="extract-btn bookmarklet-link"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              📚 {language === 'en' ? 'Setup Bookmarklet (Auto-Extract)' : 'إعداد الإشارة المرجعية (استخراج تلقائي)'}
            </a>
          </div>
        )}
      </div>
    </section>
  );
};

export default HeroSection;

