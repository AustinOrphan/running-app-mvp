import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStats } from '../../../src/hooks/useStats';
import {
  mockWeeklyInsights,
  mockRunTypeBreakdown,
  mockTrendsData,
  mockPersonalRecords,
} from '../../fixtures/mockData';
import { createApiResponse, MockApiError } from '../../utils/mockApiUtils';

// Mock apiFetch utilities
vi.mock('../../../utils/apiFetch', () => ({
  apiGet: vi.fn(),
}));

// Import the mocked functions
import { apiGet } from '../../../utils/apiFetch';
const mockApiGet = vi.mocked(apiGet);


// Helper function to set up mock responses for all endpoints
const setupMockResponses = () => {
  mockApiGet
    .mockResolvedValueOnce(createApiResponse(mockWeeklyInsights))
    .mockResolvedValueOnce(createApiResponse(mockRunTypeBreakdown))
    .mockResolvedValueOnce(createApiResponse(mockTrendsData))
    .mockResolvedValueOnce(createApiResponse(mockPersonalRecords));
};

describe('useStats', () => {
  beforeEach(() => {
    // Reset only the specific mocks we're using
    mockApiGet.mockClear();
    
    // Provide default mock for apiGet
    mockApiGet.mockResolvedValue(createApiResponse([]));
  });

  afterEach(() => {
    // More targeted cleanup - only clear our specific mocks
    mockApiGet.mockReset();
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

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('fetches all statistics data when token is provided', async () => {
      // Clear default mock and set up specific responses for each endpoint
      mockApiGet.mockClear();
      setupMockResponses();

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
      mockApiGet.mockClear();
      setupMockResponses();

      await act(async () => {
        renderHook(() => useStats('test-token'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(4);
      });

      // Check all apiGet calls were made
      expect(mockApiGet).toHaveBeenCalledWith('/api/stats/insights-summary');
      expect(mockApiGet).toHaveBeenCalledWith('/api/stats/type-breakdown');
      expect(mockApiGet).toHaveBeenCalledWith('/api/stats/trends?period=3m');
      expect(mockApiGet).toHaveBeenCalledWith('/api/stats/personal-records');
    });

    it('uses custom period for trends data', async () => {
      // Clear default mock and set up specific responses
      mockApiGet.mockClear();
      setupMockResponses();

      await act(async () => {
        renderHook(() => useStats('test-token', '6m'));
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/api/stats/trends?period=6m');
      });
    });
  });

  describe('Error Handling', () => {
    it('handles weekly insights fetch error', async () => {
      // Clear default mock and set up error for first call, success for others
      mockApiGet.mockClear();
      mockApiGet
        .mockRejectedValueOnce(new MockApiError('Unauthorized', 401))
        .mockResolvedValueOnce(createApiResponse(mockRunTypeBreakdown))
        .mockResolvedValueOnce(createApiResponse(mockTrendsData))
        .mockResolvedValueOnce(createApiResponse(mockPersonalRecords));

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
      mockApiGet.mockClear();
      mockApiGet
        .mockResolvedValueOnce(createApiResponse(mockWeeklyInsights))
        .mockRejectedValueOnce(new MockApiError('Server Error', 500))
        .mockResolvedValueOnce(createApiResponse(mockTrendsData))
        .mockResolvedValueOnce(createApiResponse(mockPersonalRecords));

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
      mockApiGet.mockClear();
      mockApiGet
        .mockResolvedValueOnce(createApiResponse(mockWeeklyInsights))
        .mockResolvedValueOnce(createApiResponse(mockRunTypeBreakdown))
        .mockRejectedValueOnce(new MockApiError('Not Found', 404))
        .mockResolvedValueOnce(createApiResponse(mockPersonalRecords));

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
      mockApiGet.mockClear();
      
      // Set up successful mocks for first three calls, error for personal records
      mockApiGet
        .mockResolvedValueOnce(createApiResponse(mockWeeklyInsights))
        .mockResolvedValueOnce(createApiResponse(mockRunTypeBreakdown))
        .mockResolvedValueOnce(createApiResponse(mockTrendsData))
        .mockRejectedValueOnce(new MockApiError('Forbidden', 403));

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
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

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
      mockApiGet.mockClear();
      setupMockResponses();

      const { result } = renderHook(() => useStats('valid-token'));

      expect(result.current.loading).toBe(true);
    });

    it('sets loading to false after successful fetch', async () => {
      mockApiGet.mockClear();
      setupMockResponses();

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
      mockApiGet.mockClear();
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

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
      mockApiGet.mockClear();
      setupMockResponses();

      const { result, rerender } = renderHook(({ token }) => useStats(token), {
        initialProps: { token: 'token1' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      // Setup new mocks for rerender
      setupMockResponses();

      rerender({ token: 'token2' });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
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
      // Setup initial mocks
      mockApiGet.mockClear();
      setupMockResponses();

      const { result, rerender } = renderHook(({ period }) => useStats('valid-token', period), {
        initialProps: { period: '3m' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      // Setup new mocks for rerender
      setupMockResponses();

      rerender({ period: '1y' });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/stats/trends?period=1y');
    });
  });

  describe('Refetch Function', () => {
    it('provides refetch function that reloads all data', async () => {
      // Setup initial mocks
      mockApiGet.mockClear();
      setupMockResponses();

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useStats('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockApiGet.mockClear();

      // Mock fresh data for refetch
      mockApiGet
        .mockResolvedValueOnce(createApiResponse(mockWeeklyInsights))
        .mockResolvedValueOnce(createApiResponse(mockRunTypeBreakdown))
        .mockResolvedValueOnce(createApiResponse(mockTrendsData))
        .mockResolvedValueOnce(createApiResponse(mockPersonalRecords));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledTimes(4);
      });
    });
  });
});
