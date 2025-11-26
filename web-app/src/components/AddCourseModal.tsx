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
    section: '01',
    days: 'Sun',
    startTime: '08:00',
    endTime: '09:30',
    location: '',
    instructor: '',
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const course: Course = {
      id: `${formData.code}-${formData.section}-${Date.now()}`,
      code: formData.code,
      name: formData.name,
      section: formData.section,
      days: [formData.days],
      startTime: formData.startTime,
      endTime: formData.endTime,
      location: formData.location || undefined,
      instructor: formData.instructor || undefined,
    };
    onAdd(course);
    setFormData({
      code: '',
      name: '',
      section: '01',
      days: 'Sun',
      startTime: '08:00',
      endTime: '09:30',
      location: '',
      instructor: '',
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{language === 'en' ? 'Add Course Manually' : 'إضافة مقرر يدوياً'}</h2>
          <button className="modal-close" onClick={onClose}>{t.close}</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit} className="add-course-form">
            <div className="form-group">
              <label>{t.courseCode} *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t.courseName} *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.section} *</label>
                <input
                  type="text"
                  value={formData.section}
                  onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t.days} *</label>
                <select
                  value={formData.days}
                  onChange={(e) => setFormData({ ...formData, days: e.target.value })}
                  required
                >
                  <option value="Sun">{t.sunday}</option>
                  <option value="Mon">{t.monday}</option>
                  <option value="Tue">{t.tuesday}</option>
                  <option value="Wed">{t.wednesday}</option>
                  <option value="Thu">{t.thursday}</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.time} (Start) *</label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t.time} (End) *</label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label>{t.location}</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t.instructor}</label>
              <input
                type="text"
                value={formData.instructor}
                onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
              />
            </div>
            <div className="form-actions">
              <button type="button" onClick={onClose} className="btn-cancel">
                {t.close}
              </button>
              <button type="submit" className="btn-submit">
                {language === 'en' ? 'Add Course' : 'إضافة المقرر'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddCourseModal;

