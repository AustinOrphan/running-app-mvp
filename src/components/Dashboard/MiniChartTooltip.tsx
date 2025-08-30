import React from 'react';
import { formatDistance, formatPace } from '../../utils/formatters';

interface TooltipPayload {
  payload: {
    date?: string;
    distance?: number;
    pace?: number;
    name?: string;
    progress?: number;
  };
}

interface MiniChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  type: 'distance' | 'pace' | 'progress';
}

export const MiniChartTooltip: React.FC<MiniChartTooltipProps> = ({ active, payload, type }) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const data = payload[0].payload;

  return (
    <div className='mini-chart-tooltip'>
      {type === 'distance' && (
        <>
          <div className='tooltip-date'>{data.date}</div>
          <div className='tooltip-value'>{formatDistance(data.distance || 0)}</div>
        </>
      )}
      {type === 'pace' && (
        <>
          <div className='tooltip-date'>{data.date}</div>
          <div className='tooltip-value'>{formatPace(data.pace || 0)}</div>
        </>
      )}
      {type === 'progress' && (
        <>
          <div className='tooltip-title'>{data.name}</div>
          <div className='tooltip-value'>{Math.round(data.progress || 0)}%</div>
        </>
      )}

      <style>{`
        .mini-chart-tooltip {
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 0.5rem 0.75rem;
          border-radius: 4px;
          font-size: 0.75rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tooltip-date,
        .tooltip-title {
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.7rem;
          margin-bottom: 0.25rem;
        }

        .tooltip-value {
          font-weight: 600;
          color: white;
        }
      `}</style>
    </div>
  );
};
