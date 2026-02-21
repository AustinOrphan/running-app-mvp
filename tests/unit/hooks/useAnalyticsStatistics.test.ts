import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAnalyticsStatistics } from '../../../src/hooks/useAnalyticsStatistics';
import { AggregatedStats } from '../../../src/types';
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
const mockWeeklyStats: AggregatedStats = {
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

const mockMonthlyStats: AggregatedStats = {
  period: 'monthly',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  totalRuns: 20,
  totalDistance: 100,
  totalDuration: 28800,
  avgPace: 288,
  fastestPace: 240,
  longestRun: 15,
  totalElevation: 500,
  avgHeartRate: 148,
  maxHeartRate: 180,
};

describe('useAnalyticsStatistics', () => {
  beforeEach(() => {
    mockApiGet.mockClear();
    mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyStats));
  });

  afterEach(() => {
    mockApiGet.mockReset();
  });

  describe('Initial State', () => {
    it('returns initial state when no token provided', () => {
      const { result } = renderHook(() => useAnalyticsStatistics(null));

      expect(result.current.statistics).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('does not fetch data when token is null', () => {
      renderHook(() => useAnalyticsStatistics(null));

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches weekly statistics when token is provided', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyStats));

      const { result } = renderHook(() => useAnalyticsStatistics('valid-token', 'weekly'));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.statistics).toEqual(mockWeeklyStats);
      expect(result.current.error).toBeNull();
    });

    it('fetches monthly statistics when period is monthly', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockMonthlyStats));

      const { result } = renderHook(() => useAnalyticsStatistics('valid-token', 'monthly'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.statistics).toEqual(mockMonthlyStats);
      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/statistics?period=monthly');
    });

    it('makes correct API call with period parameter', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyStats));

      await act(async () => {
        renderHook(() => useAnalyticsStatistics('test-token', 'weekly'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/statistics?period=weekly');
    });

    it('defaults to weekly period when not specified', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyStats));

      await act(async () => {
        renderHook(() => useAnalyticsStatistics('test-token'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/statistics?period=weekly');
      });
    });
  });

  describe('Error Handling', () => {
    it('handles API error correctly', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new MockApiError('Unauthorized', 401));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsStatistics('invalid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load analytics statistics');
      expect(result.current.statistics).toBeNull();
    });

    it('handles network errors', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsStatistics('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load analytics statistics');
    });
  });

  describe('Loading States', () => {
    it('sets loading to true while fetching data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyStats));

      const { result } = renderHook(() => useAnalyticsStatistics('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyStats));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsStatistics('valid-token'));
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
        hookResult = renderHook(() => useAnalyticsStatistics('valid-token'));
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
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyStats));

      const { result, rerender } = renderHook(({ token }) => useAnalyticsStatistics(token), {
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
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyStats));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook((props: { token: string | null }) => useAnalyticsStatistics(props.token), {
          initialProps: { token: 'valid-token' as string | null },
        });
      });

      const { rerender } = hookResult!;

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBe(1);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      await act(async () => {
        rerender({ token: null as string | null });
      });

      // Should not make additional calls
      expect(mockApiGet.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Period Changes', () => {
    it('refetches data when period changes', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyStats));

      const { result, rerender } = renderHook(
        ({ period }) => useAnalyticsStatistics('valid-token', period),
        {
          initialProps: { period: 'weekly' as 'weekly' | 'monthly' | 'yearly' },
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      mockApiGet.mockResolvedValueOnce(createApiResponse(mockMonthlyStats));

      rerender({ period: 'monthly' as 'weekly' | 'monthly' | 'yearly' });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/statistics?period=monthly');
    });
  });

  describe('Refetch Function', () => {
    it('provides refetch function that reloads data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyStats));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsStatistics('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyStats));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });
    });
  });
});
