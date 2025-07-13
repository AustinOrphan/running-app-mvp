import React from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Run } from '../../types';
import { formatDate } from '../../utils/formatters';
import { MiniChartTooltip } from './MiniChartTooltip';
import { useThemeColors } from '../../contexts/ThemeContext';

interface MiniDistanceChartProps {
  runs: Run[];
  height?: number;
  color?: string;
  onClick?: () => void;
}

export const MiniDistanceChart: React.FC<MiniDistanceChartProps> = ({
  runs,
  height = 60,
  color,
  onClick,
}) => {
  const { getThemeColor } = useThemeColors();

  const lineColor = color || getThemeColor('#3b82f6', '#60a5fa');
  // Get last 7 runs and format for chart
  const chartData = runs
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-7)
    .map((run, index) => ({
      index,
      distance: run.distance,
      date: formatDate(run.date, 'weekday-short'),
    }));

  if (chartData.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-secondary)',
          fontSize: '0.75rem',
        }}
      >
        No data
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <ResponsiveContainer width='100%' height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <XAxis dataKey='index' axisLine={false} tickLine={false} tick={false} />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={false}
            domain={['dataMin - 1', 'dataMax + 1']}
          />
          <Tooltip content={<MiniChartTooltip type='distance' />} />
          <Line
            type='monotone'
            dataKey='distance'
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              stroke: lineColor,
              strokeWidth: 2,
              fill: getThemeColor('white', '#1f2937'),
              style: { transition: 'all 0.2s ease' },
            }}
            strokeDasharray='5 5'
            strokeDashoffset={0}
            style={{
              animation: 'chartLineGrow 1s ease-out',
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
