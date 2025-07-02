import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { StatsPage } from '../../../../src/pages/StatsPage';
import {
  mockWeeklyInsights,
  mockRunTypeBreakdown,
  mockTrendsData,
  mockPersonalRecords,
} from '../../../fixtures/mockData.js';

// Mock the useStats hook
vi.mock('../../../../src/hooks/useStats', () => ({
  useStats: vi.fn(),
}));

// Mock the useGoals hook
vi.mock('../../../../src/hooks/useGoals', () => ({
  useGoals: vi.fn(),
}));

// Mock all the stats components
vi.mock('../../../../src/components/Stats/InsightsCard', () => ({
  InsightsCard: ({ insights, loading }: any) => (
    <div data-testid='insights-card'>
      {loading ? 'Loading insights...' : insights ? 'Insights loaded' : 'No insights'}
    </div>
  ),
}));

vi.mock('../../../../src/components/Stats/RunTypeBreakdownChart', () => ({
  RunTypeBreakdownChart: ({ data, loading }: any) => (
    <div data-testid='breakdown-chart'>
      {loading
        ? 'Loading breakdown...'
        : data.length > 0
          ? 'Breakdown loaded'
          : 'No breakdown data'}
    </div>
  ),
}));

vi.mock('../../../../src/components/Stats/TrendsChart', () => ({
  TrendsChart: ({ data, loading }: any) => (
    <div data-testid='trends-chart'>
      {loading ? 'Loading trends...' : data.length > 0 ? 'Trends loaded' : 'No trends data'}
    </div>
  ),
}));

vi.mock('../../../../src/components/Stats/PersonalRecordsTable', () => ({
  PersonalRecordsTable: ({ records, loading }: any) => (
    <div data-testid='records-table'>
      {loading ? 'Loading records...' : records.length > 0 ? 'Records loaded' : 'No records'}
    </div>
  ),
}));

import { useStats } from '../../../../src/hooks/useStats';
import { useGoals } from '../../../../src/hooks/useGoals';

const mockUseStats = vi.mocked(useStats);
const mockUseGoals = vi.mocked(useGoals);

describe('StatsPage', () => {
  const defaultStatsReturn = {
    weeklyInsights: null,
    typeBreakdown: [],
    trendsData: [],
    personalRecords: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  };

  beforeEach(() => {
    mockUseStats.mockReturnValue(defaultStatsReturn);
    mockUseGoals.mockReturnValue({
      goals: [],
      goalProgress: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the stats page with header and components', () => {
      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Statistics')).toBeInTheDocument();
      expect(screen.getByText('Track your running progress and insights')).toBeInTheDocument();
      expect(screen.getByTestId('insights-card')).toBeInTheDocument();
      expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
      expect(screen.getByTestId('trends-chart')).toBeInTheDocument();
      expect(screen.getByTestId('records-table')).toBeInTheDocument();
    });

    it('has correct page structure and CSS classes', () => {
      let container: any;
      act(() => {
        const renderResult = render(<StatsPage token='valid-token' />);
        container = renderResult.container;
      });

      expect(container.querySelector('.stats-page')).toBeInTheDocument();
      expect(container.querySelector('.stats-header')).toBeInTheDocument();
      expect(container.querySelector('.stats-grid')).toBeInTheDocument();
    });
  });

  describe('Hook Integration', () => {
    it('calls useStats hook with correct token', () => {
      act(() => {
        render(<StatsPage token='test-token-123' />);
      });

      expect(mockUseStats).toHaveBeenCalledWith('test-token-123');
    });

    it('calls useStats hook with null token', () => {
      act(() => {
        render(<StatsPage token={null} />);
      });

      expect(mockUseStats).toHaveBeenCalledWith(null);
    });
  });

  describe('Data States', () => {
    it('renders components with loading state', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        loading: true,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Loading insights...')).toBeInTheDocument();
      expect(screen.getByText('Loading breakdown...')).toBeInTheDocument();
      expect(screen.getByText('Loading trends...')).toBeInTheDocument();
      expect(screen.getByText('Loading records...')).toBeInTheDocument();
    });

    it('renders components with data', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        weeklyInsights: mockWeeklyInsights,
        typeBreakdown: mockRunTypeBreakdown,
        trendsData: mockTrendsData,
        personalRecords: mockPersonalRecords,
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Insights loaded')).toBeInTheDocument();
      expect(screen.getByText('Breakdown loaded')).toBeInTheDocument();
      expect(screen.getByText('Trends loaded')).toBeInTheDocument();
      expect(screen.getByText('Records loaded')).toBeInTheDocument();
    });

    it('renders components with empty data', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        weeklyInsights: null,
        typeBreakdown: [],
        trendsData: [],
        personalRecords: [],
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('No insights')).toBeInTheDocument();
      expect(screen.getByText('No breakdown data')).toBeInTheDocument();
      expect(screen.getByText('No trends data')).toBeInTheDocument();
      expect(screen.getByText('No records')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('renders error state when there is an error', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        error: 'Failed to load statistics',
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Failed to load statistics');
      expect(screen.getByText('⚠️')).toBeInTheDocument();
      expect(screen.getAllByText('Failed to load statistics')).toHaveLength(2);
    });

    it('does not render stats components when there is an error', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        error: 'API Error',
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.queryByTestId('insights-card')).not.toBeInTheDocument();
      expect(screen.queryByTestId('breakdown-chart')).not.toBeInTheDocument();
      expect(screen.queryByTestId('trends-chart')).not.toBeInTheDocument();
      expect(screen.queryByTestId('records-table')).not.toBeInTheDocument();
    });

    it('renders error with custom error message', () => {
      const customError = 'Network connection failed';
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        error: customError,
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText(customError)).toBeInTheDocument();
    });
  });

  describe('Component Props', () => {
    it('passes correct props to InsightsCard', () => {
      const insights = mockWeeklyInsights;
      const loading = true;

      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        weeklyInsights: insights,
        loading,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Loading insights...')).toBeInTheDocument();
    });

    it('passes correct props to RunTypeBreakdownChart', () => {
      const breakdown = mockRunTypeBreakdown;
      const loading = false;

      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        typeBreakdown: breakdown,
        loading,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Breakdown loaded')).toBeInTheDocument();
    });

    it('passes correct props to TrendsChart', () => {
      const trends = mockTrendsData;
      const loading = false;

      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        trendsData: trends,
        loading,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Trends loaded')).toBeInTheDocument();
    });

    it('passes correct props to PersonalRecordsTable', () => {
      const records = mockPersonalRecords;
      const loading = false;

      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        personalRecords: records,
        loading,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Records loaded')).toBeInTheDocument();
    });
  });

  describe('Error Container Structure', () => {
    it('has correct error container structure', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        error: 'Test error',
        loading: false,
      });

      let container: any;
      act(() => {
        const renderResult = render(<StatsPage token='valid-token' />);
        container = renderResult.container;
      });

      expect(container.querySelector('.error-container')).toBeInTheDocument();
      expect(container.querySelector('.error-icon')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper heading structure', () => {
      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Statistics');
    });

    it('maintains heading hierarchy in error state', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        error: 'Test error',
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'Failed to load statistics'
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('handles mixed data states correctly', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        weeklyInsights: mockWeeklyInsights, // has data
        typeBreakdown: [], // empty
        trendsData: mockTrendsData, // has data
        personalRecords: [], // empty
        loading: false,
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      expect(screen.getByText('Insights loaded')).toBeInTheDocument();
      expect(screen.getByText('No breakdown data')).toBeInTheDocument();
      expect(screen.getByText('Trends loaded')).toBeInTheDocument();
      expect(screen.getByText('No records')).toBeInTheDocument();
    });

    it('handles partial loading states', () => {
      mockUseStats.mockReturnValue({
        ...defaultStatsReturn,
        weeklyInsights: mockWeeklyInsights,
        typeBreakdown: mockRunTypeBreakdown,
        trendsData: [],
        personalRecords: [],
        loading: true, // Still loading some data
      });

      act(() => {
        render(<StatsPage token='valid-token' />);
      });

      // All components should show loading state when loading is true
      expect(screen.getByText('Loading insights...')).toBeInTheDocument();
      expect(screen.getByText('Loading breakdown...')).toBeInTheDocument();
      expect(screen.getByText('Loading trends...')).toBeInTheDocument();
      expect(screen.getByText('Loading records...')).toBeInTheDocument();
    });
  });
});
