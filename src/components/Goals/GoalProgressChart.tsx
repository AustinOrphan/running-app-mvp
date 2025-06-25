import React from 'react';

import { Goal, GoalProgress, GOAL_TYPE_CONFIGS } from '../../types/goals';

interface GoalProgressChartProps {
  goal: Goal;
  progress: GoalProgress;
  timelineData?: Array<{
    date: string;
    value: number;
    cumulative: number;
  }>;
}

export const GoalProgressChart: React.FC<GoalProgressChartProps> = ({
  goal,
  progress,
  timelineData = [],
}) => {
  const config = GOAL_TYPE_CONFIGS[goal.type];
  const progressPercentage = Math.min(progress.progressPercentage, 100);

  // Calculate days elapsed and remaining
  const startDate = new Date(goal.startDate);
  const endDate = new Date(goal.endDate);
  const today = new Date();
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(
    0,
    Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const timePercentage = totalDays > 0 ? Math.min((daysElapsed / totalDays) * 100, 100) : 0;

  // Determine goal status
  const isOnTrack = progressPercentage >= timePercentage;
  const isCompleted = goal.isCompleted || progressPercentage >= 100;
  const isOverdue = progress.daysRemaining <= 0 && !isCompleted;

  const formatValue = (value: number): string => {
    if (goal.targetUnit === 'hours') {
      return `${value.toFixed(1)}h`;
    } else if (goal.targetUnit === 'minutes') {
      return `${Math.round(value)}min`;
    } else if (goal.targetUnit === 'km') {
      return `${value.toFixed(1)}km`;
    } else if (goal.targetUnit === 'runs') {
      return `${Math.round(value)} runs`;
    } else if (goal.targetUnit.includes('min/')) {
      const minutes = Math.floor(value / 60);
      const seconds = Math.round(value % 60);
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${value.toFixed(1)} ${goal.targetUnit}`;
  };

  const getStatusColor = () => {
    if (isCompleted) return '#10b981';
    if (isOverdue) return '#ef4444';
    if (isOnTrack) return goal.color || config.color;
    return '#f59e0b';
  };

  const getStatusLabel = () => {
    if (isCompleted) return 'Completed';
    if (isOverdue) return 'Overdue';
    if (isOnTrack) return 'On Track';
    return 'Behind Schedule';
  };

  const getStatusIcon = () => {
    if (isCompleted) return '🏆';
    if (isOverdue) return '⚠️';
    if (isOnTrack) return '✅';
    return '🔄';
  };

  return (
    <div className='goal-progress-chart'>
      <div className='chart-header'>
        <div className='goal-info'>
          <div className='goal-icon' style={{ color: goal.color || config.color }}>
            {goal.icon || config.icon}
          </div>
          <div className='goal-details'>
            <h3>{goal.title}</h3>
            <p className='goal-type'>{config.label}</p>
          </div>
        </div>
        <div className='status-badge' style={{ backgroundColor: getStatusColor() }}>
          <span className='status-icon'>{getStatusIcon()}</span>
          <span className='status-text'>{getStatusLabel()}</span>
        </div>
      </div>

      {/* Progress Overview */}
      <div className='progress-overview'>
        <div className='progress-stats'>
          <div className='stat'>
            <span className='stat-label'>Current</span>
            <span className='stat-value'>{formatValue(progress.currentValue)}</span>
          </div>
          <div className='stat'>
            <span className='stat-label'>Target</span>
            <span className='stat-value'>{formatValue(goal.targetValue)}</span>
          </div>
          <div className='stat'>
            <span className='stat-label'>Remaining</span>
            <span className='stat-value'>{formatValue(progress.remainingValue)}</span>
          </div>
          <div className='stat'>
            <span className='stat-label'>Days Left</span>
            <span className='stat-value'>{Math.max(0, progress.daysRemaining)} days</span>
          </div>
        </div>
      </div>

      {/* Main Progress Visualization */}
      <div className='progress-visualization'>
        <div className='progress-section'>
          <div className='section-header'>
            <span>Goal Progress</span>
            <span className='percentage'>{Math.round(progressPercentage)}%</span>
          </div>
          <div className='progress-bar-container'>
            <div className='progress-bar large'>
              <div
                className='progress-fill'
                style={{
                  width: `${progressPercentage}%`,
                  backgroundColor: getStatusColor(),
                }}
              ></div>
              <div className='progress-label'>
                {formatValue(progress.currentValue)} / {formatValue(goal.targetValue)}
              </div>
            </div>
          </div>
        </div>

        <div className='progress-section'>
          <div className='section-header'>
            <span>Time Progress</span>
            <span className='percentage'>{Math.round(timePercentage)}%</span>
          </div>
          <div className='progress-bar-container'>
            <div className='progress-bar large'>
              <div className='progress-fill time' style={{ width: `${timePercentage}%` }}></div>
              <div className='progress-label'>
                {daysElapsed} / {totalDays} days
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Data (if available) */}
      {timelineData.length > 0 && (
        <div className='timeline-section'>
          <h4>Progress Timeline</h4>
          <div className='timeline-chart'>
            <svg viewBox='0 0 400 100' className='timeline-svg'>
              {/* Background grid */}
              <defs>
                <pattern id='grid' width='40' height='20' patternUnits='userSpaceOnUse'>
                  <path
                    d='M 40 0 L 0 0 0 20'
                    fill='none'
                    stroke='#404040'
                    strokeWidth='0.5'
                    opacity='0.3'
                  />
                </pattern>
              </defs>
              <rect width='400' height='100' fill='url(#grid)' />

              {/* Progress line */}
              {timelineData.map((point, index) => {
                const x = (index / (timelineData.length - 1)) * 380 + 10;
                const y = 90 - (point.cumulative / goal.targetValue) * 70;
                const nextPoint = timelineData[index + 1];

                return (
                  <g key={index}>
                    {/* Line to next point */}
                    {nextPoint && (
                      <line
                        x1={x}
                        y1={y}
                        x2={((index + 1) / (timelineData.length - 1)) * 380 + 10}
                        y2={90 - (nextPoint.cumulative / goal.targetValue) * 70}
                        stroke={getStatusColor()}
                        strokeWidth='2'
                      />
                    )}

                    {/* Data point */}
                    <circle
                      cx={x}
                      cy={y}
                      r='3'
                      fill={getStatusColor()}
                      className='timeline-point'
                    />
                  </g>
                );
              })}

              {/* Target line */}
              <line
                x1='10'
                y1='20'
                x2='390'
                y2='20'
                stroke='#10b981'
                strokeWidth='1'
                strokeDasharray='5,5'
                opacity='0.7'
              />
            </svg>
          </div>
        </div>
      )}

      {/* Pace Analysis */}
      <div className='pace-analysis'>
        <h4>Pace Analysis</h4>
        <div className='pace-stats'>
          {progress.daysRemaining > 0 && !isCompleted && (
            <div className='pace-stat'>
              <span className='pace-label'>Daily Target</span>
              <span className='pace-value'>
                {formatValue(progress.remainingValue / Math.max(1, progress.daysRemaining))}
              </span>
            </div>
          )}

          {daysElapsed > 0 && (
            <div className='pace-stat'>
              <span className='pace-label'>Daily Average</span>
              <span className='pace-value'>{formatValue(progress.currentValue / daysElapsed)}</span>
            </div>
          )}

          <div className='pace-stat'>
            <span className='pace-label'>Period</span>
            <span className='pace-value'>{goal.period.toLowerCase()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
