import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useGoals } from '../../../src/hooks/useGoals';
import { mockGoals, createMockGoal } from '../../fixtures/mockData.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

// Helper function to create complete fetch response mocks
const createMockResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers({
    'content-type': 'application/json',
  }),
  json: async () => data,
  text: async () => JSON.stringify(data),
});

describe('useGoals - Basic Functionality', () => {
  const mockToken = 'mock-jwt-token-123';

  beforeEach(() => {
    mockFetch.mockClear();

    // Mock localStorage and set the token
    mockLocalStorage.clear();
    mockLocalStorage.setItem('accessToken', mockToken);
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockLocalStorage.clear();
  });

  describe('Initial State', () => {
    it('starts with expected default values', () => {
      const { result } = renderHook(() => useGoals(mockToken));

      expect(result.current.goals).toEqual([]);
      expect(result.current.goalProgress).toEqual([]);
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBe(null);
      expect(result.current.activeGoals).toEqual([]);
      expect(result.current.completedGoals).toEqual([]);
      expect(result.current.newlyAchievedGoals).toEqual([]);
    });

    it('does not fetch goals when token is null', () => {
      const { result } = renderHook(() => useGoals(null));

      expect(result.current.loading).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Basic API Calls', () => {
    it('makes correct API call for fetching goals', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      renderHook(() => useGoals(mockToken));

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/goals',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockToken}`,
          }),
        })
      );
    });

    it('handles fetch success', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockGoals));
      // Also mock progress fetch when goals are loaded
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 2000 }
      );

      expect(result.current.goals).toEqual(mockGoals);
      expect(result.current.error).toBe(null);
    });

    it('handles fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 2000 }
      );

      expect(result.current.error).toBe('Network error');
      expect(result.current.goals).toEqual([]);
    });
  });

  describe('Computed Values', () => {
    it('correctly separates active and completed goals', async () => {
      const activeGoal = createMockGoal({ id: '1', isCompleted: false });
      const completedGoal = createMockGoal({ id: '2', isCompleted: true });
      const goals = [activeGoal, completedGoal];

      mockFetch.mockResolvedValueOnce(createMockResponse(goals));
      // Also mock progress fetch when goals are loaded
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(
        () => {
          expect(result.current.goals.length).toBe(2);
        },
        { timeout: 2000 }
      );

      expect(result.current.activeGoals).toEqual([activeGoal]);
      expect(result.current.completedGoals).toEqual([completedGoal]);
    });
  });

  describe('Helper Functions', () => {
    it('getGoalProgress returns undefined for non-existing goal', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 2000 }
      );

      const progress = result.current.getGoalProgress('non-existing-goal');
      expect(progress).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('handles missing authentication token', async () => {
      // Clear localStorage to simulate missing token
      mockLocalStorage.removeItem('accessToken');

      const { result } = renderHook(() => useGoals(null));

      await expect(async () => {
        await act(async () => {
          await result.current.createGoal({
            title: 'Test',
            type: 'DISTANCE',
            targetValue: 10,
            targetUnit: 'km',
            period: 'WEEKLY',
            startDate: new Date('2024-01-01'),
            endDate: new Date('2024-01-07'),
          });
        });
      }).rejects.toThrow('Authentication required but no token available');
    });
  });
});
