import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useGoals } from '../../../src/hooks/useGoals';
import { mockGoals, createMockGoal } from '../../fixtures/mockData.js';

// Mock fetch globally
const mockFetch = vi.fn();

// Create proper response mock structure that matches what apiFetch expects
const createMockResponse = (data: any, ok: boolean = true, status: number = 200) => ({
  ok,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => data,
  text: async () => JSON.stringify(data),
});

global.fetch = mockFetch;

describe('useGoals - Basic Functionality', () => {
  const mockToken = 'mock-jwt-token-123';

  beforeEach(() => {
    mockFetch.mockClear();
    // Set up localStorage with the mock token for apiFetch to use
    window.localStorage.setItem('accessToken', mockToken);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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

      expect(mockFetch).toHaveBeenCalledWith('/api/goals', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`,
        },
      });
    });

    it('handles fetch success', async () => {
      // Mock goals fetch
      mockFetch.mockResolvedValueOnce(createMockResponse(mockGoals));

      // Mock progress fetch (automatically triggered after goals load)
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

      // Mock goals fetch
      mockFetch.mockResolvedValueOnce(createMockResponse(goals));

      // Mock progress fetch (automatically triggered after goals load)
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
      // Mock goals fetch
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      // Mock progress fetch (automatically triggered after goals load)
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
      // Clear localStorage to ensure no token is available
      window.localStorage.clear();

      const { result } = renderHook(() => useGoals(null));

      await expect(async () => {
        await result.current.createGoal({
          title: 'Test',
          type: 'DISTANCE',
          targetValue: 10,
          targetUnit: 'km',
          period: 'WEEKLY',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-07'),
        });
      }).rejects.toThrow('Authentication required but no token available');
    });
  });
});
