import React, { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Icon, { IconName } from './Icon';
import './Announcements.css';

const TELEGRAM_URL = 'https://t.me/qu4611';
const EMAIL = 'qu4611@gmail.com';

interface Slide {
  id: string;
  icon: IconName;
  title: string;
  text: string;
  /** Small green tag next to the text */
  tag?: string;
  /** Show the Telegram and email buttons */
  contact?: boolean;
}

/** Time each announcement stays before moving to the next. */
const SLIDE_MS = 5000;

/**
 * "إعلانات": announcements that move to the next one by themselves (same as the mobile app).
 * Add or edit slides in `slides` below.
 */
const Announcements: React.FC = () => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [index, setIndex] = useState(0);
  // Stops moving while the mouse or keyboard is on it, so the buttons can be clicked.
  const [paused, setPaused] = useState(false);

  const slides: Slide[] = [
    {
      id: 'universities',
      icon: 'university',
      title: isAr ? 'الجامعات المدعومة' : 'Supported universities',
      text: isAr ? 'جامعة القصيم' : 'Qassim University',
      tag: isAr ? 'مدعومة' : 'Supported',
    },
    {
      id: 'add-university',
      icon: 'send',
      title: isAr ? 'أضف جامعتك أو كليتك' : 'Add your university or college',
      text: isAr
        ? 'تريد إضافة جامعتك أو كليتك إلى Qu Student؟ تواصل معنا عبر تيليجرام أو البريد.'
        : 'Want your university or college in Qu Student? Message us on Telegram or by email.',
      contact: true,
    },
  ];

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [index, paused, slides.length]);

  return (
    <section
      className="qs-news"
      aria-label={isAr ? 'إعلانات' : 'Announcements'}
      dir={isAr ? 'rtl' : 'ltr'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="qs-news-head">
        <Icon name="bell" size={16} />
        <span className="qs-news-label">{isAr ? 'إعلانات' : 'Announcements'}</span>
        <div className="qs-news-dots">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`qs-news-dot ${i === index ? 'on' : ''}`}
              aria-label={isAr ? `الإعلان ${i + 1} من ${slides.length}` : `Announcement ${i + 1} of ${slides.length}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      </div>

      {/* Every slide sits in the same spot; only the current one shows. The card keeps the
          tallest slide's height, so the page doesn't jump when they change. */}
      <div className="qs-news-stage" aria-live="polite">
        {slides.map((s, i) => (
          <div
            key={s.id}
            className={`qs-news-slide ${i === index ? 'on' : ''}`}
            aria-hidden={i === index ? undefined : true}
            {...(i === index ? {} : { inert: '' })}
          >
            <span className="qs-news-icon" aria-hidden="true">
              <Icon name={s.icon} size={24} />
            </span>
            <div className="qs-news-body">
              <strong className="qs-news-title">{s.title}</strong>
              <p className="qs-news-text">
                {s.text}
                {s.tag && (
                  <span className="qs-news-tag">
                    <Icon name="check" size={12} />
                    {s.tag}
                  </span>
                )}
              </p>
            </div>
            {s.contact && (
              <div className="qs-news-actions">
                <a className="qs-news-btn" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                  <Icon name="send" size={16} />
                  {isAr ? 'تيليجرام' : 'Telegram'}
                  <span className="qs-news-handle" dir="ltr">@qu4611</span>
                </a>
                <a className="qs-news-btn" href={`mailto:${EMAIL}`}>
                  <Icon name="mail" size={16} />
                  {isAr ? 'البريد' : 'Email'}
                  <span className="qs-news-handle" dir="ltr">{EMAIL}</span>
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default Announcements;
