import React, { createContext, useContext, useState, useCallback } from 'react';

export interface FeedbackItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
  action?: {
    label: string;
    handler: () => void;
  };
}

interface FeedbackContextType {
  items: FeedbackItem[];
  showFeedback: (item: Omit<FeedbackItem, 'id'>) => string;
  removeFeedback: (id: string) => void;
  clearAll: () => void;
}

const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined);

interface FeedbackProviderProps {
  children: React.ReactNode;
  maxItems?: number;
}

export const FeedbackProvider: React.FC<FeedbackProviderProps> = ({ children, maxItems = 5 }) => {
  const [items, setItems] = useState<FeedbackItem[]>([]);

  const removeFeedback = useCallback((id: string) => {
    setItems(current => current.filter(item => item.id !== id));
  }, []);

  const showFeedback = useCallback(
    (item: Omit<FeedbackItem, 'id'>) => {
      const id = Date.now().toString();
      const newItem: FeedbackItem = {
        ...item,
        id,
        duration: item.duration ?? 5000,
      };

      setItems(current => {
        const updated = [newItem, ...current];
        return updated.slice(0, maxItems);
      });

      // Auto-remove after duration
      if (newItem.duration && newItem.duration > 0) {
        setTimeout(() => {
          removeFeedback(id);
        }, newItem.duration);
      }

      return id;
    },
    [maxItems, removeFeedback]
  );

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  const value: FeedbackContextType = {
    items,
    showFeedback,
    removeFeedback,
    clearAll,
  };

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
};

export const useFeedback = (): FeedbackContextType => {
  const context = useContext(FeedbackContext);
  if (context === undefined) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return context;
};

// Convenience hooks for different feedback types
export const useSuccessFeedback = () => {
  const { showFeedback } = useFeedback();
  return useCallback(
    (message: string, action?: FeedbackItem['action']) => {
      return showFeedback({ type: 'success', message, action });
    },
    [showFeedback]
  );
};

export const useErrorFeedback = () => {
  const { showFeedback } = useFeedback();
  return useCallback(
    (message: string, action?: FeedbackItem['action']) => {
      return showFeedback({ type: 'error', message, action, duration: 8000 });
    },
    [showFeedback]
  );
};

export const useInfoFeedback = () => {
  const { showFeedback } = useFeedback();
  return useCallback(
    (message: string, action?: FeedbackItem['action']) => {
      return showFeedback({ type: 'info', message, action });
    },
    [showFeedback]
  );
};

export const useWarningFeedback = () => {
  const { showFeedback } = useFeedback();
  return useCallback(
    (message: string, action?: FeedbackItem['action']) => {
      return showFeedback({ type: 'warning', message, action, duration: 6000 });
    },
    [showFeedback]
  );
};
