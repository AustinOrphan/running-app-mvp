import React from 'react';
import { useRouter } from '../../hooks/useRouter';
import { EnhancedButton } from '../Interactive/EnhancedButton';
import { useFeedback } from '../Feedback/FeedbackProvider';
import styles from '../../styles/components/Dashboard.module.css';

interface QuickActionsWidgetProps {
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const QuickActionsWidget: React.FC<QuickActionsWidgetProps> = ({ onShowToast }) => {
  const { navigate } = useRouter();
  const { showFeedback } = useFeedback();

  const actions = [
    {
      id: 'log-run',
      label: 'Log Run',
      icon: '📝',
      description: 'Record a new run',
      color: 'var(--color-primary)',
      onClick: () => {
        navigate('runs');
        // The runs page will handle showing the form
        setTimeout(
          () => onShowToast('Navigate to runs and click the + button to log a new run', 'info'),
          500
        );
      },
    },
    {
      id: 'set-goal',
      label: 'Set Goal',
      icon: '🎯',
      description: 'Create a new goal',
      color: 'var(--color-success)',
      onClick: () => {
        navigate('goals');
        setTimeout(() => onShowToast('Navigate to goals to set a new target', 'info'), 500);
      },
    },
    {
      id: 'view-stats',
      label: 'View Stats',
      icon: '📈',
      description: 'Analyze your progress',
      color: 'var(--color-info)',
      onClick: () => {
        navigate('stats');
      },
    },
    {
      id: 'plan-race',
      label: 'Plan Race',
      icon: '🏆',
      description: 'Coming soon',
      color: 'var(--color-warning)',
      onClick: () => {
        onShowToast('Race planning feature coming soon!', 'info');
      },
    },
  ];

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <h2 className={styles.widgetTitle}>
          <span className={styles.widgetIcon}>⚡</span>
          Quick Actions
        </h2>
      </div>
      <div className={styles.widgetContent}>
        <div className='actions-grid'>
          {actions.map(action => (
            <EnhancedButton
              key={action.id}
              onClick={() => {
                action.onClick();
                showFeedback({
                  type: 'info',
                  message: `${action.label} action triggered!`,
                  duration: 3000,
                });
              }}
              className='action-button btn-enhanced'
              style={{ '--action-color': action.color } as React.CSSProperties}
              variant='primary'
              size='md'
              icon={<span>{action.icon}</span>}
              iconPosition='left'
              ripple={true}
              fullWidth={true}
            >
              <div className='action-content'>
                <div className='action-label'>{action.label}</div>
                <div className='action-description'>{action.description}</div>
              </div>
            </EnhancedButton>
          ))}
        </div>
      </div>

      <style>
        {`
        .actions-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.75rem;
        }

        @media (min-width: 768px) {
          .actions-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .action-button {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          border: none;
          border-radius: var(--border-radius);
          background: var(--color-background-subtle);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          text-align: left;
          width: 100%;
          border: 2px solid transparent;
          position: relative;
          overflow: hidden;
        }

        .action-button::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          background: rgba(59, 130, 246, 0.1);
          border-radius: 50%;
          transform: translate(-50%, -50%);
          transition: width 0.3s ease, height 0.3s ease;
        }

        .action-button:hover {
          background: var(--color-background-hover);
          border-color: var(--action-color);
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        }

        .action-button:hover::before {
          width: 100%;
          height: 100%;
        }

        .action-button:active {
          transform: translateY(-1px) scale(0.98);
          transition: transform 0.1s ease;
        }

        .action-icon {
          font-size: 1.5rem;
          width: 2.5rem;
          height: 2.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--action-color);
          border-radius: 50%;
          color: white;
          flex-shrink: 0;
        }

        .action-content {
          flex: 1;
          min-width: 0;
        }

        .action-label {
          font-weight: 600;
          color: var(--color-text-primary);
          margin-bottom: 0.25rem;
          font-size: 0.875rem;
        }

        .action-description {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
          line-height: 1.3;
        }

        /* Mobile-specific adjustments */
        @media (max-width: 767px) {
          .action-button {
            padding: 0.75rem;
          }

          .action-icon {
            width: 2rem;
            height: 2rem;
            font-size: 1.25rem;
          }

          .action-label {
            font-size: 0.8rem;
          }

          .action-description {
            font-size: 0.7rem;
          }
        }
        `}
      </style>
    </div>
  );
};
