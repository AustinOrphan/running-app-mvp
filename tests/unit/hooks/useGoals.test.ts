import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useGoals } from '../../../src/hooks/useGoals';
import {
  mockGoals,
  mockGoalProgress,
  mockCreateGoalData,
  createMockGoal,
  createMockGoalProgress,
} from '../../fixtures/mockData';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useGoals', () => {
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

  describe('fetchGoals', () => {
    it('successfully fetches and sets goals', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 1000 }
      );

      expect(result.current.goals).toEqual(mockGoals);
      expect(result.current.error).toBe(null);
      expect(mockFetch).toHaveBeenCalledWith('/api/goals', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`,
        },
      });
    }, 10000);

    it('handles fetch goals error correctly', async () => {
      const errorMessage = 'Failed to fetch goals';
      mockFetch.mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toEqual([]);
      expect(result.current.error).toBe(errorMessage);
    });

    it('handles API error response correctly', async () => {
      const errorMessage = 'Unauthorized access';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: errorMessage }),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(errorMessage);
    });
  });

  describe('refreshProgress', () => {
    it('successfully fetches goal progress', async () => {
      // Mock goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      // Mock progress fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoalProgress,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      await waitFor(() => {
        expect(result.current.goalProgress).toEqual(mockGoalProgress);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/goals/progress/all', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`,
        },
      });
    });

    it('handles progress fetch error silently', async () => {
      // Mock goals fetch success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      // Mock progress fetch failure
      mockFetch.mockRejectedValueOnce(new Error('Progress fetch failed'));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      // Should not set error state for progress failures
      expect(result.current.error).toBe(null);
      expect(result.current.goalProgress).toEqual([]);
    });
  });

  describe('createGoal', () => {
    it('successfully creates a new goal', async () => {
      const newGoal = createMockGoal({ id: 'new-goal-1' });

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock create goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newGoal,
      });

      // Mock progress refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let createdGoal;
      await act(async () => {
        createdGoal = await result.current.createGoal(mockCreateGoalData);
      });

      expect(createdGoal).toEqual(newGoal);
      expect(result.current.goals).toContain(newGoal);
      expect(mockFetch).toHaveBeenCalledWith('/api/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify(mockCreateGoalData),
      });
    });

    it('throws error when create goal fails', async () => {
      const errorMessage = 'Failed to create goal';

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock create goal failure
      mockFetch.mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.createGoal(mockCreateGoalData);
        });
      }).rejects.toThrow(errorMessage);
    });
  });

  describe('updateGoal', () => {
    it('successfully updates an existing goal', async () => {
      const existingGoal = mockGoals[0];
      const updatedGoal = { ...existingGoal, title: 'Updated Goal Title' };

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [existingGoal],
      });

      // Mock update goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedGoal,
      });

      // Mock progress refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(existingGoal);
      });

      let resultGoal;
      await act(async () => {
        resultGoal = await result.current.updateGoal(existingGoal.id, {
          title: 'Updated Goal Title',
        });
      });

      expect(resultGoal).toEqual(updatedGoal);
      expect(result.current.goals.find(g => g.id === existingGoal.id)?.title).toBe(
        'Updated Goal Title'
      );
    });
  });

  describe('deleteGoal', () => {
    it('successfully deletes a goal', async () => {
      const goalToDelete = mockGoals[0];

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [goalToDelete],
      });

      // Mock delete goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(goalToDelete);
      });

      await act(async () => {
        await result.current.deleteGoal(goalToDelete.id);
      });

      expect(result.current.goals).not.toContain(goalToDelete);
      expect(mockFetch).toHaveBeenCalledWith(`/api/goals/${goalToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`,
        },
      });
    });
  });

  describe('completeGoal', () => {
    it('successfully completes a goal', async () => {
      const goalToComplete = { ...mockGoals[0], isCompleted: false };
      const completedGoal = {
        ...goalToComplete,
        isCompleted: true,
        completedAt: new Date().toISOString(),
      };

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [goalToComplete],
      });

      // Mock complete goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => completedGoal,
      });

      // Mock progress refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(goalToComplete);
      });

      let resultGoal;
      await act(async () => {
        resultGoal = await result.current.completeGoal(goalToComplete.id);
      });

      expect(resultGoal).toEqual(completedGoal);
      expect(result.current.goals.find(g => g.id === goalToComplete.id)?.isCompleted).toBe(true);
    });
  });

  describe('Computed Values', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });
    });

    it('correctly computes activeGoals', async () => {
      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      const expectedActiveGoals = mockGoals.filter(goal => !goal.isCompleted);
      expect(result.current.activeGoals).toEqual(expectedActiveGoals);
    });

    it('correctly computes completedGoals', async () => {
      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      const expectedCompletedGoals = mockGoals.filter(goal => goal.isCompleted);
      expect(result.current.completedGoals).toEqual(expectedCompletedGoals);
    });

    it('correctly identifies newlyAchievedGoals', async () => {
      // Setup mock with goals and progress indicating achievement
      const achievedProgress = createMockGoalProgress({
        goalId: 'goal-1',
        isCompleted: true,
        progressPercentage: 100,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [achievedProgress],
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(1);
      });

      // Should detect the achieved goal
      expect(result.current.newlyAchievedGoals).toHaveLength(1);
      expect(result.current.newlyAchievedGoals[0]?.id).toBe('goal-1');
    });
  });

  describe('getGoalProgress', () => {
    it('returns progress for existing goal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoalProgress,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(mockGoalProgress.length);
      });

      const progress = result.current.getGoalProgress('goal-1');
      expect(progress).toEqual(mockGoalProgress[0]);
    });

    it('returns undefined for non-existing goal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const progress = result.current.getGoalProgress('non-existing-goal');
      expect(progress).toBeUndefined();
    });
  });

  describe('markAchievementSeen', () => {
    it('marks achievement as seen', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.markAchievementSeen('goal-1');
      });

      // Achievement should be marked as seen (tested indirectly through newlyAchievedGoals)
      expect(result.current.newlyAchievedGoals.find(g => g.id === 'goal-1')).toBeUndefined();
    });
  });

  describe('Auto-completion', () => {
    it('auto-completes goals when progress indicates completion', async () => {
      const incompleteGoal = { ...mockGoals[0], isCompleted: false };
      const completedGoal = {
        ...incompleteGoal,
        isCompleted: true,
        completedAt: new Date().toISOString(),
      };
      const completeProgress = createMockGoalProgress({
        goalId: incompleteGoal.id,
        isCompleted: true,
        progressPercentage: 100,
      });

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [incompleteGoal],
      });

      // Mock progress fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [completeProgress],
      });

      // Mock auto-complete goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => completedGoal,
      });

      // Mock progress refresh after completion
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ ...completeProgress, isCompleted: true }],
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(1);
      });

      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(1);
      });

      // Wait for auto-completion effect to trigger
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(`/api/goals/${incompleteGoal.id}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockToken}`,
          },
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('handles missing authentication token', async () => {
      const { result } = renderHook(() => useGoals(null));

      await expect(async () => {
        await act(async () => {
          await result.current.createGoal(mockCreateGoalData);
        });
      }).rejects.toThrow('No authentication token available');
    });

    it('handles API response without json method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.error).toBe('Request failed with status 500');
      });
    });
  });
});
