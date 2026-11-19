import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './AppPromo.css';

const APP_STORE_URL = 'https://apps.apple.com/app/id6835769939';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=net.qustudent.app';
/** Remembers that the student closed the card, so it stays closed on this browser. */
const HIDDEN_KEY = 'qu-student:app-promo-hidden';

const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
};

const AppleLogo = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
    <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.9-3.75 2.27-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.96-.74 1.39 0 1.78.74 2.99.72 1.24-.02 2.02-1.12 2.77-2.23.88-1.28 1.24-2.52 1.26-2.59-.03-.01-2.4-.92-2.42-3.65ZM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.09 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28Z" />
  </svg>
);

const PlayLogo = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M4.2 2.6 13.6 12l-9.4 9.4c-.33-.18-.55-.53-.55-.95V3.55c0-.42.22-.77.55-.95Z" fill="#34A853" />
    <path d="m16.7 8.9-3.1 3.1L4.2 2.6c.13-.07.28-.1.43-.1.18 0 .36.05.52.14L16.7 8.9Z" fill="#FBBC04" />
    <path d="m16.7 15.1-11.55 6.26c-.16.09-.34.14-.52.14-.15 0-.3-.03-.43-.1l9.4-9.4 3.1 3.1Z" fill="#EA4335" />
    <path d="M20.2 12c0 .4-.21.77-.56.96l-2.94 1.6L13.6 12l3.1-3.1 2.94 1.6c.35.19.56.56.56.96Z" fill="#4285F4" />
  </svg>
);

/** "The app is now on the App Store and Google Play" card, with a link to each store. */
const AppPromo: React.FC = () => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [hidden, setHidden] = useState(readHidden);

  if (hidden) return null;

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      // Private mode: it just shows again next time
    }
  };

  return (
    <section className="qs-promo" aria-label={isAr ? 'تطبيق الجوال' : 'Mobile app'}>
      <div className="qs-promo-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="2.5" width="12" height="19" rx="3" />
          <path d="M10.5 18.5h3" />
        </svg>
      </div>

      <div className="qs-promo-text">
        <span className="qs-promo-new">{isAr ? 'جديد' : 'New'}</span>
        <h2 className="qs-promo-title">
          {isAr ? 'تطبيق QU Student متوفر الآن على جوالك' : 'QU Student is now on your phone'}
        </h2>
        <p className="qs-promo-desc">
          {isAr
            ? 'جدولك والمعدل والغياب والتقويم الأكاديمي في تطبيق واحد. حمّله مجاناً وجرّبه.'
            : 'Your timetable, GPA, absences and academic calendar in one app. Download it free and try it.'}
        </p>
      </div>

      <div className="qs-promo-stores">
        <a className="qs-store" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
          <AppleLogo />
          <span className="qs-store-text">
            <small>{isAr ? 'حمّله من' : 'Download on the'}</small>
            <strong>App Store</strong>
          </span>
        </a>
        <a className="qs-store" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
          <PlayLogo />
          <span className="qs-store-text">
            <small>{isAr ? 'احصل عليه من' : 'Get it on'}</small>
            <strong>Google Play</strong>
          </span>
        </a>
      </div>

      <button type="button" className="qs-promo-close" onClick={close} aria-label={isAr ? 'إغلاق' : 'Close'}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </section>
  );
};

export default AppPromo;
