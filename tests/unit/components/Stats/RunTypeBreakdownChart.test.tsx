import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RunTypeBreakdownChart } from '../../../../src/components/Stats/RunTypeBreakdownChart';
import { mockRunTypeBreakdown } from '../../../fixtures/mockData.js';

// Mock recharts components
vi.mock('recharts', () => ({
  PieChart: ({ children }: any) => <div data-testid='pie-chart'>{children}</div>,
  Pie: () => <div data-testid='pie' />,
  Cell: () => <div data-testid='cell' />,
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid='responsive-container'>{children}</div>
  ),
  Tooltip: () => <div data-testid='tooltip' />,
}));

describe('RunTypeBreakdownChart', () => {
  describe('Loading State', () => {
    it('renders loading skeleton when loading is true', () => {
      const { container } = render(<RunTypeBreakdownChart data={[]} loading={true} />);

      expect(screen.getByText('Run Type Breakdown')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-chart')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-circle')).toBeInTheDocument();
    });

    it('displays skeleton legend items', () => {
      const { container } = render(<RunTypeBreakdownChart data={[]} loading={true} />);

      expect(container.querySelector('.skeleton-legend')).toBeInTheDocument();
      expect(container.querySelectorAll('.skeleton-legend-item')).toHaveLength(3);
    });
  });

  describe('Empty State', () => {
    it('renders empty state when no data and not loading', () => {
      render(<RunTypeBreakdownChart data={[]} loading={false} />);

      expect(screen.getByText('Run Type Breakdown')).toBeInTheDocument();
      expect(screen.getByText('No run data available')).toBeInTheDocument();
      expect(screen.getByText('Add some runs with tags to see breakdown')).toBeInTheDocument();
      expect(screen.getByText('📊')).toBeInTheDocument();
    });
  });

  describe('Data State', () => {
    it('renders chart with data correctly', () => {
      render(<RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />);

      expect(screen.getByText('Run Type Breakdown')).toBeInTheDocument();
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('displays all run type data in legend', () => {
      render(<RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />);

      // Check that all tags are displayed
      expect(screen.getByText('Easy Run')).toBeInTheDocument();
      expect(screen.getByText('Long Run')).toBeInTheDocument();
      expect(screen.getByText('Speed Work')).toBeInTheDocument();
      expect(screen.getByText('Race')).toBeInTheDocument();
    });

    it('displays correct run counts and percentages', () => {
      render(<RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />);

      // Calculate expected percentages based on mock data
      const totalRuns = mockRunTypeBreakdown.reduce((sum, item) => sum + item.count, 0);
      const easyRunPercentage = ((8 / totalRuns) * 100).toFixed(1);

      expect(screen.getByText(`8 runs (${easyRunPercentage}%) • 42.5km`)).toBeInTheDocument();
      expect(screen.getByText(/3 runs \(.*%\) • 45.2km/)).toBeInTheDocument();
    });

    it('displays distance information for each run type', () => {
      render(<RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />);

      expect(screen.getByText(/42.5km/)).toBeInTheDocument(); // Easy Run
      expect(screen.getByText(/45.2km/)).toBeInTheDocument(); // Long Run
      expect(screen.getByText(/16.8km/)).toBeInTheDocument(); // Speed Work
      expect(screen.getByText(/26.3km/)).toBeInTheDocument(); // Race
    });
  });

  describe('Chart Components', () => {
    it('renders all chart components when data is present', () => {
      render(<RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
      expect(screen.getByTestId('pie')).toBeInTheDocument();
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('has correct CSS classes for styling', () => {
      const { container } = render(
        <RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />
      );

      expect(container.querySelector('.chart-card')).toBeInTheDocument();
      expect(container.querySelector('.chart-container')).toBeInTheDocument();
      expect(container.querySelector('.chart-legend')).toBeInTheDocument();
    });
  });

  describe('Legend Component', () => {
    it('renders legend with correct structure', () => {
      const { container } = render(
        <RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />
      );

      const legendItems = container.querySelectorAll('.legend-item');
      expect(legendItems).toHaveLength(mockRunTypeBreakdown.length);

      legendItems.forEach(item => {
        expect(item.querySelector('.legend-color')).toBeInTheDocument();
        expect(item.querySelector('.legend-content')).toBeInTheDocument();
        expect(item.querySelector('.legend-label')).toBeInTheDocument();
        expect(item.querySelector('.legend-stats')).toBeInTheDocument();
      });
    });

    it('applies correct colors to legend items', () => {
      const { container } = render(
        <RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />
      );

      const colorElements = container.querySelectorAll('.legend-color');
      expect(colorElements.length).toBeGreaterThan(0);

      // First legend item should use the first color (blue)
      expect(colorElements[0]).toHaveStyle('background-color: rgb(59, 130, 246)');
    });
  });

  describe('Data Processing', () => {
    it('calculates percentages correctly', () => {
      const testData = [
        { tag: 'Easy', count: 5, totalDistance: 25, totalDuration: 7500, avgPace: 300 },
        { tag: 'Hard', count: 5, totalDistance: 20, totalDuration: 6000, avgPace: 300 },
      ];

      render(<RunTypeBreakdownChart data={testData} loading={false} />);

      // Each should be 50%
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('5 runs') &&
            element?.textContent?.includes('50.0%') &&
            element?.textContent?.includes('25km')
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('5 runs') &&
            element?.textContent?.includes('50.0%') &&
            element?.textContent?.includes('20km')
        )
      ).toBeInTheDocument();
    });

    it('handles single run type correctly', () => {
      const singleTypeData = [mockRunTypeBreakdown[0]];

      render(<RunTypeBreakdownChart data={singleTypeData} loading={false} />);

      expect(screen.getByText('Easy Run')).toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('8 runs') &&
            element?.textContent?.includes('100.0%') &&
            element?.textContent?.includes('42.5km')
        )
      ).toBeInTheDocument();
    });

    it('handles zero counts correctly', () => {
      const zeroCountData = [
        { tag: 'No Runs', count: 0, totalDistance: 0, totalDuration: 0, avgPace: 0 },
      ];

      render(<RunTypeBreakdownChart data={zeroCountData} loading={false} />);

      expect(screen.getByText('No Runs')).toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('0 runs') &&
            element?.textContent?.includes('0.0%') &&
            element?.textContent?.includes('0km')
        )
      ).toBeInTheDocument();
    });
  });

  describe('Component Structure', () => {
    it('has proper heading structure', () => {
      render(<RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />);

      expect(screen.getByRole('heading', { name: 'Run Type Breakdown' })).toBeInTheDocument();
    });

    it('maintains chart container structure', () => {
      const { container } = render(
        <RunTypeBreakdownChart data={mockRunTypeBreakdown} loading={false} />
      );

      expect(container.querySelector('.chart-card h3')).toBeInTheDocument();
      expect(container.querySelector('.chart-container')).toBeInTheDocument();
      expect(container.querySelector('.chart-legend')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very large numbers correctly', () => {
      const largeData = [
        {
          tag: 'Marathon Training',
          count: 999,
          totalDistance: 9999.99,
          totalDuration: 2999970,
          avgPace: 300,
        },
      ];

      render(<RunTypeBreakdownChart data={largeData} loading={false} />);

      expect(screen.getByText('Marathon Training')).toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('999 runs') &&
            element?.textContent?.includes('100.0%') &&
            element?.textContent?.includes('9999.99km')
        )
      ).toBeInTheDocument();
    });

    it('handles decimal calculations correctly', () => {
      const decimalData = [
        { tag: 'Test', count: 3, totalDistance: 10.1, totalDuration: 3030, avgPace: 300 },
        { tag: 'Other', count: 7, totalDistance: 23.3, totalDuration: 6990, avgPace: 300 },
      ];

      render(<RunTypeBreakdownChart data={decimalData} loading={false} />);

      // 3 out of 10 = 30%, 7 out of 10 = 70%
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('3 runs') &&
            element?.textContent?.includes('30.0%') &&
            element?.textContent?.includes('10.1km')
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) =>
            element?.textContent?.includes('7 runs') &&
            element?.textContent?.includes('70.0%') &&
            element?.textContent?.includes('23.3km')
        )
      ).toBeInTheDocument();
    });

    it('handles untagged runs correctly', () => {
      const untaggedData = [
        { tag: 'Untagged', count: 5, totalDistance: 25, totalDuration: 7500, avgPace: 300 },
      ];

      render(<RunTypeBreakdownChart data={untaggedData} loading={false} />);

      expect(screen.getByText('Untagged')).toBeInTheDocument();
    });
  });
});
