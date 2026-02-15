import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './NavBar.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

interface NavBarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const NavBar: React.FC<NavBarProps> = ({ currentView, onViewChange }) => {
  const { t } = useLanguage();
  const [showReviewHelper, setShowReviewHelper] = useState(false);
  const [showContactUs, setShowContactUs] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleOpenReviewPage = () => {
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
              onClick={() => setShowReviewHelper(true)}
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
          </div>
        </div>
      </nav>

      {showReviewHelper && (
        <div className="review-helper-modal-overlay" onClick={() => setShowReviewHelper(false)}>
          <div className="review-helper-modal" onClick={(e) => e.stopPropagation()}>
            <div className="review-helper-modal-header">
              <h2 className="review-helper-modal-title">{t.courseReviewHelper}</h2>
              <button 
                className="review-helper-modal-close" 
                onClick={() => setShowReviewHelper(false)}
              >
                {t.close}
              </button>
            </div>
            <div className="review-helper-modal-body">
              <div className="review-helper-section-content">
                <div className="review-helper-intro">
                  <p className="review-helper-intro-text">
                    تساعدك هذه الأداة على ملء نماذج تقييم المقررات بسرعة في بوابة الطالب بجامعة القصيم. اختر خيار الاستجابة المفضل لديك وطبقه على جميع الأسئلة دفعة واحدة.
                  </p>
                </div>

                <div className="review-helper-instructions">
                  <h3 className="review-helper-instructions-title">
                    {t.reviewInstructions}
                  </h3>
                  <ol className="review-helper-steps">
                    <li>
                      انقر على "فتح صفحة تقييم جامعة القصيم" أدناه للانتقال إلى صفحة التقييم
                    </li>
                    <li>
                      بمجرد الوصول إلى صفحة التقييم، ستظهر لوحة عائمة في الزاوية اليمنى السفلى
                    </li>
                    <li>
                      اختر خيارك المفضل من القائمة المنسدلة:
                      <ul className="review-helper-options">
                        <li>
                          موافق بشدة / موافق
                        </li>
                        <li>
                          غير متأكد
                        </li>
                        <li>
                          غير موافق / غير موافق بشدة
                        </li>
                      </ul>
                    </li>
                    <li>
                      انقر على "ملء الكل" لملء جميع الأسئلة تلقائياً بالخيار المحدد
                    </li>
                    <li>
                      راجع اختياراتك وانقر على "تراجع" إذا كنت بحاجة إلى استعادة الإجابات السابقة
                    </li>
                    <li>
                      الأداة تملأ فقط أسئلة الأزرار الراديوية وتترك حقول النص كما هي
                    </li>
                  </ol>
                </div>

                <div className="review-helper-features">
                  <h3 className="review-helper-features-title">
                    {'المميزات'}
                  </h3>
                  <ul className="review-helper-features-list">
                    <li>
                      ✅ الكشف التلقائي عن أسئلة مقياس ليكرت
                    </li>
                    <li>
                      ✅ دعم جميع خيارات الاستجابة الخمسة (من موافق بشدة إلى غير موافق بشدة)
                    </li>
                    <li>
                      ✅ وظيفة التراجع لاستعادة الاختيارات السابقة
                    </li>
                    <li>
                      ✅ حوار تأكيد قبل تطبيق التغييرات
                    </li>
                    <li>
                      ✅ يعمل مع المحتوى المحمل ديناميكياً (دعم SPA)
                    </li>
                    <li>
                      ✅ واجهة عربية
                    </li>
                  </ul>
                </div>

                <div className="review-helper-action">
                  <button 
                    className="review-helper-action-btn"
                    onClick={handleOpenReviewPage}
                  >
                    <span className="review-helper-action-icon">🔗</span>
                    <span className="review-helper-action-text">{t.openQUReviewPage}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  تواصل معنا! نحن نحب أن نسمع منك. استخدم معلومات الاتصال أدناه للتواصل.
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

