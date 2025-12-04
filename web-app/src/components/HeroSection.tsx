import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LoadingSpinner from './LoadingSpinner';
import './HeroSection.css';

interface HeroSectionProps {
  onExtractCourses?: () => void;
  isExtracting?: boolean;
}

const HeroSection: React.FC<HeroSectionProps> = ({ onExtractCourses, isExtracting = false }) => {
  const { t, language } = useLanguage();

  return (
    <section className="hero-section">
      <div className="hero-overlay"></div>
      <div className="hero-content">
        <h1 className="hero-title">{t.appTitle}</h1>
        <p className="hero-subtitle">{t.appSubtitle}</p>
        <p className="hero-welcome">{t.welcome}</p>
        {isExtracting ? (
          <LoadingSpinner 
            size="large" 
            message={language === 'en' ? 'Extracting courses...' : 'جاري استخراج المقررات...'} 
          />
        ) : (
          <div className="hero-buttons">
            <a 
              href="./bookmarklet.html" 
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

