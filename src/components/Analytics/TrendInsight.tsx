import React from 'react';
import { TrendAnalysis } from '../../types';

interface TrendInsightProps {
  trends: TrendAnalysis | null;
  loading?: boolean;
}

export const TrendInsight: React.FC<TrendInsightProps> = ({ trends, loading = false }) => {
  if (loading) {
    return (
      <div className="trend-insight trend-insight-loading">
        <div className="trend-header">
          <div className="skeleton-line" style={{ width: '150px', height: '20px' }}></div>
        </div>
        <div className="trend-indicators">
          {[1, 2, 3].map(i => (
            <div key={i} className="trend-indicator">
              <div className="skeleton-line" style={{ width: '100%', height: '80px' }}></div>
            </div>
          ))}
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!trends) {
    return (
      <div className="trend-insight">
        <div className="trend-empty">
          <div className="empty-icon">📊</div>
          <p>Not enough data for trends</p>
          <span>Add more runs to see your progress trends</span>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  const getTrendIcon = (trend: 'improving' | 'stable' | 'declining') => {
    switch (trend) {
      case 'improving':
        return '📈';
      case 'declining':
        return '📉';
      case 'stable':
        return '➡️';
    }
  };

  const getTrendColor = (trend: 'improving' | 'stable' | 'declining') => {
    switch (trend) {
      case 'improving':
        return 'var(--color-success, #10b981)';
      case 'declining':
        return 'var(--color-warning, #f59e0b)';
      case 'stable':
        return 'var(--color-info, #3b82f6)';
    }
  };

  const getVolumeTrendIcon = (trend: 'increasing' | 'stable' | 'decreasing') => {
    switch (trend) {
      case 'increasing':
        return '📈';
      case 'decreasing':
        return '📉';
      case 'stable':
        return '➡️';
    }
  };

  const getVolumeTrendColor = (trend: 'increasing' | 'stable' | 'decreasing') => {
    switch (trend) {
      case 'increasing':
        return 'var(--color-success, #10b981)';
      case 'decreasing':
        return 'var(--color-warning, #f59e0b)';
      case 'stable':
        return 'var(--color-info, #3b82f6)';
    }
  };

  const formatPercentChange = (value: number) => {
    const abs = Math.abs(value);
    return value > 0 ? `+${abs.toFixed(1)}%` : value < 0 ? `-${abs.toFixed(1)}%` : '0%';
  };

  const getConsistencyLevel = (score: number) => {
    if (score >= 0.8) return { label: 'Excellent', color: 'var(--color-success, #10b981)' };
    if (score >= 0.6) return { label: 'Good', color: 'var(--color-info, #3b82f6)' };
    if (score >= 0.4) return { label: 'Fair', color: 'var(--color-warning, #f59e0b)' };
    return { label: 'Low', color: 'var(--color-danger, #ef4444)' };
  };

  const paceTrendLabel = trends.paceTrend.charAt(0).toUpperCase() + trends.paceTrend.slice(1);
  const volumeTrendLabel =
    trends.volumeTrend.charAt(0).toUpperCase() + trends.volumeTrend.slice(1);
  const consistency = getConsistencyLevel(trends.consistencyScore);

  return (
    <div className="trend-insight">
      <div className="trend-header">
        <h3>Performance Trends</h3>
        <span className="trend-period">
          Last {trends.dataPoints} {trends.period === 'weekly' ? 'weeks' : 'months'}
        </span>
      </div>

      <div className="trend-indicators">
        {/* Pace Trend */}
        <div
          className="trend-indicator"
          style={{ '--trend-color': getTrendColor(trends.paceTrend) } as React.CSSProperties}
        >
          <div className="trend-icon">{getTrendIcon(trends.paceTrend)}</div>
          <div className="trend-content">
            <div className="trend-label">Pace</div>
            <div className="trend-value">{paceTrendLabel}</div>
            <div className="trend-change">{formatPercentChange(trends.paceChangePercent)}</div>
          </div>
          <div className="trend-bar">
            <div
              className="trend-bar-fill"
              style={{
                width: `${Math.min(Math.abs(trends.paceChangePercent), 100)}%`,
              }}
            ></div>
          </div>
        </div>

        {/* Volume Trend */}
        <div
          className="trend-indicator"
          style={
            { '--trend-color': getVolumeTrendColor(trends.volumeTrend) } as React.CSSProperties
          }
        >
          <div className="trend-icon">{getVolumeTrendIcon(trends.volumeTrend)}</div>
          <div className="trend-content">
            <div className="trend-label">Volume</div>
            <div className="trend-value">{volumeTrendLabel}</div>
            <div className="trend-change">{formatPercentChange(trends.volumeChangePercent)}</div>
          </div>
          <div className="trend-bar">
            <div
              className="trend-bar-fill"
              style={{
                width: `${Math.min(Math.abs(trends.volumeChangePercent), 100)}%`,
              }}
            ></div>
          </div>
        </div>

        {/* Consistency */}
        <div
          className="trend-indicator"
          style={{ '--trend-color': consistency.color } as React.CSSProperties}
        >
          <div className="trend-icon">🎯</div>
          <div className="trend-content">
            <div className="trend-label">Consistency</div>
            <div className="trend-value">{consistency.label}</div>
            <div className="trend-change">{(trends.consistencyScore * 100).toFixed(0)}%</div>
          </div>
          <div className="trend-bar">
            <div
              className="trend-bar-fill"
              style={{
                width: `${trends.consistencyScore * 100}%`,
              }}
            ></div>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .trend-insight {
    background: var(--color-background-subtle);
    border-radius: var(--border-radius);
    padding: 1.5rem;
  }

  .trend-insight-loading {
    opacity: 0.6;
    pointer-events: none;
  }

  .trend-header {
    margin-bottom: 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .trend-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .trend-period {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .trend-indicators {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  @media (min-width: 640px) {
    .trend-indicators {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .trend-indicator {
    background: var(--color-background);
    border-radius: var(--border-radius);
    padding: 1.25rem;
    border: 2px solid transparent;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }

  .trend-indicator::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--trend-color);
    opacity: 0.8;
  }

  .trend-indicator:hover {
    border-color: var(--trend-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .trend-icon {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }

  .trend-content {
    margin-bottom: 1rem;
  }

  .trend-label {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .trend-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin-bottom: 0.25rem;
  }

  .trend-change {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--trend-color);
  }

  .trend-bar {
    height: 6px;
    background: var(--color-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .trend-bar-fill {
    height: 100%;
    background: var(--trend-color);
    border-radius: 3px;
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .trend-empty {
    text-align: center;
    padding: 2rem;
  }

  .trend-empty .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .trend-empty p {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.5rem 0;
  }

  .trend-empty span {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .skeleton-line {
    background: linear-gradient(
      90deg,
      var(--color-background-subtle) 25%,
      var(--color-border) 50%,
      var(--color-background-subtle) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4px;
  }

  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }
`;
