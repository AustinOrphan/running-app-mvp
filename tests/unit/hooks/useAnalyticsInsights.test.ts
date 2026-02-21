import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAnalyticsInsights } from '../../../src/hooks/useAnalyticsInsights';
import { Insight } from '../../../src/types';
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
const mockInsights: Insight[] = [
  {
    type: 'consistency',
    priority: 'high',
    message: 'Great consistency! You ran 5 times this week.',
    actionable: 'Keep up the momentum and aim for 6 runs next week',
  },
  {
    type: 'volume',
    priority: 'medium',
    message: 'Your weekly mileage increased by 15%',
    actionable: 'Monitor recovery to avoid overtraining',
  },
  {
    type: 'performance',
    priority: 'low',
    message: 'Average pace improved by 10 seconds per mile',
  },
];

describe('useAnalyticsInsights', () => {
  beforeEach(() => {
    mockApiGet.mockClear();
    mockApiGet.mockResolvedValue(createApiResponse({ insights: mockInsights }));
  });

  afterEach(() => {
    mockApiGet.mockReset();
  });

  describe('Initial State', () => {
    it('returns initial state when no token provided', () => {
      const { result } = renderHook(() => useAnalyticsInsights(null));

      expect(result.current.insights).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('does not fetch data when token is null', () => {
      renderHook(() => useAnalyticsInsights(null));

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches insights when token is provided', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse({ insights: mockInsights }));

      const { result } = renderHook(() => useAnalyticsInsights('valid-token'));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.insights).toEqual(mockInsights);
      expect(result.current.error).toBeNull();
    });

    it('makes correct API call', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse({ insights: mockInsights }));

      await act(async () => {
        renderHook(() => useAnalyticsInsights('test-token'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/analytics/insights');
    });

    it('handles empty insights array', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse({ insights: [] }));

      const { result } = renderHook(() => useAnalyticsInsights('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.insights).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('handles API error correctly', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new MockApiError('Internal Server Error', 500));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsInsights('invalid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load insights');
      expect(result.current.insights).toEqual([]);
    });

    it('handles network errors', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsInsights('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load insights');
    });
  });

  describe('Loading States', () => {
    it('sets loading to true while fetching data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockInsights));

      const { result } = renderHook(() => useAnalyticsInsights('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockInsights));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsInsights('valid-token'));
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
        hookResult = renderHook(() => useAnalyticsInsights('valid-token'));
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
      mockApiGet.mockResolvedValue(createApiResponse({ insights: mockInsights }));

      const { result, rerender } = renderHook(({ token }) => useAnalyticsInsights(token), {
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
      mockApiGet.mockResolvedValue(createApiResponse({ insights: mockInsights }));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook((props: { token: string | null }) => useAnalyticsInsights(props.token), {
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

  describe('Refetch Function', () => {
    it('provides refetch function that reloads data', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse({ insights: mockInsights }));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsInsights('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockApiGet.mockClear();
      mockApiGet.mockResolvedValueOnce(createApiResponse({ insights: mockInsights }));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(1);
      });
    });

    it('refetch maintains current loading state properly', async () => {
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue(createApiResponse(mockInsights));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useAnalyticsInsights('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Trigger refetch and verify loading state
      mockApiGet.mockClear();
      mockApiGet.mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve(createApiResponse({ insights: mockInsights })), 100)
          )
      );

      act(() => {
        result.current.refetch();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });
});
