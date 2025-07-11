import React from 'react';

import { WeeklyInsights } from '../../types';
import { formatDuration, formatPace } from '../../utils/formatters';
import styles from '../../styles/components/Stats.module.css';

interface InsightsCardProps {
  insights: WeeklyInsights | null;
  loading: boolean;
}

export const InsightsCard: React.FC<InsightsCardProps> = ({ insights, loading }) => {
  if (loading) {
    return (
      <div className={styles.insightsCard}>
        <div className={styles.insightsHeader}>
          <h3>Weekly Summary</h3>
          <span
            className={`${styles.insightsPeriod} ${styles.skeletonLine}`}
            style={{ width: '100px', height: '14px' }}
          ></span>
        </div>
        <div className={styles.insightsGrid}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={styles.insightItem}>
              <div className={styles.skeletonLine} style={{ width: '60px', height: '24px' }}></div>
              <div
                className={styles.skeletonLine}
                style={{ width: '80px', height: '14px', marginTop: '4px' }}
              ></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className={styles.insightsCard}>
        <div className={styles.insightsHeader}>
          <h3>Weekly Summary</h3>
        </div>
        <div className={styles.emptyState}>
          <div className='empty-icon'>📊</div>
          <p>No runs this week yet!</p>
          <span>Add your first run to see insights</span>
        </div>
      </div>
    );
  }

  const weekStart = new Date(insights.weekStart).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const weekEnd = new Date(insights.weekEnd).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className={styles.insightsCard}>
      <div className={styles.insightsHeader}>
        <h3>Weekly Summary</h3>
        <span className={styles.insightsPeriod}>
          {weekStart} - {weekEnd}
        </span>
      </div>

      <div className={styles.insightsGrid}>
        <div className={styles.insightItem}>
          <div className={styles.insightValue}>{insights.totalRuns}</div>
          <div className={styles.insightLabel}>Runs</div>
        </div>

        <div className={styles.insightItem}>
          <div className={styles.insightValue}>{insights.totalDistance}km</div>
          <div className={styles.insightLabel}>Distance</div>
        </div>

        <div className={styles.insightItem}>
          <div className={styles.insightValue}>{formatDuration(insights.totalDuration)}</div>
          <div className={styles.insightLabel}>Time</div>
        </div>

        <div className={styles.insightItem}>
          <div className={styles.insightValue}>
            {insights.avgPace > 0 ? formatPace(insights.avgPace) : '-'}
          </div>
          <div className={styles.insightLabel}>Avg Pace</div>
        </div>
      </div>

      {insights.totalRuns > 0 && (
        <div className={styles.insightsFooter}>
          <div className={styles.insightStat}>
            <span className={styles.statLabel}>Avg Distance: </span>
            <span className={styles.statValue}>
              {(insights.totalDistance / insights.totalRuns).toFixed(1)}km
            </span>
          </div>
          <div className={styles.insightStat}>
            <span className={styles.statLabel}>Avg Duration: </span>
            <span className={styles.statValue}>
              {formatDuration(Math.floor(insights.totalDuration / insights.totalRuns))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
