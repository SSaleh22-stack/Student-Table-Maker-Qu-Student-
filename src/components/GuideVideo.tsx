import React, { useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Icon from './Icon';
import './GuideVideo.css';

/**
 * The "how to use" video on YouTube. Paste the video id here once it is uploaded:
 * the part after "watch?v=", "youtu.be/" or "/shorts/", e.g. "EIm0nSZxu2I".
 * Leave it empty to show "coming soon".
 */
export const GUIDE_VIDEO_ID = 'wIRluKLm79w';
/** Width / height of the video: 16 / 9 for a normal video, 9 / 16 for a Short. */
const GUIDE_VIDEO_RATIO = 16 / 9;

/**
 * Extension pages send no referrer, and YouTube refuses embeds without one (error 153).
 * So the player is a small page on our website (web-app/public/video.html) that embeds YouTube.
 */
const PLAYER_PAGE = 'https://qustudent.net/video.html';

/** The video, played inside the extension. */
export const GuideVideo: React.FC = () => {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  if (!GUIDE_VIDEO_ID) {
    return (
      <div className="qs-video-empty">
        <Icon name="play" size={28} />
        <strong>{isAr ? 'مقطع الشرح قادم قريباً' : 'The guide video is coming soon'}</strong>
        <span>
          {isAr
            ? 'نجهّز مقطعاً قصيراً يشرح استخراج المقررات وبناء الجدول والتصدير.'
            : 'A short video on extracting courses, building your timetable and exporting it.'}
        </span>
      </div>
    );
  }

  return (
    <div className="qs-video">
      {/* At most 70% of the window tall: a tall video gets narrower instead of letterboxed. */}
      <div
        className="qs-video-frame"
        style={{ aspectRatio: String(GUIDE_VIDEO_RATIO), width: `min(100%, calc(70vh * ${GUIDE_VIDEO_RATIO}))` }}
      >
        <iframe
          src={`${PLAYER_PAGE}?v=${encodeURIComponent(GUIDE_VIDEO_ID)}`}
          title={isAr ? 'شرح استخدام Qu Student' : 'How to use Qu Student'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <a
        className="qs-video-link"
        href={`https://www.youtube.com/watch?v=${encodeURIComponent(GUIDE_VIDEO_ID)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="externalLink" size={14} />
        {isAr ? 'فتح في YouTube' : 'Open on YouTube'}
      </a>
    </div>
  );
};

/** A window with just the video. */
export const GuideVideoModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { language, t } = useLanguage();
  const isAr = language === 'ar';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="qs-modal-overlay" onClick={onClose}>
      <div
        className="qs-modal qs-modal-video"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qs-video-title"
        onClick={(e) => e.stopPropagation()}
        dir={isAr ? 'rtl' : 'ltr'}
      >
        <div className="qs-modal-header">
          <h2 id="qs-video-title">{isAr ? 'شرح الاستخدام' : 'How to use Qu Student'}</h2>
          <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={onClose}>
            {t.close}
          </button>
        </div>
        <div className="qs-modal-body">
          <GuideVideo />
        </div>
      </div>
    </div>
  );
};
