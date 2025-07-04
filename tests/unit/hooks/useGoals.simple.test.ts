import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useGoals } from '../../../src/hooks/useGoals';
import { mockGoals, createMockGoal } from '../../fixtures/mockData.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useGoals - Basic Functionality', () => {
  const mockToken = 'mock-jwt-token-123';

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useGoals(mockToken));

      expect(mockFetch).toHaveBeenCalledWith('/api/goals', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`,
        },
      });
    });

    it('handles fetch success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => goals,
      });

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

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
      }).rejects.toThrow('No authentication token available');
    });
  });
});
