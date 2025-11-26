import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './ReviewHelperModal.css';

interface ReviewHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ReviewHelperModal: React.FC<ReviewHelperModalProps> = ({ isOpen, onClose }) => {
  const { t, language } = useLanguage();

  if (!isOpen) return null;

  const handleOpenReviewPage = () => {
    window.open('https://stu-gate.qu.edu.sa/', '_blank');
  };

  return (
    <div className="review-helper-modal-overlay" onClick={onClose}>
      <div className="review-helper-modal" onClick={(e) => e.stopPropagation()}>
        <div className="review-helper-modal-header">
          <h2 className="review-helper-modal-title">{t.courseReviewHelper}</h2>
          <button 
            className="review-helper-modal-close" 
            onClick={onClose}
          >
            {t.close}
          </button>
        </div>
        <div className="review-helper-modal-body">
          <div className="review-helper-section-content">
            <div className="review-helper-intro">
              <p className="review-helper-intro-text">
                {language === 'en' 
                  ? 'This tool helps you quickly fill out course evaluation forms on the QU student portal. For iPad, you can use the Chrome extension on a desktop computer, or manually fill the forms.'
                  : 'تساعدك هذه الأداة على ملء نماذج تقييم المقررات بسرعة في بوابة الطالب بجامعة القصيم. للآيباد، يمكنك استخدام إضافة Chrome على جهاز كمبيوتر، أو ملء النماذج يدوياً.'
                }
              </p>
            </div>

            <div className="review-helper-instructions">
              <h3 className="review-helper-instructions-title">
                {language === 'en' ? 'Instructions' : 'تعليمات'}
              </h3>
              <ol className="review-helper-steps">
                <li>
                  {language === 'en' 
                    ? 'On desktop: Install the Chrome extension for automatic filling'
                    : 'على سطح المكتب: قم بتثبيت إضافة Chrome للملء التلقائي'
                  }
                </li>
                <li>
                  {language === 'en'
                    ? 'On iPad: Use Safari to access the QU review page and fill manually, or use the extension on a desktop computer'
                    : 'على الآيباد: استخدم Safari للوصول إلى صفحة التقييم واملأ يدوياً، أو استخدم الإضافة على جهاز كمبيوتر'
                  }
                </li>
                <li>
                  {language === 'en'
                    ? 'The extension works best on desktop Chrome browsers'
                    : 'تعمل الإضافة بشكل أفضل على متصفحات Chrome على سطح المكتب'
                  }
                </li>
              </ol>
            </div>

            <div className="review-helper-action">
              <button 
                className="review-helper-action-btn"
                onClick={handleOpenReviewPage}
              >
                <span className="review-helper-action-icon">🔗</span>
                <span className="review-helper-action-text">
                  {language === 'en' ? 'Open QU Review Page' : 'فتح صفحة تقييم جامعة القصيم'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewHelperModal;

