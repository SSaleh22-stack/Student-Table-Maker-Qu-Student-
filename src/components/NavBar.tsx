import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageToggle from './LanguageToggle';
import './NavBar.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

interface NavBarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const NavBar: React.FC<NavBarProps> = ({ currentView, onViewChange }) => {
  const { t, language } = useLanguage();
  const [showReviewHelper, setShowReviewHelper] = useState(false);

  const handleOpenReviewPage = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({
        url: 'https://stu-gate.qu.edu.sa/'
      });
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
            <LanguageToggle />
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
                    {language === 'en' 
                      ? 'This tool helps you quickly fill out course evaluation forms on the QU student portal. Select your preferred response option and apply it to all questions at once.'
                      : 'تساعدك هذه الأداة على ملء نماذج تقييم المقررات بسرعة في بوابة الطالب بجامعة القصيم. اختر خيار الاستجابة المفضل لديك وطبقه على جميع الأسئلة دفعة واحدة.'
                    }
                  </p>
                </div>

                <div className="review-helper-instructions">
                  <h3 className="review-helper-instructions-title">
                    {t.reviewInstructions}
                  </h3>
                  <ol className="review-helper-steps">
                    <li>
                      {language === 'en' 
                        ? 'Click "Open QU Review Page" below to navigate to the course evaluation page'
                        : 'انقر على "فتح صفحة تقييم جامعة القصيم" أدناه للانتقال إلى صفحة التقييم'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? 'Once on the evaluation page, a floating widget will appear in the bottom-right corner'
                        : 'بمجرد الوصول إلى صفحة التقييم، ستظهر لوحة عائمة في الزاوية اليمنى السفلى'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? 'Select your preferred choice from the dropdown menu:'
                        : 'اختر خيارك المفضل من القائمة المنسدلة:'
                      }
                      <ul className="review-helper-options">
                        <li>
                          {language === 'en' ? 'Strongly Agree' : 'موافق بشدة'} / {language === 'en' ? 'Agree' : 'موافق'}
                        </li>
                        <li>
                          {language === 'en' ? 'Unsure' : 'غير متأكد'}
                        </li>
                        <li>
                          {language === 'en' ? 'Disagree' : 'غير موافق'} / {language === 'en' ? 'Strongly Disagree' : 'غير موافق بشدة'}
                        </li>
                      </ul>
                    </li>
                    <li>
                      {language === 'en'
                        ? 'Click "Fill All" to automatically fill all questions with your selected choice'
                        : 'انقر على "ملء الكل" لملء جميع الأسئلة تلقائياً بالخيار المحدد'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? 'Review your selections and click "Undo" if you need to restore previous answers'
                        : 'راجع اختياراتك وانقر على "تراجع" إذا كنت بحاجة إلى استعادة الإجابات السابقة'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? 'The tool only fills radio button questions and leaves text fields untouched'
                        : 'الأداة تملأ فقط أسئلة الأزرار الراديوية وتترك حقول النص كما هي'
                      }
                    </li>
                  </ol>
                </div>

                <div className="review-helper-features">
                  <h3 className="review-helper-features-title">
                    {language === 'en' ? 'Features' : 'المميزات'}
                  </h3>
                  <ul className="review-helper-features-list">
                    <li>
                      {language === 'en'
                        ? '✅ Automatic detection of Likert scale questions'
                        : '✅ الكشف التلقائي عن أسئلة مقياس ليكرت'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? '✅ Support for all 5 response options (Strongly Agree to Strongly Disagree)'
                        : '✅ دعم جميع خيارات الاستجابة الخمسة (من موافق بشدة إلى غير موافق بشدة)'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? '✅ Undo functionality to restore previous selections'
                        : '✅ وظيفة التراجع لاستعادة الاختيارات السابقة'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? '✅ Confirmation dialog before applying changes'
                        : '✅ حوار تأكيد قبل تطبيق التغييرات'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? '✅ Works with dynamically loaded content (SPA support)'
                        : '✅ يعمل مع المحتوى المحمل ديناميكياً (دعم SPA)'
                      }
                    </li>
                    <li>
                      {language === 'en'
                        ? '✅ Bilingual interface (English/Arabic)'
                        : '✅ واجهة ثنائية اللغة (الإنجليزية/العربية)'
                      }
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
    </>
  );
};

export default NavBar;

