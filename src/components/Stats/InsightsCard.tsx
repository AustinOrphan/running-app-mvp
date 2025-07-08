import React from 'react';

import { WeeklyInsights } from '../../types';
import { formatDuration, formatPace } from '../../utils/formatters';

interface InsightsCardProps {
  insights: WeeklyInsights | null;
  loading: boolean;
}

export const InsightsCard: React.FC<InsightsCardProps> = ({ insights, loading }) => {
  if (loading) {
    return (
      <div className='insights-card'>
        <div className='insights-header'>
          <h3>Weekly Summary</h3>
          <span
            className='insights-period skeleton-line'
            style={{ width: '100px', height: '14px' }}
          ></span>
        </div>
        <div className='insights-grid'>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className='insight-item'>
              <div className='skeleton-line' style={{ width: '60px', height: '24px' }}></div>
              <div
                className='skeleton-line'
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
      <div className='insights-card'>
        <div className='insights-header'>
          <h3>Weekly Summary</h3>
        </div>
        <div className='empty-insights'>
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
    <div className='insights-card'>
      <div className='insights-header'>
        <h3>Weekly Summary</h3>
        <span className='insights-period'>
          {weekStart} - {weekEnd}
        </span>
      </div>

      <div className='insights-grid'>
        <div className='insight-item'>
          <div className='insight-value'>{insights.totalRuns}</div>
          <div className='insight-label'>Runs</div>
        </div>

        <div className='insight-item'>
          <div className='insight-value'>{insights.totalDistance}km</div>
          <div className='insight-label'>Distance</div>
        </div>

        <div className='insight-item'>
          <div className='insight-value'>{formatDuration(insights.totalDuration)}</div>
          <div className='insight-label'>Time</div>
        </div>

        <div className='insight-item'>
          <div className='insight-value'>
            {insights.avgPace > 0 ? formatPace(insights.avgPace) : '-'}
          </div>
          <div className='insight-label'>Avg Pace</div>
        </div>
      </div>

      {insights.totalRuns > 0 && (
        <div className='insights-footer'>
          <div className='insight-stat'>
            <span className='stat-label'>Avg Distance: </span>
            <span className='stat-value'>
              {(insights.totalDistance / insights.totalRuns).toFixed(1)}km
            </span>
          </div>
          <div className='insight-stat'>
            <span className='stat-label'>Avg Duration: </span>
            <span className='stat-value'>
              {formatDuration(Math.floor(insights.totalDuration / insights.totalRuns))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
