import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStats } from '../../../src/hooks/useStats';
import {
  mockWeeklyInsights,
  mockRunTypeBreakdown,
  mockTrendsData,
  mockPersonalRecords,
  mockApiError,
} from '../../fixtures/mockData';

// Mock fetch globally
const mockFetch = vi.fn();

describe('useStats', () => {
  beforeEach(() => {
    // Reset and set up fresh mock for each test
    vi.clearAllMocks();
    global.fetch = mockFetch;

    // Provide default mock responses to prevent undefined errors
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
      text: () => Promise.resolve(''),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('returns initial state when no token provided', () => {
      const { result } = renderHook(() => useStats(null));

      expect(result.current.weeklyInsights).toBeNull();
      expect(result.current.typeBreakdown).toEqual([]);
      expect(result.current.trendsData).toEqual([]);
      expect(result.current.personalRecords).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('does not fetch data when token is null', () => {
      renderHook(() => useStats(null));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches all statistics data when token is provided', async () => {
      // Clear default mock and set up specific responses for each endpoint
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      const { result } = renderHook(() => useStats('valid-token'));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.weeklyInsights).toEqual(mockWeeklyInsights);
      expect(result.current.typeBreakdown).toEqual(mockRunTypeBreakdown);
      expect(result.current.trendsData).toEqual(mockTrendsData);
      expect(result.current.personalRecords).toEqual(mockPersonalRecords);
      expect(result.current.error).toBeNull();
    });

    it('makes correct API calls with authorization header', async () => {
      // Clear default mock and set up specific responses
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('test-token'));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(4);
      });

      // Check all endpoints were called with correct headers
      expect(mockFetch).toHaveBeenCalledWith('/api/stats/insights-summary', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(mockFetch).toHaveBeenCalledWith('/api/stats/type-breakdown', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(mockFetch).toHaveBeenCalledWith('/api/stats/trends?period=3m', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(mockFetch).toHaveBeenCalledWith('/api/stats/personal-records', {
        headers: { Authorization: 'Bearer test-token' },
      });
    });

    it('uses custom period for trends data', async () => {
      // Clear default mock and set up specific responses
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('test-token', '6m'));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/stats/trends?period=6m', {
          headers: { Authorization: 'Bearer test-token' },
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('handles weekly insights fetch error', async () => {
      // Clear default mock and set up error for first call, success for others
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('invalid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load weekly insights');
      expect(result.current.weeklyInsights).toBeNull();
    });

    it('handles type breakdown fetch error', async () => {
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server Error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load run type breakdown');
      expect(result.current.typeBreakdown).toEqual([]);
    });

    it('handles trends data fetch error', async () => {
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Not Found' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load trends data');
      expect(result.current.trendsData).toEqual([]);
    });

    it('handles personal records fetch error', async () => {
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'Forbidden' }),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load personal records');
      expect(result.current.personalRecords).toEqual([]);
    });

    it('handles network errors', async () => {
      mockFetch.mockClear();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load weekly insights');
    });
  });

  describe('Loading States', () => {
    it('sets loading to true while fetching data', async () => {
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      const { result } = renderHook(() => useStats('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('sets loading to false after error', async () => {
      mockFetch.mockClear();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Token Changes', () => {
    it('refetches data when token changes', async () => {
      // Setup initial mocks
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      const { result, rerender } = renderHook(({ token }) => useStats(token), {
        initialProps: { token: 'token1' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockFetch.mock.calls.length;

      // Setup new mocks for rerender
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      rerender({ token: 'token2' });

      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });

    it('does not fetch when token changes to null', async () => {
      let hookResult: any;

      await act(async () => {
        hookResult = renderHook((props: { token: string | null }) => useStats(props.token), {
          initialProps: { token: 'valid-token' as string | null },
        });
      });

      const { rerender } = hookResult!;

      const initialCallCount = mockFetch.mock.calls.length;

      await act(async () => {
        rerender({ token: null as string | null });
      });

      // Should not make additional calls
      expect(mockFetch.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Period Changes', () => {
    it('refetches data when period changes', async () => {
      // Setup initial mocks
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      const { result, rerender } = renderHook(({ period }) => useStats('valid-token', period), {
        initialProps: { period: '3m' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockFetch.mock.calls.length;

      // Setup new mocks for rerender
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      rerender({ period: '1y' });

      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/stats/trends?period=1y', {
        headers: { Authorization: 'Bearer valid-token' },
      });
    });
  });

  describe('Refetch Function', () => {
    it('provides refetch function that reloads all data', async () => {
      // Setup initial mocks
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockFetch.mockClear();

      // Mock fresh data for refetch
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockWeeklyInsights),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockRunTypeBreakdown),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTrendsData),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPersonalRecords),
        });

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(4);
      });
    });
  });
});
