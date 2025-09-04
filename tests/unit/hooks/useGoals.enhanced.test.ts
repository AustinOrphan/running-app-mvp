import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockGoals,
  mockGoalProgress,
  createMockGoal,
  createMockGoalProgress,
  mockCreateGoalData,
} from '../../fixtures/mockData';

// Mock dependencies
vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('../../../src/hooks/useNotifications', () => ({
  useNotifications: () => ({
    showMilestoneNotification: vi.fn(),
    showDeadlineNotification: vi.fn(),
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

describe('useGoals - Enhanced Testing', () => {
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

  describe('Advanced Error Scenarios', () => {
    it('handles authentication failure during goal creation', async () => {
      // Mock initial successful load
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
        headers: new Headers(),
      });

      // Mock auth failure during create
      const authError = new Error('Token expired');
      (authError as any).status = 401;
      mockApiPost.mockRejectedValueOnce(authError);

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should throw authentication error
      await expect(async () => {
        await act(async () => {
          await result.current.createGoal(mockCreateGoalData);
        });
      }).rejects.toThrow('Token expired');

      // Goals state should remain unchanged
      expect(result.current.goals).toEqual([]);
    });

    it('handles server errors gracefully', async () => {
      // Mock server error response
      const serverError = new Error('Internal server error');
      (serverError as any).status = 500;
      mockApiGet.mockRejectedValueOnce(serverError);

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Internal server error');
      expect(result.current.goals).toEqual([]);
    });

    it('handles network timeout gracefully', async () => {
      // Mock network timeout
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'TIMEOUT';
      mockApiGet.mockRejectedValueOnce(timeoutError);

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Request timeout');
      expect(result.current.goals).toEqual([]);
    });
  });

  describe('Complex State Management', () => {
    it('maintains data consistency during rapid state changes', async () => {
      const goal1 = createMockGoal({ id: 'rapid-1', title: 'Goal 1' });
      const goal2 = createMockGoal({ id: 'rapid-2', title: 'Goal 2' });
      const goal3 = createMockGoal({ id: 'rapid-3', title: 'Goal 3' });

      // Mock initial empty state
      mockApiGet.mockResolvedValueOnce({
        data: [],
        status: 200,
        headers: new Headers(),
      });

      // Mock creation responses
      mockApiPost
        .mockResolvedValueOnce({ data: goal1, status: 201, headers: new Headers() })
        .mockResolvedValueOnce({ data: goal2, status: 201, headers: new Headers() })
        .mockResolvedValueOnce({ data: goal3, status: 201, headers: new Headers() });

      // Mock progress refreshes
      mockApiGet.mockResolvedValue({
        data: [],
        status: 200,
        headers: new Headers(),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Rapidly create multiple goals
      await act(async () => {
        await Promise.all([
          result.current.createGoal({ ...mockCreateGoalData, title: 'Goal 1' }),
          result.current.createGoal({ ...mockCreateGoalData, title: 'Goal 2' }),
          result.current.createGoal({ ...mockCreateGoalData, title: 'Goal 3' }),
        ]);
      });

      // Should have all three goals in state
      expect(result.current.goals).toHaveLength(3);
      expect(result.current.goals.map(g => g.title)).toEqual(['Goal 1', 'Goal 2', 'Goal 3']);
    });

    it('handles goal completion state transitions correctly', async () => {
      const incompleteGoal = createMockGoal({ id: 'transition-goal', isCompleted: false });
      const completedGoal = { ...incompleteGoal, isCompleted: true };

      // Mock initial data
      mockApiGet
        .mockResolvedValueOnce({
          data: [incompleteGoal],
          status: 200,
          headers: new Headers(),
        })
        .mockResolvedValue({
          data: [],
          status: 200,
          headers: new Headers(),
        });

      // Mock completion
      mockApiPost.mockResolvedValueOnce({
        data: completedGoal,
        status: 200,
        headers: new Headers(),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(incompleteGoal);
      });

      // Initially should be in active goals
      expect(result.current.activeGoals).toContain(incompleteGoal);
      expect(result.current.completedGoals).toEqual([]);

      // Complete the goal
      await act(async () => {
        await result.current.completeGoal(incompleteGoal.id);
      });

      // Should now be in completed goals
      const updatedGoal = result.current.goals.find(g => g.id === incompleteGoal.id);
      expect(updatedGoal?.isCompleted).toBe(true);
      expect(result.current.activeGoals).not.toContain(updatedGoal);
      expect(result.current.completedGoals).toContain(updatedGoal);
    });
  });

  describe('Data Consistency', () => {
    it('maintains goal-progress relationship integrity', async () => {
      const goal = createMockGoal({ id: 'consistency-goal' });
      const progress = createMockGoalProgress({
        goalId: goal.id,
        progressPercentage: 75,
      });

      // Mock data responses
      mockApiGet
        .mockResolvedValueOnce({
          data: [goal],
          status: 200,
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          data: [progress],
          status: 200,
          headers: new Headers(),
        });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(goal);
        expect(result.current.goalProgress).toContain(progress);
      });

      // getGoalProgress should return the correct progress
      const goalProgress = result.current.getGoalProgress(goal.id);
      expect(goalProgress).toEqual(progress);
      expect(goalProgress?.progressPercentage).toBe(75);

      // Delete goal should also remove associated progress
      mockApiDelete.mockResolvedValueOnce({
        data: {},
        status: 200,
        headers: new Headers(),
      });

      await act(async () => {
        await result.current.deleteGoal(goal.id);
      });

      expect(result.current.goals).not.toContain(goal);
      expect(result.current.goalProgress).not.toContain(progress);
      expect(result.current.getGoalProgress(goal.id)).toBeUndefined();
    });

    it('handles orphaned progress data gracefully', async () => {
      const goal = createMockGoal({ id: 'orphan-goal' });
      const orphanProgress = createMockGoalProgress({
        goalId: 'non-existent-goal',
        progressPercentage: 50,
      });

      // Mock data with orphaned progress
      mockApiGet
        .mockResolvedValueOnce({
          data: [goal],
          status: 200,
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          data: [orphanProgress],
          status: 200,
          headers: new Headers(),
        });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(goal);
        expect(result.current.goalProgress).toContain(orphanProgress);
      });

      // Should handle orphaned progress without crashing
      expect(result.current.getGoalProgress('non-existent-goal')).toEqual(orphanProgress);
      expect(result.current.getGoalProgress(goal.id)).toBeUndefined();

      // Hook should remain stable
      expect(result.current.error).toBe(null);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty API responses correctly', async () => {
      // Mock empty responses
      mockApiGet.mockResolvedValue({
        data: [],
        status: 200,
        headers: new Headers(),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toEqual([]);
      expect(result.current.goalProgress).toEqual([]);
      expect(result.current.activeGoals).toEqual([]);
      expect(result.current.completedGoals).toEqual([]);
      expect(result.current.newlyAchievedGoals).toEqual([]);
      expect(result.current.error).toBe(null);
    });

    it('handles malformed goal data with missing fields', async () => {
      const malformedGoal = {
        id: 'malformed-goal',
        // Missing required fields like title, description, etc.
      };

      mockApiGet.mockResolvedValueOnce({
        data: [malformedGoal],
        status: 200,
        headers: new Headers(),
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should handle malformed data without crashing
      expect(result.current.goals).toContain(malformedGoal);
      expect(result.current.error).toBe(null);
    });

    it('handles extremely large datasets efficiently', async () => {
      // Create large dataset (100 goals)
      const largeGoalSet = Array.from({ length: 100 }, (_, i) =>
        createMockGoal({ id: `large-goal-${i}`, title: `Goal ${i}` })
      );

      const largeProgressSet = Array.from({ length: 100 }, (_, i) =>
        createMockGoalProgress({
          goalId: `large-goal-${i}`,
          progressPercentage: Math.random() * 100,
        })
      );

      mockApiGet
        .mockResolvedValueOnce({
          data: largeGoalSet,
          status: 200,
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          data: largeProgressSet,
          status: 200,
          headers: new Headers(),
        });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toHaveLength(100);
      expect(result.current.goalProgress).toHaveLength(100);

      // Computed values should work efficiently
      expect(result.current.activeGoals.length + result.current.completedGoals.length).toBe(100);

      // Individual goal lookup should work
      expect(result.current.getGoalProgress('large-goal-50')).toBeDefined();
    });

    it('handles goal updates with optimistic UI updates', async () => {
      const originalGoal = createMockGoal({ id: 'optimistic-goal', title: 'Original Title' });
      const updatedGoal = { ...originalGoal, title: 'Updated Title' };

      // Mock initial data
      mockApiGet
        .mockResolvedValueOnce({
          data: [originalGoal],
          status: 200,
          headers: new Headers(),
        })
        .mockResolvedValue({
          data: [],
          status: 200,
          headers: new Headers(),
        });

      // Mock update with delay to test optimistic updates
      mockApiPut.mockImplementationOnce(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              data: updatedGoal,
              status: 200,
              headers: new Headers(),
            });
          }, 100);
        });
      });

      const { result } = renderHook(() => useGoals(mockToken));

      await waitFor(() => {
        expect(result.current.goals).toContain(originalGoal);
      });

      // Start update
      let updatePromise;
      await act(async () => {
        updatePromise = result.current.updateGoal(originalGoal.id, { title: 'Updated Title' });
      });

      // Complete the update
      await act(async () => {
        await updatePromise;
      });

      // Should have updated goal in state
      const goalInState = result.current.goals.find(g => g.id === originalGoal.id);
      expect(goalInState?.title).toBe('Updated Title');
    });
  });
});
