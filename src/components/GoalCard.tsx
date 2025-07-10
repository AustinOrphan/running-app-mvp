import React, { useState } from 'react';

import { Goal, GoalProgress, GOAL_TYPE_CONFIGS } from '../types/goals';

import { CircularProgress } from './Goals/CircularProgress';
import { GoalProgressChart } from './Goals/GoalProgressChart';
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardActions,
  CardContent,
  CardProgress,
  CardFooter,
  IconButton,
  ProgressHeader,
  ProgressBar,
  DetailedProgress,
  SimpleProgress,
  ExpandControls,
  ExpandedContent,
  CompletionBadge,
} from './UI/Card';

interface GoalCardProps {
  goal: Goal;
  progress?: GoalProgress;
  onComplete: (goalId: string) => void;
  onDelete: (goalId: string) => void;
  onEdit?: (goalId: string) => void;
  showDetailedView?: boolean;
  enableExpandedView?: boolean;
}

export const GoalCard: React.FC<GoalCardProps> = ({
  goal,
  progress,
  onComplete,
  onDelete,
  onEdit,
  showDetailedView = false,
  enableExpandedView = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
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
  const currentValue = isCompleted ? goal.currentValue : progress?.currentValue || 0;
  const progressPercentage = isCompleted ? 100 : progress?.progressPercentage || 0;

  return (
    <Card variant="goal" completed={isCompleted}>
      <CardHeader>
        <CardIcon color={goal.color || config.color}>
          {goal.icon || config.icon}
        </CardIcon>
        <CardTitle>
          <h4>{goal.title}</h4>
          <span className="goal-type">{config.label}</span>
        </CardTitle>
        {!isCompleted && (
          <CardActions>
            {onEdit && (
              <IconButton
                onClick={() => onEdit(goal.id)}
                title="Edit goal"
              >
                ✏️
              </IconButton>
            )}
            <IconButton
              onClick={() => onComplete(goal.id)}
              title="Mark as completed"
            >
              ✓
            </IconButton>
            <IconButton
              onClick={() => onDelete(goal.id)}
              title="Delete goal"
            >
              🗑️
            </IconButton>
          </CardActions>
        )}
        {isCompleted && (
          <CompletionBadge>
            ✅ Completed
          </CompletionBadge>
        )}
      </CardHeader>

      {goal.description && (
        <CardDescription>
          {goal.description}
        </CardDescription>
      )}

      <CardContent>
        <CardProgress>
          {showDetailedView ? (
            <DetailedProgress>
              <div className="progress-circular">
                <CircularProgress
                  percentage={progressPercentage}
                  size={80}
                  strokeWidth={6}
                  color={goal.color || config.color}
                >
                  <div className="circular-content">
                    <div className="circular-percentage">{Math.round(progressPercentage)}%</div>
                    <div className="circular-label">complete</div>
                  </div>
                </CircularProgress>
              </div>
              <div className="progress-details">
                <div className="progress-stat">
                  <span className="stat-label">Current</span>
                  <span className="stat-value">
                    {formatProgressValue(currentValue, goal.targetUnit)}
                  </span>
                </div>
                <div className="progress-stat">
                  <span className="stat-label">Target</span>
                  <span className="stat-value">
                    {formatProgressValue(goal.targetValue, goal.targetUnit)}
                  </span>
                </div>
                <div className="progress-stat">
                  <span className="stat-label">Remaining</span>
                  <span className="stat-value">
                    {formatProgressValue(goal.targetValue - currentValue, goal.targetUnit)}
                  </span>
                </div>
              </div>
            </DetailedProgress>
          ) : (
            <SimpleProgress>
              <ProgressHeader>
                <span className="progress-text">
                  {formatProgressValue(currentValue, goal.targetUnit)}
                  {' / '}
                  {formatProgressValue(goal.targetValue, goal.targetUnit)}
                </span>
                <span className="progress-percentage">{Math.round(progressPercentage)}%</span>
              </ProgressHeader>
              <ProgressBar
                percentage={progressPercentage}
                completed={isCompleted}
                color={goal.color || config.color}
              />
            </SimpleProgress>
          )}

          {/* Expand/Collapse button */}
          {enableExpandedView && !isCompleted && (
            <ExpandControls
              isExpanded={isExpanded}
              onToggle={() => setIsExpanded(!isExpanded)}
              expandText="View details"
              collapseText="Show less"
            />
          )}
        </CardProgress>

        {/* Expanded detailed view */}
        {isExpanded && progress && (
          <ExpandedContent>
            <GoalProgressChart goal={goal} progress={progress} />
          </ExpandedContent>
        )}
      </CardContent>

      <CardFooter>
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
      </CardFooter>
    </Card>
  );
};