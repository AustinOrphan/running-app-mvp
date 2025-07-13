import React from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Run } from '../../types';
import { formatDate } from '../../utils/formatters';
import { MiniChartTooltip } from './MiniChartTooltip';
import { useThemeColors } from '../../contexts/ThemeContext';

interface MiniPaceChartProps {
  runs: Run[];
  height?: number;
  color?: string;
}

export const MiniPaceChart: React.FC<MiniPaceChartProps> = ({ runs, height = 60, color }) => {
  const { getThemeColor } = useThemeColors();

  const lineColor = color || getThemeColor('#22c55e', '#4ade80');
  // Get last 7 runs and calculate pace
  const chartData = runs
    .filter(run => run.duration > 0 && run.distance > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-7)
    .map((run, index) => {
      const pace = run.duration / run.distance; // seconds per km
      return {
        index,
        pace,
        date: formatDate(run.date, 'weekday-short'),
      };
    });

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
    <ResponsiveContainer width='100%' height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <XAxis dataKey='index' axisLine={false} tickLine={false} tick={false} />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={false}
          domain={['dataMin - 10', 'dataMax + 10']}
        />
        <Tooltip content={<MiniChartTooltip type='pace' />} />
        <Line
          type='monotone'
          dataKey='pace'
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          activeDot={{
            r: 3,
            stroke: lineColor,
            strokeWidth: 1,
            fill: getThemeColor('white', '#1f2937'),
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
