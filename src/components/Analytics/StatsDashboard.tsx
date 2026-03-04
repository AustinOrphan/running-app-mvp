import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAnalyticsStatistics } from '../../hooks/useAnalyticsStatistics';
import { StatsCard } from './StatsCard';
import { formatDistance, formatPace, formatDuration } from '../../utils/formatters';

type PeriodType = 'weekly' | 'monthly' | 'yearly';

export const StatsDashboard: React.FC = () => {
  const { getToken } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('weekly');
  const { statistics, loading, error } = useAnalyticsStatistics(getToken(), selectedPeriod);

  const periods: Array<{ value: PeriodType; label: string; icon: string }> = [
    { value: 'weekly', label: 'This Week', icon: '📅' },
    { value: 'monthly', label: 'This Month', icon: '📊' },
    { value: 'yearly', label: 'This Year', icon: '🗓️' },
  ];

  const formatPeriodDate = () => {
    if (!statistics) return '';

    const start = new Date(statistics.startDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const end = new Date(statistics.endDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return `${start} - ${end}`;
  };

  if (error) {
    return (
      <div className='stats-dashboard-error'>
        <div className='error-icon'>⚠️</div>
        <div className='error-message'>{error}</div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className='stats-dashboard'>
      <div className='stats-dashboard-header'>
        <div className='period-selector' role='group' aria-label='Statistics time period'>
          {periods.map(period => (
            <button
              key={period.value}
              className={`period-button ${selectedPeriod === period.value ? 'active' : ''}`}
              onClick={() => setSelectedPeriod(period.value)}
              disabled={loading}
              aria-pressed={selectedPeriod === period.value}
            >
              <span className='period-icon' aria-hidden='true'>
                {period.icon}
              </span>
              <span className='period-label'>{period.label}</span>
            </button>
          ))}
        </div>
        {statistics && <div className='period-date'>{formatPeriodDate()}</div>}
      </div>

      {loading || !statistics ? (
        <div className='stats-grid' aria-busy='true' aria-label='Loading statistics'>
          {Array.from({ length: 6 }).map((_, i) => (
            <StatsCard key={i} icon='📊' label='Loading...' value='--' loading={true} />
          ))}
        </div>
      ) : statistics.totalRuns === 0 ? (
        <div className='stats-empty'>
          <div className='empty-icon'>🏃‍♂️</div>
          <div className='empty-message'>No runs in this period</div>
          <div className='empty-hint'>Start logging runs to see your stats!</div>
        </div>
      ) : (
        <div className='stats-grid'>
          <StatsCard
            icon='🏃‍♂️'
            label='Total Runs'
            value={statistics.totalRuns}
            color='var(--color-primary)'
          />

          <StatsCard
            icon='📏'
            label='Total Distance'
            value={formatDistance(statistics.totalDistance)}
            subValue={`${formatDistance(statistics.totalDistance / statistics.totalRuns)} avg`}
            color='var(--color-success)'
          />

          <StatsCard
            icon='⏱️'
            label='Total Time'
            value={formatDuration(statistics.totalDuration)}
            color='var(--color-info)'
          />

          <StatsCard
            icon='⚡'
            label='Avg Pace'
            value={statistics.avgPace > 0 ? formatPace(statistics.avgPace) : '--'}
            subValue={
              statistics.fastestPace > 0 && statistics.fastestPace !== Infinity
                ? `${formatPace(statistics.fastestPace)} best`
                : undefined
            }
            trend={
              statistics.fastestPace < statistics.avgPace && statistics.fastestPace > 0
                ? 'up'
                : 'neutral'
            }
            color='var(--color-warning)'
          />

          <StatsCard
            icon='🔝'
            label='Longest Run'
            value={formatDistance(statistics.longestRun)}
            color='var(--color-primary)'
          />

          {statistics.totalElevation !== undefined && statistics.totalElevation > 0 && (
            <StatsCard
              icon='⛰️'
              label='Total Elevation'
              value={`${Math.round(statistics.totalElevation)}m`}
              subValue={`${Math.round(statistics.totalElevation / statistics.totalRuns)}m avg`}
              color='var(--color-success)'
            />
          )}

          {statistics.avgHeartRate !== undefined && statistics.avgHeartRate > 0 && (
            <StatsCard
              icon='❤️'
              label='Avg Heart Rate'
              value={`${statistics.avgHeartRate} bpm`}
              subValue={statistics.maxHeartRate ? `${statistics.maxHeartRate} max` : undefined}
              color='var(--color-danger, #ef4444)'
            />
          )}
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .stats-dashboard {
    width: 100%;
  }

  .stats-dashboard-header {
    margin-bottom: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  @media (min-width: 768px) {
    .stats-dashboard-header {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }
  }

  .period-selector {
    display: flex;
    gap: 0.5rem;
    background: var(--color-background-subtle);
    padding: 0.25rem;
    border-radius: var(--border-radius);
    flex-wrap: wrap;
  }

  .period-button {
    flex: 1;
    min-width: 100px;
    padding: 0.75rem 1rem;
    border: 2px solid transparent;
    border-radius: calc(var(--border-radius) - 2px);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .period-button:hover:not(:disabled) {
    background: var(--color-background);
    color: var(--color-text-primary);
  }

  .period-button.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }

  .period-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .period-icon {
    font-size: 1.1rem;
  }

  .period-label {
    font-size: 0.85rem;
  }

  @media (max-width: 767px) {
    .period-button {
      flex: 1 1 calc(50% - 0.25rem);
    }
  }

  .period-date {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    text-align: center;
    padding: 0.5rem;
  }

  @media (min-width: 768px) {
    .period-date {
      text-align: right;
    }
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  @media (min-width: 640px) {
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .stats-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .stats-empty {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--color-background-subtle);
    border-radius: var(--border-radius);
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .empty-message {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
  }

  .empty-hint {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .stats-dashboard-error {
    text-align: center;
    padding: 2rem;
    background: var(--color-background-subtle);
    border-radius: var(--border-radius);
    border: 2px solid var(--color-danger, #ef4444);
  }

  .error-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  .error-message {
    color: var(--color-danger, #ef4444);
    font-weight: 500;
  }
`;
