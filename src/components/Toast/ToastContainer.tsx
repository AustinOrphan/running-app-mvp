import React from 'react';

import { Toast } from '../../types';
import styles from '../../styles/components/Notification.module.css';

interface ToastContainerProps {
  toasts: Toast[];
  onRemoveToast: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemoveToast }) => {
  return (
    <div className={styles.toastContainer}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          data-toast-id={toast.id}
          className={`${styles.toast} ${styles[toast.type]} ${styles.show}`}
          role='status'
          aria-live='polite'
        >
          <div className={styles.toastContent}>
            <span className={styles.toastMessage}>{toast.message}</span>
            <button
              className={styles.toastClose}
              onClick={() => onRemoveToast(toast.id)}
              aria-label={`Dismiss ${toast.type} notification`}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
