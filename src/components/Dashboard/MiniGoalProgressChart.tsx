import React from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Goal } from '../../types/goals';
import { MiniChartTooltip } from './MiniChartTooltip';
import { useThemeColors } from '../../contexts/ThemeContext';

interface MiniGoalProgressChartProps {
  goals: Goal[];
  height?: number;
  color?: string;
}

export const MiniGoalProgressChart: React.FC<MiniGoalProgressChartProps> = ({
  goals,
  height = 60,
  color,
}) => {
  const { getThemeColor } = useThemeColors();

  const barColor = color || getThemeColor('#f59e0b', '#fbbf24');
  // Get active goals and their progress
  const chartData = goals
    .filter(goal => goal.isActive && !goal.isCompleted)
    .slice(0, 5) // Show up to 5 goals
    .map((goal, index) => {
      // Calculate progress percentage based on goal type
      let progress = 0;
      if (goal.currentValue > 0 && goal.targetValue > 0) {
        progress = Math.min((goal.currentValue / goal.targetValue) * 100, 100);
      }

      return {
        index,
        progress,
        name: goal.title.length > 10 ? goal.title.substring(0, 10) + '...' : goal.title,
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
        No active goals
      </div>
    );
  }

  return (
    <ResponsiveContainer width='100%' height={height}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <XAxis dataKey='index' axisLine={false} tickLine={false} tick={false} />
        <YAxis axisLine={false} tickLine={false} tick={false} domain={[0, 100]} />
        <Tooltip content={<MiniChartTooltip type='progress' />} />
        <Bar
          dataKey='progress'
          fill={barColor}
          radius={[2, 2, 0, 0]}
          style={{
            animation: 'chartBarGrow 0.8s ease-out',
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};
