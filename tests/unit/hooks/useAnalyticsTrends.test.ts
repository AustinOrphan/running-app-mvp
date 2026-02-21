import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAnalyticsTrends } from '../../../src/hooks/useAnalyticsTrends';
import { TrendAnalysis } from '../../../src/types';
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
const mockWeeklyTrends: TrendAnalysis = {
  period: 'weekly',
  dataPoints: 12,
  paceTrend: 'improving',
  volumeTrend: 'increasing',
  paceChangePercent: -5.2,
  volumeChangePercent: 10.5,
  consistencyScore: 85,
};

const mockMonthlyTrends: TrendAnalysis = {
  period: 'monthly',
  dataPoints: 6,
  paceTrend: 'stable',
  volumeTrend: 'stable',
  paceChangePercent: -0.5,
  volumeChangePercent: 2.1,
  consistencyScore: 78,
};

describe('useAnalyticsTrends', () => {
  beforeEach(() => {
    mockApiGet.mockClear();
    mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyTrends));
  });

  afterEach(() => {
    mockApiGet.mockReset();
  });

  describe('Initial State', () => {
    it('returns initial state when no token provided', () => {
      const { result } = renderHook(() => useAnalyticsTrends(null));

      expect(result.current.trends).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('does not fetch data when token is null', () => {
      renderHook(() => useAnalyticsTrends(null));

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches trends when token is provided', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      const { result } = renderHook(() => useAnalyticsTrends('valid-token', 'weekly', 12));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.trends).toEqual(mockWeeklyTrends);
      expect(result.current.error).toBeNull();
    });

    it('makes correct API call with period and dataPoints parameters', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      await act(async () => {
        renderHook(() => useAnalyticsTrends('test-token', 'weekly', 12));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/trends?period=weekly&dataPoints=12');
    });

    it('defaults to weekly period and 12 data points when not specified', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      await act(async () => {
        renderHook(() => useAnalyticsTrends('test-token'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/trends?period=weekly&dataPoints=12');
      });
    });

    it('uses custom period and dataPoints', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockMonthlyTrends));

      await act(async () => {
        renderHook(() => useAnalyticsTrends('test-token', 'monthly', 6));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/trends?period=monthly&dataPoints=6');
      });
    });
  });

  describe('Error Handling', () => {
    it('handles API error correctly', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new MockApiError('Forbidden', 403));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsTrends('invalid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load analytics trends');
      expect(result.current.trends).toBeNull();
    });

    it('handles network errors', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsTrends('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load analytics trends');
    });
  });

  describe('Loading States', () => {
    it('sets loading to true while fetching data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      const { result } = renderHook(() => useAnalyticsTrends('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsTrends('valid-token'));
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
        hookResult = renderHook(() => useAnalyticsTrends('valid-token'));
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
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyTrends));

      const { result, rerender } = renderHook(({ token }) => useAnalyticsTrends(token), {
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
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyTrends));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook((props: { token: string | null }) => useAnalyticsTrends(props.token), {
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

      expect(mockApiGet.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Parameter Changes', () => {
    it('refetches data when period changes', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyTrends));

      const { result, rerender } = renderHook(
        ({ period }) => useAnalyticsTrends('valid-token', period, 12),
        {
          initialProps: { period: 'weekly' as 'weekly' | 'monthly' | 'yearly' },
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      mockApiGet.mockResolvedValueOnce(createApiResponse(mockMonthlyTrends));

      rerender({ period: 'monthly' as 'weekly' | 'monthly' | 'yearly' });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/trends?period=monthly&dataPoints=12');
    });

    it('refetches data when dataPoints changes', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyTrends));

      const { result, rerender } = renderHook(
        ({ dataPoints }) => useAnalyticsTrends('valid-token', 'weekly', dataPoints),
        {
          initialProps: { dataPoints: 12 },
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      rerender({ dataPoints: 24 });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/trends?period=weekly&dataPoints=24');
    });
  });

  describe('Refetch Function', () => {
    it('provides refetch function that reloads data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockWeeklyTrends));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsTrends('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockWeeklyTrends));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });
    });
  });
});
