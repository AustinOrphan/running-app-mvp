import React from 'react';
import { Goal, GOAL_TYPES } from '../../types/goals';
import { Run } from '../../types';
import { useRouter } from '../../hooks/useRouter';
import { MiniGoalProgressChart } from './MiniGoalProgressChart';
import { SkeletonLoader, SkeletonStyles } from './SkeletonLoader';
import { EnhancedProgress } from '../Interactive/EnhancedProgress';
import styles from '../../styles/components/Dashboard.module.css';

interface GoalProgressWidgetProps {
  goals: Goal[];
  runs: Run[];
  loading: boolean;
}

export const GoalProgressWidget: React.FC<GoalProgressWidgetProps> = ({ goals, runs, loading }) => {
  const { navigate } = useRouter();

  if (loading) {
    return (
      <div className={styles.widget}>
        <SkeletonStyles />
        <div className={styles.widgetHeader}>
          <h2 className={styles.widgetTitle}>
            <span className={styles.widgetIcon}>🎯</span>
            Goal Progress
          </h2>
        </div>
        <div className={styles.widgetContent}>
          <SkeletonLoader type='progress' count={3} />
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <SkeletonLoader type='text' width='150px' height='0.75rem' />
            <div style={{ marginTop: '0.75rem' }}>
              <SkeletonLoader type='chart' height='60px' />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Filter for active goals and get the most recent ones
  const activeGoals = goals
    .filter(goal => goal.isActive && !goal.isCompleted)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  const calculateProgress = (goal: Goal): number => {
    // Basic progress calculation - this would be more sophisticated in a real app
    switch (goal.type) {
      case GOAL_TYPES.DISTANCE: {
        const totalDistance = runs.reduce((sum, run) => sum + run.distance, 0);
        return Math.min((totalDistance / goal.targetValue) * 100, 100);
      }
      case GOAL_TYPES.PACE:
        // For pace goals, we'd need to calculate if the user is meeting their target
        return 0; // Simplified for now
      case GOAL_TYPES.TIME: {
        const totalTime = runs.reduce((sum, run) => sum + run.duration, 0);
        return Math.min((totalTime / goal.targetValue) * 100, 100);
      }
      default:
        return 0;
    }
  };

  const getGoalIcon = (type: string): string => {
    switch (type) {
      case GOAL_TYPES.DISTANCE:
        return '📏';
      case GOAL_TYPES.PACE:
        return '⚡';
      case GOAL_TYPES.TIME:
        return '⏱️';
      case GOAL_TYPES.FREQUENCY:
        return '🔄';
      case GOAL_TYPES.LONGEST_RUN:
        return '🏃‍♂️';
      default:
        return '🎯';
    }
  };

  const formatGoalValue = (goal: Goal): string => {
    switch (goal.type) {
      case GOAL_TYPES.DISTANCE:
        return `${goal.targetValue} ${goal.targetUnit}`;
      case GOAL_TYPES.PACE: {
        const minutes = Math.floor(goal.targetValue);
        const seconds = Math.round((goal.targetValue - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}/${goal.targetUnit}`;
      }
      case GOAL_TYPES.TIME: {
        const hours = Math.floor(goal.targetValue / 60);
        const mins = Math.round(goal.targetValue % 60);
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      }
      default:
        return `${goal.targetValue} ${goal.targetUnit}`;
    }
  };

  const handleViewAllGoals = () => {
    navigate('goals');
  };

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <h2 className={styles.widgetTitle}>
          <span className={styles.widgetIcon}>🎯</span>
          Goal Progress
        </h2>
        {goals.length > 0 && (
          <button onClick={handleViewAllGoals} className='view-all-button'>
            View All
          </button>
        )}
      </div>
      <div className={styles.widgetContent}>
        {activeGoals.length === 0 ? (
          <div className={styles.widgetEmpty}>
            <div className={styles.emptyIcon}>🎯</div>
            <div className={styles.emptyMessage}>No active goals</div>
            <div className={styles.emptyHint}>Set a goal to track your progress</div>
          </div>
        ) : (
          <>
            <div className='goals-list'>
              {activeGoals.map(goal => {
                const progress = calculateProgress(goal);
                return (
                  <div key={goal.id} className='goal-item'>
                    <div className='goal-header'>
                      <div className='goal-icon'>{getGoalIcon(goal.type)}</div>
                      <div className='goal-info'>
                        <div className='goal-title'>{goal.title}</div>
                        <div className='goal-target'>Target: {formatGoalValue(goal)}</div>
                      </div>
                      <div className='goal-percentage'>{Math.round(progress)}%</div>
                    </div>
                    <EnhancedProgress
                      value={progress}
                      max={100}
                      size='md'
                      variant={progress >= 100 ? 'success' : progress >= 80 ? 'warning' : 'default'}
                      animated={true}
                      striped={progress < 100}
                      glow={progress >= 100}
                      pulse={progress >= 100}
                    />
                  </div>
                );
              })}
            </div>
            {activeGoals.length > 0 && (
              <div className='chart-section'>
                <div className='chart-label'>Goal Progress Overview</div>
                <MiniGoalProgressChart goals={goals} height={60} color='var(--color-accent)' />
              </div>
            )}
          </>
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

        .goals-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .goal-item {
          padding: 1rem;
          border-radius: var(--border-radius);
          background: var(--color-background-subtle);
          transition: background-color 0.2s ease;
        }

        .goal-item:hover {
          background: var(--color-background-hover);
        }

        .goal-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .goal-icon {
          font-size: 1.25rem;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-primary-subtle);
          border-radius: 50%;
        }

        .goal-info {
          flex: 1;
          min-width: 0;
        }

        .goal-title {
          font-weight: 600;
          color: var(--color-text-primary);
          font-size: 0.875rem;
          margin-bottom: 0.25rem;
        }

        .goal-target {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
        }

        .goal-percentage {
          font-weight: 700;
          color: var(--color-primary);
          font-size: 0.875rem;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: var(--color-background);
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--color-primary), var(--color-success));
          border-radius: 3px;
          width: 0%;
          animation: progressFill 1.2s ease-out forwards;
          position: relative;
          overflow: hidden;
        }

        .progress-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          right: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.3),
            transparent
          );
          transform: translateX(-100%);
          animation: shimmer 2s infinite;
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
