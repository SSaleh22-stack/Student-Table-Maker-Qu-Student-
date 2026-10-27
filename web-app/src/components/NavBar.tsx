import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Icon, { IconName } from './Icon';
import Logo from './Logo';
import './NavBar.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

interface NavBarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const NavBar: React.FC<NavBarProps> = ({ currentView, onViewChange }) => {
  // The website is Arabic-only, so there is no language switch here
  const { t, language } = useLanguage();
  const [showReviewHelper, setShowReviewHelper] = useState(false);
  const [showContactUs, setShowContactUs] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const isAr = language === 'ar';

  const handleOpenReviewPage = () => {
    window.open('https://stu-gate.qu.edu.sa/', '_blank', 'noopener');
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

  // Instructions come either as titled sections (separated by blank lines)
  // or as a simple numbered list ("1. ...\n2. ..."): show each as one step
  const instructionSteps = t.instructionsContent.includes('\n\n\n')
    ? t.instructionsContent
        .split('\n\n\n')
        .map((section) => section.split('\n').filter((line) => line.trim()))
        .filter((lines) => lines.length > 0)
        .map((lines) => ({ title: lines[0], text: lines.slice(1).join('\n') }))
    : t.instructionsContent
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({ title: line.replace(/^\d+[.)]\s*/, ''), text: '' }));

  const viewItems: { view: ViewMode; icon: IconName; label: string; title: string }[] = [
    { view: 'timetable', icon: 'calendar', label: t.timetable, title: t.timetable },
    { view: 'gpa', icon: 'calculator', label: isAr ? 'المعدل' : 'GPA', title: t.gpaCalculator },
    { view: 'absence', icon: 'userMinus', label: isAr ? 'الغياب' : 'Absence', title: t.absenceCalculator },
  ];

  return (
    <>
      <header className="qs-header">
        <div className="qs-brand">
          <Logo size={44} className="qs-brand-mark" />
          <span className="qs-brand-name">{t.appTitle}</span>
        </div>

        <nav className="qs-nav" aria-label={isAr ? 'القائمة الرئيسية' : 'Main menu'}>
          {viewItems.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`qs-nav-item ${currentView === item.view ? 'active' : ''}`}
              aria-current={currentView === item.view ? 'page' : undefined}
              title={item.title}
              onClick={() => onViewChange(item.view)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="qs-nav-item"
            title={t.courseReviewHelper}
            onClick={() => setShowReviewHelper(true)}
          >
            <Icon name="clipboardCheck" />
            <span>{isAr ? 'تقييم المقررات' : 'Course reviews'}</span>
          </button>
          <button
            type="button"
            className="qs-nav-item"
            title={t.qeeemSite}
            onClick={() => window.open('https://qeeem.com/qu', '_blank', 'noopener')}
          >
            <Icon name="star" />
            <span>{isAr ? 'تقييم الدكاترة' : 'Instructor ratings'}</span>
          </button>
        </nav>

        <div className="qs-header-actions">
          <button
            type="button"
            className="qs-icon-btn"
            aria-label={t.instructions}
            title={t.instructions}
            onClick={() => setShowInstructions(true)}
          >
            <Icon name="help" size={20} />
          </button>
          <button
            type="button"
            className="qs-icon-btn"
            aria-label={t.contactUs}
            title={t.contactUs}
            onClick={() => setShowContactUs(true)}
          >
            <Icon name="mail" size={20} />
          </button>
        </div>
      </header>

      {showInstructions && (
        <div className="qs-modal-overlay" onClick={() => setShowInstructions(false)}>
          <div
            className="qs-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qs-instructions-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qs-modal-header">
              <h2 id="qs-instructions-title">{t.instructionsTitle}</h2>
              <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={() => setShowInstructions(false)}>
                {t.close}
              </button>
            </div>
            <div className="qs-modal-body">
              <ol className="qs-steps">
                {instructionSteps.map((step, index) => (
                  <li key={index} className="qs-step">
                    <span className="qs-step-title">{step.title}</span>
                    {step.text && <span className="qs-step-text">{step.text}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {showReviewHelper && (
        <div className="qs-modal-overlay" onClick={() => setShowReviewHelper(false)}>
          <div
            className="qs-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qs-review-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qs-modal-header">
              <h2 id="qs-review-title">{t.courseReviewHelper}</h2>
              <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={() => setShowReviewHelper(false)}>
                {t.close}
              </button>
            </div>
            <div className="qs-modal-body">
              <p className="qs-modal-intro">
                {language === 'en'
                  ? 'This tool helps you quickly fill out course evaluation forms on the QU student portal. Select your preferred response option and apply it to all questions at once.'
                  : 'تساعدك هذه الأداة على ملء نماذج تقييم المقررات بسرعة في بوابة الطالب بجامعة القصيم. اختر خيار الاستجابة المفضل لديك وطبقه على جميع الأسئلة دفعة واحدة.'}
              </p>

              <h3 className="qs-modal-subtitle">{t.reviewInstructions}</h3>
              <ol className="qs-numbered">
                <li>
                  {language === 'en'
                    ? 'Click "Open QU Review Page" below to navigate to the course evaluation page'
                    : 'انقر على "فتح صفحة تقييم جامعة القصيم" أدناه للانتقال إلى صفحة التقييم'}
                </li>
                <li>
                  {language === 'en'
                    ? 'Once on the evaluation page, a floating widget will appear in the bottom-right corner'
                    : 'بمجرد الوصول إلى صفحة التقييم، ستظهر لوحة عائمة في الزاوية اليمنى السفلى'}
                </li>
                <li>
                  {language === 'en'
                    ? 'Select your preferred choice from the dropdown menu:'
                    : 'اختر خيارك المفضل من القائمة المنسدلة:'}
                  <ul className="qs-options">
                    <li>
                      {language === 'en' ? 'Strongly Agree' : 'موافق بشدة'} / {language === 'en' ? 'Agree' : 'موافق'}
                    </li>
                    <li>{language === 'en' ? 'Unsure' : 'غير متأكد'}</li>
                    <li>
                      {language === 'en' ? 'Disagree' : 'غير موافق'} / {language === 'en' ? 'Strongly Disagree' : 'غير موافق بشدة'}
                    </li>
                  </ul>
                </li>
                <li>
                  {language === 'en'
                    ? 'Click "Fill All" to automatically fill all questions with your selected choice'
                    : 'انقر على "ملء الكل" لملء جميع الأسئلة تلقائياً بالخيار المحدد'}
                </li>
                <li>
                  {language === 'en'
                    ? 'Review your selections and click "Undo" if you need to restore previous answers'
                    : 'راجع اختياراتك وانقر على "تراجع" إذا كنت بحاجة إلى استعادة الإجابات السابقة'}
                </li>
                <li>
                  {language === 'en'
                    ? 'The tool only fills radio button questions and leaves text fields untouched'
                    : 'الأداة تملأ فقط أسئلة الأزرار الراديوية وتترك حقول النص كما هي'}
                </li>
              </ol>

              <h3 className="qs-modal-subtitle">{language === 'en' ? 'Features' : 'المميزات'}</h3>
              <ul className="qs-checklist">
                {(language === 'en'
                  ? [
                      'Automatic detection of Likert scale questions',
                      'Support for all 5 response options (Strongly Agree to Strongly Disagree)',
                      'Undo functionality to restore previous selections',
                      'Confirmation dialog before applying changes',
                      'Works with dynamically loaded content (SPA support)',
                      'Bilingual interface (English/Arabic)',
                    ]
                  : [
                      'الكشف التلقائي عن أسئلة مقياس ليكرت',
                      'دعم جميع خيارات الاستجابة الخمسة (من موافق بشدة إلى غير موافق بشدة)',
                      'وظيفة التراجع لاستعادة الاختيارات السابقة',
                      'حوار تأكيد قبل تطبيق التغييرات',
                      'يعمل مع المحتوى المحمل ديناميكياً (دعم SPA)',
                      'واجهة ثنائية اللغة (الإنجليزية/العربية)',
                    ]
                ).map((feature) => (
                  <li key={feature}>
                    <span className="qs-check-dot">
                      <Icon name="check" size={14} />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="qs-modal-actions">
                <button type="button" className="qs-btn qs-btn-primary qs-btn-lg" onClick={handleOpenReviewPage}>
                  <Icon name="externalLink" size={20} />
                  {t.openQUReviewPage}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showContactUs && (
        <div className="qs-modal-overlay" onClick={() => setShowContactUs(false)}>
          <div
            className="qs-modal qs-modal-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qs-contact-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qs-modal-header">
              <h2 id="qs-contact-title">{t.contactUs}</h2>
              <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={() => setShowContactUs(false)}>
                {t.close}
              </button>
            </div>
            <div className="qs-modal-body">
              <p className="qs-modal-intro">
                {language === 'en'
                  ? "Get in touch with us! We'd love to hear from you. Use the contact information below to reach out."
                  : 'تواصل معنا! نحن نحب أن نسمع منك. استخدم معلومات الاتصال أدناه للتواصل.'}
              </p>

              <div className="qs-contact-list">
                <div className="qs-contact-item">
                  <span className="qs-contact-icon">
                    <Icon name="mail" size={20} />
                  </span>
                  <div className="qs-contact-text">
                    <span className="qs-contact-label">{t.contactEmailLabel}</span>
                    <span className="qs-contact-value" dir="ltr">qu4611@gmail.com</span>
                  </div>
                  <button
                    type="button"
                    className={`qs-btn qs-btn-sm ${copiedField === 'email' ? 'qs-btn-soft' : 'qs-btn-outline'}`}
                    onClick={() => handleCopyToClipboard('qu4611@gmail.com', 'email')}
                  >
                    <Icon name={copiedField === 'email' ? 'check' : 'copy'} size={16} />
                    {copiedField === 'email' ? t.contactCopied : t.contactCopyEmail}
                  </button>
                </div>

                <div className="qs-contact-item">
                  <span className="qs-contact-icon">
                    <Icon name="send" size={20} />
                  </span>
                  <div className="qs-contact-text">
                    <span className="qs-contact-label">{t.contactTelegramLabel}</span>
                    <span className="qs-contact-value" dir="ltr">@qu4611</span>
                  </div>
                  <button
                    type="button"
                    className={`qs-btn qs-btn-sm ${copiedField === 'telegram' ? 'qs-btn-soft' : 'qs-btn-outline'}`}
                    onClick={() => handleCopyToClipboard('@qu4611', 'telegram')}
                  >
                    <Icon name={copiedField === 'telegram' ? 'check' : 'copy'} size={16} />
                    {copiedField === 'telegram' ? t.contactCopied : t.contactCopyTelegram}
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
