import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { TrendInsight } from '../../../../src/components/Analytics/TrendInsight';
import { TrendAnalysis } from '../../../../src/types';

describe('TrendInsight', () => {
  const mockTrends: TrendAnalysis = {
    period: 'weekly',
    dataPoints: 12,
    paceTrend: 'improving',
    volumeTrend: 'increasing',
    paceChangePercent: -5.2,
    volumeChangePercent: 10.5,
    consistencyScore: 0.85,
  };

  beforeEach(() => {
    // No mocks needed for this presentational component
  });

  describe('Loading State', () => {
    it('renders loading skeleton when loading is true', () => {
      const { container } = render(<TrendInsight trends={null} loading={true} />);

      expect(container.querySelector('.trend-insight-loading')).toBeInTheDocument();
      expect(container.querySelectorAll('.skeleton-line')).toHaveLength(4); // 1 header + 3 indicators
    });

    it('does not render content when loading', () => {
      render(<TrendInsight trends={mockTrends} loading={true} />);

      expect(screen.queryByText('Performance Trends')).not.toBeInTheDocument();
      expect(screen.queryByText('Pace')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when trends is null', () => {
      render(<TrendInsight trends={null} loading={false} />);

      expect(screen.getByText('Not enough data for trends')).toBeInTheDocument();
      expect(screen.getByText('Add more runs to see your progress trends')).toBeInTheDocument();
      expect(screen.getByText('📊')).toBeInTheDocument();
    });

    it('does not render trend indicators when trends is null', () => {
      render(<TrendInsight trends={null} loading={false} />);

      expect(screen.queryByText('Pace')).not.toBeInTheDocument();
      expect(screen.queryByText('Volume')).not.toBeInTheDocument();
      expect(screen.queryByText('Consistency')).not.toBeInTheDocument();
    });
  });

  describe('Header Rendering', () => {
    it('renders header with title', () => {
      render(<TrendInsight trends={mockTrends} />);

      expect(screen.getByText('Performance Trends')).toBeInTheDocument();
    });

    it('displays period information for weekly data', () => {
      render(<TrendInsight trends={mockTrends} />);

      expect(screen.getByText('Last 12 weeks')).toBeInTheDocument();
    });

    it('displays period information for monthly data', () => {
      const monthlyTrends: TrendAnalysis = {
        ...mockTrends,
        period: 'monthly',
        dataPoints: 6,
      };

      render(<TrendInsight trends={monthlyTrends} />);

      expect(screen.getByText('Last 6 months')).toBeInTheDocument();
    });
  });

  describe('Pace Trend Indicator', () => {
    it('renders pace trend with improving status', () => {
      const { container } = render(<TrendInsight trends={mockTrends} />);

      expect(screen.getByText('Pace')).toBeInTheDocument();
      expect(screen.getByText('Improving')).toBeInTheDocument();
      expect(screen.getByText('-5.2%')).toBeInTheDocument();

      // Check that at least one trend icon has the improving icon
      const icons = container.querySelectorAll('.trend-icon');
      const hasImprovingIcon = Array.from(icons).some(icon => icon.textContent === '📈');
      expect(hasImprovingIcon).toBe(true);
    });

    it('renders pace trend with declining status', () => {
      const decliningTrends: TrendAnalysis = {
        ...mockTrends,
        paceTrend: 'declining',
        paceChangePercent: 3.5,
        volumeTrend: 'stable', // Make volume different to avoid icon conflicts
      };

      render(<TrendInsight trends={decliningTrends} />);

      expect(screen.getByText('Declining')).toBeInTheDocument();
      expect(screen.getByText('+3.5%')).toBeInTheDocument();
      expect(screen.getByText('📉')).toBeInTheDocument();
    });

    it('renders pace trend with stable status', () => {
      const stableTrends: TrendAnalysis = {
        ...mockTrends,
        paceTrend: 'stable',
        paceChangePercent: 0.5,
        volumeTrend: 'decreasing', // Make volume different to avoid icon conflicts
      };

      render(<TrendInsight trends={stableTrends} />);

      expect(screen.getByText('Stable')).toBeInTheDocument();
      expect(screen.getByText('+0.5%')).toBeInTheDocument();
      expect(screen.getByText('➡️')).toBeInTheDocument();
    });

    it('renders progress bar for pace with correct width', () => {
      const { container } = render(<TrendInsight trends={mockTrends} />);

      const trendBars = container.querySelectorAll('.trend-bar-fill');
      expect(trendBars[0]).toHaveStyle({ width: '5.2%' }); // Math.abs(paceChangePercent)
    });
  });

  describe('Volume Trend Indicator', () => {
    it('renders volume trend with increasing status', () => {
      render(<TrendInsight trends={mockTrends} />);

      expect(screen.getByText('Volume')).toBeInTheDocument();
      expect(screen.getByText('Increasing')).toBeInTheDocument();
      expect(screen.getByText('+10.5%')).toBeInTheDocument();
    });

    it('renders volume trend with decreasing status', () => {
      const decreasingVolume: TrendAnalysis = {
        ...mockTrends,
        volumeTrend: 'decreasing',
        volumeChangePercent: -8.2,
      };

      render(<TrendInsight trends={decreasingVolume} />);

      expect(screen.getByText('Decreasing')).toBeInTheDocument();
      expect(screen.getByText('-8.2%')).toBeInTheDocument();
    });

    it('renders volume trend with stable status', () => {
      const stableVolume: TrendAnalysis = {
        ...mockTrends,
        volumeTrend: 'stable',
        volumeChangePercent: 0,
      };

      render(<TrendInsight trends={stableVolume} />);

      expect(screen.getByText('Stable')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('renders progress bar for volume with correct width', () => {
      const { container } = render(<TrendInsight trends={mockTrends} />);

      const trendBars = container.querySelectorAll('.trend-bar-fill');
      expect(trendBars[1]).toHaveStyle({ width: '10.5%' }); // Math.abs(volumeChangePercent)
    });
  });

  describe('Consistency Indicator', () => {
    it('renders consistency with Excellent level (score >= 0.8)', () => {
      render(<TrendInsight trends={mockTrends} />);

      expect(screen.getByText('Consistency')).toBeInTheDocument();
      expect(screen.getByText('Excellent')).toBeInTheDocument();
      expect(screen.getByText('85%')).toBeInTheDocument();
      expect(screen.getByText('🎯')).toBeInTheDocument();
    });

    it('renders consistency with Good level (0.6 <= score < 0.8)', () => {
      const goodConsistency: TrendAnalysis = {
        ...mockTrends,
        consistencyScore: 0.7,
      };

      render(<TrendInsight trends={goodConsistency} />);

      expect(screen.getByText('Good')).toBeInTheDocument();
      expect(screen.getByText('70%')).toBeInTheDocument();
    });

    it('renders consistency with Fair level (0.4 <= score < 0.6)', () => {
      const fairConsistency: TrendAnalysis = {
        ...mockTrends,
        consistencyScore: 0.5,
      };

      render(<TrendInsight trends={fairConsistency} />);

      expect(screen.getByText('Fair')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('renders consistency with Low level (score < 0.4)', () => {
      const lowConsistency: TrendAnalysis = {
        ...mockTrends,
        consistencyScore: 0.3,
      };

      render(<TrendInsight trends={lowConsistency} />);

      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('renders progress bar for consistency with correct width', () => {
      const { container } = render(<TrendInsight trends={mockTrends} />);

      const trendBars = container.querySelectorAll('.trend-bar-fill');
      expect(trendBars[2]).toHaveStyle({ width: '85%' }); // consistencyScore * 100
    });
  });

  describe('Percent Change Formatting', () => {
    it('formats positive change with + sign', () => {
      const positiveTrends: TrendAnalysis = {
        ...mockTrends,
        volumeChangePercent: 15.3,
      };

      render(<TrendInsight trends={positiveTrends} />);

      expect(screen.getByText('+15.3%')).toBeInTheDocument();
    });

    it('formats negative change with - sign', () => {
      const negativeTrends: TrendAnalysis = {
        ...mockTrends,
        paceChangePercent: -12.8,
      };

      render(<TrendInsight trends={negativeTrends} />);

      expect(screen.getByText('-12.8%')).toBeInTheDocument();
    });

    it('formats zero change as 0%', () => {
      const zeroChangeTrends: TrendAnalysis = {
        ...mockTrends,
        volumeChangePercent: 0,
      };

      render(<TrendInsight trends={zeroChangeTrends} />);

      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('rounds percent change to 1 decimal place', () => {
      const preciseTrends: TrendAnalysis = {
        ...mockTrends,
        paceChangePercent: -5.27891,
      };

      render(<TrendInsight trends={preciseTrends} />);

      expect(screen.getByText('-5.3%')).toBeInTheDocument();
    });
  });

  describe('Progress Bar Capping', () => {
    it('caps progress bar at 100% for values over 100', () => {
      const extremeTrends: TrendAnalysis = {
        ...mockTrends,
        volumeChangePercent: 150.5,
      };

      const { container } = render(<TrendInsight trends={extremeTrends} />);

      const trendBars = container.querySelectorAll('.trend-bar-fill');
      expect(trendBars[1]).toHaveStyle({ width: '100%' }); // Capped at 100%
    });

    it('handles negative percentages by using absolute value', () => {
      const negativeTrends: TrendAnalysis = {
        ...mockTrends,
        paceChangePercent: -25.5,
      };

      const { container } = render(<TrendInsight trends={negativeTrends} />);

      const trendBars = container.querySelectorAll('.trend-bar-fill');
      expect(trendBars[0]).toHaveStyle({ width: '25.5%' }); // Math.abs()
    });
  });

  describe('All Three Indicators Together', () => {
    it('renders all three trend indicators', () => {
      render(<TrendInsight trends={mockTrends} />);

      expect(screen.getByText('Pace')).toBeInTheDocument();
      expect(screen.getByText('Volume')).toBeInTheDocument();
      expect(screen.getByText('Consistency')).toBeInTheDocument();
    });

    it('renders all three progress bars', () => {
      const { container } = render(<TrendInsight trends={mockTrends} />);

      const trendBars = container.querySelectorAll('.trend-bar-fill');
      expect(trendBars).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('handles consistency score of 0', () => {
      const zeroConsistency: TrendAnalysis = {
        ...mockTrends,
        consistencyScore: 0,
      };

      render(<TrendInsight trends={zeroConsistency} />);

      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('handles consistency score of 1', () => {
      const perfectConsistency: TrendAnalysis = {
        ...mockTrends,
        consistencyScore: 1,
      };

      render(<TrendInsight trends={perfectConsistency} />);

      expect(screen.getByText('Excellent')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('handles consistency score exactly at boundary (0.8)', () => {
      const boundaryConsistency: TrendAnalysis = {
        ...mockTrends,
        consistencyScore: 0.8,
      };

      render(<TrendInsight trends={boundaryConsistency} />);

      expect(screen.getByText('Excellent')).toBeInTheDocument();
      expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('handles very large dataPoints value', () => {
      const largeTrends: TrendAnalysis = {
        ...mockTrends,
        dataPoints: 999,
      };

      render(<TrendInsight trends={largeTrends} />);

      expect(screen.getByText('Last 999 weeks')).toBeInTheDocument();
    });

    it('handles single dataPoint', () => {
      const singlePoint: TrendAnalysis = {
        ...mockTrends,
        dataPoints: 1,
      };

      render(<TrendInsight trends={singlePoint} />);

      expect(screen.getByText('Last 1 weeks')).toBeInTheDocument();
    });
  });
});
