import React from 'react';
import { useFeedback } from './FeedbackProvider';

export const FeedbackContainer: React.FC = () => {
  const { items, removeFeedback } = useFeedback();

  if (items.length === 0) return null;

  return (
    <div className='feedback-container'>
      {items.map(item => (
        <FeedbackItem key={item.id} item={item} onRemove={() => removeFeedback(item.id)} />
      ))}
      <style>{`
        .feedback-container {
          position: fixed;
          top: 1rem;
          right: 1rem;
          z-index: var(--z-index-tooltip);
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-width: 400px;
          pointer-events: none;
        }

        @media (max-width: 640px) {
          .feedback-container {
            top: 0.5rem;
            right: 0.5rem;
            left: 0.5rem;
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
};

interface FeedbackItemProps {
  item: {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    action?: {
      label: string;
      handler: () => void;
    };
  };
  onRemove: () => void;
}

const FeedbackItem: React.FC<FeedbackItemProps> = ({ item, onRemove }) => {
  const getIcon = () => {
    switch (item.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return 'ℹ️';
    }
  };

  const getColorScheme = () => {
    switch (item.type) {
      case 'success':
        return {
          bg: 'var(--color-success-subtle)',
          border: 'var(--color-success)',
          text: 'var(--color-success-dark)',
        };
      case 'error':
        return {
          bg: 'var(--color-error-subtle)',
          border: 'var(--color-error)',
          text: 'var(--color-error-dark)',
        };
      case 'warning':
        return {
          bg: 'var(--color-warning-subtle)',
          border: 'var(--color-warning)',
          text: 'var(--color-warning-dark)',
        };
      case 'info':
        return {
          bg: 'var(--color-info-subtle)',
          border: 'var(--color-info)',
          text: 'var(--color-info-dark)',
        };
    }
  };

  const colors = getColorScheme();

  return (
    <div
      className='feedback-item toast-enhanced'
      style={{
        backgroundColor: colors.bg,
        borderLeft: `4px solid ${colors.border}`,
        color: colors.text,
      }}
      role='alert'
      aria-live='polite'
    >
      <div className='feedback-content'>
        <div className='feedback-header'>
          <span className='feedback-icon' role='img' aria-hidden='true'>
            {getIcon()}
          </span>
          <span className='feedback-message'>{item.message}</span>
          <button className='feedback-close' onClick={onRemove} aria-label='Close notification'>
            ×
          </button>
        </div>
        {item.action && (
          <div className='feedback-actions'>
            <button
              className='feedback-action-btn btn-enhanced'
              onClick={() => {
                item.action!.handler();
                onRemove();
              }}
            >
              {item.action.label}
            </button>
          </div>
        )}
      </div>

      <style>{`
        .feedback-item {
          padding: 1rem;
          border-radius: var(--border-radius);
          box-shadow: var(--shadow-lg);
          backdrop-filter: blur(10px);
          pointer-events: auto;
          position: relative;
          overflow: hidden;
          min-width: 300px;
        }

        .feedback-content {
          position: relative;
          z-index: 2;
        }

        .feedback-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .feedback-icon {
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .feedback-message {
          flex: 1;
          font-size: 0.875rem;
          font-weight: var(--font-weight-medium);
          line-height: var(--line-height-normal);
        }

        .feedback-close {
          background: none;
          border: none;
          color: inherit;
          font-size: 1.5rem;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all var(--transition-fast);
          flex-shrink: 0;
        }

        .feedback-close:hover {
          background: rgba(0, 0, 0, 0.1);
          transform: scale(1.1);
        }

        .feedback-actions {
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
        }

        .feedback-action-btn {
          background: transparent;
          border: 1px solid currentColor;
          color: inherit;
          padding: 0.5rem 1rem;
          border-radius: var(--border-radius-sm);
          font-size: 0.75rem;
          font-weight: var(--font-weight-medium);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .feedback-action-btn:hover {
          background: currentColor;
          color: var(--color-card-background);
          transform: translateY(-1px);
        }

        /* Progress bar for timed notifications */
        .feedback-item::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          height: 2px;
          background: currentColor;
          opacity: 0.3;
          animation: feedbackProgress var(--duration, 5s) linear;
        }

        @keyframes feedbackProgress {
          from { width: 100%; }
          to { width: 0%; }
        }

        @media (max-width: 640px) {
          .feedback-item {
            min-width: auto;
          }
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
          .feedback-item {
            animation: none;
          }
          
          .feedback-item::after {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
};
