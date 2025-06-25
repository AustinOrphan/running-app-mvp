import React from 'react';

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
      <div className='stats-card goals-overview-card'>
        <div className='stats-card-header'>
          <h3>🎯 Goals Overview</h3>
        </div>
        <div className='stats-card-content'>
          <div className='loading-spinner'></div>
          <p>Loading goals...</p>
        </div>
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className='stats-card goals-overview-card'>
        <div className='stats-card-header'>
          <h3>🎯 Goals Overview</h3>
        </div>
        <div className='stats-card-content'>
          <div className='empty-goals-state'>
            <div className='empty-icon'>🎯</div>
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
    <div className='stats-card goals-overview-card'>
      <div className='stats-card-header'>
        <h3>🎯 Goals Overview</h3>
      </div>
      <div className='stats-card-content'>
        {/* Summary Statistics */}
        <div className='goals-summary'>
          <div className='summary-stat'>
            <span className='stat-number'>{totalGoals}</span>
            <span className='stat-label'>Total Goals</span>
          </div>
          <div className='summary-stat'>
            <span className='stat-number'>{completedCount}</span>
            <span className='stat-label'>Completed</span>
          </div>
          <div className='summary-stat'>
            <span className='stat-number'>{Math.round(completionRate)}%</span>
            <span className='stat-label'>Success Rate</span>
          </div>
        </div>

        {/* Active Goals Progress */}
        {activeGoals.length > 0 && (
          <div className='active-goals-section'>
            <h4>Active Goals Progress</h4>
            <div className='goals-progress-list'>
              {topActiveGoals.map(({ goal, progress }) => {
                const config = GOAL_TYPE_CONFIGS[goal.type];
                const progressPercentage = progress?.progressPercentage || 0;
                const currentValue = progress?.currentValue || 0;

                return (
                  <div key={goal.id} className='goal-progress-item'>
                    <div className='goal-info'>
                      <div className='goal-icon' style={{ color: goal.color || config.color }}>
                        {goal.icon || config.icon}
                      </div>
                      <div className='goal-details'>
                        <span className='goal-title'>{goal.title}</span>
                        <span className='goal-progress-text'>
                          {formatProgressValue(currentValue, goal.targetUnit)} /{' '}
                          {formatProgressValue(goal.targetValue, goal.targetUnit)}
                        </span>
                      </div>
                      <div className='goal-percentage'>{Math.round(progressPercentage)}%</div>
                    </div>
                    <div className='goal-progress-bar'>
                      <div
                        className='goal-progress-fill'
                        style={{
                          width: `${Math.min(progressPercentage, 100)}%`,
                          backgroundColor: goal.color || config.color,
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
          <div className='recent-achievements-section'>
            <h4>Recent Achievements</h4>
            <div className='achievements-list'>
              {completedGoals
                .sort((a, b) => {
                  const dateA = new Date(a.completedAt || a.updatedAt).getTime();
                  const dateB = new Date(b.completedAt || b.updatedAt).getTime();
                  return dateB - dateA;
                })
                .slice(0, 2)
                .map(goal => {
                  const config = GOAL_TYPE_CONFIGS[goal.type];
                  return (
                    <div key={goal.id} className='achievement-item'>
                      <div
                        className='achievement-icon'
                        style={{ color: goal.color || config.color }}
                      >
                        {goal.icon || config.icon}
                      </div>
                      <div className='achievement-details'>
                        <span className='achievement-title'>{goal.title}</span>
                        <span className='achievement-date'>
                          {goal.completedAt
                            ? new Date(goal.completedAt).toLocaleDateString()
                            : 'Recently completed'}
                        </span>
                      </div>
                      <div className='achievement-badge'>🏆</div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Call to Action */}
        {activeGoals.length === 0 && completedGoals.length > 0 && (
          <div className='goals-cta'>
            <p>🎉 All goals completed! Ready for your next challenge?</p>
          </div>
        )}
      </div>
    </div>
  );
};
