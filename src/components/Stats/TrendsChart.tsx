import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendsDataPoint } from '../../types';

interface TrendsChartProps {
  data: TrendsDataPoint[];
  loading: boolean;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const date = new Date(label).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    
    return (
      <div className="chart-tooltip">
        <p className="tooltip-label">Week of {date}</p>
        <p className="tooltip-item">
          Distance: <span className="tooltip-value">{data.distance}km</span>
        </p>
        <p className="tooltip-item">
          Avg Pace: <span className="tooltip-value">
            {data.pace > 0 ? `${Math.floor(data.pace / 60)}:${(data.pace % 60).toString().padStart(2, '0')}/km` : '-'}
          </span>
        </p>
      </div>
    );
  }
  return null;
};

export const TrendsChart: React.FC<TrendsChartProps> = ({ data, loading }) => {
  const [selectedMetric, setSelectedMetric] = useState<'distance' | 'pace'>('distance');

  if (loading) {
    return (
      <div className="trends-chart-card">
        <div className="trends-header">
          <h3>Running Trends</h3>
          <div className="trends-controls">
            <div className="skeleton-line" style={{width: '80px', height: '32px'}}></div>
          </div>
        </div>
        <div className="chart-loading">
          <div className="skeleton-chart">
            <div className="skeleton-line-chart">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton-line" style={{
                  width: '100%', 
                  height: `${20 + Math.random() * 40}px`,
                  marginBottom: '4px'
                }}></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="trends-chart-card">
        <div className="trends-header">
          <h3>Running Trends</h3>
        </div>
        <div className="empty-chart">
          <div className="empty-icon">📈</div>
          <p>Not enough data for trends</p>
          <span>Add more runs to see your progress over time</span>
        </div>
      </div>
    );
  }

  // Format data for display
  const chartData = data.map(point => ({
    ...point,
    displayDate: new Date(point.date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    }),
  }));

  const getYAxisLabel = () => {
    return selectedMetric === 'distance' ? 'Distance (km)' : 'Pace (min/km)';
  };

  const getDataKey = () => {
    return selectedMetric === 'distance' ? 'distance' : 'pace';
  };

  const getLineColor = () => {
    return selectedMetric === 'distance' ? '#3b82f6' : '#10b981';
  };

  // Keep pace in seconds for correct display (tooltip expects seconds)
  const processedData = chartData.map(point => ({
    ...point,
    pace: point.pace > 0 ? point.pace : 0, // Keep in seconds for correct display
  }));

  return (
    <div className="trends-chart-card">
      <div className="trends-header">
        <h3>Running Trends</h3>
        <div className="trends-controls">
          <select 
            value={selectedMetric} 
            onChange={(e) => setSelectedMetric(e.target.value as 'distance' | 'pace')}
            className="metric-selector"
          >
            <option value="distance">Distance</option>
            <option value="pace">Pace</option>
          </select>
        </div>
      </div>
      
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={processedData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              dataKey="displayDate" 
              stroke="rgba(255,255,255,0.6)"
              fontSize={12}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.6)"
              fontSize={12}
              label={{ 
                value: getYAxisLabel(), 
                angle: -90, 
                position: 'insideLeft',
                style: { textAnchor: 'middle', fill: 'rgba(255,255,255,0.6)' }
              }}
              tickFormatter={selectedMetric === 'pace' ? (value: number) => {
                if (value <= 0) return '0';
                const totalSeconds = Math.round(value);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                return `${minutes}:${seconds.toString().padStart(2, '0')}`;
              } : undefined}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey={getDataKey()}
              stroke={getLineColor()}
              strokeWidth={2}
              dot={{ fill: getLineColor(), strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: getLineColor(), strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="trends-summary">
        <div className="trend-stat">
          <span className="stat-label">Total weeks: </span>
          <span className="stat-value">{data.length}</span>
        </div>
        <div className="trend-stat">
          <span className="stat-label">Best week: </span>
          <span className="stat-value">
            {Math.max(...data.map(d => d.distance)).toFixed(1)}km
          </span>
        </div>
        <div className="trend-stat">
          <span className="stat-label">Avg weekly: </span>
          <span className="stat-value">
            {(data.reduce((sum, d) => sum + d.distance, 0) / data.length).toFixed(1)}km
          </span>
        </div>
      </div>
    </div>
  );
};