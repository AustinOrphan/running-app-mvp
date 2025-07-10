import React from 'react';
import { ConfirmationModal as UIConfirmationModal } from './UI/Modal';

// Re-export the UI component for backward compatibility
export { UIConfirmationModal as ConfirmationModal } from './UI/Modal';

// Legacy wrapper for existing usage if needed
interface LegacyConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export const LegacyConfirmationModal: React.FC<LegacyConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  onConfirm,
  onCancel,
}) => {
  return (
    <UIConfirmationModal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      message={message}
      confirmText={confirmText}
      cancelText={cancelText}
      type={type}
      onConfirm={onConfirm}
    />
  );
};
