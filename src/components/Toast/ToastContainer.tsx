import React from 'react';
import { Toast } from '../../types';

interface ToastContainerProps {
  toasts: Toast[];
  onRemoveToast: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemoveToast }) => {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div 
          key={toast.id} 
          data-toast-id={toast.id}
          className={`toast toast-${toast.type}`}
          onClick={() => onRemoveToast(toast.id)}
        >
          <span className="toast-icon">
            {toast.type === 'success' && '✅'}
            {toast.type === 'error' && '❌'}
            {toast.type === 'info' && 'ℹ️'}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={(event) => { event.stopPropagation(); onRemoveToast(toast.id); }}>×</button>
        </div>
      ))}
    </div>
  );
};