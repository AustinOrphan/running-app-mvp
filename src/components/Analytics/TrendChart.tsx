import React, { useState } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useAuth } from '../../hooks/useAuth';
import { useStats } from '../../hooks/useStats';
import { formatPace } from '../../utils/formatters';

type MetricType = 'distance' | 'pace' | 'both';
type ChartType = 'line' | 'area';

interface TrendChartProps {
  period?: '3m' | '6m' | '1y';
  height?: number;
}

export const TrendChart: React.FC<TrendChartProps> = ({ period = '3m', height = 300 }) => {
  const { getToken } = useAuth();
  const { trendsData, loading } = useStats(getToken(), period);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('distance');
  const [chartType, setChartType] = useState<ChartType>('line');

  if (loading) {
    return (
      <div className='trend-chart trend-chart-loading'>
        <div className='trend-chart-header'>
          <div className='skeleton-line' style={{ width: '150px', height: '20px' }}></div>
          <div className='skeleton-line' style={{ width: '200px', height: '36px' }}></div>
        </div>
        <div className='skeleton-chart' style={{ height: `${height}px` }}>
          <div className='skeleton-chart-content'>
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className='skeleton-line'
                style={{
                  width: '100%',
                  height: `${20 + Math.random() * 40}px`,
                  marginBottom: '8px',
                }}
              ></div>
            ))}
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!trendsData || trendsData.length === 0) {
    return (
      <div className='trend-chart'>
        <div className='trend-chart-header'>
          <h3>Running Trends</h3>
        </div>
        <div className='trend-chart-empty'>
          <div className='empty-icon'>📈</div>
          <p>Not enough data for trends</p>
          <span>Add more runs to see your progress over time</span>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Format data for display
  const chartData = trendsData.map(point => ({
    ...point,
    displayDate: new Date(point.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    // Keep pace in seconds for proper charting
    pace: point.pace > 0 ? point.pace : null,
    distance: point.distance,
  }));

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{
      value: number;
      dataKey: string;
      name: string;
      color: string;
      payload?: { displayDate?: string };
    }>;
  }) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0]?.payload;
      return (
        <div className='trend-chart-tooltip'>
          <p className='tooltip-label'>{dataPoint?.displayDate || ''}</p>
          {payload.map((entry, index) => {
            const value =
              entry.dataKey === 'pace' && entry.value
                ? formatPace(entry.value)
                : entry.dataKey === 'distance'
                  ? `${entry.value.toFixed(1)} km`
                  : entry.value;

            return (
              <p key={index} className='tooltip-item' style={{ color: entry.color }}>
                <span className='tooltip-name'>{entry.name}: </span>
                <span className='tooltip-value'>{value}</span>
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 10, right: 30, left: 0, bottom: 0 },
    };

    const xAxisProps = {
      dataKey: 'displayDate',
      stroke: 'var(--color-text-secondary)',
      fontSize: 12,
      tickMargin: 8,
    };

    const yAxisProps = {
      stroke: 'var(--color-text-secondary)',
      fontSize: 12,
      tickMargin: 8,
    };

    if (chartType === 'area') {
      return (
        <AreaChart {...commonProps}>
          <defs>
            <linearGradient id='colorDistance' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--color-primary)' stopOpacity={0.8} />
              <stop offset='95%' stopColor='var(--color-primary)' stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id='colorPace' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='var(--color-success)' stopOpacity={0.8} />
              <stop offset='95%' stopColor='var(--color-success)' stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray='3 3' stroke='var(--color-border)' opacity={0.3} />
          <XAxis {...xAxisProps} />
          <YAxis
            {...yAxisProps}
            yAxisId='left'
            label={{
              value: 'Distance (km)',
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: 'var(--color-text-secondary)', fontSize: 12 },
            }}
          />
          {(selectedMetric === 'pace' || selectedMetric === 'both') && (
            <YAxis
              {...yAxisProps}
              yAxisId='right'
              orientation='right'
              tickFormatter={(value: number) => {
                if (!value || value <= 0) return '0';
                const minutes = Math.floor(value / 60);
                const seconds = Math.round(value % 60);
                return `${minutes}:${seconds.toString().padStart(2, '0')}`;
              }}
              label={{
                value: 'Pace (min/km)',
                angle: 90,
                position: 'insideRight',
                style: {
                  textAnchor: 'middle',
                  fill: 'var(--color-text-secondary)',
                  fontSize: 12,
                },
              }}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />

          {(selectedMetric === 'distance' || selectedMetric === 'both') && (
            <Area
              yAxisId='left'
              type='monotone'
              dataKey='distance'
              name='Distance'
              stroke='var(--color-primary)'
              strokeWidth={2}
              fillOpacity={1}
              fill='url(#colorDistance)'
            />
          )}

          {(selectedMetric === 'pace' || selectedMetric === 'both') && (
            <Area
              yAxisId={selectedMetric === 'both' ? 'right' : 'left'}
              type='monotone'
              dataKey='pace'
              name='Pace'
              stroke='var(--color-success)'
              strokeWidth={2}
              fillOpacity={1}
              fill='url(#colorPace)'
            />
          )}
        </AreaChart>
      );
    }

    // Line chart
    return (
      <LineChart {...commonProps}>
        <CartesianGrid strokeDasharray='3 3' stroke='var(--color-border)' opacity={0.3} />
        <XAxis {...xAxisProps} />
        <YAxis
          {...yAxisProps}
          yAxisId='left'
          label={{
            value: 'Distance (km)',
            angle: -90,
            position: 'insideLeft',
            style: { textAnchor: 'middle', fill: 'var(--color-text-secondary)', fontSize: 12 },
          }}
        />
        {(selectedMetric === 'pace' || selectedMetric === 'both') && (
          <YAxis
            {...yAxisProps}
            yAxisId='right'
            orientation='right'
            tickFormatter={(value: number) => {
              if (!value || value <= 0) return '0';
              const minutes = Math.floor(value / 60);
              const seconds = Math.round(value % 60);
              return `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }}
            label={{
              value: 'Pace (min/km)',
              angle: 90,
              position: 'insideRight',
              style: { textAnchor: 'middle', fill: 'var(--color-text-secondary)', fontSize: 12 },
            }}
          />
        )}
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ paddingTop: '20px' }} />

        {(selectedMetric === 'distance' || selectedMetric === 'both') && (
          <Line
            yAxisId='left'
            type='monotone'
            dataKey='distance'
            name='Distance'
            stroke='var(--color-primary)'
            strokeWidth={2}
            dot={{ fill: 'var(--color-primary)', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
        )}

        {(selectedMetric === 'pace' || selectedMetric === 'both') && (
          <Line
            yAxisId={selectedMetric === 'both' ? 'right' : 'left'}
            type='monotone'
            dataKey='pace'
            name='Pace'
            stroke='var(--color-success)'
            strokeWidth={2}
            dot={{ fill: 'var(--color-success)', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
        )}
      </LineChart>
    );
  };

  return (
    <div className='trend-chart'>
      <div className='trend-chart-header'>
        <h3>Running Trends</h3>
        <div className='trend-chart-controls'>
          <select
            value={selectedMetric}
            onChange={e => setSelectedMetric(e.target.value as MetricType)}
            className='metric-selector'
            aria-label='Metric selector'
          >
            <option value='distance'>Distance</option>
            <option value='pace'>Pace</option>
            <option value='both'>Both</option>
          </select>

          <select
            value={chartType}
            onChange={e => setChartType(e.target.value as ChartType)}
            className='chart-type-selector'
            aria-label='Chart type selector'
          >
            <option value='line'>Line</option>
            <option value='area'>Area</option>
          </select>
        </div>
      </div>

      <div className='trend-chart-container'>
        <ResponsiveContainer width='100%' height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </div>

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .trend-chart {
    background: var(--color-background-subtle);
    border-radius: var(--border-radius);
    padding: 1.5rem;
  }

  .trend-chart-loading {
    opacity: 0.6;
    pointer-events: none;
  }

  .trend-chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .trend-chart-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .trend-chart-controls {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .metric-selector,
  .chart-type-selector {
    padding: 0.5rem 1rem;
    border: 2px solid var(--color-border);
    border-radius: var(--border-radius);
    background: var(--color-background);
    color: var(--color-text-primary);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .metric-selector:hover,
  .chart-type-selector:hover {
    border-color: var(--color-primary);
  }

  .metric-selector:focus,
  .chart-type-selector:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .trend-chart-container {
    width: 100%;
  }

  .trend-chart-tooltip {
    background: var(--color-background);
    border: 2px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 0.75rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .tooltip-label {
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
  }

  .tooltip-item {
    margin: 0.25rem 0;
    font-size: 0.85rem;
  }

  .tooltip-name {
    font-weight: 500;
  }

  .tooltip-value {
    font-weight: 700;
  }

  .trend-chart-empty {
    text-align: center;
    padding: 3rem 1rem;
  }

  .trend-chart-empty .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .trend-chart-empty p {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.5rem 0;
  }

  .trend-chart-empty span {
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

  .skeleton-chart {
    display: flex;
    align-items: flex-end;
    padding: 1rem;
    background: var(--color-background);
    border-radius: var(--border-radius);
  }

  .skeleton-chart-content {
    width: 100%;
    display: flex;
    flex-direction: column-reverse;
    gap: 4px;
  }

  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  @media (max-width: 640px) {
    .trend-chart-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .trend-chart-controls {
      width: 100%;
    }

    .metric-selector,
    .chart-type-selector {
      flex: 1;
    }
  }
`;
