import React from 'react';
import { Run } from '../../types';
import { formatDistance } from '../../utils/formatters';
import { SkeletonLoader, SkeletonStyles } from './SkeletonLoader';

interface ActivityHeatmapProps {
  runs: Run[];
  weeks?: number;
  loading?: boolean;
}

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({
  runs,
  weeks = 12,
  loading = false,
}) => {
  if (loading) {
    return (
      <div>
        <SkeletonStyles />
        <SkeletonLoader type='heatmap' />
      </div>
    );
  }
  // Calculate activity data for the heatmap
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - weeks * 7);

  // Create a map of date strings to run data
  const runsByDate = runs.reduce(
    (acc, run) => {
      const dateStr = new Date(run.date).toISOString().split('T')[0];
      if (!acc[dateStr]) {
        acc[dateStr] = [];
      }
      acc[dateStr].push(run);
      return acc;
    },
    {} as Record<string, Run[]>
  );

  // Generate all dates for the heatmap
  const dates = [];
  const currentDate = new Date(startDate);
  while (currentDate <= today) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Group dates by week
  const weekGroups = [];
  for (let i = 0; i < dates.length; i += 7) {
    weekGroups.push(dates.slice(i, i + 7));
  }

  const getActivityLevel = (date: Date): { level: number; distance: number; runs: number } => {
    const dateStr = date.toISOString().split('T')[0];
    const dayRuns = runsByDate[dateStr] || [];
    const totalDistance = dayRuns.reduce((sum, run) => sum + run.distance, 0);

    let level = 0;
    if (totalDistance > 0) level = 1;
    if (totalDistance > 5) level = 2;
    if (totalDistance > 10) level = 3;
    if (totalDistance > 15) level = 4;

    return { level, distance: totalDistance, runs: dayRuns.length };
  };

  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className='activity-heatmap'>
      <div className='heatmap-header'>
        <h3>Activity Overview</h3>
        <span className='heatmap-subtitle'>Last {weeks} weeks</span>
      </div>

      <div className='heatmap-container'>
        <div className='weekday-labels'>
          {weekDays.map((day, index) => (
            <div key={index} className='weekday-label'>
              {day}
            </div>
          ))}
        </div>

        <div className='heatmap-grid'>
          {weekGroups.map((week, weekIndex) => (
            <div key={weekIndex} className='week-column'>
              {week.map((date, dayIndex) => {
                const { level, distance, runs } = getActivityLevel(date);
                const isToday = date.toDateString() === today.toDateString();
                const isFuture = date > today;

                return (
                  <div
                    key={dayIndex}
                    className={`day-cell level-${level} ${isToday ? 'today' : ''} ${
                      isFuture ? 'future' : ''
                    }`}
                    style={{
                      animationDelay: `${(weekIndex * 7 + dayIndex) * 0.02}s`,
                    }}
                    title={
                      !isFuture
                        ? `${date.toLocaleDateString()}: ${runs} run${
                            runs !== 1 ? 's' : ''
                          }, ${formatDistance(distance)}`
                        : ''
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className='heatmap-legend'>
          <span className='legend-label'>Less</span>
          <div className='legend-cells'>
            {[0, 1, 2, 3, 4].map(level => (
              <div key={level} className={`day-cell level-${level}`} />
            ))}
          </div>
          <span className='legend-label'>More</span>
        </div>
      </div>

      <style>{`
        .activity-heatmap {
          background: var(--color-background-subtle);
          border-radius: var(--border-radius);
          padding: 1.5rem;
        }

        .heatmap-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .heatmap-header h3 {
          margin: 0;
          font-size: 1rem;
          color: var(--color-text-primary);
        }

        .heatmap-subtitle {
          font-size: 0.875rem;
          color: var(--color-text-secondary);
        }

        .heatmap-container {
          display: flex;
          gap: 0.5rem;
        }

        .weekday-labels {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-right: 0.5rem;
        }

        .weekday-label {
          height: 12px;
          width: 12px;
          font-size: 0.7rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-secondary);
        }

        .heatmap-grid {
          display: flex;
          gap: 2px;
          flex: 1;
          overflow-x: auto;
          padding-bottom: 0.5rem;
        }

        .week-column {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .day-cell {
          width: 12px;
          height: 12px;
          border-radius: 2px;
          background: var(--color-background);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: scaleIn 0.4s ease-out both;
          transform-origin: center;
        }

        .day-cell:hover {
          transform: scale(1.3);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
          z-index: 10;
          position: relative;
        }

        .day-cell.level-0 {
          background: var(--color-background);
          opacity: 0.8;
        }

        .day-cell.level-1 {
          background: rgba(52, 211, 153, 0.3);
        }

        .day-cell.level-2 {
          background: rgba(52, 211, 153, 0.5);
        }

        .day-cell.level-3 {
          background: rgba(52, 211, 153, 0.7);
        }

        .day-cell.level-4 {
          background: rgba(52, 211, 153, 0.9);
        }

        .day-cell.today {
          border: 2px solid var(--color-primary);
          width: 10px;
          height: 10px;
        }

        .day-cell.future {
          background: transparent;
          cursor: default;
        }

        .day-cell.future:hover {
          transform: none;
          box-shadow: none;
        }

        .heatmap-legend {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 1rem;
          font-size: 0.75rem;
          color: var(--color-text-secondary);
        }

        .legend-cells {
          display: flex;
          gap: 2px;
        }

        .legend-label {
          font-size: 0.7rem;
        }

        @media (max-width: 768px) {
          .activity-heatmap {
            padding: 1rem;
          }

          .heatmap-grid {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
};
