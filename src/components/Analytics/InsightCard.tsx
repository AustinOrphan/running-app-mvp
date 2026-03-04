import React from 'react';
import { Insight } from '../../types';

interface InsightCardProps {
  insight: Insight;
  onDismiss?: (insight: Insight) => void;
}

export const InsightCard: React.FC<InsightCardProps> = ({ insight, onDismiss }) => {
  const getInsightIcon = (type: Insight['type']) => {
    switch (type) {
      case 'consistency':
        return '🎯';
      case 'volume':
        return '📊';
      case 'recovery':
        return '😴';
      case 'performance':
        return '🚀';
      case 'goal':
        return '🏆';
      default:
        return '💡';
    }
  };

  const getPriorityColor = (priority: Insight['priority']) => {
    switch (priority) {
      case 'high':
        return 'var(--color-danger, #ef4444)';
      case 'medium':
        return 'var(--color-warning, #f59e0b)';
      case 'low':
        return 'var(--color-info, #3b82f6)';
    }
  };

  const getPriorityLabel = (priority: Insight['priority']) => {
    switch (priority) {
      case 'high':
        return 'High Priority';
      case 'medium':
        return 'Medium Priority';
      case 'low':
        return 'Low Priority';
    }
  };

  const getTypeLabel = (type: Insight['type']) => {
    switch (type) {
      case 'consistency':
        return 'Consistency';
      case 'volume':
        return 'Volume';
      case 'recovery':
        return 'Recovery';
      case 'performance':
        return 'Performance';
      case 'goal':
        return 'Goal';
      default:
        return 'Insight';
    }
  };

  return (
    <div
      className='insight-card'
      style={{ '--priority-color': getPriorityColor(insight.priority) } as React.CSSProperties}
    >
      <div className='insight-card-header'>
        <div className='insight-icon'>{getInsightIcon(insight.type)}</div>
        <div className='insight-meta'>
          <span className='insight-type'>{getTypeLabel(insight.type)}</span>
          <span className='insight-priority'>{getPriorityLabel(insight.priority)}</span>
        </div>
        {onDismiss && (
          <button
            className='insight-dismiss'
            onClick={() => onDismiss(insight)}
            aria-label='Dismiss insight'
            title='Dismiss'
          >
            ×
          </button>
        )}
      </div>

      <div className='insight-card-body'>
        <p className='insight-message'>{insight.message}</p>
        {insight.actionable && (
          <div className='insight-action'>
            <span className='action-icon'>💡</span>
            <span className='action-text'>{insight.actionable}</span>
          </div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .insight-card {
    background: var(--color-background);
    border-radius: var(--border-radius);
    border-left: 4px solid var(--priority-color);
    padding: 1.25rem;
    transition: all 0.3s ease;
    position: relative;
  }

  .insight-card:hover {
    transform: translateX(4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .insight-card-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .insight-icon {
    font-size: 2rem;
    flex-shrink: 0;
    line-height: 1;
  }

  .insight-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .insight-type {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .insight-priority {
    font-size: 0.75rem;
    color: var(--priority-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .insight-dismiss {
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    font-size: 1.5rem;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s ease;
    flex-shrink: 0;
    line-height: 1;
  }

  .insight-dismiss:hover {
    background: var(--color-background-subtle);
    color: var(--color-text-primary);
  }

  .insight-dismiss:active {
    transform: scale(0.95);
  }

  .insight-card-body {
    padding-left: 2.75rem;
  }

  @media (max-width: 640px) {
    .insight-card-body {
      padding-left: 0;
    }
  }

  .insight-message {
    margin: 0 0 0.75rem 0;
    color: var(--color-text-primary);
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .insight-action {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--color-background-subtle);
    border-radius: calc(var(--border-radius) - 2px);
    border-left: 3px solid var(--priority-color);
  }

  .action-icon {
    font-size: 1rem;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .action-text {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    line-height: 1.6;
  }
`;
