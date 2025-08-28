import React from 'react';
import styles from '../../styles/components/Stats.module.css';

import { Goal, GoalProgress, GOAL_TYPE_CONFIGS } from '../../types/goals';

interface GoalsOverviewCardProps {
  goals: Goal[];
  goalProgress: GoalProgress[];
  loading: boolean;
}

export const GoalsOverviewCard: React.FC<GoalsOverviewCardProps> = ({
  goals,
  goalProgress,
  loading,
}) => {
  const activeGoals = goals.filter(goal => !goal.isCompleted);
  const completedGoals = goals.filter(goal => goal.isCompleted);

  const getProgressForGoal = (goalId: string): GoalProgress | undefined => {
    return goalProgress.find(p => p.goalId === goalId);
  };

  const formatProgressValue = (value: number, unit: string): string => {
    if (unit === 'hours') {
      return `${value.toFixed(1)}h`;
    } else if (unit === 'minutes') {
      return `${Math.round(value)}min`;
    } else if (unit === 'km') {
      return `${value.toFixed(1)}km`;
    } else if (unit === 'runs') {
      return `${Math.round(value)} runs`;
    }
    return `${value.toFixed(1)} ${unit}`;
  };

  if (loading) {
    return (
      <div className={`${styles.statsCard} ${styles.goalsOverviewCard}`}>
        <div className={styles.statsCardHeader}>
          <h3>🎯 Goals Overview</h3>
        </div>
        <div className={styles.statsCardContent}>
          <div className={styles.loadingSpinner}></div>
          <p>Loading goals...</p>
        </div>
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className={`${styles.statsCard} ${styles.goalsOverviewCard}`}>
        <div className={styles.statsCardHeader}>
          <h3>🎯 Goals Overview</h3>
        </div>
        <div className={styles.statsCardContent}>
          <div className={styles.emptyGoalsState}>
            <div className={styles.emptyIcon}>🎯</div>
            <p>No goals set yet</p>
            <small>Create your first goal to start tracking progress!</small>
          </div>
        </div>
      </div>
    );
  }

  // Calculate overall statistics
  const totalGoals = goals.length;
  const completedCount = completedGoals.length;
  const completionRate = totalGoals > 0 ? (completedCount / totalGoals) * 100 : 0;

  // Get top 3 active goals by progress
  const topActiveGoals = activeGoals
    .map(goal => ({
      goal,
      progress: getProgressForGoal(goal.id),
    }))
    .sort((a, b) => (b.progress?.progressPercentage || 0) - (a.progress?.progressPercentage || 0))
    .slice(0, 3);

  return (
    <div className={`${styles.statsCard} ${styles.goalsOverviewCard}`}>
      <div className={styles.statsCardHeader}>
        <h3>🎯 Goals Overview</h3>
      </div>
      <div className={styles.statsCardContent}>
        {/* Summary Statistics */}
        <div className={styles.goalsSummary}>
          <div className={styles.summaryStat}>
            <span className={styles.statNumber}>{totalGoals}</span>
            <span className={styles.statLabel}>Total Goals</span>
          </div>
          <div className={styles.summaryStat}>
            <span className={styles.statNumber}>{completedCount}</span>
            <span className={styles.statLabel}>Completed</span>
          </div>
          <div className={styles.summaryStat}>
            <span className={styles.statNumber}>{Math.round(completionRate)}%</span>
            <span className={styles.statLabel}>Success Rate</span>
          </div>
        </div>

        {/* Active Goals Progress */}
        {activeGoals.length > 0 && (
          <div className={styles.activeGoalsSection}>
            <h4>Active Goals Progress</h4>
            <div className={styles.goalsProgressList}>
              {topActiveGoals.map(({ goal, progress }) => {
                const config = GOAL_TYPE_CONFIGS[goal.type as keyof typeof GOAL_TYPE_CONFIGS];
                const progressPercentage = progress?.progressPercentage || 0;
                const currentValue = progress?.currentValue || 0;

                return (
                  <div key={goal.id} className={styles.goalProgressItem}>
                    <div className={styles.goalInfo}>
                      <div
                        className={styles.goalIcon}
                        style={{ color: goal.color || config?.color || '#666' }}
                      >
                        {goal.icon || config?.icon || '📊'}
                      </div>
                      <div className={styles.goalDetails}>
                        <span className={styles.goalTitle}>{goal.title}</span>
                        <span className={styles.goalProgressText}>
                          {formatProgressValue(currentValue, goal.targetUnit)} /{' '}
                          {formatProgressValue(goal.targetValue, goal.targetUnit)}
                        </span>
                      </div>
                      <div className={styles.goalPercentage}>{Math.round(progressPercentage)}%</div>
                    </div>
                    <div className={styles.goalProgressBar}>
                      <div
                        className={styles.goalProgressFill}
                        style={{
                          transform: `scaleX(${Math.min(progressPercentage, 100) / 100})`,
                          backgroundColor: goal.color || config?.color || '#3b82f6',
                        }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Achievements */}
        {completedGoals.length > 0 && (
          <div className={styles.recentAchievementsSection}>
            <h4>Recent Achievements</h4>
            <div className={styles.achievementsList}>
              {completedGoals
                .sort((a, b) => {
                  const dateA = new Date(a.completedAt || a.updatedAt).getTime();
                  const dateB = new Date(b.completedAt || b.updatedAt).getTime();
                  return dateB - dateA;
                })
                .slice(0, 2)
                .map(goal => {
                  const config = GOAL_TYPE_CONFIGS[goal.type as keyof typeof GOAL_TYPE_CONFIGS];
                  return (
                    <div key={goal.id} className={styles.achievementItem}>
                      <div
                        className={styles.achievementIcon}
                        style={{ color: goal.color || config?.color || '#10b981' }}
                      >
                        {goal.icon || config?.icon || '🏆'}
                      </div>
                      <div className={styles.achievementDetails}>
                        <span className={styles.achievementTitle}>{goal.title}</span>
                        <span className={styles.achievementDate}>
                          {goal.completedAt
                            ? new Date(goal.completedAt).toLocaleDateString()
                            : 'Recently completed'}
                        </span>
                      </div>
                      <div className={styles.achievementBadge}>🏆</div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Call to Action */}
        {activeGoals.length === 0 && completedGoals.length > 0 && (
          <div className={styles.goalsCta}>
            <p>🎉 All goals completed! Ready for your next challenge?</p>
          </div>
        )}
      </div>
    </div>
  );
};
