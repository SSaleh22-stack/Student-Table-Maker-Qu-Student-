import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Course } from '../types';
import Icon from './Icon';
import './AddCourseModal.css';

interface AddCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (course: Course) => void;
}

const AddCourseModal: React.FC<AddCourseModalProps> = ({ isOpen, onClose, onAdd }) => {
  const { t, language } = useLanguage();
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    section: '',
    days: [] as string[],
    startTime: '',
    endTime: '',
    location: '',
    instructor: '',
    examPeriod: '',
    status: 'open' as 'open' | 'closed',
    classType: 'theoretical' as 'practical' | 'theoretical' | 'exercise',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const daysOptions = [
    { value: 'Sun', label: t.sunday },
    { value: 'Mon', label: t.monday },
    { value: 'Tue', label: t.tuesday },
    { value: 'Wed', label: t.wednesday },
    { value: 'Thu', label: t.thursday },
  ];

  const handleDayToggle = (day: string) => {
    setFormData((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day],
    }));
    // Clear day error if any
    if (errors.days) {
      setErrors((prev) => ({ ...prev, days: '' }));
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.code.trim()) {
      newErrors.code = language === 'en' ? 'Course code is required' : 'رمز المقرر مطلوب';
    }

    if (!formData.name.trim()) {
      newErrors.name = language === 'en' ? 'Course name is required' : 'اسم المقرر مطلوب';
    }

    if (!formData.section.trim()) {
      newErrors.section = language === 'en' ? 'Section is required' : 'الشعبة مطلوبة';
    }

    if (formData.days.length === 0) {
      newErrors.days = language === 'en' ? 'At least one day is required' : 'يجب اختيار يوم واحد على الأقل';
    }

    if (!formData.startTime) {
      newErrors.startTime = language === 'en' ? 'Start time is required' : 'وقت البداية مطلوب';
    }

    if (!formData.endTime) {
      newErrors.endTime = language === 'en' ? 'End time is required' : 'وقت النهاية مطلوب';
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (formData.startTime && !timeRegex.test(formData.startTime)) {
      newErrors.startTime = language === 'en' ? 'Invalid time format (use HH:MM)' : 'تنسيق الوقت غير صحيح (استخدم HH:MM)';
    }
    if (formData.endTime && !timeRegex.test(formData.endTime)) {
      newErrors.endTime = language === 'en' ? 'Invalid time format (use HH:MM)' : 'تنسيق الوقت غير صحيح (استخدم HH:MM)';
    }

    // Validate end time is after start time
    if (formData.startTime && formData.endTime && timeRegex.test(formData.startTime) && timeRegex.test(formData.endTime)) {
      const [startH, startM] = formData.startTime.split(':').map(Number);
      const [endH, endM] = formData.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      if (endMinutes <= startMinutes) {
        newErrors.endTime = language === 'en' ? 'End time must be after start time' : 'وقت النهاية يجب أن يكون بعد وقت البداية';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Create course object
    const course: Course = {
      id: `${formData.code}-${formData.section}-${Date.now()}`,
      code: formData.code.trim(),
      name: formData.name.trim(),
      section: formData.section.trim(),
      days: formData.days,
      startTime: formData.startTime,
      endTime: formData.endTime,
      location: formData.location.trim() || undefined,
      instructor: formData.instructor.trim() || undefined,
      // Only the exam period is known; don't invent a day or time
      finalExam: formData.examPeriod
        ? { day: '', startTime: '', endTime: '', date: formData.examPeriod }
        : undefined,
      status: formData.status,
      classType: formData.classType,
    };

    onAdd(course);
    handleClose();
  };

  const handleClose = () => {
    setFormData({
      code: '',
      name: '',
      section: '',
      days: [],
      startTime: '',
      endTime: '',
      location: '',
      instructor: '',
      examPeriod: '',
      status: 'open',
      classType: 'theoretical',
    });
    setErrors({});
    onClose();
  };

  if (!isOpen) return null;

  const isAr = language === 'ar';
  const req = <span className="qs-required" aria-hidden="true">*</span>;

  return (
    <div className="qs-modal-overlay" onClick={handleClose}>
      <div
        className="qs-modal ac-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ac-title"
        dir={isAr ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qs-modal-header">
          <div className="ac-title-wrap">
            <span className="ac-title-icon">
              <Icon name="plus" size={22} />
            </span>
            <div>
              <h2 id="ac-title">{isAr ? 'إضافة مقرر يدوياً' : 'Add course manually'}</h2>
              <p className="ac-subtitle">
                {isAr ? 'الحقول المعلّمة بـ * مطلوبة' : 'Fields marked * are required'}
              </p>
            </div>
          </div>
          <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={handleClose}>
            {t.close}
          </button>
        </div>

        <form className="ac-form" onSubmit={handleSubmit} noValidate>
          <div className="ac-body">
            <fieldset className="ac-section">
              <legend className="ac-section-title">{isAr ? 'بيانات المقرر' : 'Course details'}</legend>
              <div className="ac-grid ac-grid-3">
                <div className="qs-field">
                  <label className="qs-label" htmlFor="code">{t.courseCode} {req}</label>
                  <input
                    type="text"
                    id="code"
                    dir="ltr"
                    value={formData.code}
                    onChange={(e) => handleChange('code', e.target.value)}
                    className={`qs-input ${errors.code ? 'is-error' : ''}`}
                    aria-invalid={!!errors.code}
                    placeholder={isAr ? 'مثال: CS101' : 'e.g., CS101'}
                  />
                  {errors.code && <span className="qs-field-error">{errors.code}</span>}
                </div>
                <div className="qs-field ac-span-2">
                  <label className="qs-label" htmlFor="name">{t.courseName} {req}</label>
                  <input
                    type="text"
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className={`qs-input ${errors.name ? 'is-error' : ''}`}
                    aria-invalid={!!errors.name}
                    placeholder={isAr ? 'اسم المقرر' : 'Course name'}
                  />
                  {errors.name && <span className="qs-field-error">{errors.name}</span>}
                </div>
                <div className="qs-field">
                  <label className="qs-label" htmlFor="section">{t.section} {req}</label>
                  <input
                    type="text"
                    id="section"
                    dir="ltr"
                    value={formData.section}
                    onChange={(e) => handleChange('section', e.target.value)}
                    className={`qs-input ${errors.section ? 'is-error' : ''}`}
                    aria-invalid={!!errors.section}
                    placeholder={isAr ? 'مثال: 01' : 'e.g., 01'}
                  />
                  {errors.section && <span className="qs-field-error">{errors.section}</span>}
                </div>
                <div className="qs-field">
                  <label className="qs-label" htmlFor="status">{t.status}</label>
                  <select
                    id="status"
                    className="qs-select"
                    value={formData.status}
                    onChange={(e) => handleChange('status', e.target.value)}
                  >
                    <option value="open">{t.open}</option>
                    <option value="closed">{t.closed}</option>
                  </select>
                </div>
                <div className="qs-field">
                  <label className="qs-label" htmlFor="classType">{t.classType}</label>
                  <select
                    id="classType"
                    className="qs-select"
                    value={formData.classType}
                    onChange={(e) => handleChange('classType', e.target.value)}
                  >
                    <option value="theoretical">{t.theoretical}</option>
                    <option value="practical">{t.practical}</option>
                    <option value="exercise">{t.exercise}</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset className="ac-section">
              <legend className="ac-section-title">{isAr ? 'الموعد' : 'Schedule'}</legend>
              <div className="qs-field">
                <span className="qs-label" id="ac-days-label">{t.days} {req}</span>
                <div className="ac-days" role="group" aria-labelledby="ac-days-label">
                  {daysOptions.map((day) => {
                    const checked = formData.days.includes(day.value);
                    return (
                      <label key={day.value} className={`ac-day ${checked ? 'is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleDayToggle(day.value)}
                        />
                        {checked && <Icon name="check" size={14} />}
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.days && <span className="qs-field-error">{errors.days}</span>}
              </div>
              <div className="ac-grid ac-grid-2">
                <div className="qs-field">
                  <label className="qs-label" htmlFor="startTime">{isAr ? 'وقت البداية' : 'Start time'} {req}</label>
                  <input
                    type="time"
                    id="startTime"
                    value={formData.startTime}
                    onChange={(e) => handleChange('startTime', e.target.value)}
                    className={`qs-input ${errors.startTime ? 'is-error' : ''}`}
                    aria-invalid={!!errors.startTime}
                  />
                  {errors.startTime && <span className="qs-field-error">{errors.startTime}</span>}
                </div>
                <div className="qs-field">
                  <label className="qs-label" htmlFor="endTime">{isAr ? 'وقت النهاية' : 'End time'} {req}</label>
                  <input
                    type="time"
                    id="endTime"
                    value={formData.endTime}
                    onChange={(e) => handleChange('endTime', e.target.value)}
                    className={`qs-input ${errors.endTime ? 'is-error' : ''}`}
                    aria-invalid={!!errors.endTime}
                  />
                  {errors.endTime && <span className="qs-field-error">{errors.endTime}</span>}
                </div>
              </div>
            </fieldset>

            <fieldset className="ac-section">
              <legend className="ac-section-title">{isAr ? 'معلومات إضافية (اختياري)' : 'More details (optional)'}</legend>
              <div className="ac-grid ac-grid-3">
                <div className="qs-field">
                  <label className="qs-label" htmlFor="location">{t.location}</label>
                  <input
                    type="text"
                    id="location"
                    className="qs-input"
                    value={formData.location}
                    onChange={(e) => handleChange('location', e.target.value)}
                    placeholder={isAr ? 'مثال: مبنى 5، قاعة 201' : 'e.g., Building 5, Room 201'}
                  />
                </div>
                <div className="qs-field">
                  <label className="qs-label" htmlFor="instructor">{t.instructor}</label>
                  <input
                    type="text"
                    id="instructor"
                    className="qs-input"
                    value={formData.instructor}
                    onChange={(e) => handleChange('instructor', e.target.value)}
                    placeholder={isAr ? 'اسم المحاضر' : 'Instructor name'}
                  />
                </div>
                <div className="qs-field">
                  <label className="qs-label" htmlFor="examPeriod">{isAr ? 'فترة الامتحان' : 'Exam period'}</label>
                  <input
                    type="text"
                    id="examPeriod"
                    className="qs-input"
                    value={formData.examPeriod}
                    onChange={(e) => handleChange('examPeriod', e.target.value)}
                    placeholder={isAr ? 'مثال: 1، 2، 3...' : 'e.g., 1, 2, 3...'}
                  />
                </div>
              </div>
            </fieldset>
          </div>

          <div className="ac-footer">
            <button type="button" className="qs-btn qs-btn-ghost" onClick={handleClose}>
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" className="qs-btn qs-btn-primary">
              <Icon name="plus" />
              {isAr ? 'إضافة المقرر' : 'Add course'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCourseModal;
