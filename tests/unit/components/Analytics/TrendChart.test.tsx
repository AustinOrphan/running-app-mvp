import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrendChart } from '../../../../src/components/Analytics/TrendChart';

// Mock hooks
vi.mock('../../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../../src/hooks/useStats', () => ({
  useStats: vi.fn(),
}));

// Mock Recharts components
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children, data }: any) => (
    <div data-testid="line-chart" data-chart-data={JSON.stringify(data)}>
      {children}
    </div>
  ),
  AreaChart: ({ children, data }: any) => (
    <div data-testid="area-chart" data-chart-data={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: ({ dataKey, name }: any) => (
    <div data-testid={`line-${dataKey}`} data-name={name} />
  ),
  Area: ({ dataKey, name }: any) => (
    <div data-testid={`area-${dataKey}`} data-name={name} />
  ),
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: ({ yAxisId, orientation }: any) => (
    <div data-testid={`y-axis-${yAxisId || 'default'}`} data-orientation={orientation} />
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: ({ content }: any) => <div data-testid="tooltip">{content}</div>,
  Legend: () => <div data-testid="legend" />,
}));

// Import mocked functions
import { useAuth } from '../../../../src/hooks/useAuth';
import { useStats } from '../../../../src/hooks/useStats';

const mockUseAuth = vi.mocked(useAuth);
const mockUseStats = vi.mocked(useStats);

describe('TrendChart', () => {
  const mockGetToken = vi.fn(() => 'test-token');

  const mockTrendsData = [
    { date: '2026-01-01', distance: 5.2, pace: 330 }, // 5:30/km
    { date: '2026-01-08', distance: 6.5, pace: 315 }, // 5:15/km
    { date: '2026-01-15', distance: 7.0, pace: 300 }, // 5:00/km
    { date: '2026-01-22', distance: 5.8, pace: 310 }, // 5:10/km
  ];

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
    it('renders loading skeleton when loading is true', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: true,
      });

      const { container } = render(<TrendChart />);

      expect(container.querySelector('.trend-chart-loading')).toBeInTheDocument();
      expect(container.querySelectorAll('.skeleton-line')).toHaveLength(7); // 2 header + 5 chart bars
    });

    it('renders skeleton chart with correct height', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: true,
      });

      const { container } = render(<TrendChart height={400} />);

      const skeletonChart = container.querySelector('.skeleton-chart');
      expect(skeletonChart).toHaveStyle({ height: '400px' });
    });

    it('does not render controls when loading', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: true,
      });

      render(<TrendChart />);

      expect(screen.queryByLabelText('Metric selector')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Chart type selector')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when trendsData is null', () => {
      mockUseStats.mockReturnValue({
        trendsData: null,
        loading: false,
      });

      render(<TrendChart />);

      expect(screen.getByText('Not enough data for trends')).toBeInTheDocument();
      expect(screen.getByText('Add more runs to see your progress over time')).toBeInTheDocument();
      expect(screen.getByText('📈')).toBeInTheDocument();
    });

    it('renders empty state when trendsData is empty array', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      render(<TrendChart />);

      expect(screen.getByText('Not enough data for trends')).toBeInTheDocument();
    });

    it('renders header with title in empty state', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      render(<TrendChart />);

      expect(screen.getByText('Running Trends')).toBeInTheDocument();
    });

    it('does not render chart when empty', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      render(<TrendChart />);

      expect(screen.queryByTestId('responsive-container')).not.toBeInTheDocument();
    });
  });

  describe('Header and Controls', () => {
    beforeEach(() => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });
    });

    it('renders header with title', () => {
      render(<TrendChart />);

      expect(screen.getByText('Running Trends')).toBeInTheDocument();
    });

    it('renders metric selector with correct options', () => {
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector') as HTMLSelectElement;
      expect(metricSelector).toBeInTheDocument();

      const options = Array.from(metricSelector.options).map(opt => opt.value);
      expect(options).toEqual(['distance', 'pace', 'both']);
    });

    it('renders chart type selector with correct options', () => {
      render(<TrendChart />);

      const chartTypeSelector = screen.getByLabelText('Chart type selector') as HTMLSelectElement;
      expect(chartTypeSelector).toBeInTheDocument();

      const options = Array.from(chartTypeSelector.options).map(opt => opt.value);
      expect(options).toEqual(['line', 'area']);
    });

    it('defaults to distance metric', () => {
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector') as HTMLSelectElement;
      expect(metricSelector.value).toBe('distance');
    });

    it('defaults to line chart type', () => {
      render(<TrendChart />);

      const chartTypeSelector = screen.getByLabelText('Chart type selector') as HTMLSelectElement;
      expect(chartTypeSelector.value).toBe('line');
    });
  });

  describe('Metric Selection', () => {
    beforeEach(() => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });
    });

    it('changes metric when selector is changed', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector') as HTMLSelectElement;
      await user.selectOptions(metricSelector, 'pace');

      expect(metricSelector.value).toBe('pace');
    });

    it('renders distance line when distance metric is selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      await user.selectOptions(metricSelector, 'distance');

      expect(screen.getByTestId('line-distance')).toBeInTheDocument();
      expect(screen.queryByTestId('line-pace')).not.toBeInTheDocument();
    });

    it('renders pace line when pace metric is selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      await user.selectOptions(metricSelector, 'pace');

      expect(screen.getByTestId('line-pace')).toBeInTheDocument();
      expect(screen.queryByTestId('line-distance')).not.toBeInTheDocument();
    });

    it('renders both lines when both metric is selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      await user.selectOptions(metricSelector, 'both');

      expect(screen.getByTestId('line-distance')).toBeInTheDocument();
      expect(screen.getByTestId('line-pace')).toBeInTheDocument();
    });
  });

  describe('Chart Type Selection', () => {
    beforeEach(() => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });
    });

    it('changes chart type when selector is changed', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const chartTypeSelector = screen.getByLabelText('Chart type selector') as HTMLSelectElement;
      await user.selectOptions(chartTypeSelector, 'area');

      expect(chartTypeSelector.value).toBe('area');
    });

    it('renders LineChart when line type is selected', () => {
      render(<TrendChart />);

      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
      expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    });

    it('renders AreaChart when area type is selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const chartTypeSelector = screen.getByLabelText('Chart type selector');
      await user.selectOptions(chartTypeSelector, 'area');

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
      expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    });

    it('renders distance area when area type and distance metric selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const chartTypeSelector = screen.getByLabelText('Chart type selector');
      await user.selectOptions(chartTypeSelector, 'area');

      expect(screen.getByTestId('area-distance')).toBeInTheDocument();
    });

    it('renders pace area when area type and pace metric selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      const chartTypeSelector = screen.getByLabelText('Chart type selector');

      await user.selectOptions(metricSelector, 'pace');
      await user.selectOptions(chartTypeSelector, 'area');

      expect(screen.getByTestId('area-pace')).toBeInTheDocument();
    });
  });

  describe('Chart Rendering', () => {
    beforeEach(() => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });
    });

    it('renders ResponsiveContainer with correct height', () => {
      render(<TrendChart height={350} />);

      const container = screen.getByTestId('responsive-container');
      expect(container).toBeInTheDocument();
    });

    it('renders chart axes', () => {
      render(<TrendChart />);

      expect(screen.getByTestId('x-axis')).toBeInTheDocument();
      expect(screen.getByTestId('y-axis-left')).toBeInTheDocument();
    });

    it('renders CartesianGrid', () => {
      render(<TrendChart />);

      expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument();
    });

    it('renders Tooltip', () => {
      render(<TrendChart />);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('renders Legend', () => {
      render(<TrendChart />);

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });

    it('renders right Y-axis when pace or both metric is selected', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      await user.selectOptions(metricSelector, 'pace');

      expect(screen.getByTestId('y-axis-right')).toBeInTheDocument();
    });

    it('does not render right Y-axis when only distance is selected', () => {
      render(<TrendChart />);

      expect(screen.queryByTestId('y-axis-right')).not.toBeInTheDocument();
    });
  });

  describe('Data Formatting', () => {
    it('formats chart data with displayDate', () => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });

      const { container } = render(<TrendChart />);

      const lineChart = container.querySelector('[data-testid="line-chart"]');
      const chartData = JSON.parse(lineChart?.getAttribute('data-chart-data') || '[]');

      expect(chartData[0]).toHaveProperty('displayDate');
      expect(chartData[0].displayDate).toMatch(/\w{3} \d+/); // Matches "Jan 1", "Dec 31", etc.
      expect(typeof chartData[0].displayDate).toBe('string');
    });

    it('keeps pace in seconds for charting', () => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });

      const { container } = render(<TrendChart />);

      const lineChart = container.querySelector('[data-testid="line-chart"]');
      const chartData = JSON.parse(lineChart?.getAttribute('data-chart-data') || '[]');

      expect(chartData[0].pace).toBe(330);
    });

    it('sets pace to null when pace is 0', () => {
      mockUseStats.mockReturnValue({
        trendsData: [{ date: '2026-01-01', distance: 5.2, pace: 0 }],
        loading: false,
      });

      const { container } = render(<TrendChart />);

      const lineChart = container.querySelector('[data-testid="line-chart"]');
      const chartData = JSON.parse(lineChart?.getAttribute('data-chart-data') || '[]');

      expect(chartData[0].pace).toBeNull();
    });

    it('preserves distance values', () => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });

      const { container } = render(<TrendChart />);

      const lineChart = container.querySelector('[data-testid="line-chart"]');
      const chartData = JSON.parse(lineChart?.getAttribute('data-chart-data') || '[]');

      expect(chartData[0].distance).toBe(5.2);
      expect(chartData[1].distance).toBe(6.5);
    });
  });

  describe('Hook Integration', () => {
    it('calls useAuth hook', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      render(<TrendChart />);

      expect(mockUseAuth).toHaveBeenCalled();
    });

    it('calls useStats with token and default period', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      render(<TrendChart />);

      expect(mockUseStats).toHaveBeenCalledWith('test-token', '3m');
    });

    it('calls useStats with custom period', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      render(<TrendChart period="1y" />);

      expect(mockUseStats).toHaveBeenCalledWith('test-token', '1y');
    });

    it('respects different period values', () => {
      mockUseStats.mockReturnValue({
        trendsData: [],
        loading: false,
      });

      const { rerender } = render(<TrendChart period="3m" />);
      expect(mockUseStats).toHaveBeenCalledWith('test-token', '3m');

      rerender(<TrendChart period="6m" />);
      expect(mockUseStats).toHaveBeenCalledWith('test-token', '6m');

      rerender(<TrendChart period="1y" />);
      expect(mockUseStats).toHaveBeenCalledWith('test-token', '1y');
    });
  });

  describe('Custom Height', () => {
    beforeEach(() => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });
    });

    it('uses default height of 300', () => {
      const { container } = render(<TrendChart />);

      // Default height is passed to ResponsiveContainer
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('uses custom height when provided', () => {
      const { container } = render(<TrendChart height={400} />);

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles single data point', () => {
      mockUseStats.mockReturnValue({
        trendsData: [{ date: '2026-01-01', distance: 5.2, pace: 330 }],
        loading: false,
      });

      render(<TrendChart />);

      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('handles data with no pace values', () => {
      mockUseStats.mockReturnValue({
        trendsData: [
          { date: '2026-01-01', distance: 5.2, pace: 0 },
          { date: '2026-01-08', distance: 6.5, pace: 0 },
        ],
        loading: false,
      });

      const { container } = render(<TrendChart />);

      const lineChart = container.querySelector('[data-testid="line-chart"]');
      const chartData = JSON.parse(lineChart?.getAttribute('data-chart-data') || '[]');

      expect(chartData.every((d: any) => d.pace === null)).toBe(true);
    });

    it('handles very large distance values', () => {
      mockUseStats.mockReturnValue({
        trendsData: [{ date: '2026-01-01', distance: 42.195, pace: 300 }],
        loading: false,
      });

      const { container } = render(<TrendChart />);

      const lineChart = container.querySelector('[data-testid="line-chart"]');
      const chartData = JSON.parse(lineChart?.getAttribute('data-chart-data') || '[]');

      expect(chartData[0].distance).toBe(42.195);
    });

    it('handles switching between all combinations of metric and chart type', async () => {
      const user = userEvent.setup();

      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });

      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      const chartTypeSelector = screen.getByLabelText('Chart type selector');

      // Test all combinations
      await user.selectOptions(metricSelector, 'distance');
      await user.selectOptions(chartTypeSelector, 'line');
      expect(screen.getByTestId('line-distance')).toBeInTheDocument();

      await user.selectOptions(chartTypeSelector, 'area');
      expect(screen.getByTestId('area-distance')).toBeInTheDocument();

      await user.selectOptions(metricSelector, 'pace');
      expect(screen.getByTestId('area-pace')).toBeInTheDocument();

      await user.selectOptions(chartTypeSelector, 'line');
      expect(screen.getByTestId('line-pace')).toBeInTheDocument();

      await user.selectOptions(metricSelector, 'both');
      expect(screen.getByTestId('line-distance')).toBeInTheDocument();
      expect(screen.getByTestId('line-pace')).toBeInTheDocument();
    });

    it('handles rapid selector changes', async () => {
      const user = userEvent.setup();

      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });

      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');

      // Rapidly change selections
      await user.selectOptions(metricSelector, 'pace');
      await user.selectOptions(metricSelector, 'both');
      await user.selectOptions(metricSelector, 'distance');

      expect((metricSelector as HTMLSelectElement).value).toBe('distance');
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      mockUseStats.mockReturnValue({
        trendsData: mockTrendsData,
        loading: false,
      });
    });

    it('has accessible labels for selectors', () => {
      render(<TrendChart />);

      expect(screen.getByLabelText('Metric selector')).toBeInTheDocument();
      expect(screen.getByLabelText('Chart type selector')).toBeInTheDocument();
    });

    it('metric selector is keyboard accessible', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const metricSelector = screen.getByLabelText('Metric selector');
      metricSelector.focus();

      expect(metricSelector).toHaveFocus();
    });

    it('chart type selector is keyboard accessible', async () => {
      const user = userEvent.setup();
      render(<TrendChart />);

      const chartTypeSelector = screen.getByLabelText('Chart type selector');
      chartTypeSelector.focus();

      expect(chartTypeSelector).toHaveFocus();
    });
  });
});
