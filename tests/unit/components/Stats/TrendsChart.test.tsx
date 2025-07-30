import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TrendsChart } from '../../../../src/components/Stats/TrendsChart';
import { mockTrendsData, createMockTrendsData } from '../../../fixtures/mockData.js';

// Mock recharts components
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid='line-chart'>{children}</div>,
  Line: () => <div data-testid='line' />,
  XAxis: () => <div data-testid='x-axis' />,
  YAxis: () => <div data-testid='y-axis' />,
  CartesianGrid: () => <div data-testid='cartesian-grid' />,
  Tooltip: () => <div data-testid='tooltip' />,
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid='responsive-container'>{children}</div>
  ),
}));

describe('TrendsChart', () => {
  describe('Loading State', () => {
    it('renders loading skeleton when loading is true', () => {
      render(<TrendsChart data={[]} loading={true} />);

      expect(screen.getByText('Running Trends')).toBeInTheDocument();
      expect(screen.getByTestId('skeleton-line')).toBeInTheDocument();
    });

    it('displays skeleton chart with correct structure', () => {
      const { container } = render(<TrendsChart data={[]} loading={true} />);

      // With CSS modules, we need to look for elements that contain the class names
      const skeletonChart = container.querySelector('[class*="skeletonChart"]');
      const skeletonLineChart = container.querySelector('[class*="skeletonLineChart"]');

      expect(skeletonChart).toBeInTheDocument();
      expect(skeletonLineChart).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when no data and not loading', () => {
      render(<TrendsChart data={[]} loading={false} />);

      expect(screen.getByText('Running Trends')).toBeInTheDocument();
      expect(screen.getByText('Not enough data for trends')).toBeInTheDocument();
      expect(screen.getByText('Add more runs to see your progress over time')).toBeInTheDocument();
      expect(screen.getByText('📈')).toBeInTheDocument();
    });
  });

  describe('Data State', () => {
    it('renders chart with data correctly', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      expect(screen.getByText('Running Trends')).toBeInTheDocument();
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('renders metric selector with correct options', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      const selector = screen.getByRole('combobox');
      expect(selector).toBeInTheDocument();
      expect(selector).toHaveValue('distance');

      const distanceOption = screen.getByRole('option', { name: 'Distance' });
      const paceOption = screen.getByRole('option', { name: 'Pace' });

      expect(distanceOption).toBeInTheDocument();
      expect(paceOption).toBeInTheDocument();
    });

    it('switches between distance and pace metrics', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      const selector = screen.getByRole('combobox');

      // Initially should be distance
      expect(selector).toHaveValue('distance');

      // Switch to pace
      fireEvent.change(selector, { target: { value: 'pace' } });
      expect(selector).toHaveValue('pace');
    });

    it('displays summary statistics correctly', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      const totalWeeksLabel = screen.getByText('Total weeks:');
      expect(totalWeeksLabel).toBeInTheDocument();
      expect(totalWeeksLabel.nextSibling?.textContent).toBe(String(mockTrendsData.length));

      expect(screen.getByText(/Best week:/)).toBeInTheDocument();
      expect(screen.getByText(/Avg weekly:/)).toBeInTheDocument();
    });

    it('calculates best week correctly', () => {
      const testData = createMockTrendsData(4);
      testData[1].distance = 50.5; // Make this the highest

      render(<TrendsChart data={testData} loading={false} />);

      const bestLabel = screen.getByText('Best week:');
      expect(bestLabel.nextSibling?.textContent).toBe('50.5km');
    });

    it('calculates average weekly distance correctly', () => {
      const testData = [
        { date: '2024-01-01', distance: 20, duration: 6000, pace: 300, weeklyDistance: 20 },
        { date: '2024-01-08', distance: 30, duration: 9000, pace: 300, weeklyDistance: 30 },
        { date: '2024-01-15', distance: 40, duration: 12000, pace: 300, weeklyDistance: 40 },
      ];

      render(<TrendsChart data={testData} loading={false} />);

      // Average should be (20 + 30 + 40) / 3 = 30.0
      const avgLabel = screen.getByText('Avg weekly:');
      expect(avgLabel.nextSibling?.textContent).toBe('30.0km');
    });
  });

  describe('Chart Components', () => {
    it('renders all chart components when data is present', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
      expect(screen.getByTestId('line')).toBeInTheDocument();
      expect(screen.getByTestId('x-axis')).toBeInTheDocument();
      expect(screen.getByTestId('y-axis')).toBeInTheDocument();
      expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument();
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('has correct CSS classes for styling', () => {
      const { container } = render(<TrendsChart data={mockTrendsData} loading={false} />);

      // With CSS modules, we need to match partial class names
      expect(container.querySelector('[class*="trendsChartCard"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="trendsHeader"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="trendsControls"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="chartContainer"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="trendsSummary"]')).toBeInTheDocument();
    });
  });

  describe('Metric Selector', () => {
    it('has correct styling classes', () => {
      const { container } = render(<TrendsChart data={mockTrendsData} loading={false} />);

      const selector = container.querySelector('[class*="metricSelector"]');
      expect(selector).toBeInTheDocument();
    });

    it('updates chart when metric changes', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      const selector = screen.getByRole('combobox');

      // Change to pace metric
      fireEvent.change(selector, { target: { value: 'pace' } });

      // Chart should still be rendered with new metric
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
      expect(selector).toHaveValue('pace');
    });
  });

  describe('Edge Cases', () => {
    it('handles single data point', () => {
      const singleDataPoint = [mockTrendsData[0]];

      render(<TrendsChart data={singleDataPoint} loading={false} />);

      const weeksLabel1 = screen.getByText('Total weeks:');
      expect(weeksLabel1.nextSibling?.textContent).toBe('1');
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('handles zero distance values', () => {
      const dataWithZeros = [
        { date: '2024-01-01', distance: 0, duration: 0, pace: 0, weeklyDistance: 0 },
        { date: '2024-01-08', distance: 10, duration: 3000, pace: 300, weeklyDistance: 10 },
      ];

      render(<TrendsChart data={dataWithZeros} loading={false} />);

      const weeksLabel2 = screen.getByText('Total weeks:');
      expect(weeksLabel2.nextSibling?.textContent).toBe('2');
      const bestLabel2 = screen.getByText('Best week:');
      expect(bestLabel2.nextSibling?.textContent).toBe('10.0km');
    });

    it('handles very large numbers', () => {
      const largeData = [
        { date: '2024-01-01', distance: 999.9, duration: 299970, pace: 300, weeklyDistance: 999.9 },
      ];

      render(<TrendsChart data={largeData} loading={false} />);

      const bestLabel3 = screen.getByText('Best week:');
      expect(bestLabel3.nextSibling?.textContent).toBe('999.9km');
      const avgLabel3 = screen.getByText('Avg weekly:');
      expect(avgLabel3.nextSibling?.textContent).toBe('999.9km');
    });
  });

  describe('Accessibility', () => {
    it('has proper heading structure', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      expect(screen.getByRole('heading', { name: 'Running Trends' })).toBeInTheDocument();
    });

    it('has accessible form controls', () => {
      render(<TrendsChart data={mockTrendsData} loading={false} />);

      const selector = screen.getByRole('combobox');
      expect(selector).toBeInTheDocument();
      expect(selector).toHaveAccessibleName();
    });
  });
});
