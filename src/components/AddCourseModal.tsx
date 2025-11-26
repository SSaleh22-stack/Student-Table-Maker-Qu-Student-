import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Course } from '../types';
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
      finalExam: formData.examPeriod
        ? {
            day: formData.days[0] || 'Sun',
            startTime: '08:00',
            endTime: '10:00',
            date: formData.examPeriod,
          }
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

  return (
    <div className="add-course-modal-overlay" onClick={handleClose}>
      <div className="add-course-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-course-modal-header">
          <h2>{language === 'en' ? '➕ Add Course Manually' : '➕ إضافة مقرر يدوياً'}</h2>
          <button className="close-modal-btn" onClick={handleClose}>
            {t.close}
          </button>
        </div>

        <form className="add-course-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="code">
                {t.courseCode} <span className="required">*</span>
              </label>
              <input
                type="text"
                id="code"
                value={formData.code}
                onChange={(e) => handleChange('code', e.target.value)}
                className={errors.code ? 'error' : ''}
                placeholder={language === 'en' ? 'e.g., CS101' : 'مثال: CS101'}
              />
              {errors.code && <span className="error-message">{errors.code}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="name">
                {t.courseName} <span className="required">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className={errors.name ? 'error' : ''}
                placeholder={language === 'en' ? 'Course name' : 'اسم المقرر'}
              />
              {errors.name && <span className="error-message">{errors.name}</span>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="section">
                {t.section} <span className="required">*</span>
              </label>
              <input
                type="text"
                id="section"
                value={formData.section}
                onChange={(e) => handleChange('section', e.target.value)}
                className={errors.section ? 'error' : ''}
                placeholder={language === 'en' ? 'e.g., 01' : 'مثال: 01'}
              />
              {errors.section && <span className="error-message">{errors.section}</span>}
            </div>

            <div className="form-group">
              <label>
                {t.days} <span className="required">*</span>
              </label>
              <div className="days-checkboxes">
                {daysOptions.map((day) => (
                  <label key={day.value} className="day-checkbox">
                    <input
                      type="checkbox"
                      checked={formData.days.includes(day.value)}
                      onChange={() => handleDayToggle(day.value)}
                    />
                    <span>{day.label}</span>
                  </label>
                ))}
              </div>
              {errors.days && <span className="error-message">{errors.days}</span>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="startTime">
                {language === 'en' ? 'Start Time' : 'وقت البداية'} <span className="required">*</span>
              </label>
              <input
                type="time"
                id="startTime"
                value={formData.startTime}
                onChange={(e) => handleChange('startTime', e.target.value)}
                className={errors.startTime ? 'error' : ''}
              />
              {errors.startTime && <span className="error-message">{errors.startTime}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="endTime">
                {language === 'en' ? 'End Time' : 'وقت النهاية'} <span className="required">*</span>
              </label>
              <input
                type="time"
                id="endTime"
                value={formData.endTime}
                onChange={(e) => handleChange('endTime', e.target.value)}
                className={errors.endTime ? 'error' : ''}
              />
              {errors.endTime && <span className="error-message">{errors.endTime}</span>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="location">{t.location}</label>
              <input
                type="text"
                id="location"
                value={formData.location}
                onChange={(e) => handleChange('location', e.target.value)}
                placeholder={language === 'en' ? 'e.g., Building 5, Room 201' : 'مثال: مبنى 5، قاعة 201'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="instructor">{t.instructor}</label>
              <input
                type="text"
                id="instructor"
                value={formData.instructor}
                onChange={(e) => handleChange('instructor', e.target.value)}
                placeholder={language === 'en' ? 'Instructor name' : 'اسم المحاضر'}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="examPeriod">
                {language === 'en' ? 'Exam Period' : 'فترة الامتحان'}
              </label>
              <input
                type="text"
                id="examPeriod"
                value={formData.examPeriod}
                onChange={(e) => handleChange('examPeriod', e.target.value)}
                placeholder={language === 'en' ? 'e.g., 1, 2, 3...' : 'مثال: 1، 2، 3...'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="status">{t.status}</label>
              <select
                id="status"
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
              >
                <option value="open">{t.open}</option>
                <option value="closed">{t.closed}</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="classType">{t.classType}</label>
              <select
                id="classType"
                value={formData.classType}
                onChange={(e) => handleChange('classType', e.target.value)}
              >
                <option value="theoretical">{t.theoretical}</option>
                <option value="practical">{t.practical}</option>
                <option value="exercise">{t.exercise}</option>
              </select>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="cancel-btn" onClick={handleClose}>
              {t.close}
            </button>
            <button type="submit" className="submit-btn">
              {language === 'en' ? '➕ Add Course' : '➕ إضافة المقرر'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCourseModal;

