import React from 'react';
import { Goal } from '../../types/goals';

interface StreakData {
  date: string;
  hasActivity: boolean;
  value?: number;
}

interface GoalStreakVisualizationProps {
  goal: Goal;
  streakData: StreakData[];
  currentStreak: number;
  longestStreak: number;
  className?: string;
}

export const GoalStreakVisualization: React.FC<GoalStreakVisualizationProps> = ({
  goal,
  streakData,
  currentStreak,
  longestStreak,
  className = ''
}) => {
  // Get last 30 days of streak data
  const recentData = streakData.slice(-30);
  
  const getStreakColor = (hasActivity: boolean, isToday: boolean) => {
    if (!hasActivity) {
      return isToday ? '#404040' : '#2a2a2a';
    }
    return goal.color || '#3b82f6';
  };

  const getStreakOpacity = (hasActivity: boolean, index: number) => {
    if (!hasActivity) return 0.3;
    
    // More recent days have higher opacity
    const recency = (index + 1) / recentData.length;
    return Math.max(0.4, recency);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getWeekdayLabel = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className={`goal-streak-visualization ${className}`}>
      <div className="streak-header">
        <h4>Activity Streak</h4>
        <div className="streak-stats">
          <div className="streak-stat">
            <span className="streak-number">{currentStreak}</span>
            <span className="streak-label">Current</span>
          </div>
          <div className="streak-stat">
            <span className="streak-number">{longestStreak}</span>
            <span className="streak-label">Best</span>
          </div>
        </div>
      </div>

      {/* Calendar-style grid */}
      <div className="streak-calendar">
        <div className="calendar-grid">
          {recentData.map((day, index) => {
            const isToday = day.date === today;
            const dayOfWeek = new Date(day.date).getDay();
            
            return (
              <div
                key={day.date}
                className={`streak-day ${day.hasActivity ? 'active' : 'inactive'} ${isToday ? 'today' : ''}`}
                style={{
                  backgroundColor: getStreakColor(day.hasActivity, isToday),
                  opacity: getStreakOpacity(day.hasActivity, index),
                }}
                title={`${formatDate(day.date)}: ${day.hasActivity ? 'Active' : 'No activity'}`}
              >
                <span className="day-number">
                  {new Date(day.date).getDate()}
                </span>
                {day.hasActivity && day.value && (
                  <div className="day-value">
                    {goal.targetUnit === 'km' ? `${day.value.toFixed(1)}` : Math.round(day.value)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Week labels */}
        <div className="week-labels">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <span key={day} className="week-label">{day}</span>
          ))}
        </div>
      </div>

      {/* Streak insights */}
      <div className="streak-insights">
        <div className="insight-item">
          <span className="insight-icon">🔥</span>
          <span className="insight-text">
            {currentStreak > 0 
              ? `${currentStreak} day${currentStreak === 1 ? '' : 's'} streak!`
              : 'Start your streak today'
            }
          </span>
        </div>
        
        {currentStreak >= 7 && (
          <div className="insight-item">
            <span className="insight-icon">💪</span>
            <span className="insight-text">
              Great consistency this week!
            </span>
          </div>
        )}
        
        {currentStreak >= longestStreak && longestStreak > 0 && (
          <div className="insight-item">
            <span className="insight-icon">🏆</span>
            <span className="insight-text">
              Personal best streak!
            </span>
          </div>
        )}
        
        {currentStreak === 0 && longestStreak > 0 && (
          <div className="insight-item">
            <span className="insight-icon">🎯</span>
            <span className="insight-text">
              Beat your {longestStreak}-day record!
            </span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="streak-legend">
        <div className="legend-item">
          <div className="legend-color active" style={{ backgroundColor: goal.color || '#3b82f6' }}></div>
          <span>Active day</span>
        </div>
        <div className="legend-item">
          <div className="legend-color inactive"></div>
          <span>No activity</span>
        </div>
        <div className="legend-item">
          <div className="legend-color today"></div>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
};