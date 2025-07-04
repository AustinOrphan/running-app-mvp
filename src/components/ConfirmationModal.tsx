import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const getIconForType = () => {
    switch (type) {
      case 'danger':
        return '⚠️';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '⚠️';
    }
  };

  const getButtonStyleForType = () => {
    switch (type) {
      case 'danger':
        return 'btn-danger';
      case 'warning':
        return 'btn-warning';
      case 'info':
        return 'btn-primary';
      default:
        return 'btn-danger';
    }
  };

  return (
    <div
      className='modal-overlay'
      role='button'
      tabIndex={0}
      aria-label='Close modal'
      onClick={onCancel}
      onKeyDown={e => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className='modal confirmation-modal'
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
        aria-labelledby='confirmation-modal-title'
        tabIndex={-1}
      >
        <div className='modal-header'>
          <div className='confirmation-header'>
            <span className='confirmation-icon'>{getIconForType()}</span>
            <h3 id='confirmation-modal-title'>{title}</h3>
          </div>
        </div>

        <div className='modal-body'>
          <p className='confirmation-message'>{message}</p>
        </div>

        <div className='modal-footer'>
          <button type='button' className='btn-secondary' onClick={onCancel}>
            {cancelText}
          </button>
          <button type='button' className={getButtonStyleForType()} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
