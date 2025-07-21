import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockGoals,
  mockGoalProgress,
  mockCreateGoalData,
  createMockGoal,
  createMockGoalProgress,
} from '../../fixtures/mockData';

vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

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

import { useGoals } from '../../../src/hooks/useGoals';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../src/utils/apiFetch';

// Get references to mocked functions
const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
const mockApiPost = apiPost as ReturnType<typeof vi.fn>;
const mockApiPut = apiPut as ReturnType<typeof vi.fn>;
const mockApiDelete = apiDelete as ReturnType<typeof vi.fn>;

// Remove old fetch mock - we're mocking apiFetch utilities instead

describe('useGoals', () => {
  const mockToken = 'mock-jwt-token-123';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockApiGet.mockReset();
    mockApiPost.mockReset();
    mockApiPut.mockReset();
    mockApiDelete.mockReset();

    // Provide default mock responses
    mockApiGet.mockResolvedValue({ data: [], status: 200, headers: new Headers() });
    mockApiPost.mockResolvedValue({ data: {}, status: 200, headers: new Headers() });
    mockApiPut.mockResolvedValue({ data: {}, status: 200, headers: new Headers() });
    mockApiDelete.mockResolvedValue({ data: {}, status: 200, headers: new Headers() });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('starts with expected default values', async () => {
      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(mockToken));
      });

      const { result } = hookResult!;

      // Initial state before any async operations complete
      expect(result.current.goals).toEqual([]);
      expect(result.current.goalProgress).toEqual([]);
      expect(result.current.error).toBe(null);
      expect(result.current.activeGoals).toEqual([]);
      expect(result.current.completedGoals).toEqual([]);
      expect(result.current.newlyAchievedGoals).toEqual([]);

      // Wait for loading to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('does not fetch goals when token is null', async () => {
      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(null));
      });

      const { result } = hookResult!;

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
        headers: new Headers(),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toEqual(mockGoals);
      expect(result.current.error).toBe(null);
      expect(mockApiGet).toHaveBeenCalledWith('/api/goals');
    });

    it('handles fetch goals error correctly', async () => {
      const errorMessage = 'Failed to fetch goals';
      mockApiGet.mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toEqual([]);
      expect(result.current.error).toBe(errorMessage);
    });

    it('handles API error response correctly', async () => {
      // Create an ApiFetchError similar to what the real apiFetch would throw
      const error = new Error('Authentication failed. Please log in again.');
      (error as any).status = 401;
      mockApiGet.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Authentication failed. Please log in again.');
    });
  });

  describe('refreshProgress', () => {
    it('successfully fetches goal progress', async () => {
      mockFetch.mockClear();

      // Mock goals fetch
      mockFetch.mockResolvedValueOnce(createMockResponse(mockGoals));

      // Mock progress fetch
      mockFetch.mockResolvedValueOnce(createMockResponse(mockGoalProgress));

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

      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [existingGoal],
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock update goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedGoal,
      });

      // Mock progress refresh after update
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

      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [goalToDelete],
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
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

      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [goalToComplete],
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock complete goal
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => completedGoal,
      });

      // Mock progress refresh after completion
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
    it('correctly computes activeGoals', async () => {
      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      const expectedActiveGoals = mockGoals.filter(goal => !goal.isCompleted);
      expect(result.current.activeGoals).toEqual(expectedActiveGoals);
    });

    it('correctly computes completedGoals', async () => {
      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
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

      // Clear and reset mocks
      mockFetch.mockClear();
      mockFetch.mockReset();

      // Set up a specific mock implementation for this test
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('/api/goals') && !url.includes('progress') && !url.includes('complete')) {
          // Goals fetch (first call)
          return {
            ok: true,
            json: async () => [mockGoals[0]], // Use existing mock goal which is not completed
          };
        } else if (url.includes('/api/goals/progress')) {
          // Progress fetch (second call)
          return {
            ok: true,
            json: async () => [achievedProgress],
          };
        } else if (url.includes('/complete')) {
          // Complete endpoint (any subsequent calls) - return successful response but goal remains uncompleted
          return {
            ok: true,
            json: async () => ({ ...mockGoals[0], isCompleted: false }),
          };
        }
        // Default fallback
        return {
          ok: true,
          json: async () => [],
        };
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
      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
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
        expect(result.current.goalProgress.length).toBe(mockGoalProgress.length);
      });

      const progress = result.current.getGoalProgress('goal-1');
      expect(progress).toEqual(mockGoalProgress[0]);
    });

    it('returns undefined for non-existing goal', async () => {
      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
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
      // Clear the default mock first
      mockFetch.mockClear();

      // Mock initial goals fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGoals,
      });

      // Mock initial progress fetch (triggered when goals are loaded)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
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
      }).rejects.toThrow('Authentication required but no token available');
    });

    it('handles API response without json method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new Error('Invalid JSON')),
        text: async () => 'Server error',
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.error).toBe('Server error occurred. Please try again.');
      });
    });
  });
});
