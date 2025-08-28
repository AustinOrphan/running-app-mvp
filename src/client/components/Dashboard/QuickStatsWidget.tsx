import React from 'react';
import { Run } from '../../types';
import { formatDistance, formatPace, calculateAveragePace } from '../../utils/formatters';
import { MiniDistanceChart } from './MiniDistanceChart';
import { SkeletonLoader, SkeletonStyles } from './SkeletonLoader';
import { InteractiveCard } from '../Interactive/InteractiveCard';
import { useRouter } from '../../hooks/useRouter';
import styles from '../../styles/components/Dashboard.module.css';

interface QuickStatsWidgetProps {
  runs: Run[];
  loading: boolean;
}

export const QuickStatsWidget: React.FC<QuickStatsWidgetProps> = ({ runs, loading }) => {
  const { navigate } = useRouter();
  if (loading) {
    return (
      <div className={styles.widget}>
        <SkeletonStyles />
        <div className={styles.widgetHeader}>
          <h2 className={styles.widgetTitle}>
            <span className={styles.widgetIcon}>📊</span>
            Quick Stats
          </h2>
        </div>
        <div className={styles.widgetContent}>
          <SkeletonLoader type='stat-grid' count={4} />
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <SkeletonLoader type='text' width='150px' height='0.75rem' />
            <div style={{ marginTop: '0.75rem' }}>
              <SkeletonLoader type='chart' height='50px' />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calculate stats from runs
  const totalRuns = runs.length;
  const totalDistance = runs.reduce((sum, run) => sum + run.distance, 0);
  const thisWeekRuns = runs.filter(run => {
    const runDate = new Date(run.date);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return runDate >= oneWeekAgo;
  });
  const thisWeekDistance = thisWeekRuns.reduce((sum, run) => sum + run.distance, 0);
  const averagePace = runs.length > 0 ? calculateAveragePace(runs) : 0;

  const stats = [
    {
      label: 'Total Runs',
      value: totalRuns.toString(),
      icon: '🏃‍♂️',
      color: 'var(--color-primary)',
    },
    {
      label: 'Total Distance',
      value: formatDistance(totalDistance),
      icon: '📏',
      color: 'var(--color-success)',
    },
    {
      label: 'This Week',
      value: formatDistance(thisWeekDistance),
      icon: '📅',
      color: 'var(--color-warning)',
    },
    {
      label: 'Avg Pace',
      value: runs.length > 0 ? formatPace(averagePace) : 'N/A',
      icon: '⚡',
      color: 'var(--color-info)',
    },
  ];

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <h2 className={styles.widgetTitle}>
          <span className={styles.widgetIcon}>📊</span>
          Quick Stats
        </h2>
      </div>
      <div className={styles.widgetContent}>
        {runs.length === 0 ? (
          <div className={styles.widgetEmpty}>
            <div className={styles.emptyIcon}>🏃‍♂️</div>
            <div className={styles.emptyMessage}>No runs yet!</div>
            <div className={styles.emptyHint}>Start by logging your first run</div>
          </div>
        ) : (
          <>
            <div className='stats-grid'>
              {stats.map(stat => (
                <InteractiveCard
                  key={stat.label}
                  className='stat-item card-interactive'
                  style={{ '--accent-color': stat.color } as React.CSSProperties}
                  elevation={1}
                  interactive={true}
                  onClick={() => navigate('runs')}
                  glow={false}
                  tilt={true}
                >
                  <div className='stat-icon icon-spin'>{stat.icon}</div>
                  <div className='stat-value counter-animate'>{stat.value}</div>
                  <div className='stat-label'>{stat.label}</div>
                </InteractiveCard>
              ))}
            </div>
            {runs.length > 1 && (
              <div className='chart-section'>
                <div className='chart-label'>Distance Trend (Last 7 runs)</div>
                <MiniDistanceChart
                  runs={runs}
                  height={50}
                  color='var(--color-primary)'
                  onClick={() => navigate('stats')}
                />
              </div>
            )}
          </>
        )}
      </div>

      <style>
        {`
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }

        @media (min-width: 768px) {
          .stats-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        .stat-item {
          text-align: center;
          padding: 1rem;
          border-radius: var(--border-radius);
          background: var(--color-background-subtle);
          border: 2px solid transparent;
          transition: border-color 0.2s ease, transform 0.2s ease;
        }

        .stat-item:hover {
          border-color: var(--accent-color);
          transform: translateY(-2px);
        }

        .stat-icon {
          font-size: 1.5rem;
          margin-bottom: 0.5rem;
        }

        .stat-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--color-text-primary);
          margin-bottom: 0.25rem;
        }

        .stat-label {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .chart-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--color-border);
        }

        .chart-label {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.75rem;
          text-align: center;
        }
        `}
      </style>
    </div>
  );
};
