import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LoadingSpinner from './LoadingSpinner';
import './HeroSection.css';

interface HeroSectionProps {
  onExtractCourses?: () => void;
  isExtracting?: boolean;
}

const HeroSection: React.FC<HeroSectionProps> = ({ onExtractCourses, isExtracting = false }) => {
  const { t, language } = useLanguage();
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <>
      <section className="hero-section">
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <h1 className="hero-title">{t.appTitle}</h1>
          <p className="hero-subtitle">{t.appSubtitle}</p>
          <p className="hero-welcome">{t.welcome}</p>
          <div className="hero-buttons">
            <button 
              className="instructions-btn" 
              onClick={() => setShowInstructions(true)}
              title={language === 'en' ? 'View instructions' : 'عرض التعليمات'}
            >
              {t.instructions}
            </button>
          </div>
        </div>
      </section>
      
      {showInstructions && (
        <div className="instructions-modal-overlay" onClick={() => setShowInstructions(false)}>
          <div className="instructions-modal" onClick={(e) => e.stopPropagation()}>
            <div className="instructions-modal-header">
              <h2>{t.instructionsTitle}</h2>
              <button className="close-instructions-btn" onClick={() => setShowInstructions(false)}>
                {t.close}
              </button>
            </div>
            <div className="instructions-content">
              <pre>{t.instructionsContent}</pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HeroSection;

