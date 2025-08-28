import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

import { RunTypeBreakdown } from '../../types';

interface RunTypeBreakdownChartProps {
  data: RunTypeBreakdown[];
  loading: boolean;
}

const COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Yellow
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#84cc16', // Lime
  '#f97316', // Orange
];

interface RunTypeTooltipPayload {
  tag: string;
  count: number;
  totalDistance: number;
  avgPace: number;
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: RunTypeTooltipPayload }>;
}) => {
  if (active && payload?.length) {
    const data = payload[0].payload as RunTypeTooltipPayload;
    return (
      <div className='chart-tooltip'>
        <p className='tooltip-label'>{data.tag}</p>
        <p className='tooltip-item'>
          <span className='tooltip-value'>{data.count}</span> runs
        </p>
        <p className='tooltip-item'>
          <span className='tooltip-value'>{data.totalDistance}km</span> total
        </p>
        <p className='tooltip-item'>
          Avg pace:{' '}
          <span className='tooltip-value'>
            {data.avgPace > 0 && isFinite(data.avgPace)
              ? `${Math.floor(data.avgPace / 60)}:${(data.avgPace % 60).toString().padStart(2, '0')}/km`
              : '-'}
          </span>
        </p>
      </div>
    );
  }
  return null;
};

export const RunTypeBreakdownChart: React.FC<RunTypeBreakdownChartProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <div className='chart-card'>
        <h3>Run Type Breakdown</h3>
        <div className='chart-loading'>
          <div className='skeleton-chart'>
            <div className='skeleton-circle'></div>
            <div className='skeleton-legend'>
              {[1, 2, 3].map(i => (
                <div key={i} className='skeleton-legend-item'>
                  <div className='skeleton-line' style={{ width: '12px', height: '12px' }}></div>
                  <div className='skeleton-line' style={{ width: '60px', height: '14px' }}></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className='chart-card'>
        <h3>Run Type Breakdown</h3>
        <div className='empty-chart'>
          <div className='empty-icon'>📊</div>
          <p>No run data available</p>
          <span>Add some runs with tags to see breakdown</span>
        </div>
      </div>
    );
  }

  // Prepare data for the chart - add percentage and color
  const totalCount = data.reduce((sum, d) => sum + d.count, 0);
  const chartData = data.map((item, index) => ({
    ...item,
    percentage: totalCount === 0 ? '0.0' : ((item.count / totalCount) * 100).toFixed(1),
    color: COLORS[index % COLORS.length],
  }));

  return (
    <div className='chart-card'>
      <h3>Run Type Breakdown</h3>

      <div className='chart-container' role='img' aria-label='Run type breakdown chart'>
        <ResponsiveContainer width='100%' height={250}>
          <PieChart>
            <Pie
              data={chartData}
              cx='50%'
              cy='50%'
              innerRadius={40}
              outerRadius={80}
              paddingAngle={2}
              dataKey='count'
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${entry.tag}-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className='chart-legend'>
        {chartData.map((item, index) => (
          <div key={`${item.tag}-${index}`} className='legend-item'>
            <div className='legend-color' style={{ backgroundColor: item.color }}></div>
            <div className='legend-content'>
              <div className='legend-label'>{item.tag}</div>
              <div className='legend-stats'>
                {item.count} runs ({item.percentage}%) • {item.totalDistance?.toFixed(1) || '0.0'}km
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
