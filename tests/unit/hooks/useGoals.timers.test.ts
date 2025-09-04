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

describe('useGoals - Time-based Testing', () => {
  const mockToken = 'mock-jwt-token-123';
  let mockApiGet: ReturnType<typeof vi.fn>;
  let mockApiPost: ReturnType<typeof vi.fn>;
  let mockApiPut: ReturnType<typeof vi.fn>;
  let mockApiDelete: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Use fake timers
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'));

    // Import mocked functions
    const apiFetch = await import('../../../src/utils/apiFetch');
    mockApiGet = apiFetch.apiGet as ReturnType<typeof vi.fn>;
    mockApiPost = apiFetch.apiPost as ReturnType<typeof vi.fn>;
    mockApiPut = apiFetch.apiPut as ReturnType<typeof vi.fn>;
    mockApiDelete = apiFetch.apiDelete as ReturnType<typeof vi.fn>;

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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('handles time-based goal auto-completion with periodic progress updates', async () => {
    const timeBasedGoal = createMockGoal({
      id: 'time-based-goal',
      title: 'Run 3 times this week',
      goalType: 'time_based',
      targetDate: new Date('2024-01-07T23:59:59Z').toISOString(), // End of week
      isCompleted: false,
    });

    // Mock initial progress (1 out of 3 runs)
    const initialProgress = createMockGoalProgress({
      goalId: timeBasedGoal.id,
      progressPercentage: 33, // 1/3 = 33%
      isCompleted: false,
      currentValue: 1,
      targetValue: 3,
    });

    // Mock API responses for initial fetch
    mockApiGet
      .mockResolvedValueOnce({
        data: [timeBasedGoal],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: [initialProgress],
        status: 200,
        headers: new Headers(),
      });

    const { useGoals } = await import('../../../src/hooks/useGoals');
    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goals).toContain(timeBasedGoal);
      expect(result.current.goalProgress).toContain(initialProgress);
    });

    // Fast-forward to day 3 and simulate progress update
    vi.setSystemTime(new Date('2024-01-03T10:00:00Z'));

    const midWeekProgress = createMockGoalProgress({
      goalId: timeBasedGoal.id,
      progressPercentage: 67, // 2/3 = 67%
      isCompleted: false,
      currentValue: 2,
      targetValue: 3,
    });

    // Mock progress refresh
    mockApiGet.mockResolvedValueOnce({
      data: [midWeekProgress],
      status: 200,
      headers: new Headers(),
    });

    await act(async () => {
      await result.current.refreshProgress();
    });

    await waitFor(() => {
      expect(result.current.goalProgress[0].progressPercentage).toBe(67);
    });

    // Fast-forward to day 5 and complete the goal
    vi.setSystemTime(new Date('2024-01-05T10:00:00Z'));

    const completedProgress = createMockGoalProgress({
      goalId: timeBasedGoal.id,
      progressPercentage: 100, // 3/3 = 100%
      isCompleted: true,
      currentValue: 3,
      targetValue: 3,
    });

    const completedGoal = { ...timeBasedGoal, isCompleted: true };

    // Mock progress refresh and auto-completion
    mockApiGet.mockResolvedValueOnce({
      data: [completedProgress],
      status: 200,
      headers: new Headers(),
    });

    mockApiPost.mockResolvedValueOnce({
      data: completedGoal,
      status: 200,
      headers: new Headers(),
    });

    // Mock progress refresh after completion
    mockApiGet.mockResolvedValueOnce({
      data: [{ ...completedProgress, isCompleted: true }],
      status: 200,
      headers: new Headers(),
    });

    await act(async () => {
      await result.current.refreshProgress();
    });

    // Wait for auto-completion effect to trigger
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(`/api/goals/${timeBasedGoal.id}/complete`);
    });

    await waitFor(() => {
      expect(result.current.goals.find(g => g.id === timeBasedGoal.id)?.isCompleted).toBe(true);
    });
  });

  it('handles deadline reminders with time progression', async () => {
    const goalWithDeadline = createMockGoal({
      id: 'deadline-goal',
      targetDate: new Date('2024-01-05T23:59:59Z').toISOString(), // 5 days from now
      isCompleted: false,
    });

    const progress = createMockGoalProgress({
      goalId: goalWithDeadline.id,
      progressPercentage: 40,
      isCompleted: false,
    });

    // Mock API responses
    mockApiGet
      .mockResolvedValueOnce({
        data: [goalWithDeadline],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: [progress],
        status: 200,
        headers: new Headers(),
      });

    const { useGoals } = await import('../../../src/hooks/useGoals');
    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goals).toContain(goalWithDeadline);
    });

    // Fast-forward to 2 days before deadline
    vi.setSystemTime(new Date('2024-01-03T10:00:00Z'));

    // Mock refresh to simulate checking deadline proximity
    mockApiGet.mockResolvedValueOnce({
      data: [progress],
      status: 200,
      headers: new Headers(),
    });

    await act(async () => {
      await result.current.refreshProgress();
    });

    // Fast-forward past deadline
    vi.setSystemTime(new Date('2024-01-06T10:00:00Z'));

    mockApiGet.mockResolvedValueOnce({
      data: [progress],
      status: 200,
      headers: new Headers(),
    });

    await act(async () => {
      await result.current.refreshProgress();
    });

    // Goal should still be incomplete but past deadline
    expect(result.current.goals.find(g => g.id === goalWithDeadline.id)?.isCompleted).toBe(false);
    expect(new Date(goalWithDeadline.targetDate) < new Date()).toBe(true);
  });

  it('handles debounced API calls with rapid state changes', async () => {
    const goal = createMockGoal({ id: 'debounce-test-goal' });

    // Mock API responses
    mockApiGet
      .mockResolvedValueOnce({
        data: [goal],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValue({
        data: [],
        status: 200,
        headers: new Headers(),
      });

    // Mock update calls
    mockApiPut.mockResolvedValue({
      data: { ...goal, title: 'Final Update' },
      status: 200,
      headers: new Headers(),
    });

    const { useGoals } = await import('../../../src/hooks/useGoals');
    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goals).toContain(goal);
    });

    // Perform rapid successive updates within a short timeframe
    await act(async () => {
      result.current.updateGoal(goal.id, { title: 'Update 1' });

      // Advance time slightly
      vi.advanceTimersByTime(50);

      result.current.updateGoal(goal.id, { title: 'Update 2' });

      // Advance time slightly
      vi.advanceTimersByTime(50);

      result.current.updateGoal(goal.id, { title: 'Final Update' });

      // Let any debounced operations complete
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledTimes(3); // All calls should go through
    });
  });

  it('handles timeout scenarios in API calls', async () => {
    const goal = createMockGoal({ id: 'timeout-goal' });

    // Mock API call that takes a long time
    mockApiGet.mockImplementationOnce(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            data: [goal],
            status: 200,
            headers: new Headers(),
          });
        }, 5000); // 5 second delay
      });
    });

    const { useGoals } = await import('../../../src/hooks/useGoals');
    const { result } = renderHook(() => useGoals(mockToken));

    // Initially should be loading
    expect(result.current.loading).toBe(true);

    // Fast-forward 2.5 seconds (halfway through the API call)
    vi.advanceTimersByTime(2500);

    // Should still be loading
    expect(result.current.loading).toBe(true);
    expect(result.current.goals).toEqual([]);

    // Complete the remaining time for API call
    vi.advanceTimersByTime(2500);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.goals).toContain(goal);
    });
  });

  it('handles periodic auto-refresh with time intervals', async () => {
    const goal = createMockGoal({ id: 'refresh-goal' });
    let refreshCount = 0;

    // Mock API to track refresh calls
    mockApiGet.mockImplementation(() => {
      refreshCount++;
      return Promise.resolve({
        data: refreshCount === 1 ? [goal] : [], // Return different data on subsequent calls
        status: 200,
        headers: new Headers(),
      });
    });

    const { useGoals } = await import('../../../src/hooks/useGoals');
    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(refreshCount).toBe(2); // Initial fetch + progress refresh

    // Simulate periodic refresh (e.g., every 30 seconds)
    await act(async () => {
      vi.advanceTimersByTime(30000); // 30 seconds
      await result.current.fetchGoals();
    });

    await act(async () => {
      vi.advanceTimersByTime(30000); // Another 30 seconds
      await result.current.fetchGoals();
    });

    expect(refreshCount).toBeGreaterThan(2); // Should have made additional calls
  });

  it('handles time-based caching and cache invalidation', async () => {
    const goal = createMockGoal({ id: 'cache-goal' });

    // Mock API responses
    mockApiGet
      .mockResolvedValueOnce({
        data: [goal],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValue({
        data: [],
        status: 200,
        headers: new Headers(),
      });

    const { useGoals } = await import('../../../src/hooks/useGoals');
    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goals).toContain(goal);
    });

    // Fast-forward time to simulate cache expiration
    vi.advanceTimersByTime(60000); // 1 minute

    // Trigger refresh after cache expiration
    await act(async () => {
      await result.current.fetchGoals();
    });

    // Should have made fresh API calls
    expect(mockApiGet).toHaveBeenCalledTimes(3); // Initial + progress + refresh
  });
});
