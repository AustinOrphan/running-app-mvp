import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockGoals,
  mockGoalProgress,
  createMockGoal,
  createMockGoalProgress,
} from '../../fixtures/mockData';

// Mock dependencies
vi.mock('../../../src/utils/apiFetch', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

describe('useGoals - Notification Integration', () => {
  const mockToken = 'mock-jwt-token-123';
  let mockShowMilestoneNotification: ReturnType<typeof vi.fn>;
  let mockShowDeadlineNotification: ReturnType<typeof vi.fn>;
  let mockMilestoneDetector: any;
  let mockDeadlineDetector: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    vi.resetModules();

    // Create fresh mocks for each test
    mockShowMilestoneNotification = vi.fn();
    mockShowDeadlineNotification = vi.fn();

    mockMilestoneDetector = {
      checkMilestones: vi.fn().mockReturnValue({
        hasNewMilestones: false,
        newMilestones: [],
      }),
    };

    mockDeadlineDetector = {
      checkDeadlineReminder: vi.fn().mockReturnValue({
        shouldNotify: false,
        daysRemaining: 0,
      }),
    };

    // Setup global mocks
    (global as any).MilestoneDetector = mockMilestoneDetector;
    (global as any).DeadlineDetector = mockDeadlineDetector;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (global as any).MilestoneDetector;
    delete (global as any).DeadlineDetector;
  });

  it('calls showMilestoneNotification when milestone notifications enabled and milestone achieved', async () => {
    // Mock useNotifications with enabled milestone notifications
    vi.doMock('../../../src/hooks/useNotifications', () => ({
      useNotifications: () => ({
        showMilestoneNotification: mockShowMilestoneNotification,
        showDeadlineNotification: mockShowDeadlineNotification,
        preferences: {
          enableMilestoneNotifications: true,
          enableDeadlineReminders: false,
          deadlineReminderDays: 3,
        },
      }),
    }));

    // Mock MilestoneDetector to return a milestone
    mockMilestoneDetector.checkMilestones.mockReturnValue({
      hasNewMilestones: true,
      newMilestones: [{ percentage: 75, type: 'percentage' }],
    });

    // Mock API responses
    const { apiGet } = await import('../../../src/utils/apiFetch');
    const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
    
    const goalWithProgress = createMockGoal({ id: 'milestone-goal' });
    const progressWithMilestone = createMockGoalProgress({
      goalId: goalWithProgress.id,
      progressPercentage: 75,
      isCompleted: false,
    });

    mockApiGet
      .mockResolvedValueOnce({
        data: [goalWithProgress],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: [progressWithMilestone],
        status: 200,
        headers: new Headers(),
      });

    // Re-import useGoals after mocking
    const { useGoals } = await import('../../../src/hooks/useGoals');

    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goalProgress.length).toBe(1);
    });

    // Wait for notification check effect
    await waitFor(() => {
      expect(mockMilestoneDetector.checkMilestones).toHaveBeenCalledWith(
        goalWithProgress,
        progressWithMilestone
      );
    });

    await waitFor(() => {
      expect(mockShowMilestoneNotification).toHaveBeenCalledWith(
        goalWithProgress,
        progressWithMilestone,
        { percentage: 75, type: 'percentage' }
      );
    });
  });

  it('calls showDeadlineNotification when deadline reminders enabled and deadline approaching', async () => {
    // Mock useNotifications with enabled deadline reminders
    vi.doMock('../../../src/hooks/useNotifications', () => ({
      useNotifications: () => ({
        showMilestoneNotification: mockShowMilestoneNotification,
        showDeadlineNotification: mockShowDeadlineNotification,
        preferences: {
          enableMilestoneNotifications: false,
          enableDeadlineReminders: true,
          deadlineReminderDays: 3,
        },
      }),
    }));

    // Mock DeadlineDetector to return deadline reminder
    mockDeadlineDetector.checkDeadlineReminder.mockReturnValue({
      shouldNotify: true,
      daysRemaining: 2,
    });

    // Mock API responses
    const { apiGet } = await import('../../../src/utils/apiFetch');
    const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
    
    const goalWithDeadline = createMockGoal({
      id: 'deadline-goal',
      targetDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    });
    
    const progressData = createMockGoalProgress({
      goalId: goalWithDeadline.id,
      progressPercentage: 50,
    });

    mockApiGet
      .mockResolvedValueOnce({
        data: [goalWithDeadline],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: [progressData],
        status: 200,
        headers: new Headers(),
      });

    // Re-import useGoals after mocking
    const { useGoals } = await import('../../../src/hooks/useGoals');

    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goalProgress.length).toBe(1);
    });

    // Wait for notification check effect
    await waitFor(() => {
      expect(mockDeadlineDetector.checkDeadlineReminder).toHaveBeenCalledWith(
        goalWithDeadline,
        progressData,
        3 // deadlineReminderDays
      );
    });

    await waitFor(() => {
      expect(mockShowDeadlineNotification).toHaveBeenCalledWith(
        goalWithDeadline,
        progressData
      );
    });
  });

  it('does not call notification functions when notifications are disabled', async () => {
    // Mock useNotifications with disabled notifications
    vi.doMock('../../../src/hooks/useNotifications', () => ({
      useNotifications: () => ({
        showMilestoneNotification: mockShowMilestoneNotification,
        showDeadlineNotification: mockShowDeadlineNotification,
        preferences: {
          enableMilestoneNotifications: false,
          enableDeadlineReminders: false,
          deadlineReminderDays: 3,
        },
      }),
    }));

    // Mock API responses
    const { apiGet } = await import('../../../src/utils/apiFetch');
    const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
    
    const goal = createMockGoal({ id: 'no-notification-goal' });
    const progress = createMockGoalProgress({
      goalId: goal.id,
      progressPercentage: 75,
    });

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

    // Re-import useGoals after mocking
    const { useGoals } = await import('../../../src/hooks/useGoals');

    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goalProgress.length).toBe(1);
    });

    // Give time for effects to run
    await new Promise(resolve => setTimeout(resolve, 100));

    // Neither detector should be called when notifications are disabled
    expect(mockMilestoneDetector.checkMilestones).not.toHaveBeenCalled();
    expect(mockDeadlineDetector.checkDeadlineReminder).not.toHaveBeenCalled();
    expect(mockShowMilestoneNotification).not.toHaveBeenCalled();
    expect(mockShowDeadlineNotification).not.toHaveBeenCalled();
  });

  it('handles notification errors gracefully without affecting hook state', async () => {
    // Mock useNotifications with enabled notifications
    vi.doMock('../../../src/hooks/useNotifications', () => ({
      useNotifications: () => ({
        showMilestoneNotification: mockShowMilestoneNotification,
        showDeadlineNotification: mockShowDeadlineNotification,
        preferences: {
          enableMilestoneNotifications: true,
          enableDeadlineReminders: true,
          deadlineReminderDays: 3,
        },
      }),
    }));

    // Mock MilestoneDetector to throw error
    mockMilestoneDetector.checkMilestones.mockImplementation(() => {
      throw new Error('Milestone detector error');
    });

    // Mock API responses
    const { apiGet } = await import('../../../src/utils/apiFetch');
    const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
    
    const goal = createMockGoal({ id: 'error-goal' });
    const progress = createMockGoalProgress({
      goalId: goal.id,
      progressPercentage: 75,
    });

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

    // Re-import useGoals after mocking
    const { useGoals } = await import('../../../src/hooks/useGoals');

    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goalProgress.length).toBe(1);
    });

    // Give time for effects to run and handle errors
    await new Promise(resolve => setTimeout(resolve, 100));

    // Hook should still be functional despite notification errors
    expect(result.current.goals).toEqual([goal]);
    expect(result.current.goalProgress).toEqual([progress]);
    expect(result.current.error).toBe(null);
    expect(result.current.loading).toBe(false);
  });

  it('properly tracks previous progress to avoid duplicate notifications', async () => {
    // Mock useNotifications with enabled notifications
    vi.doMock('../../../src/hooks/useNotifications', () => ({
      useNotifications: () => ({
        showMilestoneNotification: mockShowMilestoneNotification,
        showDeadlineNotification: mockShowDeadlineNotification,
        preferences: {
          enableMilestoneNotifications: true,
          enableDeadlineReminders: false,
          deadlineReminderDays: 3,
        },
      }),
    }));

    // Mock MilestoneDetector to return milestone only on first check
    let checkCount = 0;
    mockMilestoneDetector.checkMilestones.mockImplementation(() => {
      checkCount++;
      return checkCount === 1 ? {
        hasNewMilestones: true,
        newMilestones: [{ percentage: 75, type: 'percentage' }],
      } : {
        hasNewMilestones: false,
        newMilestones: [],
      };
    });

    // Mock API responses
    const { apiGet } = await import('../../../src/utils/apiFetch');
    const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
    
    const goal = createMockGoal({ id: 'progress-tracking-goal' });
    const progress = createMockGoalProgress({
      goalId: goal.id,
      progressPercentage: 75,
    });

    mockApiGet
      .mockResolvedValueOnce({
        data: [goal],
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValue({
        data: [progress],
        status: 200,
        headers: new Headers(),
      });

    // Re-import useGoals after mocking
    const { useGoals } = await import('../../../src/hooks/useGoals');

    const { result } = renderHook(() => useGoals(mockToken));

    await waitFor(() => {
      expect(result.current.goalProgress.length).toBe(1);
    });

    // Wait for first notification
    await waitFor(() => {
      expect(mockShowMilestoneNotification).toHaveBeenCalledTimes(1);
    });

    // Trigger progress refresh
    await act(async () => {
      await result.current.refreshProgress();
    });

    // Give time for effects to run again
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should still only be called once (no duplicate notification)
    expect(mockShowMilestoneNotification).toHaveBeenCalledTimes(1);
    expect(mockMilestoneDetector.checkMilestones).toHaveBeenCalledTimes(2);
  });
});