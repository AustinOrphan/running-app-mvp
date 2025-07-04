import React, { useState } from 'react';

import {
  GoalAnalytics,
  GoalInsight,
  PersonalBest,
  MonthlyGoalProgress,
} from '../../types/goalAnalytics';

const DIFFICULTY_COLORS = {
  beginner: '#10b981',
  intermediate: '#f59e0b',
  advanced: '#ef4444',
} as const;

interface GoalAnalyticsDashboardProps {
  analytics: GoalAnalytics;
  insights: GoalInsight[];
  isOpen: boolean;
  onClose: () => void;
}

interface AnalyticsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: string;
  color?: string;
  trend?: 'up' | 'down' | 'stable';
}

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color = '#3b82f6',
  trend,
}) => {
  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return '📈';
      case 'down':
        return '📉';
      case 'stable':
        return '➡️';
      default:
        return '';
    }
  };

  return (
    <div className='analytics-card'>
      <div className='analytics-card-header'>
        <div className='analytics-card-icon' style={{ color }}>
          {icon}
        </div>
        <div className='analytics-card-trend'>{getTrendIcon()}</div>
      </div>
      <div className='analytics-card-content'>
        <div className='analytics-card-value'>{value}</div>
        <div className='analytics-card-title'>{title}</div>
        {subtitle && <div className='analytics-card-subtitle'>{subtitle}</div>}
      </div>
    </div>
  );
};

const InsightCard: React.FC<{ insight: GoalInsight }> = ({ insight }) => {
  const getInsightColor = () => {
    switch (insight.type) {
      case 'success':
        return '#10b981';
      case 'warning':
        return '#f59e0b';
      case 'info':
        return '#3b82f6';
      case 'tip':
        return '#8b5cf6';
      default:
        return '#6b7280';
    }
  };

  return (
    <div className='insight-card' style={{ borderLeftColor: getInsightColor() }}>
      <div className='insight-header'>
        <span className='insight-icon'>{insight.icon}</span>
        <h4 className='insight-title'>{insight.title}</h4>
      </div>
      <p className='insight-message'>{insight.message}</p>
      {insight.actionText && insight.actionHandler && (
        <button className='insight-action' onClick={insight.actionHandler}>
          {insight.actionText}
        </button>
      )}
    </div>
  );
};

const PersonalBestCard: React.FC<{ personalBest: PersonalBest }> = ({ personalBest }) => {
  const formatValue = () => {
    if (personalBest.type === 'TIME') {
      const minutes = Math.floor(personalBest.value / 60);
      const seconds = personalBest.value % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${personalBest.value} ${personalBest.unit}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className='personal-best-card'>
      <div className='pb-icon'>🏆</div>
      <div className='pb-content'>
        <div className='pb-value'>{formatValue()}</div>
        <div className='pb-type'>
          {personalBest.type} ({personalBest.period})
        </div>
        <div className='pb-goal'>{personalBest.goalTitle}</div>
        <div className='pb-date'>{formatDate(personalBest.achievedDate)}</div>
      </div>
    </div>
  );
};

const ProgressChart: React.FC<{ data: MonthlyGoalProgress[] }> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div className='chart-empty'>
        <div className='empty-chart-icon'>📊</div>
        <p>No progress data available yet</p>
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d.totalGoals));

  return (
    <div className='progress-chart'>
      <div className='chart-bars'>
        {data.map((month, _index) => (
          <div key={month.month} className='chart-bar-container'>
            <div className='chart-bar-group'>
              <div
                className='chart-bar chart-bar-total'
                style={{
                  height: `${(month.totalGoals / maxValue) * 100}%`,
                  minHeight: month.totalGoals > 0 ? '4px' : '0',
                }}
                title={`${month.totalGoals} total goals`}
              />
              <div
                className='chart-bar chart-bar-completed'
                style={{
                  height: `${(month.completedGoals / maxValue) * 100}%`,
                  minHeight: month.completedGoals > 0 ? '4px' : '0',
                }}
                title={`${month.completedGoals} completed goals`}
              />
            </div>
            <div className='chart-label'>
              {new Date(month.month + '-01').toLocaleDateString('en-US', { month: 'short' })}
            </div>
          </div>
        ))}
      </div>
      <div className='chart-legend'>
        <div className='legend-item'>
          <div className='legend-color chart-bar-total'></div>
          <span>Total Goals</span>
        </div>
        <div className='legend-item'>
          <div className='legend-color chart-bar-completed'></div>
          <span>Completed</span>
        </div>
      </div>
    </div>
  );
};

export const GoalAnalyticsDashboard: React.FC<GoalAnalyticsDashboardProps> = ({
  analytics,
  insights,
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'performance' | 'records'>(
    'overview'
  );

  if (!isOpen) return null;

  const formatCompletionRate = (rate: number) => `${rate.toFixed(1)}%`;
  const formatAverageTime = (days: number) => {
    if (days === 0) return 'N/A';
    if (days < 7) return `${days} days`;
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''}`;
  };

  return (
    <div
      className='analytics-overlay'
      role='button'
      tabIndex={0}
      aria-label='Close modal'
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className='analytics-dashboard'
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
        aria-labelledby='analytics-dashboard-title'
        tabIndex={-1}
      >
        <div className='analytics-header'>
          <h2 id='analytics-dashboard-title'>Goal Analytics & Insights</h2>
          <button className='btn-icon' onClick={onClose}>
            ×
          </button>
        </div>

        <div className='analytics-tabs'>
          <button
            className={`analytics-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Overview
          </button>
          <button
            className={`analytics-tab ${activeTab === 'insights' ? 'active' : ''}`}
            onClick={() => setActiveTab('insights')}
          >
            💡 Insights
          </button>
          <button
            className={`analytics-tab ${activeTab === 'performance' ? 'active' : ''}`}
            onClick={() => setActiveTab('performance')}
          >
            📈 Performance
          </button>
          <button
            className={`analytics-tab ${activeTab === 'records' ? 'active' : ''}`}
            onClick={() => setActiveTab('records')}
          >
            🏆 Records
          </button>
        </div>

        <div className='analytics-content'>
          {activeTab === 'overview' && (
            <div className='analytics-overview'>
              <div className='analytics-cards-grid'>
                <AnalyticsCard
                  title='Total Goals'
                  value={analytics.totalGoals}
                  icon='🎯'
                  color='#3b82f6'
                />
                <AnalyticsCard
                  title='Completion Rate'
                  value={formatCompletionRate(analytics.completionRate)}
                  icon='✅'
                  color='#10b981'
                  trend={
                    analytics.completionRate >= 75
                      ? 'up'
                      : analytics.completionRate >= 50
                        ? 'stable'
                        : 'down'
                  }
                />
                <AnalyticsCard
                  title='Active Goals'
                  value={analytics.activeGoals}
                  icon='🏃‍♂️'
                  color='#f59e0b'
                />
                <AnalyticsCard
                  title='Average Time'
                  value={formatAverageTime(analytics.averageTimeToCompletion)}
                  subtitle='to complete goals'
                  icon='⏱️'
                  color='#8b5cf6'
                />
              </div>

              <div className='analytics-section'>
                <h3>Goal Distribution</h3>
                <div className='goal-distribution'>
                  <div className='distribution-chart'>
                    <h4>By Type</h4>
                    {Object.entries(analytics.goalsByType).map(([type, count]) => (
                      <div key={type} className='distribution-item'>
                        <span className='distribution-label'>{type}</span>
                        <div className='distribution-bar'>
                          <div
                            className='distribution-fill'
                            style={{
                              width: `${(count / analytics.totalGoals) * 100}%`,
                              backgroundColor: '#3b82f6',
                            }}
                          />
                        </div>
                        <span className='distribution-value'>{count}</span>
                      </div>
                    ))}
                  </div>

                  <div className='distribution-chart'>
                    <h4>By Difficulty</h4>
                    {Object.entries(analytics.goalsByDifficulty).map(([difficulty, count]) => {
                      return (
                        <div key={difficulty} className='distribution-item'>
                          <span className='distribution-label'>{difficulty}</span>
                          <div className='distribution-bar'>
                            <div
                              className='distribution-fill'
                              style={{
                                width: `${(count / analytics.totalGoals) * 100}%`,
                                backgroundColor:
                                  DIFFICULTY_COLORS[difficulty as keyof typeof DIFFICULTY_COLORS] ||
                                  '#6b7280',
                              }}
                            />
                          </div>
                          <span className='distribution-value'>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'insights' && (
            <div className='analytics-insights'>
              <div className='insights-grid'>
                {insights.length > 0 ? (
                  insights.map((insight, index) => <InsightCard key={index} insight={insight} />)
                ) : (
                  <div className='no-insights'>
                    <div className='empty-icon'>🔍</div>
                    <h3>No insights available</h3>
                    <p>Complete more goals to unlock personalized insights and recommendations!</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'performance' && (
            <div className='analytics-performance'>
              <div className='performance-section'>
                <h3>Monthly Progress</h3>
                <ProgressChart data={analytics.monthlyProgress} />
              </div>

              <div className='performance-metrics'>
                <div className='streak-stats'>
                  <h3>Streak Statistics</h3>
                  <div className='streak-cards'>
                    <div className='streak-card'>
                      <div className='streak-icon'>🔥</div>
                      <div className='streak-value'>{analytics.streakData.currentStreak}</div>
                      <div className='streak-label'>Current Streak</div>
                    </div>
                    <div className='streak-card'>
                      <div className='streak-icon'>⚡</div>
                      <div className='streak-value'>{analytics.streakData.longestStreak}</div>
                      <div className='streak-label'>Longest Streak</div>
                    </div>
                    <div className='streak-card'>
                      <div className='streak-icon'>📅</div>
                      <div className='streak-value'>{analytics.streakData.totalActiveWeeks}</div>
                      <div className='streak-label'>Active Weeks</div>
                    </div>
                    <div className='streak-card'>
                      <div className='streak-icon'>📊</div>
                      <div className='streak-value'>
                        {analytics.streakData.averageGoalsPerWeek.toFixed(1)}
                      </div>
                      <div className='streak-label'>Avg Goals/Week</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'records' && (
            <div className='analytics-records'>
              <h3>Personal Bests</h3>
              {analytics.personalBests.length > 0 ? (
                <div className='personal-bests-grid'>
                  {analytics.personalBests.map((pb, index) => (
                    <PersonalBestCard key={index} personalBest={pb} />
                  ))}
                </div>
              ) : (
                <div className='no-records'>
                  <div className='empty-icon'>🏆</div>
                  <h4>No personal bests yet</h4>
                  <p>Complete your first goals to start tracking your personal bests!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
