import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageToggle from './LanguageToggle';
import './NavBar.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

interface NavBarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onShowReviewHelper: () => void;
  isPhone?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({ currentView, onViewChange, onShowReviewHelper, isPhone = false }) => {
  const { t, language } = useLanguage();
  const [showContactUs, setShowContactUs] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleOpenReviewPage = () => {
    // For webapp, open in same window instead of new tab
    window.open('https://stu-gate.qu.edu.sa/', '_blank');
  };

  const handleCopyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <span className="navbar-title">{t.appTitle}</span>
          </div>
          <div className="navbar-menu">
            {!isPhone && (
              <button 
                className={`navbar-item ${currentView === 'timetable' ? 'active' : ''}`}
                onClick={() => onViewChange('timetable')}
              >
                <span className="navbar-icon">📅</span>
                <span className="navbar-text">{t.timetable}</span>
              </button>
            )}
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
            <button 
              className="navbar-item contact-us-nav-btn"
              onClick={() => setShowContactUs(true)}
            >
              <span className="navbar-icon">📧</span>
              <span className="navbar-text">{t.contactUs}</span>
            </button>
            <LanguageToggle />
          </div>
        </div>
      </nav>

      {showContactUs && (
        <div className="contact-us-modal-overlay" onClick={() => setShowContactUs(false)}>
          <div className="contact-us-modal" onClick={(e) => e.stopPropagation()}>
            <div className="contact-us-modal-header">
              <h2 className="contact-us-modal-title">{t.contactUs}</h2>
              <button 
                className="contact-us-modal-close" 
                onClick={() => setShowContactUs(false)}
              >
                {t.close}
              </button>
            </div>
            <div className="contact-us-modal-body">
              <div className="contact-us-intro">
                <p className="contact-us-intro-text">
                  {language === 'en' 
                    ? 'Get in touch with us! We\'d love to hear from you. Use the contact information below to reach out.'
                    : 'تواصل معنا! نحن نحب أن نسمع منك. استخدم معلومات الاتصال أدناه للتواصل.'
                  }
                </p>
              </div>

              <div className="contact-us-info">
                <div className="contact-us-item">
                  <div className="contact-us-item-header">
                    <span className="contact-us-item-icon">📧</span>
                    <h3 className="contact-us-item-title">{t.contactEmailLabel}</h3>
                  </div>
                  <div className="contact-us-item-content">
                    <div className="contact-us-item-value">qu4611@gmail.com</div>
                    <button 
                      className="contact-us-copy-btn"
                      onClick={() => handleCopyToClipboard('qu4611@gmail.com', 'email')}
                    >
                      {copiedField === 'email' ? '✓ ' + t.contactCopied : t.contactCopyEmail}
                    </button>
                  </div>
                </div>

                <div className="contact-us-item">
                  <div className="contact-us-item-header">
                    <span className="contact-us-item-icon">✈️</span>
                    <h3 className="contact-us-item-title">{t.contactTelegramLabel}</h3>
                  </div>
                  <div className="contact-us-item-content">
                    <div className="contact-us-item-value">@qu4611</div>
                    <button 
                      className="contact-us-copy-btn"
                      onClick={() => handleCopyToClipboard('@qu4611', 'telegram')}
                    >
                      {copiedField === 'telegram' ? '✓ ' + t.contactCopied : t.contactCopyTelegram}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default NavBar;

