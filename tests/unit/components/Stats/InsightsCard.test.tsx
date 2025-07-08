import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InsightsCard } from '../../../../src/components/Stats/InsightsCard';
import { mockWeeklyInsights, mockEmptyWeeklyInsights } from '../../../fixtures/mockData.js';

// Mock the formatters utility
vi.mock('../../../../src/utils/formatters', () => ({
  formatDuration: vi.fn((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }),
  formatPace: vi.fn((paceInSeconds: number) => {
    if (!isFinite(paceInSeconds) || paceInSeconds <= 0) return '-';
    const minutes = Math.floor(paceInSeconds / 60);
    const seconds = Math.round(paceInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }),
}));

describe('InsightsCard', () => {
  describe('Loading State', () => {
    it('renders loading skeleton when loading is true', () => {
      const { container } = render(<InsightsCard insights={null} loading={true} />);

      expect(screen.getByText('Weekly Summary')).toBeInTheDocument();
      expect(container.querySelectorAll('.skeleton-line')).toHaveLength(9); // 1 period + 8 item skeletons
    });

    it('displays skeleton lines with correct styling', () => {
      const { container } = render(<InsightsCard insights={null} loading={true} />);

      const skeletonLines = container.querySelectorAll('.skeleton-line');
      expect(skeletonLines.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('renders empty state when insights is null and not loading', () => {
      render(<InsightsCard insights={null} loading={false} />);

      expect(screen.getByText('Weekly Summary')).toBeInTheDocument();
      expect(screen.getByText('No runs this week yet!')).toBeInTheDocument();
      expect(screen.getByText('Add your first run to see insights')).toBeInTheDocument();
      expect(screen.getByText('📊')).toBeInTheDocument();
    });
  });

  describe('Data State', () => {
    it('renders insights data correctly', () => {
      render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      expect(screen.getByText('Weekly Summary')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument(); // totalRuns
      expect(screen.getByText('39.9km')).toBeInTheDocument(); // totalDistance
      expect(screen.getByText('Runs')).toBeInTheDocument();
      expect(screen.getByText('Distance')).toBeInTheDocument();
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Avg Pace')).toBeInTheDocument();
    });

    it('formats and displays duration correctly', () => {
      render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      // Mock formatDuration should return formatted time
      expect(screen.getByText('3h 21m')).toBeInTheDocument();
    });

    it('formats and displays average pace correctly', () => {
      render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      // avgPace is 302 seconds, should be 5:02
      expect(screen.getByText('5:02')).toBeInTheDocument();
    });

    it('displays week period correctly', () => {
      render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      // Should format dates as "Jun 9 - Jun 15"
      expect(screen.getByText(/Jun 9 - Jun 15/)).toBeInTheDocument();
    });

    it('displays insights footer with calculated averages when runs > 0', () => {
      render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      expect(screen.getByText('Avg Distance:')).toBeInTheDocument();
      expect(screen.getByText('10.0km')).toBeInTheDocument(); // 39.9 / 4
      expect(screen.getByText('Avg Duration:')).toBeInTheDocument();
    });

    it('handles zero pace correctly', () => {
      const insightsWithZeroPace = {
        ...mockWeeklyInsights,
        avgPace: 0,
      };

      render(<InsightsCard insights={insightsWithZeroPace} loading={false} />);

      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('handles empty insights (zero runs)', () => {
      render(<InsightsCard insights={mockEmptyWeeklyInsights} loading={false} />);

      expect(screen.getByText('0')).toBeInTheDocument(); // totalRuns
      expect(screen.getByText('0km')).toBeInTheDocument(); // totalDistance
      expect(screen.getByText('-')).toBeInTheDocument(); // avgPace should be dash

      // Footer should not be displayed when totalRuns is 0
      expect(screen.queryByText('Avg Distance:')).not.toBeInTheDocument();
    });
  });

  describe('Component Structure', () => {
    it('has correct CSS classes for styling', () => {
      const { container } = render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      expect(container.querySelector('.insights-card')).toBeInTheDocument();
      expect(container.querySelector('.insights-header')).toBeInTheDocument();
      expect(container.querySelector('.insights-grid')).toBeInTheDocument();
      expect(container.querySelector('.insights-footer')).toBeInTheDocument();
    });

    it('renders all insight items with correct structure', () => {
      const { container } = render(<InsightsCard insights={mockWeeklyInsights} loading={false} />);

      const insightItems = container.querySelectorAll('.insight-item');
      expect(insightItems).toHaveLength(4); // Runs, Distance, Time, Avg Pace

      insightItems.forEach(item => {
        expect(item.querySelector('.insight-value')).toBeInTheDocument();
        expect(item.querySelector('.insight-label')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles very large numbers correctly', () => {
      const largeInsights = {
        ...mockWeeklyInsights,
        totalDistance: 999.99,
        totalRuns: 50,
        totalDuration: 999999,
      };

      render(<InsightsCard insights={largeInsights} loading={false} />);

      expect(screen.getByText('999.99km')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
    });

    it('handles decimal calculations correctly', () => {
      const precisionInsights = {
        ...mockWeeklyInsights,
        totalDistance: 33.33,
        totalRuns: 3,
      };

      render(<InsightsCard insights={precisionInsights} loading={false} />);

      // Should calculate average correctly: 33.33 / 3 = 11.1
      expect(screen.getByText('11.1km')).toBeInTheDocument();
    });
  });
});
