import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StatsDashboard } from '../../../../src/components/Analytics/StatsDashboard';
import { AggregatedStats } from '../../../../src/types';

// Mock hooks
vi.mock('../../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../../src/hooks/useAnalyticsStatistics', () => ({
  useAnalyticsStatistics: vi.fn(),
}));

// Mock StatsCard component
vi.mock('../../../../src/components/Analytics/StatsCard', () => ({
  StatsCard: ({ icon, label, value, subValue, loading }: any) => (
    <div data-testid="stats-card" data-loading={loading}>
      <div data-testid="stats-icon">{icon}</div>
      <div data-testid="stats-label">{label}</div>
      <div data-testid="stats-value">{value}</div>
      {subValue && <div data-testid="stats-subvalue">{subValue}</div>}
    </div>
  ),
}));

// Mock formatters
vi.mock('../../../../src/utils/formatters', () => ({
  formatDistance: (value: number) => `${value.toFixed(1)} km`,
  formatPace: (value: number) => `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, '0')}`,
  formatDuration: (value: number) => {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return `${hours}h ${minutes}m`;
  },
}));

// Import mocked functions
import { useAuth } from '../../../../src/hooks/useAuth';
import { useAnalyticsStatistics } from '../../../../src/hooks/useAnalyticsStatistics';

const mockUseAuth = vi.mocked(useAuth);
const mockUseAnalyticsStatistics = vi.mocked(useAnalyticsStatistics);

describe('StatsDashboard', () => {
  const mockGetToken = vi.fn(() => 'test-token');

  const mockStatistics: AggregatedStats = {
    period: 'weekly',
    startDate: '2026-02-01',
    endDate: '2026-02-07',
    totalRuns: 5,
    totalDistance: 25.5,
    totalDuration: 7200,
    avgPace: 282.35,
    fastestPace: 240,
    longestRun: 10,
    totalElevation: 150,
    avgHeartRate: 145,
    maxHeartRate: 175,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      getToken: mockGetToken,
      isLoggedIn: true,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
  });

  describe('Loading State', () => {
    it('renders 6 loading skeleton cards when loading', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const loadingCards = screen.getAllByTestId('stats-card').filter(card =>
        card.getAttribute('data-loading') === 'true'
      );
      expect(loadingCards).toHaveLength(6);
    });

    it('disables period buttons when loading', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const weeklyButton = screen.getByRole('button', { name: /This Week/i });
      const monthlyButton = screen.getByRole('button', { name: /This Month/i });
      const yearlyButton = screen.getByRole('button', { name: /This Year/i });

      expect(weeklyButton).toBeDisabled();
      expect(monthlyButton).toBeDisabled();
      expect(yearlyButton).toBeDisabled();
    });
  });

  describe('Error State', () => {
    it('renders error message when error occurs', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: null,
        loading: false,
        error: 'Failed to load analytics statistics',
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      expect(screen.getByText('Failed to load analytics statistics')).toBeInTheDocument();
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('does not render period selector when error occurs', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: null,
        loading: false,
        error: 'Network error',
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      expect(screen.queryByRole('button', { name: /This Week/i })).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when totalRuns is 0', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, totalRuns: 0 },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      expect(screen.getByText('No runs in this period')).toBeInTheDocument();
      expect(screen.getByText('Start logging runs to see your stats!')).toBeInTheDocument();
      expect(screen.getByText('🏃‍♂️')).toBeInTheDocument();
    });
  });

  describe('Period Selector', () => {
    beforeEach(() => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('renders all three period buttons', () => {
      render(<StatsDashboard />);

      expect(screen.getByRole('button', { name: /This Week/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /This Month/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /This Year/i })).toBeInTheDocument();
    });

    it('marks weekly button as active by default', () => {
      render(<StatsDashboard />);

      const weeklyButton = screen.getByRole('button', { name: /This Week/i });
      expect(weeklyButton).toHaveClass('active');
    });

    it('switches to monthly period when monthly button clicked', async () => {
      const user = userEvent.setup();
      render(<StatsDashboard />);

      const monthlyButton = screen.getByRole('button', { name: /This Month/i });
      await user.click(monthlyButton);

      expect(monthlyButton).toHaveClass('active');
      expect(mockUseAnalyticsStatistics).toHaveBeenLastCalledWith('test-token', 'monthly');
    });

    it('switches to yearly period when yearly button clicked', async () => {
      const user = userEvent.setup();
      render(<StatsDashboard />);

      const yearlyButton = screen.getByRole('button', { name: /This Year/i });
      await user.click(yearlyButton);

      expect(yearlyButton).toHaveClass('active');
      expect(mockUseAnalyticsStatistics).toHaveBeenLastCalledWith('test-token', 'yearly');
    });

    it('displays period icons', () => {
      render(<StatsDashboard />);

      expect(screen.getByText('📅')).toBeInTheDocument(); // Weekly
      expect(screen.getByText('📊')).toBeInTheDocument(); // Monthly
      expect(screen.getByText('🗓️')).toBeInTheDocument(); // Yearly
    });
  });

  describe('Period Date Display', () => {
    it('displays formatted date range when statistics are loaded', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<StatsDashboard />);

      const periodDate = container.querySelector('.period-date');
      expect(periodDate).toBeInTheDocument();
      expect(periodDate?.textContent).toMatch(/\w+ \d+ - \w+ \d+/); // Matches format like "Jan 31 - Feb 6"
    });

    it('does not display date range when statistics are null', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<StatsDashboard />);
      expect(container.querySelector('.period-date')).not.toBeInTheDocument();
    });
  });

  describe('Stats Cards Rendering', () => {
    beforeEach(() => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('renders Total Runs card', () => {
      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const totalRunsCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Total Runs'
      );

      expect(totalRunsCard).toBeDefined();
      expect(within(totalRunsCard!).getByTestId('stats-value')).toHaveTextContent('5');
      expect(within(totalRunsCard!).getByTestId('stats-icon')).toHaveTextContent('🏃‍♂️');
    });

    it('renders Total Distance card with average', () => {
      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const distanceCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Total Distance'
      );

      expect(distanceCard).toBeDefined();
      expect(within(distanceCard!).getByTestId('stats-value')).toHaveTextContent('25.5 km');
      expect(within(distanceCard!).getByTestId('stats-subvalue')).toHaveTextContent('5.1 km avg');
    });

    it('renders Total Time card', () => {
      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const timeCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Total Time'
      );

      expect(timeCard).toBeDefined();
      expect(within(timeCard!).getByTestId('stats-value')).toHaveTextContent('2h 0m');
    });

    it('renders Avg Pace card with best pace', () => {
      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const paceCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Avg Pace'
      );

      expect(paceCard).toBeDefined();
      expect(within(paceCard!).getByTestId('stats-value')).toHaveTextContent('4:42');
      expect(within(paceCard!).getByTestId('stats-subvalue')).toHaveTextContent('4:00 best');
    });

    it('renders Longest Run card', () => {
      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const longestCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Longest Run'
      );

      expect(longestCard).toBeDefined();
      expect(within(longestCard!).getByTestId('stats-value')).toHaveTextContent('10.0 km');
    });
  });

  describe('Optional Metrics', () => {
    it('renders Total Elevation card when totalElevation is provided and > 0', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const elevationCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Total Elevation'
      );

      expect(elevationCard).toBeDefined();
      expect(within(elevationCard!).getByTestId('stats-value')).toHaveTextContent('150m');
      expect(within(elevationCard!).getByTestId('stats-subvalue')).toHaveTextContent('30m avg');
    });

    it('does not render Total Elevation card when totalElevation is 0', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, totalElevation: 0 },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const elevationCard = cards.find(card =>
        within(card).queryByTestId('stats-label')?.textContent === 'Total Elevation'
      );

      expect(elevationCard).toBeUndefined();
    });

    it('does not render Total Elevation card when totalElevation is undefined', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, totalElevation: undefined },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const elevationCard = cards.find(card =>
        within(card).queryByTestId('stats-label')?.textContent === 'Total Elevation'
      );

      expect(elevationCard).toBeUndefined();
    });

    it('renders Avg Heart Rate card when avgHeartRate is provided and > 0', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const hrCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Avg Heart Rate'
      );

      expect(hrCard).toBeDefined();
      expect(within(hrCard!).getByTestId('stats-value')).toHaveTextContent('145 bpm');
      expect(within(hrCard!).getByTestId('stats-subvalue')).toHaveTextContent('175 max');
    });

    it('does not render Avg Heart Rate card when avgHeartRate is 0', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, avgHeartRate: 0 },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const hrCard = cards.find(card =>
        within(card).queryByTestId('stats-label')?.textContent === 'Avg Heart Rate'
      );

      expect(hrCard).toBeUndefined();
    });

    it('renders heart rate card without max when maxHeartRate is undefined', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, maxHeartRate: undefined },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const hrCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Avg Heart Rate'
      );

      expect(hrCard).toBeDefined();
      expect(within(hrCard!).getByTestId('stats-value')).toHaveTextContent('145 bpm');
      expect(within(hrCard!).queryByTestId('stats-subvalue')).not.toBeInTheDocument();
    });
  });

  describe('Hook Integration', () => {
    it('calls useAuth hook', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      expect(mockUseAuth).toHaveBeenCalled();
    });

    it('calls useAnalyticsStatistics with token and default weekly period', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: mockStatistics,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      expect(mockUseAnalyticsStatistics).toHaveBeenCalledWith('test-token', 'weekly');
    });
  });

  describe('Edge Cases', () => {
    it('handles zero avgPace', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, avgPace: 0 },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const paceCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Avg Pace'
      );

      expect(within(paceCard!).getByTestId('stats-value')).toHaveTextContent('--');
    });

    it('handles Infinity fastestPace', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: { ...mockStatistics, fastestPace: Infinity },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      const cards = screen.getAllByTestId('stats-card');
      const paceCard = cards.find(card =>
        within(card).getByTestId('stats-label').textContent === 'Avg Pace'
      );

      expect(within(paceCard!).queryByTestId('stats-subvalue')).not.toBeInTheDocument();
    });

    it('handles very large values', () => {
      mockUseAnalyticsStatistics.mockReturnValue({
        statistics: {
          ...mockStatistics,
          totalRuns: 999,
          totalDistance: 9999.99,
          totalDuration: 999999,
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<StatsDashboard />);

      expect(screen.getByText('999')).toBeInTheDocument();
      expect(screen.getByText('10000.0 km')).toBeInTheDocument();
    });
  });
});
