import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useGoals } from '../../../src/hooks/useGoals';
import { mockGoals, createMockGoal } from '../../fixtures/mockData.js';
import { createApiResponse, MockApiError } from '../../utils/mockApiUtils';

// Mock useNotifications so the hook renders without pulling in toast/browser
// notification side effects.
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

// The hook talks to the API through the apiFetch helpers, so mock that module
// (same strategy as useGoals.test.ts).
vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('../../../src/utils/clientLogger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

import { apiGet, apiPost, apiPut, apiDelete } from '../../../src/utils/apiFetch';

describe('useGoals - Basic Functionality', () => {
  const mockToken = 'mock-jwt-token-123';

  const mockApiGet = vi.mocked(apiGet);
  const mockApiPost = vi.mocked(apiPost);
  const mockApiPut = vi.mocked(apiPut);
  const mockApiDelete = vi.mocked(apiDelete);

  beforeEach(() => {
    vi.clearAllMocks();

    mockApiGet.mockResolvedValue(createApiResponse([]));
    mockApiPost.mockResolvedValue(createApiResponse({}));
    mockApiPut.mockResolvedValue(createApiResponse({}));
    mockApiDelete.mockResolvedValue(createApiResponse({}));
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
      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('Basic API Calls', () => {
    it('makes correct API call for fetching goals', () => {
      renderHook(() => useGoals(mockToken));

      expect(mockApiGet).toHaveBeenCalledWith('/api/goals');
    });

    it('handles fetch success', async () => {
      mockApiGet.mockResolvedValueOnce(createApiResponse(mockGoals));

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
      mockApiGet.mockRejectedValueOnce(new Error('Network error'));

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

      mockApiGet.mockResolvedValueOnce(createApiResponse(goals));

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
      mockApiGet.mockResolvedValueOnce(createApiResponse([]));

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
      // apiFetch throws when no token is available; createGoal propagates it.
      mockApiPost.mockRejectedValue(
        new MockApiError('Authentication required but no token available', 401)
      );

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
