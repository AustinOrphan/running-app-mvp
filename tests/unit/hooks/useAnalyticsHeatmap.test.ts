import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  useAnalyticsHeatmap,
  Heatmap,
  HeatmapFeature,
} from '../../../src/hooks/useAnalyticsHeatmap';
import { createApiResponse, MockApiError } from '../../utils/mockApiUtils';

// Mock apiFetch utilities
vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: vi.fn(),
}));

// Mock clientLogger
vi.mock('../../../src/utils/clientLogger', () => ({
  logError: vi.fn(),
}));

// Import the mocked functions
import { apiGet } from '../../../src/utils/apiFetch';
const mockApiGet = vi.mocked(apiGet);

// Mock data
const mockHeatmapFeature: HeatmapFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.4, 37.7],
        [-122.4, 37.8],
        [-122.3, 37.8],
        [-122.3, 37.7],
        [-122.4, 37.7],
      ],
    ],
  },
  properties: {
    density: 15,
  },
};

const mockHeatmap: Heatmap = {
  type: 'FeatureCollection',
  features: [mockHeatmapFeature],
  bbox: [-122.4, 37.7, -122.3, 37.8],
};

const mockEmptyHeatmap: Heatmap = {
  type: 'FeatureCollection',
  features: [],
};

describe('useAnalyticsHeatmap', () => {
  beforeEach(() => {
    mockApiGet.mockClear();
    mockApiGet.mockResolvedValue(createApiResponse(mockHeatmap));
  });

  afterEach(() => {
    mockApiGet.mockReset();
  });

  describe('Initial State', () => {
    it('returns initial state when no token provided', () => {
      const { result } = renderHook(() => useAnalyticsHeatmap(null));

      expect(result.current.heatmap).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('does not fetch data when token is null', () => {
      renderHook(() => useAnalyticsHeatmap(null));

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches heatmap when token is provided', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      const { result } = renderHook(() => useAnalyticsHeatmap('valid-token', 0.5));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.heatmap).toEqual(mockHeatmap);
      expect(result.current.error).toBeNull();
    });

    it('makes correct API call with gridSize parameter', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      await act(async () => {
        renderHook(() => useAnalyticsHeatmap('test-token', 0.5));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/heatmap?gridSize=0.5');
    });

    it('defaults to 0.5 km grid size when not specified', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      await act(async () => {
        renderHook(() => useAnalyticsHeatmap('test-token'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/heatmap?gridSize=0.5');
      });
    });

    it('uses custom grid size', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      await act(async () => {
        renderHook(() => useAnalyticsHeatmap('test-token', 1.0));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/heatmap?gridSize=1');
      });
    });

    it('handles empty heatmap data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockEmptyHeatmap));

      const { result } = renderHook(() => useAnalyticsHeatmap('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.heatmap).toEqual(mockEmptyHeatmap);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('handles API error correctly', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new MockApiError('Not Found', 404));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsHeatmap('invalid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load heatmap');
      expect(result.current.heatmap).toBeNull();
    });

    it('handles network errors', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsHeatmap('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load heatmap');
    });
  });

  describe('Loading States', () => {
    it('sets loading to true while fetching data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      const { result } = renderHook(() => useAnalyticsHeatmap('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsHeatmap('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('sets loading to false after error', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsHeatmap('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Token Changes', () => {
    it('refetches data when token changes', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockHeatmap));

      const { result, rerender } = renderHook(({ token }) => useAnalyticsHeatmap(token), {
        initialProps: { token: 'token1' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      rerender({ token: 'token2' });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });

    it('does not fetch when token changes to null', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockHeatmap));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(
          (props: { token: string | null }) => useAnalyticsHeatmap(props.token),
          {
            initialProps: { token: 'valid-token' as string | null },
          }
        );
      });

      const { rerender } = hookResult!;

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBe(1);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      await act(async () => {
        rerender({ token: null as string | null });
      });

      expect(mockApiGet.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Grid Size Changes', () => {
    it('refetches data when gridSize changes', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockHeatmap));

      const { result, rerender } = renderHook(
        ({ gridSize }) => useAnalyticsHeatmap('valid-token', gridSize),
        {
          initialProps: { gridSize: 0.5 },
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      rerender({ gridSize: 1.0 });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/heatmap?gridSize=1');
    });

    it('handles fine grid size (0.1 km)', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      await act(async () => {
        renderHook(() => useAnalyticsHeatmap('test-token', 0.1));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/heatmap?gridSize=0.1');
      });
    });

    it('handles coarse grid size (2.0 km)', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      await act(async () => {
        renderHook(() => useAnalyticsHeatmap('test-token', 2.0));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/heatmap?gridSize=2');
      });
    });
  });

  describe('Refetch Function', () => {
    it('provides refetch function that reloads data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockHeatmap));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsHeatmap('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockHeatmap));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });
    });
  });
});
