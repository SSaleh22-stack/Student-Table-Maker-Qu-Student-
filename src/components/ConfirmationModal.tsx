import React from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../contexts/LanguageContext';
import Icon from './Icon';
import './ConfirmationModal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, message, onConfirm, onCancel }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  if (!isOpen) return null;

  const modalContent = (
    <div className="qs-modal-overlay confirm-overlay" onClick={onCancel}>
      <div
        className="qs-modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        dir={isAr ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-body">
          <span className="confirm-icon">
            <Icon name="alert" size={26} />
          </span>
          <h3 id="confirm-title" className="confirm-title">
            {isAr ? 'تأكيد' : 'Please confirm'}
          </h3>
          <p id="confirm-message" className="confirm-message">{message}</p>
        </div>
        <div className="confirm-footer">
          <button type="button" className="qs-btn qs-btn-ghost" onClick={onCancel}>
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button type="button" className="qs-btn qs-btn-primary" onClick={onConfirm} autoFocus>
            {isAr ? 'تأكيد' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default ConfirmationModal;
