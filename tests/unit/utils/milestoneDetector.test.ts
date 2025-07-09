import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MilestoneDetector,
  DeadlineDetector,
  StreakDetector,
  GoalAnalytics,
} from '../../../src/utils/milestoneDetector';
import { Goal, GoalProgress } from '../../../src/types/goals';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock data factories
const createMockGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: 'goal-1',
  title: 'Test Goal',
  type: 'DISTANCE',
  targetValue: 50,
  targetUnit: 'km',
  period: 'MONTHLY',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31'),
  isCompleted: false,
  isActive: true,
  ...overrides,
});

const createMockGoalProgress = (overrides: Partial<GoalProgress> = {}): GoalProgress => ({
  goalId: 'goal-1',
  currentValue: 25,
  targetValue: 50,
  progressPercentage: 50,
  daysRemaining: 15,
  isOnTrack: true,
  ...overrides,
});

describe('MilestoneDetector', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('checkMilestones', () => {
    it('should detect new milestone achievements', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 75 });

      const result = MilestoneDetector.checkMilestones(goal, progress);

      expect(result.newMilestones).toEqual([25, 50, 75]);
      expect(result.hasNewMilestones).toBe(true);
      expect(result.nextMilestone).toBe(100);
    });

    it('should not detect already achieved milestones', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 75 });

      // First call should detect milestones
      MilestoneDetector.checkMilestones(goal, progress);

      // Second call should not detect same milestones
      const result = MilestoneDetector.checkMilestones(goal, progress);

      expect(result.newMilestones).toEqual([]);
      expect(result.hasNewMilestones).toBe(false);
    });

    it('should detect only new milestones when progress increases', () => {
      const goal = createMockGoal();

      // First check at 50%
      MilestoneDetector.checkMilestones(goal, createMockGoalProgress({ progressPercentage: 50 }));

      // Second check at 75%
      const result = MilestoneDetector.checkMilestones(
        goal,
        createMockGoalProgress({ progressPercentage: 75 })
      );

      expect(result.newMilestones).toEqual([75]);
      expect(result.hasNewMilestones).toBe(true);
    });

    it('should calculate progress to next milestone correctly', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 60 });

      const result = MilestoneDetector.checkMilestones(goal, progress);

      expect(result.nextMilestone).toBe(75);
      expect(result.progressToNextMilestone).toBe(40); // (60-50)/(75-50) * 100 = 40%
    });

    it('should handle 100% completion correctly', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 100 });

      const result = MilestoneDetector.checkMilestones(goal, progress);

      expect(result.newMilestones).toEqual([25, 50, 75, 100]);
      expect(result.nextMilestone).toBe(null);
      expect(result.progressToNextMilestone).toBe(0);
    });

    it('should handle low progress percentages', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 10 });

      const result = MilestoneDetector.checkMilestones(goal, progress);

      expect(result.newMilestones).toEqual([]);
      expect(result.nextMilestone).toBe(25);
      expect(result.progressToNextMilestone).toBe(40); // 10/25 * 100 = 40%
    });

    it('should handle localStorage errors gracefully', () => {
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 50 });

      expect(() => {
        MilestoneDetector.checkMilestones(goal, progress);
      }).not.toThrow();

      localStorage.getItem = originalGetItem;
    });
  });

  describe('clearMilestones', () => {
    it('should clear milestones for specific goal', () => {
      const goal1 = createMockGoal({ id: 'goal-1' });
      const goal2 = createMockGoal({ id: 'goal-2' });
      const progress = createMockGoalProgress({ progressPercentage: 50 });

      // Set milestones for both goals
      MilestoneDetector.checkMilestones(goal1, progress);
      MilestoneDetector.checkMilestones(goal2, progress);

      // Clear milestones for goal1
      MilestoneDetector.clearMilestones('goal-1');

      // Verify goal1 milestones are cleared but goal2 remains
      const goal1Milestones = MilestoneDetector.getAchievedMilestones('goal-1');
      const goal2Milestones = MilestoneDetector.getAchievedMilestones('goal-2');

      expect(goal1Milestones).toEqual([]);
      expect(goal2Milestones).toEqual([25, 50]);
    });
  });

  describe('getAchievedMilestones', () => {
    it('should return achieved milestones for goal', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ progressPercentage: 75 });

      MilestoneDetector.checkMilestones(goal, progress);

      const achieved = MilestoneDetector.getAchievedMilestones(goal.id);

      expect(achieved).toEqual([25, 50, 75]);
    });

    it('should return empty array for goal with no milestones', () => {
      const achieved = MilestoneDetector.getAchievedMilestones('nonexistent-goal');

      expect(achieved).toEqual([]);
    });
  });
});

describe('DeadlineDetector', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  describe('checkDeadlineReminder', () => {
    it('should trigger reminder for specified days', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 7 });
      const reminderDays = [7, 3, 1];

      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);

      expect(result.shouldNotify).toBe(true);
      expect(result.daysRemaining).toBe(7);
      expect(result.notificationLevel).toBe('info');
      expect(result.isUrgent).toBe(false);
    });

    it('should not trigger reminder for non-specified days', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 5 });
      const reminderDays = [7, 3, 1];

      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);

      expect(result.shouldNotify).toBe(false);
    });

    it('should mark urgent notifications correctly', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 1 });
      const reminderDays = [1];

      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);

      expect(result.notificationLevel).toBe('urgent');
      expect(result.isUrgent).toBe(true);
    });

    it('should mark warning notifications correctly', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 3 });
      const reminderDays = [3];

      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);

      expect(result.notificationLevel).toBe('warning');
      expect(result.isUrgent).toBe(false);
    });

    it('should handle due today notifications', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 0 });
      const reminderDays = [1];

      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);

      expect(result.shouldNotify).toBe(true);
      expect(result.notificationLevel).toBe('urgent');
    });

    it('should not send duplicate notifications on same day', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 3 });
      const reminderDays = [3];

      // First notification
      const result1 = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);
      expect(result1.shouldNotify).toBe(true);

      // Second notification same day
      const result2 = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);
      expect(result2.shouldNotify).toBe(false);
    });

    it('should send notification on different day for same milestone', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 3 });
      const reminderDays = [3];

      // First notification
      DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);

      // Advance time by one day
      vi.setSystemTime(new Date('2024-01-16T12:00:00Z'));

      // Should send notification again
      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, reminderDays);
      expect(result.shouldNotify).toBe(true);
    });
  });

  describe('clearDeadlineNotifications', () => {
    it('should clear deadline notifications for specific goal', () => {
      const goal = createMockGoal();
      const progress = createMockGoalProgress({ daysRemaining: 3 });

      // Set notification
      DeadlineDetector.checkDeadlineReminder(goal, progress, [3]);

      // Clear notifications
      DeadlineDetector.clearDeadlineNotifications(goal.id);

      // Should send notification again after clearing
      const result = DeadlineDetector.checkDeadlineReminder(goal, progress, [3]);
      expect(result.shouldNotify).toBe(true);
    });
  });
});

describe('StreakDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateRunningStreak', () => {
    it('should calculate current streak correctly', () => {
      const runDates = [
        '2024-01-15T06:00:00Z', // Today
        '2024-01-14T06:00:00Z', // Yesterday
        '2024-01-13T06:00:00Z', // 2 days ago
      ];

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
      expect(result.streakType).toBe('daily');
    });

    it('should handle broken streaks correctly', () => {
      const runDates = [
        '2024-01-15T06:00:00Z', // Today
        '2024-01-14T06:00:00Z', // Yesterday
        '2024-01-12T06:00:00Z', // 3 days ago (gap on 13th)
        '2024-01-11T06:00:00Z', // 4 days ago
      ];

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.currentStreak).toBe(2); // Only today and yesterday
      expect(result.longestStreak).toBe(2); // Both streaks are length 2
    });

    it('should calculate longest streak in history', () => {
      const runDates = [
        '2024-01-15T06:00:00Z', // Today
        '2024-01-10T06:00:00Z', // Gap
        '2024-01-09T06:00:00Z',
        '2024-01-08T06:00:00Z',
        '2024-01-07T06:00:00Z',
        '2024-01-06T06:00:00Z', // 4-day streak
      ];

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.currentStreak).toBe(1); // Only today
      expect(result.longestStreak).toBe(5); // Historical 5-day streak (Jan 6-10)
    });

    it('should detect celebration milestones', () => {
      const runDates = Array.from({ length: 7 }, (_, i) =>
        new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
      );

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.currentStreak).toBe(7);
      expect(result.shouldCelebrate).toBe(true); // 7 days is a milestone
    });

    it('should detect new records', () => {
      const runDates = [
        '2024-01-15T06:00:00Z',
        '2024-01-14T06:00:00Z',
        '2024-01-13T06:00:00Z', // 3-day current streak
      ];

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.isNewRecord).toBe(false); // Current equals longest
    });

    it('should handle empty run dates', () => {
      const result = StreakDetector.calculateRunningStreak([]);

      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
      expect(result.shouldCelebrate).toBe(false);
      expect(result.isNewRecord).toBe(false);
    });

    it('should handle single run', () => {
      const runDates = ['2024-01-15T06:00:00Z'];

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
    });

    it('should handle runs not starting from today', () => {
      const runDates = [
        '2024-01-13T06:00:00Z', // 2 days ago
        '2024-01-12T06:00:00Z', // 3 days ago
      ];

      const result = StreakDetector.calculateRunningStreak(runDates);

      expect(result.currentStreak).toBe(0); // No current streak since no run today/yesterday
      expect(result.longestStreak).toBe(2); // Historical streak
    });
  });

  describe('getStoredStreak and storeStreak', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('should store and retrieve streak information', () => {
      const streakInfo = {
        currentStreak: 5,
        longestStreak: 10,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      StreakDetector.storeStreak(streakInfo);
      const retrieved = StreakDetector.getStoredStreak();

      expect(retrieved).toEqual(streakInfo);
    });

    it('should store streak with goal ID', () => {
      const streakInfo = {
        currentStreak: 3,
        longestStreak: 7,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: true,
      };

      StreakDetector.storeStreak(streakInfo, 'goal-1');
      const retrieved = StreakDetector.getStoredStreak('goal-1');

      expect(retrieved).toEqual(streakInfo);
    });

    it('should return null for non-existent streak', () => {
      const retrieved = StreakDetector.getStoredStreak('nonexistent');

      expect(retrieved).toBe(null);
    });

    it('should handle localStorage errors gracefully', () => {
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      const retrieved = StreakDetector.getStoredStreak();

      expect(retrieved).toBe(null);

      localStorage.getItem = originalGetItem;
    });
  });

  describe('shouldNotifyStreak', () => {
    it('should notify for new records', () => {
      const newStreak = {
        currentStreak: 8,
        longestStreak: 8,
        streakType: 'daily' as const,
        isNewRecord: true,
        shouldCelebrate: false,
      };

      const oldStreak = {
        currentStreak: 5,
        longestStreak: 7,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      const shouldNotify = StreakDetector.shouldNotifyStreak(newStreak, oldStreak);

      expect(shouldNotify).toBe(true);
    });

    it('should notify for celebration milestones', () => {
      const newStreak = {
        currentStreak: 7,
        longestStreak: 7,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: true,
      };

      const oldStreak = {
        currentStreak: 6,
        longestStreak: 6,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      const shouldNotify = StreakDetector.shouldNotifyStreak(newStreak, oldStreak);

      expect(shouldNotify).toBe(true);
    });

    it('should notify for weekly milestones', () => {
      const newStreak = {
        currentStreak: 14,
        longestStreak: 14,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      const oldStreak = {
        currentStreak: 13,
        longestStreak: 13,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      const shouldNotify = StreakDetector.shouldNotifyStreak(newStreak, oldStreak);

      expect(shouldNotify).toBe(true); // 14 is divisible by 7
    });

    it('should notify for first streak when no old streak exists', () => {
      const newStreak = {
        currentStreak: 3,
        longestStreak: 3,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: true,
      };

      const shouldNotify = StreakDetector.shouldNotifyStreak(newStreak, null);

      expect(shouldNotify).toBe(true);
    });

    it('should not notify for regular increments', () => {
      const newStreak = {
        currentStreak: 5,
        longestStreak: 8,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      const oldStreak = {
        currentStreak: 4,
        longestStreak: 8,
        streakType: 'daily' as const,
        isNewRecord: false,
        shouldCelebrate: false,
      };

      const shouldNotify = StreakDetector.shouldNotifyStreak(newStreak, oldStreak);

      expect(shouldNotify).toBe(false);
    });
  });
});

describe('GoalAnalytics', () => {
  const createGoalsWithProgress = () => {
    const goals = [
      createMockGoal({ id: 'goal-1', isCompleted: true, isActive: true }),
      createMockGoal({ id: 'goal-2', isCompleted: false, isActive: true }),
      createMockGoal({ id: 'goal-3', isCompleted: false, isActive: false }),
    ];

    const progressData = [
      createMockGoalProgress({ goalId: 'goal-1', progressPercentage: 100 }),
      createMockGoalProgress({ goalId: 'goal-2', progressPercentage: 60 }),
    ];

    return { goals, progressData };
  };

  describe('calculateGoalStats', () => {
    it('should calculate goal statistics correctly', () => {
      const { goals, progressData } = createGoalsWithProgress();

      const stats = GoalAnalytics.calculateGoalStats(goals, progressData);

      expect(stats.goalsCompleted).toBe(1);
      expect(stats.totalGoals).toBe(2); // Only active goals
      expect(stats.averageProgress).toBe(60); // Only active, incomplete goal
    });

    it('should identify top performing goal', () => {
      const goals = [
        createMockGoal({ id: 'goal-1', title: 'Best Goal', isActive: true }),
        createMockGoal({ id: 'goal-2', title: 'Average Goal', isActive: true }),
      ];

      const progressData = [
        createMockGoalProgress({ goalId: 'goal-1', progressPercentage: 80 }),
        createMockGoalProgress({ goalId: 'goal-2', progressPercentage: 40 }),
      ];

      const stats = GoalAnalytics.calculateGoalStats(goals, progressData);

      expect(stats.topPerformingGoal).toBe('Best Goal');
    });

    it('should identify struggling goals', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-20T12:00:00Z'));

      const goals = [
        createMockGoal({
          id: 'goal-1',
          title: 'Struggling Goal',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          isActive: true,
        }),
      ];

      const progressData = [
        createMockGoalProgress({ goalId: 'goal-1', progressPercentage: 20 }), // Low progress
      ];

      const stats = GoalAnalytics.calculateGoalStats(goals, progressData);

      expect(stats.strugglingGoals).toContain('Struggling Goal');

      vi.useRealTimers();
    });

    it('should generate improvement suggestions', () => {
      const { goals, progressData } = createGoalsWithProgress();

      const stats = GoalAnalytics.calculateGoalStats(goals, progressData);

      expect(stats.improvementSuggestions).toBeInstanceOf(Array);
      expect(stats.improvementSuggestions.length).toBeGreaterThan(0);
    });

    it('should handle goals without progress data', () => {
      const goals = [createMockGoal({ isActive: true })];

      const stats = GoalAnalytics.calculateGoalStats(goals, []);

      expect(stats.averageProgress).toBe(0);
      expect(stats.topPerformingGoal).toBeUndefined();
    });

    it('should suggest goal variety for single type', () => {
      const goals = [
        createMockGoal({ id: 'goal-1', type: 'DISTANCE', isActive: true }),
        createMockGoal({ id: 'goal-2', type: 'DISTANCE', isActive: true }),
      ];

      const progressData = [
        createMockGoalProgress({ goalId: 'goal-1', progressPercentage: 50 }),
        createMockGoalProgress({ goalId: 'goal-2', progressPercentage: 50 }),
      ];

      const stats = GoalAnalytics.calculateGoalStats(goals, progressData);

      expect(stats.improvementSuggestions).toContainEqual(
        expect.stringContaining('diversifying your goals')
      );
    });
  });
});
