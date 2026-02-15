import React from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../contexts/LanguageContext';
import './ReviewHelperModal.css';

interface ReviewHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ReviewHelperModal: React.FC<ReviewHelperModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();

  if (!isOpen) return null;

  const handleOpenReviewPage = () => {
    window.open('https://stu-gate.qu.edu.sa/', '_blank');
  };

  const modalContent = (
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
  );

  return createPortal(modalContent, document.body);
};

export default ReviewHelperModal;
