import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStats } from '../../../src/hooks/useStats';
import {
  mockWeeklyInsights,
  mockRunTypeBreakdown,
  mockTrendsData,
  mockPersonalRecords,
  mockApiError,
} from '../../fixtures/mockData';
import { createMockServer } from '../../setup/mockServer';

describe('useStats', () => {
  let mockAPI: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    mockAPI = createMockServer();
  });

  afterEach(() => {
    mockAPI.reset();
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
      const fetchSpy = vi.spyOn(global, 'fetch');

      renderHook(() => useStats(null));

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches all statistics data when token is provided', async () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

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
      const fetchSpy = vi.spyOn(global, 'fetch');

      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      renderHook(() => useStats('test-token'));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(4);
      });

      // Check all endpoints were called with correct headers
      expect(fetchSpy).toHaveBeenCalledWith('/api/stats/insights-summary', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(fetchSpy).toHaveBeenCalledWith('/api/stats/type-breakdown', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(fetchSpy).toHaveBeenCalledWith('/api/stats/trends?period=3m', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(fetchSpy).toHaveBeenCalledWith('/api/stats/personal-records', {
        headers: { Authorization: 'Bearer test-token' },
      });
    });

    it('uses custom period for trends data', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      renderHook(() => useStats('test-token', '6m'));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/stats/trends?period=6m', {
          headers: { Authorization: 'Bearer test-token' },
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('handles weekly insights fetch error', async () => {
      mockAPI.mockError(401, 'Unauthorized');
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result } = renderHook(() => useStats('invalid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load weekly insights');
      expect(result.current.weeklyInsights).toBeNull();
    });

    it('handles type breakdown fetch error', async () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockError(500, 'Server Error');
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load run type breakdown');
      expect(result.current.typeBreakdown).toEqual([]);
    });

    it('handles trends data fetch error', async () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockError(404, 'Not Found');
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load trends data');
      expect(result.current.trendsData).toEqual([]);
    });

    it('handles personal records fetch error', async () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockError(403, 'Forbidden');

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load personal records');
      expect(result.current.personalRecords).toEqual([]);
    });

    it('handles network errors', async () => {
      mockAPI.mockNetworkError();

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load statistics');
    });
  });

  describe('Loading States', () => {
    it('sets loading to true while fetching data', () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result } = renderHook(() => useStats('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('sets loading to false after error', async () => {
      mockAPI.mockNetworkError();

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Token Changes', () => {
    it('refetches data when token changes', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result, rerender } = renderHook(({ token }) => useStats(token), {
        initialProps: { token: 'token1' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = fetchSpy.mock.calls.length;

      // Change token
      mockAPI.reset();
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      rerender({ token: 'token2' });

      await waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });

    it('does not fetch when token changes to null', () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const { rerender } = renderHook(({ token }) => useStats(token), {
        initialProps: { token: 'valid-token' },
      });

      const initialCallCount = fetchSpy.mock.calls.length;

      rerender({ token: null });

      // Should not make additional calls
      expect(fetchSpy.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Period Changes', () => {
    it('refetches data when period changes', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result, rerender } = renderHook(({ period }) => useStats('valid-token', period), {
        initialProps: { period: '3m' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = fetchSpy.mock.calls.length;

      // Change period
      mockAPI.reset();
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      rerender({ period: '1y' });

      await waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(fetchSpy).toHaveBeenCalledWith('/api/stats/trends?period=1y', {
        headers: { Authorization: 'Bearer valid-token' },
      });
    });
  });

  describe('Refetch Function', () => {
    it('provides refetch function that reloads all data', async () => {
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      const { result } = renderHook(() => useStats('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const fetchSpy = vi.spyOn(global, 'fetch');
      fetchSpy.mockClear();

      // Mock fresh data for refetch
      mockAPI.reset();
      mockAPI.mockInsightsSummary(mockWeeklyInsights);
      mockAPI.mockTypeBreakdown(mockRunTypeBreakdown);
      mockAPI.mockTrends(mockTrendsData);
      mockAPI.mockPersonalRecords(mockPersonalRecords);

      result.current.refetch();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(4);
      });
    });
  });
});
