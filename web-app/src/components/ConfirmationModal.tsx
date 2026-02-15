import React from 'react';
import { createPortal } from 'react-dom';
import './ConfirmationModal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;

  const modalContent = (
    <div className="confirmation-modal-overlay" onClick={onCancel}>
      <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirmation-modal-header">
          <h3 className="confirmation-modal-title">
            ⚠️ تأكيد
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
            إلغاء
          </button>
          <button 
            className="confirmation-modal-btn confirmation-modal-btn-confirm"
            onClick={onConfirm}
          >
            تأكيد
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default ConfirmationModal;
