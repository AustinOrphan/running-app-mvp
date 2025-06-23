import React from 'react';
import { Goal, GoalProgress, GOAL_TYPE_CONFIGS } from '../types/goals';

interface GoalCardProps {
  goal: Goal;
  progress?: GoalProgress;
  onComplete: (goalId: string) => void;
  onDelete: (goalId: string) => void;
  onEdit?: (goalId: string) => void;
}

export const GoalCard: React.FC<GoalCardProps> = ({
  goal,
  progress,
  onComplete,
  onDelete,
  onEdit
}) => {
  const config = GOAL_TYPE_CONFIGS[goal.type];

  const formatProgressValue = (value: number, unit: string): string => {
    if (unit === 'hours') {
      return `${value.toFixed(1)}h`;
    } else if (unit === 'minutes') {
      return `${Math.round(value)}min`;
    } else if (unit === 'km') {
      return `${value.toFixed(1)}km`;
    } else if (unit === 'runs') {
      return `${Math.round(value)} runs`;
    } else if (unit.includes('min/')) {
      const minutes = Math.floor(value / 60);
      const seconds = Math.round(value % 60);
      return `${minutes}:${seconds.toString().padStart(2, '0')} ${unit}`;
    }
    return `${value.toFixed(1)} ${unit}`;
  };

  const isCompleted = goal.isCompleted;
  const currentValue = isCompleted ? goal.currentValue : (progress?.currentValue || 0);
  const progressPercentage = isCompleted ? 100 : (progress?.progressPercentage || 0);

  return (
    <div className={`goal-card ${isCompleted ? 'completed' : ''}`}>
      <div className="goal-header">
        <div className="goal-icon" style={{ color: goal.color || config.color }}>
          {goal.icon || config.icon}
        </div>
        <div className="goal-title">
          <h4>{goal.title}</h4>
          <span className="goal-type">{config.label}</span>
        </div>
        {!isCompleted && (
          <div className="goal-actions">
            {onEdit && (
              <button 
                className="btn-icon"
                onClick={() => onEdit(goal.id)}
                title="Edit goal"
              >
                ✏️
              </button>
            )}
            <button 
              className="btn-icon"
              onClick={() => onComplete(goal.id)}
              title="Mark as completed"
            >
              ✓
            </button>
            <button 
              className="btn-icon"
              onClick={() => onDelete(goal.id)}
              title="Delete goal"
            >
              🗑️
            </button>
          </div>
        )}
        {isCompleted && (
          <div className="completion-badge">
            <span>✅ Completed</span>
          </div>
        )}
      </div>

      {goal.description && (
        <p className="goal-description">{goal.description}</p>
      )}

      <div className="goal-progress">
        <div className="progress-header">
          <span className="progress-text">
            {formatProgressValue(currentValue, goal.targetUnit)} 
            {' / '}
            {formatProgressValue(goal.targetValue, goal.targetUnit)}
          </span>
          <span className="progress-percentage">
            {Math.round(progressPercentage)}%
          </span>
        </div>
        <div className="progress-bar">
          <div 
            className={`progress-fill ${isCompleted ? 'completed' : ''}`}
            style={{ 
              width: `${Math.min(progressPercentage, 100)}%`,
              backgroundColor: goal.color || config.color
            }}
          ></div>
        </div>
      </div>

      <div className="goal-meta">
        <div className="goal-period">
          <span>📅 {goal.period.toLowerCase()}</span>
        </div>
        <div className="goal-deadline">
          {isCompleted && goal.completedAt ? (
            <span className="completion-date">
              🎉 Completed on {new Date(goal.completedAt).toLocaleDateString()}
            </span>
          ) : progress && progress.daysRemaining > 0 ? (
            <span>⏰ {progress.daysRemaining} days left</span>
          ) : (
            <span className="overdue">⚠️ Overdue</span>
          )}
        </div>
      </div>
    </div>
  );
};