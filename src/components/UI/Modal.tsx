import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from '../../styles/components/Modal.module.css';

/**
 * Modal component props interface
 */
export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;

  /** Callback when modal should close */
  onClose: () => void;

  /** Modal title */
  title?: string;

  /** Size variant */
  size?: 'small' | 'medium' | 'large' | 'fullscreen';

  /** Close when clicking backdrop */
  closeOnBackdrop?: boolean;

  /** Close when pressing ESC key */
  closeOnEsc?: boolean;

  /** Show close button in header */
  showCloseButton?: boolean;

  /** Custom footer content */
  footer?: React.ReactNode;

  /** Additional CSS classes */
  className?: string;

  /** Modal content */
  children: React.ReactNode;

  /** ARIA label for accessibility */
  'aria-label'?: string;

  /** ARIA labelledby for accessibility */
  'aria-labelledby'?: string;

  /** ARIA describedby for accessibility */
  'aria-describedby'?: string;
}

/**
 * Modal component with accessibility features and animations
 *
 * @example
 * ```tsx
 * <Modal
 *   isOpen={isModalOpen}
 *   onClose={() => setIsModalOpen(false)}
 *   title="Confirm Action"
 *   footer={
 *     <>
 *       <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
 *         Cancel
 *       </Button>
 *       <Button variant="primary" onClick={handleConfirm}>
 *         Confirm
 *       </Button>
 *     </>
 *   }
 * >
 *   Are you sure you want to proceed?
 * </Modal>
 * ```
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  size = 'medium',
  closeOnBackdrop = true,
  closeOnEsc = true,
  showCloseButton = true,
  footer,
  className = '',
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).substr(2, 9)}`).current;

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnBackdrop && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnBackdrop, onClose]
  );

  // Handle ESC key press
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === 'Escape') {
        onClose();
      }
    },
    [closeOnEsc, onClose]
  );

  // Focus trap implementation
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    const firstFocusable = focusableElements[0] as HTMLElement;
    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (e.shiftKey && document.activeElement === firstFocusable) {
      e.preventDefault();
      lastFocusable?.focus();
    } else if (!e.shiftKey && document.activeElement === lastFocusable) {
      e.preventDefault();
      firstFocusable?.focus();
    }
  }, []);

  // Handle modal open/close
  useEffect(() => {
    if (isOpen) {
      // Store current active element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Add event listeners
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keydown', handleTabKey);

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      // Focus modal
      setTimeout(() => {
        const firstFocusable = modalRef.current?.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) as HTMLElement;
        firstFocusable?.focus();
      }, 100);
    } else {
      // Start closing animation
      if (modalRef.current) {
        setIsClosing(true);
        setTimeout(() => {
          setIsClosing(false);
        }, 200);
      }

      // Restore body scroll
      document.body.style.overflow = '';

      // Restore focus to previous element
      previousActiveElement.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleTabKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown, handleTabKey]);

  if (!isOpen && !isClosing) return null;

  const modalClasses = [
    styles.modal,
    styles[`modal${size.charAt(0).toUpperCase() + size.slice(1)}`],
    isClosing && styles.closing,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const overlayClasses = [styles.modalOverlay, isClosing && styles.closing]
    .filter(Boolean)
    .join(' ');

  const modalContent = (
    <div className={overlayClasses} onClick={handleBackdropClick} role='presentation'>
      <div
        ref={modalRef}
        className={modalClasses}
        role='dialog'
        aria-modal='true'
        aria-label={ariaLabel}
        aria-labelledby={title ? titleId : ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
      >
        {(title || showCloseButton) && (
          <div className={styles.modalHeader}>
            {title && <h3 id={titleId}>{title}</h3>}
            {showCloseButton && (
              <button
                type='button'
                className={styles.closeButton}
                onClick={onClose}
                aria-label='Close modal'
              >
                ×
              </button>
            )}
          </div>
        )}

        <div className={styles.modalBody}>{children}</div>

        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

/**
 * Confirmation modal props interface
 */
export interface ConfirmationModalProps extends Omit<ModalProps, 'children' | 'footer'> {
  /** Type of confirmation (affects icon and color) */
  type?: 'warning' | 'danger' | 'info' | 'success';

  /** Custom icon */
  icon?: React.ReactNode;

  /** Confirmation message */
  message: string;

  /** Confirm button text */
  confirmText?: string;

  /** Cancel button text */
  cancelText?: string;

  /** Confirm button variant */
  confirmVariant?: 'primary' | 'danger' | 'warning' | 'success';

  /** Callback when confirmed */
  onConfirm: () => void | Promise<void>;

  /** Callback when cancelled */
  onCancel?: () => void;

  /** Loading state */
  loading?: boolean;
}

/**
 * ConfirmationModal component for user confirmations
 *
 * @example
 * ```tsx
 * <ConfirmationModal
 *   isOpen={showConfirm}
 *   onClose={() => setShowConfirm(false)}
 *   type="danger"
 *   title="Delete Item"
 *   message="Are you sure you want to delete this item? This action cannot be undone."
 *   confirmText="Delete"
 *   onConfirm={handleDelete}
 * />
 * ```
 */
export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  type = 'info',
  icon,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant,
  onConfirm,
  onCancel,
  loading = false,
  ...modalProps
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      modalProps.onClose();
    } catch {
      // Handle error appropriately in production
      // Error logging should be handled by proper error reporting service
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    modalProps.onClose();
  };

  const defaultIcons = {
    warning: '⚠️',
    danger: '🗑️',
    info: 'ℹ️',
    success: '✅',
  };

  const displayIcon = icon || defaultIcons[type];
  const buttonVariant = confirmVariant || (type === 'danger' ? 'danger' : 'primary');

  return (
    <Modal
      {...modalProps}
      size='small'
      className={styles.confirmationModal}
      footer={
        <>
          <Button variant='secondary' onClick={handleCancel} disabled={isLoading || loading}>
            {cancelText}
          </Button>
          <Button
            variant={buttonVariant}
            onClick={handleConfirm}
            disabled={isLoading || loading}
            loading={isLoading || loading}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className={styles.confirmationHeader}>
        <div className={`${styles.confirmationIcon} ${styles[type]}`}>{displayIcon}</div>
        <div>
          {modalProps.title && <h4 className={styles.confirmationTitle}>{modalProps.title}</h4>}
          <p className={styles.confirmationMessage}>{message}</p>
        </div>
      </div>
    </Modal>
  );
};

/**
 * Loading modal props interface
 */
export interface LoadingModalProps {
  /** Whether modal is open */
  isOpen: boolean;

  /** Loading message */
  message?: string;

  /** Additional CSS classes */
  className?: string;
}

/**
 * LoadingModal component for blocking loading states
 *
 * @example
 * ```tsx
 * <LoadingModal
 *   isOpen={isProcessing}
 *   message="Processing your request..."
 * />
 * ```
 */
export const LoadingModal: React.FC<LoadingModalProps> = ({
  isOpen,
  message = 'Loading...',
  className = '',
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}} // Cannot be closed
      size='small'
      showCloseButton={false}
      closeOnBackdrop={false}
      closeOnEsc={false}
      className={`${styles.loadingModal} ${className}`}
      aria-label='Loading'
    >
      <div className={styles.loadingSpinner} aria-hidden='true' />
      <p className={styles.loadingText}>{message}</p>
    </Modal>
  );
};
