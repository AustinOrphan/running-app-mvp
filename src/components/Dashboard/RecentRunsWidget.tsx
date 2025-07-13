import React from 'react';
import { Run } from '../../types';
import { formatDistance, formatDuration, formatDate } from '../../utils/formatters';
import { SkeletonLoader, SkeletonStyles } from './SkeletonLoader';
import { useRouter } from '../../hooks/useRouter';
import styles from '../../styles/components/Dashboard.module.css';

interface RecentRunsWidgetProps {
  runs: Run[];
  loading: boolean;
}

export const RecentRunsWidget: React.FC<RecentRunsWidgetProps> = ({ runs, loading }) => {
  const { navigate } = useRouter();

  if (loading) {
    return (
      <div className={styles.widget}>
        <SkeletonStyles />
        <div className={styles.widgetHeader}>
          <h2 className={styles.widgetTitle}>
            <span className={styles.widgetIcon}>🏃‍♂️</span>
            Recent Runs
          </h2>
        </div>
        <div className={styles.widgetContent}>
          <SkeletonLoader type='list-item' count={3} />
        </div>
      </div>
    );
  }

  // Get the 3 most recent runs
  const recentRuns = runs
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  const handleViewAllRuns = () => {
    navigate('runs');
  };

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <h2 className={styles.widgetTitle}>
          <span className={styles.widgetIcon}>🏃‍♂️</span>
          Recent Runs
        </h2>
        {runs.length > 0 && (
          <button onClick={handleViewAllRuns} className='view-all-button'>
            View All
          </button>
        )}
      </div>
      <div className={styles.widgetContent}>
        {runs.length === 0 ? (
          <div className={styles.widgetEmpty}>
            <div className={styles.emptyIcon}>🏃‍♂️</div>
            <div className={styles.emptyMessage}>No runs logged yet</div>
            <div className={styles.emptyHint}>Your recent runs will appear here</div>
          </div>
        ) : (
          <div className='recent-runs-list'>
            {recentRuns.map(run => (
              <div
                key={run.id}
                className='run-item'
                onClick={() => navigate('runs')}
                role='button'
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate('runs');
                  }
                }}
              >
                <div className='run-icon'>
                  {run.tag === 'race'
                    ? '🏆'
                    : run.tag === 'tempo'
                      ? '⚡'
                      : run.tag === 'interval'
                        ? '🔥'
                        : run.tag === 'long'
                          ? '🛣️'
                          : '🏃‍♂️'}
                </div>
                <div className='run-details'>
                  <div className='run-primary'>
                    <span className='run-distance'>{formatDistance(run.distance)}</span>
                    <span className='run-duration'>{formatDuration(run.duration)}</span>
                  </div>
                  <div className='run-secondary'>
                    <span className='run-date'>{formatDate(run.date)}</span>
                    <span className='run-type'>{run.tag || 'run'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>
        {`
        .view-all-button {
          background: none;
          border: 1px solid var(--color-primary);
          color: var(--color-primary);
          padding: 0.25rem 0.75rem;
          border-radius: var(--border-radius);
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .view-all-button:hover {
          background: var(--color-primary);
          color: white;
        }

        .recent-runs-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .run-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem;
          border-radius: var(--border-radius);
          background: var(--color-background-subtle);
          transition: background-color 0.2s ease, transform 0.2s ease;
          cursor: pointer;
        }

        .run-item:hover {
          background: var(--color-background-hover);
          transform: translateX(4px);
        }

        .run-icon {
          font-size: 1.5rem;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-primary-subtle);
          border-radius: 50%;
        }

        .run-details {
          flex: 1;
          min-width: 0;
        }

        .run-primary {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }

        .run-distance {
          font-weight: 600;
          color: var(--color-text-primary);
          font-size: 1rem;
        }

        .run-duration {
          color: var(--color-text-secondary);
          font-size: 0.875rem;
        }

        .run-secondary {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .run-date {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
        }

        .run-type {
          font-size: 0.75rem;
          color: var(--color-primary);
          text-transform: capitalize;
          font-weight: 500;
        }
        `}
      </style>
    </div>
  );
};
