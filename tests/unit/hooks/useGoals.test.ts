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
import { createApiResponse, MockApiError } from '../../utils/mockApiUtils';

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

// The hook now talks to the API through the apiFetch helpers rather than
// calling global.fetch directly, so we mock that module.
vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

// Silence the client logger used in the hook's catch blocks.
vi.mock('../../../src/utils/clientLogger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

// Import the mocked functions after registering the mock.
import { apiGet, apiPost, apiPut, apiDelete } from '../../../src/utils/apiFetch';

describe('useGoals', () => {
  const mockToken = 'mock-jwt-token-123';

  const mockApiGet = vi.mocked(apiGet);
  const mockApiPost = vi.mocked(apiPost);
  const mockApiPut = vi.mocked(apiPut);
  const mockApiDelete = vi.mocked(apiDelete);

  beforeEach(() => {
    vi.clearAllMocks();

    // Default responses keep GET endpoints returning empty collections so the
    // hook settles into a stable (loading === false) state.
    mockApiGet.mockResolvedValue(createApiResponse([]));
    mockApiPost.mockResolvedValue(createApiResponse({}));
    mockApiPut.mockResolvedValue(createApiResponse({}));
    mockApiDelete.mockResolvedValue(createApiResponse({}));
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
      // First GET (goals) returns the fixtures; the follow-up progress GET
      // falls through to the default empty response.
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockGoals));

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useGoals(mockToken));
      });

      const { result } = hookResult!;

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 1000 }
      );

      expect(result.current.goals).toEqual(mockGoals);
      expect(result.current.error).toBe(null);
      expect(mockApiGet).toHaveBeenCalledWith('/api/goals');
    }, 10000);

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

    it('surfaces the API error message in error state', async () => {
      // apiFetch rejects with an ApiFetchError whose message the hook copies
      // into its error state.
      const errorMessage = 'Unauthorized access';
      mockApiGet.mockRejectedValueOnce(new MockApiError(errorMessage, 401));

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
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse(mockGoalProgress));
        }
        return Promise.resolve(createApiResponse(mockGoals));
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

      expect(mockApiGet).toHaveBeenCalledWith('/api/goals/progress/all');
    });

    it('handles progress fetch error silently', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.reject(new Error('Progress fetch failed'));
        }
        return Promise.resolve(createApiResponse(mockGoals));
      });

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

      mockApiGet.mockResolvedValue(createApiResponse([]));
      mockApiPost.mockResolvedValue(createApiResponse(newGoal));

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

      mockApiGet.mockResolvedValue(createApiResponse([]));
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

      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse([existingGoal]));
      });
      mockApiPut.mockResolvedValue(createApiResponse(updatedGoal));

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
      expect(mockApiPut).toHaveBeenCalledWith(`/api/goals/${existingGoal.id}`, {
        title: 'Updated Goal Title',
      });
    });
  });

  describe('deleteGoal', () => {
    it('successfully deletes a goal', async () => {
      const goalToDelete = mockGoals[0];

      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse([goalToDelete]));
      });
      mockApiDelete.mockResolvedValue(createApiResponse({}));

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

      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse([goalToComplete]));
      });
      mockApiPost.mockResolvedValue(createApiResponse(completedGoal));

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
      expect(mockApiPost).toHaveBeenCalledWith(`/api/goals/${goalToComplete.id}/complete`);
    });
  });

  describe('Computed Values', () => {
    it('correctly computes activeGoals', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse(mockGoals));
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(mockGoals.length);
      });

      const expectedActiveGoals = mockGoals.filter(goal => !goal.isCompleted);
      expect(result.current.activeGoals).toEqual(expectedActiveGoals);
    });

    it('correctly computes completedGoals', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse(mockGoals));
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
      // but the goal itself is not yet marked as complete.
      const achievedProgress = createMockGoalProgress({
        goalId: 'goal-1',
        isCompleted: true,
        progressPercentage: 100,
      });

      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/api/goals/progress')) {
          return Promise.resolve(createApiResponse([achievedProgress]));
        }
        // Goals fetch: an active (not completed) goal.
        return Promise.resolve(createApiResponse([mockGoals[0]]));
      });

      // The auto-completion effect fires because progress says complete while the
      // goal is still active. Reject the /complete call so the goal stays active
      // (mirroring "not yet marked complete") and the effect does not loop.
      mockApiPost.mockRejectedValue(new MockApiError('Complete failed', 500));

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
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse(mockGoalProgress));
        }
        return Promise.resolve(createApiResponse(mockGoals));
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(mockGoalProgress.length);
      });

      const progress = result.current.getGoalProgress('goal-1');
      expect(progress).toEqual(mockGoalProgress[0]);
    });

    it('returns undefined for non-existing goal', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse(mockGoals));
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
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([]));
        }
        return Promise.resolve(createApiResponse(mockGoals));
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

      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/progress')) {
          return Promise.resolve(createApiResponse([completeProgress]));
        }
        return Promise.resolve(createApiResponse([incompleteGoal]));
      });
      // The /complete call succeeds and flips the goal to completed, which stops
      // the auto-completion effect from firing again.
      mockApiPost.mockResolvedValue(createApiResponse(completedGoal));

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals.length).toBe(1);
      });

      await waitFor(() => {
        expect(result.current.goalProgress.length).toBe(1);
      });

      // Wait for auto-completion effect to trigger the complete call
      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(`/api/goals/${incompleteGoal.id}/complete`);
      });
    });
  });

  describe('Error Handling', () => {
    it('handles missing authentication token', async () => {
      // The hook no longer guards on the token itself; apiFetch throws when no
      // token is available, so createGoal surfaces that error.
      mockApiPost.mockRejectedValue(
        new MockApiError('Authentication required but no token available', 401)
      );

      const { result } = renderHook(() => useGoals(null));

      await expect(async () => {
        await act(async () => {
          await result.current.createGoal(mockCreateGoalData);
        });
      }).rejects.toThrow('Authentication required but no token available');
    });

    it('sets error state when the API request fails with a server error', async () => {
      // A 5xx from apiFetch surfaces as an ApiFetchError; the hook copies its
      // message into error state.
      mockApiGet.mockRejectedValueOnce(
        new MockApiError('Server error. Please try again later.', 500)
      );

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.error).toBe('Server error. Please try again later.');
      });
    });
  });
});
