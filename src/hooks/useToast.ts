import { useState, useCallback } from 'react';

import { Toast } from '../types';

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    // Add removing class to trigger animation
    const toastElement = document.querySelector(`[data-toast-id="${id}"]`);
    if (toastElement) {
      toastElement.classList.add('removing');
      // Wait for animation to complete before removing from state
      setTimeout(() => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }, 300); // Match the animation duration
    } else {
      // Fallback if element not found
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      // Generate unique ID using crypto.randomUUID for better uniqueness
      const id = crypto.randomUUID();
      const newToast: Toast = { id, message, type };
      setToasts(prev => [...prev, newToast]);

      // Auto remove after 4 seconds
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  return {
    toasts,
    showToast,
    removeToast,
  };
};
