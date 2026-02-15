import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './ConfirmationModal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, message, onConfirm, onCancel }) => {
  const { language } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="confirmation-modal-overlay" onClick={onCancel}>
      <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirmation-modal-header">
          <h3 className="confirmation-modal-title">
            {language === 'en' ? '⚠️ Confirmation' : '⚠️ تأكيد'}
          </h3>
        </div>
        <div className="confirmation-modal-body">
          <p className="confirmation-modal-message">{message}</p>
        </div>
        <div className="confirmation-modal-footer">
          <button 
            className="confirmation-modal-btn confirmation-modal-btn-cancel"
            onClick={onCancel}
          >
            {language === 'en' ? 'Cancel' : 'إلغاء'}
          </button>
          <button 
            className="confirmation-modal-btn confirmation-modal-btn-confirm"
            onClick={onConfirm}
          >
            {language === 'en' ? 'Confirm' : 'تأكيد'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
