import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HeatmapMap } from '../../../../src/components/Analytics/HeatmapMap';
import { HeatmapData } from '../../../../src/hooks/useAnalyticsHeatmap';

// Mock hooks
vi.mock('../../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../../src/hooks/useAnalyticsHeatmap', () => ({
  useAnalyticsHeatmap: vi.fn(),
}));

// Import mocked functions
import { useAuth } from '../../../../src/hooks/useAuth';
import { useAnalyticsHeatmap } from '../../../../src/hooks/useAnalyticsHeatmap';

const mockUseAuth = vi.mocked(useAuth);
const mockUseAnalyticsHeatmap = vi.mocked(useAnalyticsHeatmap);

describe('HeatmapMap', () => {
  const mockGetToken = vi.fn(() => 'test-token');

  const mockHeatmapData: HeatmapData = {
    type: 'FeatureCollection' as const,
    bbox: [-122.5, 37.7, -122.3, 37.9],
    features: [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-122.4, 37.8],
              [-122.4, 37.85],
              [-122.35, 37.85],
              [-122.35, 37.8],
              [-122.4, 37.8],
            ],
          ],
        },
        properties: {
          density: 10,
        },
      },
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-122.45, 37.75],
              [-122.45, 37.8],
              [-122.4, 37.8],
              [-122.4, 37.75],
              [-122.45, 37.75],
            ],
          ],
        },
        properties: {
          density: 5,
        },
      },
    ],
  };

  // Mock Canvas API
  let mockCanvasContext: any;
  let canvasMethods: {
    getContext: ReturnType<typeof vi.fn>;
    getBoundingClientRect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup canvas mocks
    mockCanvasContext = {
      scale: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };

    canvasMethods = {
      getContext: vi.fn().mockReturnValue(mockCanvasContext),
      getBoundingClientRect: vi.fn().mockReturnValue({
        width: 800,
        height: 400,
        top: 0,
        left: 0,
        right: 800,
        bottom: 400,
      }),
    };

    HTMLCanvasElement.prototype.getContext = canvasMethods.getContext as any;
    HTMLCanvasElement.prototype.getBoundingClientRect = canvasMethods.getBoundingClientRect as any;

    mockUseAuth.mockReturnValue({
      getToken: mockGetToken,
      isLoggedIn: true,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    // Mock window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', {
      writable: true,
      configurable: true,
      value: 2,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Loading State', () => {
    it('renders loading state when loading is true', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: true,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText('Loading heatmap...')).toBeInTheDocument();
      expect(screen.getByText('🗺️')).toBeInTheDocument();
    });

    it('renders loading skeleton in header', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: true,
        error: null,
      });

      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.skeleton-line')).toBeInTheDocument();
    });

    it('renders header title in loading state', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: true,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText('GPS Heatmap')).toBeInTheDocument();
    });

    it('does not render canvas in loading state', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: true,
        error: null,
      });

      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.heatmap-canvas')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('renders error message when error occurs', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: 'Failed to load heatmap data',
      });

      render(<HeatmapMap />);

      expect(screen.getByText('Failed to load heatmap data')).toBeInTheDocument();
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('renders header in error state', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: 'Network error',
      });

      render(<HeatmapMap />);

      expect(screen.getByText('GPS Heatmap')).toBeInTheDocument();
    });

    it('does not render canvas in error state', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: 'Error',
      });

      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.heatmap-canvas')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when heatmap is null', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText('No GPS data available')).toBeInTheDocument();
      expect(
        screen.getByText('Record runs with GPS tracking to see your activity heatmap')
      ).toBeInTheDocument();
      expect(screen.getByText('🗺️')).toBeInTheDocument();
    });

    it('renders empty state when features array is empty', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: {
          type: 'FeatureCollection',
          bbox: [-122.5, 37.7, -122.3, 37.9],
          features: [],
        },
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText('No GPS data available')).toBeInTheDocument();
    });

    it('renders header in empty state', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText('GPS Heatmap')).toBeInTheDocument();
    });

    it('does not render canvas in empty state', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: null,
      });

      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.heatmap-canvas')).not.toBeInTheDocument();
    });
  });

  describe('Header and Controls', () => {
    beforeEach(() => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });
    });

    it('renders header with title', () => {
      render(<HeatmapMap />);

      expect(screen.getByText('GPS Heatmap')).toBeInTheDocument();
    });

    it('displays statistics in header', () => {
      render(<HeatmapMap />);

      expect(screen.getByText(/2 grid cells/)).toBeInTheDocument();
      expect(screen.getByText(/Max density: 10 points/)).toBeInTheDocument();
    });

    it('renders grid size selector with label', () => {
      render(<HeatmapMap />);

      expect(screen.getByLabelText('Grid Size:')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders grid size options correctly', () => {
      render(<HeatmapMap />);

      const selector = screen.getByRole('combobox') as HTMLSelectElement;
      const options = Array.from(selector.options).map(opt => ({
        value: opt.value,
        text: opt.text,
      }));

      expect(options).toEqual([
        { value: '0.1', text: '0.1 km (Fine)' },
        { value: '0.5', text: '0.5 km (Medium)' },
        { value: '1', text: '1.0 km (Coarse)' },
        { value: '2', text: '2.0 km (Very Coarse)' },
      ]);
    });

    it('defaults to 0.5 km grid size', () => {
      render(<HeatmapMap />);

      const selector = screen.getByRole('combobox') as HTMLSelectElement;
      expect(selector.value).toBe('0.5');
    });
  });

  describe('Grid Size Selection', () => {
    beforeEach(() => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });
    });

    it('changes grid size when selector is changed', async () => {
      const user = userEvent.setup();
      render(<HeatmapMap />);

      const selector = screen.getByRole('combobox') as HTMLSelectElement;
      await user.selectOptions(selector, '1');

      expect(selector.value).toBe('1');
    });

    it('calls useAnalyticsHeatmap with new grid size', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<HeatmapMap />);

      // Initial call with default 0.5
      expect(mockUseAnalyticsHeatmap).toHaveBeenCalledWith('test-token', 0.5);

      const selector = screen.getByRole('combobox');
      await user.selectOptions(selector, '2');

      // Re-render to trigger the hook with new value
      rerender(<HeatmapMap />);
    });

    it('handles all grid size options', async () => {
      const user = userEvent.setup();
      render(<HeatmapMap />);

      const selector = screen.getByRole('combobox') as HTMLSelectElement;

      await user.selectOptions(selector, '0.1');
      expect(selector.value).toBe('0.1');

      await user.selectOptions(selector, '0.5');
      expect(selector.value).toBe('0.5');

      await user.selectOptions(selector, '1');
      expect(selector.value).toBe('1');

      await user.selectOptions(selector, '2');
      expect(selector.value).toBe('2');
    });
  });

  describe('Canvas Rendering', () => {
    beforeEach(() => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });
    });

    it('renders canvas element', () => {
      const { container } = render(<HeatmapMap />);

      const canvas = container.querySelector('.heatmap-canvas');
      expect(canvas).toBeInTheDocument();
      expect(canvas?.tagName).toBe('CANVAS');
    });

    it('calls getContext on canvas', () => {
      render(<HeatmapMap />);

      expect(canvasMethods.getContext).toHaveBeenCalledWith('2d');
    });

    it('sets canvas dimensions based on devicePixelRatio', () => {
      const { container } = render(<HeatmapMap />);

      const canvas = container.querySelector('.heatmap-canvas') as HTMLCanvasElement;
      expect(canvas.width).toBe(1600); // 800 * 2 (devicePixelRatio)
      expect(canvas.height).toBe(800); // 400 * 2
    });

    it('scales canvas context by devicePixelRatio', () => {
      render(<HeatmapMap />);

      expect(mockCanvasContext.scale).toHaveBeenCalledWith(2, 2);
    });

    it('fills background with dark color', () => {
      render(<HeatmapMap />);

      expect(mockCanvasContext.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
    });

    it('draws polygons for each feature', () => {
      render(<HeatmapMap />);

      // Should call beginPath for each feature
      expect(mockCanvasContext.beginPath).toHaveBeenCalledTimes(2);
      expect(mockCanvasContext.fill).toHaveBeenCalledTimes(2);
      expect(mockCanvasContext.stroke).toHaveBeenCalledTimes(2);
    });

    it('draws polygon vertices with moveTo and lineTo', () => {
      render(<HeatmapMap />);

      // Each polygon has 5 vertices (closing point)
      expect(mockCanvasContext.moveTo).toHaveBeenCalled();
      expect(mockCanvasContext.lineTo).toHaveBeenCalled();
    });

    it('closes paths after drawing polygons', () => {
      render(<HeatmapMap />);

      expect(mockCanvasContext.closePath).toHaveBeenCalledTimes(2);
    });

    it('does not draw when heatmap has no bbox', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: {
          type: 'FeatureCollection',
          features: mockHeatmapData.features,
        },
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      // Should clear background but not draw features
      expect(mockCanvasContext.fillRect).toHaveBeenCalled();
      expect(mockCanvasContext.beginPath).not.toHaveBeenCalled();
    });
  });

  describe('Legend', () => {
    beforeEach(() => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });
    });

    it('renders legend section', () => {
      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.heatmap-legend')).toBeInTheDocument();
    });

    it('displays Activity Density label', () => {
      render(<HeatmapMap />);

      expect(screen.getByText('Activity Density')).toBeInTheDocument();
    });

    it('renders gradient bar', () => {
      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.legend-gradient')).toBeInTheDocument();
    });

    it('displays Low and High labels', () => {
      render(<HeatmapMap />);

      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
    });
  });

  describe('Info Section', () => {
    beforeEach(() => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });
    });

    it('renders info section', () => {
      const { container } = render(<HeatmapMap />);

      expect(container.querySelector('.heatmap-info')).toBeInTheDocument();
    });

    it('displays info about number of areas', () => {
      const { container } = render(<HeatmapMap />);

      expect(container.textContent).toContain('Showing 2 areas where you have run');
      expect(screen.getByText('📍')).toBeInTheDocument();
    });

    it('displays info about color meaning', () => {
      render(<HeatmapMap />);

      expect(screen.getByText('Brighter colors indicate higher activity')).toBeInTheDocument();
      expect(screen.getByText('🔥')).toBeInTheDocument();
    });

    it('updates area count based on features', () => {
      const singleFeatureData: HeatmapData = {
        ...mockHeatmapData,
        features: [mockHeatmapData.features[0]],
      };

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: singleFeatureData,
        loading: false,
        error: null,
      });

      const { container } = render(<HeatmapMap />);

      expect(container.textContent).toContain('Showing 1 areas where you have run');
    });
  });

  describe('Hook Integration', () => {
    it('calls useAuth hook', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(mockUseAuth).toHaveBeenCalled();
    });

    it('calls useAnalyticsHeatmap with token and default grid size', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(mockUseAnalyticsHeatmap).toHaveBeenCalledWith('test-token', 0.5);
    });

    it('uses token from useAuth', () => {
      const customToken = 'custom-token-123';
      mockGetToken.mockReturnValue(customToken);

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(mockUseAnalyticsHeatmap).toHaveBeenCalledWith(customToken, 0.5);
    });
  });

  describe('Statistics Display', () => {
    it('displays correct grid cell count', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText(/2 grid cells/)).toBeInTheDocument();
    });

    it('displays max density correctly', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText(/Max density: 10 points/)).toBeInTheDocument();
    });

    it('calculates max density from features', () => {
      const customHeatmap: HeatmapData = {
        ...mockHeatmapData,
        features: [
          { ...mockHeatmapData.features[0], properties: { density: 25 } },
          { ...mockHeatmapData.features[1], properties: { density: 15 } },
        ],
      };

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: customHeatmap,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText(/Max density: 25 points/)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles single feature', () => {
      const singleFeatureData: HeatmapData = {
        type: 'FeatureCollection',
        bbox: [-122.5, 37.7, -122.3, 37.9],
        features: [mockHeatmapData.features[0]],
      };

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: singleFeatureData,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText(/1 grid cells/)).toBeInTheDocument();
      expect(mockCanvasContext.beginPath).toHaveBeenCalledTimes(1);
    });

    it('handles very large density values', () => {
      const largeData: HeatmapData = {
        ...mockHeatmapData,
        features: [{ ...mockHeatmapData.features[0], properties: { density: 999999 } }],
      };

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: largeData,
        loading: false,
        error: null,
      });

      render(<HeatmapMap />);

      expect(screen.getByText(/Max density: 999999 points/)).toBeInTheDocument();
    });

    it('handles null canvas context gracefully', () => {
      canvasMethods.getContext.mockReturnValueOnce(null);

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });

      expect(() => render(<HeatmapMap />)).not.toThrow();
    });

    it('does not crash when canvas ref is not available', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });

      expect(() => render(<HeatmapMap />)).not.toThrow();
    });

    it('handles transition from loading to data', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: true,
        error: null,
      });

      const { rerender } = render(<HeatmapMap />);

      expect(screen.getByText('Loading heatmap...')).toBeInTheDocument();

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });

      rerender(<HeatmapMap />);

      expect(screen.queryByText('Loading heatmap...')).not.toBeInTheDocument();
      expect(screen.getByText(/2 grid cells/)).toBeInTheDocument();
    });

    it('handles transition from error to data', () => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: null,
        loading: false,
        error: 'Network error',
      });

      const { rerender } = render(<HeatmapMap />);

      expect(screen.getByText('Network error')).toBeInTheDocument();

      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });

      rerender(<HeatmapMap />);

      expect(screen.queryByText('Network error')).not.toBeInTheDocument();
      expect(screen.getByText(/2 grid cells/)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      mockUseAnalyticsHeatmap.mockReturnValue({
        heatmap: mockHeatmapData,
        loading: false,
        error: null,
      });
    });

    it('has accessible label for grid size selector', () => {
      render(<HeatmapMap />);

      const selector = screen.getByLabelText('Grid Size:');
      expect(selector).toBeInTheDocument();
    });

    it('grid size selector is keyboard accessible', async () => {
      render(<HeatmapMap />);

      const selector = screen.getByRole('combobox');
      selector.focus();

      expect(selector).toHaveFocus();
    });

    it('uses semantic HTML for controls', () => {
      const { container } = render(<HeatmapMap />);

      const label = container.querySelector('label[for="grid-size"]');
      const select = container.querySelector('select#grid-size');

      expect(label).toBeInTheDocument();
      expect(select).toBeInTheDocument();
    });
  });
});
