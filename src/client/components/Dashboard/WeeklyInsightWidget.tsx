import React from 'react';
import { Run } from '../../types';
import { formatDistance, formatDuration } from '../../utils/formatters';
import { MiniPaceChart } from './MiniPaceChart';
import { SkeletonLoader, SkeletonStyles } from './SkeletonLoader';
import styles from '../../styles/components/Dashboard.module.css';

interface WeeklyInsightWidgetProps {
  runs: Run[];
  loading: boolean;
}

export const WeeklyInsightWidget: React.FC<WeeklyInsightWidgetProps> = ({ runs, loading }) => {
  if (loading) {
    return (
      <div className={styles.widget}>
        <SkeletonStyles />
        <div className={styles.widgetHeader}>
          <h2 className={styles.widgetTitle}>
            <span className={styles.widgetIcon}>📈</span>
            Weekly Insights
          </h2>
        </div>
        <div className={styles.widgetContent}>
          {/* Weekly stats skeleton */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '1rem',
              textAlign: 'center',
              marginBottom: '1.5rem',
            }}
          >
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                style={{
                  padding: '0.75rem',
                  borderRadius: 'var(--border-radius)',
                  background: 'var(--color-background-subtle)',
                }}
              >
                <SkeletonLoader type='text' width='60px' height='1.25rem' />
                <SkeletonLoader type='text' width='40px' height='0.75rem' />
              </div>
            ))}
          </div>
          {/* Insight message skeleton */}
          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--border-radius)',
              background: 'var(--color-background-subtle)',
              marginBottom: '1.5rem',
            }}
          >
            <SkeletonLoader type='text' width='80%' height='0.875rem' />
          </div>
          {/* Activity pattern skeleton */}
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <SkeletonLoader type='text' width='120px' height='0.75rem' />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '0.5rem',
                marginTop: '0.75rem',
              }}
            >
              {Array.from({ length: 7 }).map((_, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <SkeletonLoader type='text' width='12px' height='0.7rem' />
                  <SkeletonLoader type='circle' width='8px' height='8px' />
                </div>
              ))}
            </div>
          </div>
          {/* Chart skeleton */}
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <SkeletonLoader type='text' width='120px' height='0.75rem' />
            <div style={{ marginTop: '0.75rem' }}>
              <SkeletonLoader type='chart' height='50px' />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calculate weekly stats
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const thisWeekRuns = runs.filter(run => new Date(run.date) >= oneWeekAgo);
  const lastWeekRuns = runs.filter(run => {
    const runDate = new Date(run.date);
    return runDate >= twoWeeksAgo && runDate < oneWeekAgo;
  });

  const thisWeekDistance = thisWeekRuns.reduce((sum, run) => sum + run.distance, 0);
  const lastWeekDistance = lastWeekRuns.reduce((sum, run) => sum + run.distance, 0);
  const thisWeekTime = thisWeekRuns.reduce((sum, run) => sum + run.duration, 0);

  // Calculate trends
  const distanceChange =
    lastWeekDistance > 0 ? ((thisWeekDistance - lastWeekDistance) / lastWeekDistance) * 100 : 0;

  const getInsightMessage = (): {
    message: string;
    type: 'positive' | 'neutral' | 'motivational';
  } => {
    if (thisWeekRuns.length === 0) {
      return {
        message: 'No runs this week yet. Time to lace up those running shoes! 👟',
        type: 'motivational',
      };
    }

    if (distanceChange > 10) {
      return {
        message: `Great week! You've increased your distance by ${Math.round(distanceChange)}% 🚀`,
        type: 'positive',
      };
    }

    if (distanceChange < -10) {
      return {
        message: `Take it easy this week. Recovery is just as important as training 💪`,
        type: 'neutral',
      };
    }

    if (thisWeekRuns.length >= 3) {
      return {
        message: `Consistency is key! ${thisWeekRuns.length} runs this week 🔥`,
        type: 'positive',
      };
    }

    return {
      message: `You're off to a good start with ${formatDistance(thisWeekDistance)} this week! 🏃‍♂️`,
      type: 'neutral',
    };
  };

  const insight = getInsightMessage();

  // Weekly activity pattern
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const activityPattern = weekDays.map(day => {
    const dayRuns = thisWeekRuns.filter(run => {
      const runDay = new Date(run.date).toLocaleDateString('en-US', { weekday: 'short' });
      return runDay === day;
    });
    return {
      day,
      hasRun: dayRuns.length > 0,
      distance: dayRuns.reduce((sum, run) => sum + run.distance, 0),
    };
  });

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <h2 className={styles.widgetTitle}>
          <span className={styles.widgetIcon}>📈</span>
          Weekly Insights
        </h2>
      </div>
      <div className={styles.widgetContent}>
        {runs.length === 0 ? (
          <div className={styles.widgetEmpty}>
            <div className={styles.emptyIcon}>📈</div>
            <div className={styles.emptyMessage}>No data yet</div>
            <div className={styles.emptyHint}>Start running to see insights</div>
          </div>
        ) : (
          <div className='insights-content'>
            {/* Key Stats */}
            <div className='weekly-stats'>
              <div className='stat'>
                <div className='stat-value'>{thisWeekRuns.length}</div>
                <div className='stat-label'>Runs</div>
              </div>
              <div className='stat'>
                <div className='stat-value'>{formatDistance(thisWeekDistance)}</div>
                <div className='stat-label'>Distance</div>
              </div>
              <div className='stat'>
                <div className='stat-value'>{formatDuration(thisWeekTime)}</div>
                <div className='stat-label'>Time</div>
              </div>
            </div>

            {/* Insight Message */}
            <div className={`insight-message ${insight.type}`}>{insight.message}</div>

            {/* Weekly Pattern */}
            <div className='activity-pattern'>
              <div className='pattern-label'>This week&apos;s activity</div>
              <div className='pattern-days'>
                {activityPattern.map(({ day, hasRun, distance }) => (
                  <div key={day} className={`day-indicator ${hasRun ? 'active' : ''}`}>
                    <div className='day-label'>{day}</div>
                    <div
                      className='day-dot'
                      title={hasRun ? `${formatDistance(distance)}` : 'Rest day'}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Pace Trend Chart */}
            {thisWeekRuns.length > 1 && (
              <div className='chart-section'>
                <div className='chart-label'>Pace Trend (This Week)</div>
                <MiniPaceChart runs={thisWeekRuns} height={50} color='var(--color-secondary)' />
              </div>
            )}
          </div>
        )}
      </div>

      <style>
        {`
        .insights-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .weekly-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          text-align: center;
        }

        .stat {
          padding: 0.75rem;
          border-radius: var(--border-radius);
          background: var(--color-background-subtle);
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

        .insight-message {
          padding: 1rem;
          border-radius: var(--border-radius);
          font-size: 0.875rem;
          line-height: 1.4;
          font-weight: 500;
        }

        .insight-message.positive {
          background: var(--color-success-subtle);
          color: var(--color-success-dark);
          border-left: 3px solid var(--color-success);
        }

        .insight-message.neutral {
          background: var(--color-info-subtle);
          color: var(--color-info-dark);
          border-left: 3px solid var(--color-info);
        }

        .insight-message.motivational {
          background: var(--color-warning-subtle);
          color: var(--color-warning-dark);
          border-left: 3px solid var(--color-warning);
        }

        .activity-pattern {
          text-align: center;
        }

        .pattern-label {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
          margin-bottom: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .pattern-days {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.5rem;
        }

        .day-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .day-label {
          font-size: 0.7rem;
          color: var(--color-text-secondary);
          font-weight: 500;
        }

        .day-indicator.active .day-label {
          color: var(--color-primary);
        }

        .day-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--color-background);
          border: 2px solid var(--color-border);
          transition: all 0.2s ease;
        }

        .day-indicator.active .day-dot {
          background: var(--color-primary);
          border-color: var(--color-primary);
          transform: scale(1.2);
        }

        .chart-section {
          margin-top: 1rem;
          padding-top: 1rem;
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
