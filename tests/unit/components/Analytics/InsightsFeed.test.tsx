import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { InsightsFeed } from '../../../../src/components/Analytics/InsightsFeed';
import { Insight } from '../../../../src/types';

// Mock hooks
vi.mock('../../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../../src/hooks/useAnalyticsInsights', () => ({
  useAnalyticsInsights: vi.fn(),
}));

// Mock InsightCard component
vi.mock('../../../../src/components/Analytics/InsightCard', () => ({
  InsightCard: ({ insight, onDismiss }: any) => (
    <div data-testid="insight-card" data-priority={insight.priority}>
      <div data-testid="insight-message">{insight.message}</div>
      <button data-testid="dismiss-button" onClick={() => onDismiss(insight)}>
        Dismiss
      </button>
    </div>
  ),
}));

// Import mocked functions
import { useAuth } from '../../../../src/hooks/useAuth';
import { useAnalyticsInsights } from '../../../../src/hooks/useAnalyticsInsights';

const mockUseAuth = vi.mocked(useAuth);
const mockUseAnalyticsInsights = vi.mocked(useAnalyticsInsights);

describe('InsightsFeed', () => {
  const mockGetToken = vi.fn(() => 'test-token');
  const mockRefetch = vi.fn();

  const mockInsights: Insight[] = [
    {
      type: 'consistency',
      priority: 'high',
      message: 'Great consistency! You ran 5 times this week.',
      actionable: 'Keep up the momentum',
    },
    {
      type: 'volume',
      priority: 'medium',
      message: 'Your weekly mileage increased by 15%',
      actionable: 'Monitor recovery',
    },
    {
      type: 'performance',
      priority: 'low',
      message: 'Average pace improved by 10 seconds per mile',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mockUseAuth.mockReturnValue({
      getToken: mockGetToken,
      isLoggedIn: true,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Loading State', () => {
    it('renders loading skeletons when loading', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: true,
        error: null,
        refetch: mockRefetch,
      });

      const { container } = render(<InsightsFeed />);

      expect(container.querySelectorAll('.insight-skeleton')).toHaveLength(3);
    });

    it('disables refresh button when loading', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: true,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      const refreshButton = screen.getByRole('button');
      expect(refreshButton).toBeDisabled();
    });

    it('shows spinning refresh icon when loading', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: true,
        error: null,
        refetch: mockRefetch,
      });

      const { container } = render(<InsightsFeed />);

      const spinningIcon = container.querySelector('.spinning');
      expect(spinningIcon).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('renders error message when error occurs', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: false,
        error: 'Failed to load insights',
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(screen.getByText('Failed to load insights')).toBeInTheDocument();
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('renders Try Again button in error state', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: false,
        error: 'Network error',
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
    });

    it('calls refetch and clears dismissed insights when Try Again is clicked', async () => {
      const user = userEvent.setup();

      // Set some dismissed insights in localStorage
      localStorage.setItem('dismissedInsights', JSON.stringify(['consistency-test']));

      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: false,
        error: 'Network error',
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      const tryAgainButton = screen.getByRole('button', { name: /Try Again/i });
      await user.click(tryAgainButton);

      expect(mockRefetch).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('dismissedInsights')).toBeNull();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when no insights are available', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(screen.getByText('Keep running to get insights!')).toBeInTheDocument();
      expect(
        screen.getByText('We analyze your runs to provide personalized recommendations')
      ).toBeInTheDocument();
      expect(screen.getByText('✨')).toBeInTheDocument();
    });

    it('renders "all dismissed" empty state when all insights are dismissed', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: mockInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      // Pre-dismiss all insights
      const dismissedKeys = mockInsights.map(i => `${i.type}-${i.message}`);
      localStorage.setItem('dismissedInsights', JSON.stringify(dismissedKeys));

      render(<InsightsFeed />);

      expect(screen.getByText('All insights dismissed')).toBeInTheDocument();
      expect(screen.getByText('Click refresh to see your insights again')).toBeInTheDocument();
    });
  });

  describe('Insights Rendering', () => {
    beforeEach(() => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: mockInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });
    });

    it('renders all insights when none are dismissed', () => {
      render(<InsightsFeed />);

      const insightCards = screen.getAllByTestId('insight-card');
      expect(insightCards).toHaveLength(3);
    });

    it('displays insight count in header', () => {
      render(<InsightsFeed />);

      expect(screen.getByText(/3 active/)).toBeInTheDocument();
    });

    it('does not show dismissed count when no insights are dismissed', () => {
      render(<InsightsFeed />);

      expect(screen.queryByText(/dismissed/)).not.toBeInTheDocument();
    });
  });

  describe('Priority Grouping', () => {
    beforeEach(() => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: mockInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });
    });

    it('renders High Priority group header', () => {
      render(<InsightsFeed />);

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('🔴')).toBeInTheDocument();
    });

    it('renders Medium Priority group header', () => {
      render(<InsightsFeed />);

      expect(screen.getByText('Medium Priority')).toBeInTheDocument();
      expect(screen.getByText('🟡')).toBeInTheDocument();
    });

    it('renders Low Priority group header', () => {
      render(<InsightsFeed />);

      expect(screen.getByText('Low Priority')).toBeInTheDocument();
      expect(screen.getByText('🔵')).toBeInTheDocument();
    });

    it('displays correct count for each priority group', () => {
      const { container } = render(<InsightsFeed />);

      const groups = container.querySelectorAll('.insights-group');
      expect(groups).toHaveLength(3);

      // High priority: 1 insight
      const highGroup = groups[0];
      expect(within(highGroup as HTMLElement).getByText('1')).toBeInTheDocument();

      // Medium priority: 1 insight
      const mediumGroup = groups[1];
      expect(within(mediumGroup as HTMLElement).getByText('1')).toBeInTheDocument();

      // Low priority: 1 insight
      const lowGroup = groups[2];
      expect(within(lowGroup as HTMLElement).getByText('1')).toBeInTheDocument();
    });

    it('only renders groups with insights', () => {
      const highOnlyInsights: Insight[] = [
        {
          type: 'consistency',
          priority: 'high',
          message: 'High priority insight',
        },
      ];

      mockUseAnalyticsInsights.mockReturnValue({
        insights: highOnlyInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      const { container } = render(<InsightsFeed />);

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.queryByText('Medium Priority')).not.toBeInTheDocument();
      expect(screen.queryByText('Low Priority')).not.toBeInTheDocument();

      const groups = container.querySelectorAll('.insights-group');
      expect(groups).toHaveLength(1);
    });
  });

  describe('Dismiss Functionality', () => {
    beforeEach(() => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: mockInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });
    });

    it('removes insight from view when dismissed', async () => {
      const user = userEvent.setup();
      render(<InsightsFeed />);

      expect(screen.getAllByTestId('insight-card')).toHaveLength(3);

      const firstDismissButton = screen.getAllByTestId('dismiss-button')[0];
      await user.click(firstDismissButton);

      expect(screen.getAllByTestId('insight-card')).toHaveLength(2);
    });

    it('persists dismissed insights to localStorage', async () => {
      const user = userEvent.setup();
      render(<InsightsFeed />);

      const firstDismissButton = screen.getAllByTestId('dismiss-button')[0];
      await user.click(firstDismissButton);

      const stored = localStorage.getItem('dismissedInsights');
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(parsed).toContain('consistency-Great consistency! You ran 5 times this week.');
    });

    it('shows dismissed count after dismissing insights', async () => {
      const user = userEvent.setup();
      render(<InsightsFeed />);

      const firstDismissButton = screen.getAllByTestId('dismiss-button')[0];
      await user.click(firstDismissButton);

      expect(screen.getByText(/2 active/)).toBeInTheDocument();
      expect(screen.getByText(/1 dismissed/)).toBeInTheDocument();
    });

    it('loads dismissed insights from localStorage on mount', () => {
      const dismissedKeys = ['consistency-Great consistency! You ran 5 times this week.'];
      localStorage.setItem('dismissedInsights', JSON.stringify(dismissedKeys));

      render(<InsightsFeed />);

      // Should only show 2 insights (1 was dismissed)
      expect(screen.getAllByTestId('insight-card')).toHaveLength(2);
    });

    it('handles invalid localStorage data gracefully', () => {
      localStorage.setItem('dismissedInsights', 'invalid json{');

      expect(() => render(<InsightsFeed />)).not.toThrow();
    });
  });

  describe('Refresh Functionality', () => {
    beforeEach(() => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: mockInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });
    });

    it('renders refresh button', () => {
      render(<InsightsFeed />);

      const refreshButton = screen.getByTitle('Refresh insights');
      expect(refreshButton).toBeInTheDocument();
    });

    it('calls refetch when refresh button is clicked', async () => {
      const user = userEvent.setup();
      render(<InsightsFeed />);

      const refreshButton = screen.getByTitle('Refresh insights');
      await user.click(refreshButton);

      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it('clears dismissed insights when refresh is clicked', async () => {
      const user = userEvent.setup();

      // Dismiss an insight first
      const { rerender } = render(<InsightsFeed />);

      const firstDismissButton = screen.getAllByTestId('dismiss-button')[0];
      await user.click(firstDismissButton);

      expect(screen.getAllByTestId('insight-card')).toHaveLength(2);

      // Click refresh
      const refreshButton = screen.getByTitle('Refresh insights');
      await user.click(refreshButton);

      // Re-render with same insights
      rerender(<InsightsFeed />);

      // All insights should be visible again
      expect(screen.getAllByTestId('insight-card')).toHaveLength(3);
    });

    it('removes dismissed insights from localStorage when refreshed', async () => {
      const user = userEvent.setup();

      localStorage.setItem('dismissedInsights', JSON.stringify(['test-key']));

      render(<InsightsFeed />);

      const refreshButton = screen.getByTitle('Refresh insights');
      await user.click(refreshButton);

      expect(localStorage.getItem('dismissedInsights')).toBeNull();
    });
  });

  describe('Hook Integration', () => {
    it('calls useAuth hook', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(mockUseAuth).toHaveBeenCalled();
    });

    it('calls useAnalyticsInsights with token', () => {
      mockUseAnalyticsInsights.mockReturnValue({
        insights: [],
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(mockUseAnalyticsInsights).toHaveBeenCalledWith('test-token');
    });
  });

  describe('Edge Cases', () => {
    it('handles multiple insights with same type but different messages', () => {
      const duplicateTypeInsights: Insight[] = [
        {
          type: 'consistency',
          priority: 'high',
          message: 'First consistency message',
        },
        {
          type: 'consistency',
          priority: 'high',
          message: 'Second consistency message',
        },
      ];

      mockUseAnalyticsInsights.mockReturnValue({
        insights: duplicateTypeInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(screen.getAllByTestId('insight-card')).toHaveLength(2);
    });

    it('handles rapid dismiss clicks', async () => {
      const user = userEvent.setup();

      mockUseAnalyticsInsights.mockReturnValue({
        insights: mockInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      const dismissButtons = screen.getAllByTestId('dismiss-button');

      // Rapidly click multiple dismiss buttons
      await user.click(dismissButtons[0]);
      await user.click(dismissButtons[1]);

      expect(screen.getAllByTestId('insight-card')).toHaveLength(1);

      const stored = localStorage.getItem('dismissedInsights');
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(2);
    });

    it('handles empty priority groups gracefully', () => {
      const noMediumInsights: Insight[] = [
        { type: 'consistency', priority: 'high', message: 'High' },
        { type: 'performance', priority: 'low', message: 'Low' },
      ];

      mockUseAnalyticsInsights.mockReturnValue({
        insights: noMediumInsights,
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<InsightsFeed />);

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.queryByText('Medium Priority')).not.toBeInTheDocument();
      expect(screen.getByText('Low Priority')).toBeInTheDocument();
    });
  });
});
