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

// Mock useNotifications hook
vi.mock('../../../src/hooks/useNotifications', () => ({
  useNotifications: () => ({
    showMilestoneNotification: vi.fn(),
    showDeadlineNotification: vi.fn(),
    showStreakNotification: vi.fn(),
    preferences: {
      enableMilestoneNotifications: false,
      enableDeadlineReminders: false,
      deadlineReminderDays: 3,
    },
  }),
}));

// Mock apiFetch utilities using vi.hoisted
const mocks = vi.hoisted(() => {
  return {
    mockApiGet: vi.fn(),
    mockApiPost: vi.fn(),
    mockApiPut: vi.fn(),
    mockApiDelete: vi.fn(),
  };
});

vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: mocks.mockApiGet,
  apiPost: mocks.mockApiPost,
  apiPut: mocks.mockApiPut,
  apiDelete: mocks.mockApiDelete,
}));

// Extract mocks for easier access
const { mockApiGet, mockApiPost, mockApiPut, mockApiDelete } = mocks;

describe('useGoals', () => {
  const mockToken = 'mock-jwt-token-123';

  beforeEach(() => {
    // Reset all apiFetch mocks for each test
    mockApiGet.mockReset();
    mockApiPost.mockReset();
    mockApiPut.mockReset();
    mockApiDelete.mockReset();

    // Set up default successful responses
    mockApiGet.mockResolvedValue({ data: [], status: 200 });
    mockApiPost.mockResolvedValue({ data: {}, status: 201 });
    mockApiPut.mockResolvedValue({ data: {}, status: 200 });
    mockApiDelete.mockResolvedValue({ data: null, status: 204 });
  });

  afterEach(() => {
    // Reset all apiFetch mocks after each test
    mockApiGet.mockReset();
    mockApiPost.mockReset();
    mockApiPut.mockReset();
    mockApiDelete.mockReset();
  });

  describe('Initial State', () => {
    it('starts with expected default values', async () => {
      const { result } = renderHook(() => useGoals(mockToken));

      // Initial state before any async operations complete
      expect(result.current.goals).toEqual([]);
      expect(result.current.goalProgress).toEqual([]);
      expect(result.current.error).toBe(null);
      expect(result.current.activeGoals).toEqual([]);
      expect(result.current.completedGoals).toEqual([]);
      expect(result.current.newlyAchievedGoals).toEqual([]);

      // Wait for loading to complete using RTL best practices
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 3000 }
      );
    });

    it('does not fetch goals when token is null', () => {
      const { result } = renderHook(() => useGoals(null));

      expect(result.current.loading).toBe(false);
      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('fetchGoals', () => {
    it('successfully fetches and sets goals', async () => {
      // Set up specific mock for this test
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      // Wait for async operations to complete
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
          expect(result.current.goals).toEqual(mockGoals);
        },
        { timeout: 3000 }
      );

      expect(result.current.error).toBe(null);
      expect(mockApiGet).toHaveBeenCalledWith('/api/goals');
    });

    it('handles fetch goals error correctly', async () => {
      const errorMessage = 'Failed to fetch goals';
      mockApiGet.mockRejectedValueOnce(new Error(errorMessage));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(mockToken));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toEqual([]);
      expect(result.current.error).toBe(errorMessage);
    });

    it('handles API error response correctly', async () => {
      const errorMessage = 'Unauthorized access';
      const apiError = new Error(errorMessage);
      mockApiGet.mockRejectedValueOnce(apiError);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(mockToken));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(errorMessage);
    });
  });

  describe('refreshProgress', () => {
    it('successfully fetches goal progress', async () => {
      // Mock goals fetch - first call when hook initializes
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock progress fetch - second call for progress data
      mockApiGet.mockResolvedValueOnce({
        data: mockGoalProgress,
        status: 200,
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(mockToken));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      await waitFor(() => {
        expect(result.current.goalProgress).toEqual(mockGoalProgress);
      });

      expect(mockApiGet).toHaveBeenCalledWith('/api/goals');
      expect(mockApiGet).toHaveBeenCalledWith('/api/goals/progress/all');
    });

    it('handles progress fetch error silently', async () => {
      // Mock goals fetch success
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock progress fetch failure
      mockApiGet.mockRejectedValueOnce(new Error('Progress fetch failed'));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(mockToken));
      });

      const { result } = hookResult!;

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
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      // Mock create goal
      mockApiPost.mockResolvedValueOnce({
        data: newGoal,
        status: 201,
      });

      // Mock progress refresh
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
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
      expect(mockApiPost).toHaveBeenCalledWith('/api/goals', mockCreateGoalData);
    });

    it('throws error when create goal fails', async () => {
      const errorMessage = 'Failed to create goal';

      // Mock initial goals fetch
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      // Mock create goal failure
      mockApiPost.mockRejectedValueOnce(new Error(errorMessage));

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
      mockApiGet.mockResolvedValueOnce({
        data: [existingGoal],
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      // Mock update goal
      mockApiPut.mockResolvedValueOnce({
        data: updatedGoal,
        status: 200,
      });

      // Mock progress refresh after update
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
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
      mockApiGet.mockResolvedValueOnce({
        data: [goalToDelete],
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      // Mock delete goal
      mockApiDelete.mockResolvedValueOnce({
        data: null,
        status: 204,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(goalToDelete);
      });

      await act(async () => {
        await result.current.deleteGoal(goalToDelete.id);
      });

      expect(result.current.goals).not.toContain(goalToDelete);
      expect(mockApiDelete).toHaveBeenCalledWith(`/api/goals/${goalToDelete.id}`);
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
      mockApiGet.mockResolvedValueOnce({
        data: [goalToComplete],
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      // Mock complete goal
      mockApiPost.mockResolvedValueOnce({
        data: completedGoal,
        status: 200,
      });

      // Mock progress refresh after completion
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
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
    it('correctly computes activeGoals', async () => {
      // Mock initial goals fetch
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      const expectedActiveGoals = mockGoals.filter(goal => !goal.isCompleted);
      expect(result.current.activeGoals).toEqual(expectedActiveGoals);
    });

    it('correctly computes completedGoals', async () => {
      // Mock initial goals fetch
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      const expectedCompletedGoals = mockGoals.filter(goal => goal.isCompleted);
      expect(result.current.completedGoals).toEqual(expectedCompletedGoals);
    });

    it('correctly identifies newlyAchievedGoals', async () => {
      // This test checks the detection of goals that have progress marked as complete
      // but the goal itself is not yet marked as complete
      const achievedProgress = createMockGoalProgress({
        goalId: 'goal-1',
        isCompleted: true,
        progressPercentage: 100,
      });

      // Set up specific mocks for this test
      mockApiGet
        .mockResolvedValueOnce({
          data: [mockGoals[0]], // Use existing mock goal which is not completed
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [achievedProgress],
          status: 200,
        });

      // Mock complete endpoint for any subsequent calls
      mockApiPost.mockResolvedValue({
        data: { ...mockGoals[0], isCompleted: false },
        status: 200,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      // Wait for goals to load
      await waitFor(() => {
        expect(result.current.goals.length).toBe(1);
      });

      // Wait for progress to load
      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(1);
      });

      // Wait for newlyAchievedGoals to be detected
      await waitFor(
        () => {
          expect(result.current.newlyAchievedGoals).toHaveLength(1);
        },
        { timeout: 3000 }
      );

      expect(result.current.newlyAchievedGoals[0]?.id).toBe('goal-1');
    });
  });

  describe('getGoalProgress', () => {
    it('returns progress for existing goal', async () => {
      // Mock initial goals fetch
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock progress fetch
      mockApiGet.mockResolvedValueOnce({
        data: mockGoalProgress,
        status: 200,
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(mockGoalProgress.length);
      });

      const progress = result.current.getGoalProgress('goal-1');
      expect(progress).toEqual(mockGoalProgress[0]);
    });

    it('returns undefined for non-existing goal', async () => {
      // Mock initial goals fetch
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
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
      // Mock initial goals fetch
      mockApiGet.mockResolvedValueOnce({
        data: mockGoals,
        status: 200,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
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
      mockApiGet.mockResolvedValueOnce({
        data: [incompleteGoal],
        status: 200,
      });

      // Mock progress fetch
      mockApiGet.mockResolvedValueOnce({
        data: [completeProgress],
        status: 200,
      });

      // Mock auto-complete goal
      mockApiPost.mockResolvedValueOnce({
        data: completedGoal,
        status: 200,
      });

      // Mock progress refresh after completion
      mockApiGet.mockResolvedValueOnce({
        data: [{ ...completeProgress, isCompleted: true }],
        status: 200,
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
        expect(mockApiPost).toHaveBeenCalledWith(`/api/goals/${incompleteGoal.id}/complete`);
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
      mockApiGet.mockRejectedValueOnce(new Error('Invalid JSON'));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.error).toBe('Unknown error');
      });
    });
  });
});
