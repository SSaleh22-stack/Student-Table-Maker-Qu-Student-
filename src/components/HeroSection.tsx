import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTimetable } from '../contexts/TimetableContext';
import Icon from './Icon';
import './HeroSection.css';

interface HeroSectionProps {
  hasCourses: boolean;
  onOpenOfferedCourses: () => void;
  onAddCourse: () => void;
}

const STUDENT_PORTAL_URL = 'https://stu-gate.qu.edu.sa/';

const HeroSection: React.FC<HeroSectionProps> = ({ hasCourses, onOpenOfferedCourses, onAddCourse }) => {
  const { t, language } = useLanguage();
  const { timetable } = useTimetable();
  const isAr = language === 'ar';

  // Same totals the timetable summary uses
  const stats = useMemo(() => {
    const uniqueCourses = new Set(timetable.map((entry) => entry.course.code)).size;
    const conflicts = timetable.filter((entry) => entry.isConflictSection).length;
    const courseHours = new Map<string, number>();
    timetable.forEach((entry) => {
      const code = entry.course.code;
      if (entry.course.hours && !courseHours.has(code)) {
        courseHours.set(code, parseFloat(entry.course.hours) || 0);
      }
    });
    const totalHours = Array.from(courseHours.values()).reduce((sum, hours) => sum + hours, 0);
    return { uniqueCourses, conflicts, totalHours };
  }, [timetable]);

  const openPortal = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: STUDENT_PORTAL_URL });
    } else {
      window.open(STUDENT_PORTAL_URL, '_blank', 'noopener');
    }
  };

  return (
    <section className="qs-hero qs-card">
      <div className="qs-hero-text">
        <h1 className="qs-hero-title">{isAr ? 'لنبنِ جدولك الأسبوعي' : "Let's build your week"}</h1>
        <p className="qs-hero-desc">
          {isAr
            ? 'افتح صفحة «المقررات المطروحة وفق الخطة» في بوابة الطالب واضغط زر الاستخراج بجانب اختيار الفصل. بعدها اختر شعبة لكل مقرر وستظهر مباشرة في جدولك.'
            : 'Open “Offered Courses According to Plan” on the student portal and press the extract button next to the semester picker. Then pick a section for each course and it appears on your timetable.'}
        </p>
        <div className="qs-hero-actions">
          {hasCourses ? (
            <button type="button" className="qs-btn qs-btn-primary qs-btn-lg" onClick={onOpenOfferedCourses}>
              <Icon name="list" size={20} />
              {t.offeredCourses}
            </button>
          ) : (
            <button type="button" className="qs-btn qs-btn-primary qs-btn-lg" onClick={openPortal}>
              <Icon name="externalLink" size={20} />
              {isAr ? 'فتح بوابة الطالب' : 'Open student portal'}
            </button>
          )}
          <button type="button" className="qs-btn qs-btn-soft qs-btn-lg" onClick={onAddCourse}>
            <Icon name="plus" size={20} />
            {isAr ? 'إضافة مقرر يدوياً' : 'Add course manually'}
          </button>
          {hasCourses ? (
            <button type="button" className="qs-btn qs-btn-text qs-btn-lg" onClick={openPortal}>
              <Icon name="externalLink" size={18} />
              {isAr ? 'بوابة الطالب' : 'Student portal'}
            </button>
          ) : (
            <button type="button" className="qs-btn qs-btn-text qs-btn-lg" onClick={onOpenOfferedCourses}>
              <Icon name="list" size={18} />
              {t.offeredCourses}
            </button>
          )}
        </div>
      </div>

      <div className="qs-hero-stats" aria-label={isAr ? 'ملخص الجدول' : 'Timetable summary'}>
        <div className="qs-stat qs-stat-blue">
          <span className="qs-stat-value">{stats.uniqueCourses}</span>
          <span className="qs-stat-label">{isAr ? 'مقررات مضافة' : 'courses added'}</span>
        </div>
        <div className="qs-stat qs-stat-orange">
          <span className="qs-stat-value">{stats.totalHours}</span>
          <span className="qs-stat-label">{isAr ? 'إجمالي الساعات' : 'credit hours'}</span>
        </div>
        <div className={`qs-stat ${stats.conflicts > 0 ? 'qs-stat-warn' : 'qs-stat-green'}`}>
          <span className="qs-stat-value">{stats.conflicts}</span>
          <span className="qs-stat-label">{isAr ? 'تعارضات' : 'clashes'}</span>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
