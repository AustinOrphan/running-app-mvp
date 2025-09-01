import { useEffect, RefObject } from 'react';

/**
 * Custom hook for handling close on outside click functionality
 * Extracted from ConnectivityFooter for reusability
 */
export const useCloseOnOutsideClick = (
  ref: RefObject<HTMLElement>,
  isExpanded: boolean,
  onClose: () => void
) => {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (isExpanded && ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isExpanded, onClose, ref]);
};

/**
 * Custom hook for handling escape key to close
 */
export const useCloseOnEscape = (
  isExpanded: boolean,
  onClose: () => void
) => {
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (isExpanded && event.key === 'Escape') {
        onClose();
      }
    };

    if (isExpanded) {
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isExpanded, onClose]);
};