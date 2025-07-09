import { describe, it, expect } from 'vitest';
import { GoalAnalyticsCalculator } from '../../../src/utils/goalAnalytics';
import { Goal, GoalProgress } from '../../../src/types/goals';

// Mock data factories for testing
const createMockGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: 'goal-1',
  userId: 'user-1',
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

describe('GoalAnalyticsCalculator', () => {
  describe('calculateAnalytics', () => {
    it('should calculate basic analytics for empty goals', () => {
      const result = GoalAnalyticsCalculator.calculateAnalytics([], []);

      expect(result.totalGoals).toBe(0);
      expect(result.activeGoals).toBe(0);
      expect(result.completedGoals).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.averageTimeToCompletion).toBe(0);
      expect(result.mostCommonGoalType).toBe('No goals yet');
    });

    it('should calculate analytics for single active goal', () => {
      const goals = [createMockGoal()];
      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.totalGoals).toBe(1);
      expect(result.activeGoals).toBe(1);
      expect(result.completedGoals).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.mostCommonGoalType).toBe('DISTANCE');
    });

    it('should calculate analytics for mixed active and completed goals', () => {
      const goals = [
        createMockGoal({ id: 'goal-1', isCompleted: false }),
        createMockGoal({ id: 'goal-2', isCompleted: true, completedAt: new Date('2024-01-15') }),
        createMockGoal({ id: 'goal-3', isCompleted: true, completedAt: new Date('2024-01-20') }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.totalGoals).toBe(3);
      expect(result.activeGoals).toBe(1);
      expect(result.completedGoals).toBe(2);
      expect(result.completionRate).toBe(66.67);
    });

    it('should identify most common goal type correctly', () => {
      const goals = [
        createMockGoal({ id: 'goal-1', type: 'DISTANCE' }),
        createMockGoal({ id: 'goal-2', type: 'DISTANCE' }),
        createMockGoal({ id: 'goal-3', type: 'TIME' }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.mostCommonGoalType).toBe('DISTANCE');
      expect(result.goalsByType).toEqual({
        DISTANCE: 2,
        TIME: 1,
      });
    });

    it('should calculate average time to completion correctly', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          isCompleted: true,
          startDate: new Date('2024-01-01'),
          completedAt: new Date('2024-01-15'), // 14 days
        }),
        createMockGoal({
          id: 'goal-2',
          isCompleted: true,
          startDate: new Date('2024-01-01'),
          completedAt: new Date('2024-01-31'), // 30 days
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.averageTimeToCompletion).toBe(22); // (14 + 30) / 2 = 22
    });

    it('should categorize goals by difficulty correctly', () => {
      const goals = [
        createMockGoal({ type: 'DISTANCE', targetValue: 10 }), // beginner
        createMockGoal({ type: 'DISTANCE', targetValue: 30 }), // intermediate
        createMockGoal({ type: 'DISTANCE', targetValue: 60 }), // advanced
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.goalsByDifficulty).toEqual({
        beginner: 1,
        intermediate: 1,
        advanced: 1,
      });
    });
  });

  describe('difficulty estimation', () => {
    it('should categorize distance goals correctly', () => {
      const goals = [
        createMockGoal({ type: 'DISTANCE', targetValue: 15 }), // beginner
        createMockGoal({ type: 'DISTANCE', targetValue: 35 }), // intermediate
        createMockGoal({ type: 'DISTANCE', targetValue: 75 }), // advanced
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.goalsByDifficulty.beginner).toBe(1);
      expect(result.goalsByDifficulty.intermediate).toBe(1);
      expect(result.goalsByDifficulty.advanced).toBe(1);
    });

    it('should categorize time goals correctly', () => {
      const goals = [
        createMockGoal({ type: 'TIME', targetValue: 7200 }), // beginner (2 hours)
        createMockGoal({ type: 'TIME', targetValue: 2400 }), // intermediate (40 min)
        createMockGoal({ type: 'TIME', targetValue: 1200 }), // advanced (20 min)
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.goalsByDifficulty.beginner).toBe(1);
      expect(result.goalsByDifficulty.intermediate).toBe(1);
      expect(result.goalsByDifficulty.advanced).toBe(1);
    });

    it('should categorize frequency goals correctly', () => {
      const goals = [
        createMockGoal({ type: 'FREQUENCY', targetValue: 2 }), // beginner
        createMockGoal({ type: 'FREQUENCY', targetValue: 4 }), // intermediate
        createMockGoal({ type: 'FREQUENCY', targetValue: 6 }), // advanced
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.goalsByDifficulty.beginner).toBe(1);
      expect(result.goalsByDifficulty.intermediate).toBe(1);
      expect(result.goalsByDifficulty.advanced).toBe(1);
    });
  });

  describe('monthly progress calculation', () => {
    it('should calculate monthly progress correctly', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          startDate: new Date('2024-01-01'),
          isCompleted: true,
        }),
        createMockGoal({
          id: 'goal-2',
          startDate: new Date('2024-01-15'),
          isCompleted: false,
        }),
        createMockGoal({
          id: 'goal-3',
          startDate: new Date('2024-02-01'),
          isCompleted: true,
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.monthlyProgress).toEqual([
        expect.objectContaining({
          month: '2024-01',
          totalGoals: 2,
          completedGoals: 1,
          completionRate: 50,
        }),
        expect.objectContaining({
          month: '2024-02',
          totalGoals: 1,
          completedGoals: 1,
          completionRate: 100,
        }),
      ]);
    });

    it('should limit monthly progress to last 12 months', () => {
      const goals = Array.from({ length: 15 }, (_, i) =>
        createMockGoal({
          id: `goal-${i}`,
          startDate: new Date(2023, i, 1), // 15 different months
          isCompleted: true,
        })
      );

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.monthlyProgress.length).toBeLessThanOrEqual(12);
    });
  });

  describe('streak data calculation', () => {
    it('should calculate streak data correctly', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          isCompleted: true,
          completedAt: new Date('2024-01-01'),
        }),
        createMockGoal({
          id: 'goal-2',
          isCompleted: true,
          completedAt: new Date('2024-01-08'), // Same week
        }),
        createMockGoal({
          id: 'goal-3',
          isCompleted: true,
          completedAt: new Date('2024-01-15'), // Next week
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.streakData).toEqual(
        expect.objectContaining({
          totalActiveWeeks: expect.any(Number),
          averageGoalsPerWeek: expect.any(Number),
        })
      );
    });

    it('should handle goals with no completion dates', () => {
      const goals = [
        createMockGoal({ id: 'goal-1', isCompleted: false }),
        createMockGoal({ id: 'goal-2', isCompleted: false }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.streakData.totalActiveWeeks).toBe(0);
      expect(result.streakData.averageGoalsPerWeek).toBe(0);
    });
  });

  describe('personal bests calculation', () => {
    it('should calculate personal bests correctly', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          type: 'DISTANCE',
          targetValue: 50,
          targetUnit: 'km',
          period: 'MONTHLY',
          isCompleted: true,
          completedAt: new Date('2024-01-15'),
        }),
        createMockGoal({
          id: 'goal-2',
          type: 'DISTANCE',
          targetValue: 75,
          targetUnit: 'km',
          period: 'MONTHLY',
          isCompleted: true,
          completedAt: new Date('2024-02-15'),
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.personalBests).toHaveLength(1);
      expect(result.personalBests[0]).toEqual(
        expect.objectContaining({
          type: 'DISTANCE',
          value: 75, // Higher value is better for distance
          unit: 'km',
          period: 'MONTHLY',
        })
      );
    });

    it('should handle time goals correctly (lower is better)', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          type: 'TIME',
          targetValue: 1800, // 30 minutes
          targetUnit: 'seconds',
          period: 'WEEKLY',
          isCompleted: true,
          completedAt: new Date('2024-01-15'),
        }),
        createMockGoal({
          id: 'goal-2',
          type: 'TIME',
          targetValue: 1500, // 25 minutes (better)
          targetUnit: 'seconds',
          period: 'WEEKLY',
          isCompleted: true,
          completedAt: new Date('2024-02-15'),
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.personalBests[0].value).toBe(1500); // Lower time is better
    });
  });

  describe('edge cases', () => {
    it('should handle goals without completion dates', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          isCompleted: true,
          completedAt: undefined,
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.averageTimeToCompletion).toBe(0);
    });

    it('should handle invalid dates gracefully', () => {
      const goals = [
        createMockGoal({
          id: 'goal-1',
          startDate: new Date('invalid-date'),
          isCompleted: true,
        }),
      ];

      expect(() => {
        GoalAnalyticsCalculator.calculateAnalytics(goals, []);
      }).not.toThrow();
    });

    it('should handle unknown goal types', () => {
      const goals = [
        createMockGoal({
          type: 'UNKNOWN_TYPE' as any,
          targetValue: 30,
        }),
      ];

      const result = GoalAnalyticsCalculator.calculateAnalytics(goals, []);

      expect(result.goalsByDifficulty.intermediate).toBe(1);
    });
  });
});

describe('GoalAnalyticsCalculator.generateInsights', () => {
  it('should generate success insight for high completion rate', () => {
    const analytics = {
      totalGoals: 10,
      completionRate: 85,
      streakData: { currentStreak: 2 },
      personalBests: [],
      goalsByType: { DISTANCE: 5, TIME: 5 },
    } as any;

    const insights = GoalAnalyticsCalculator.generateInsights(analytics, []);

    expect(insights).toContainEqual(
      expect.objectContaining({
        type: 'success',
        title: 'Excellent Goal Achievement!',
        icon: '🏆',
      })
    );
  });

  it('should generate warning for low completion rate', () => {
    const analytics = {
      totalGoals: 10,
      completionRate: 30,
      streakData: { currentStreak: 0 },
      personalBests: [],
      goalsByType: { DISTANCE: 5, TIME: 5 },
      completedGoals: 3,
    } as any;

    const insights = GoalAnalyticsCalculator.generateInsights(analytics, []);

    expect(insights).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        title: 'Room for Improvement',
        icon: '💡',
      })
    );
  });

  it('should generate streak insights', () => {
    const analytics = {
      totalGoals: 5,
      completionRate: 60,
      streakData: { currentStreak: 5 },
      personalBests: [],
      goalsByType: { DISTANCE: 5 },
      completedGoals: 3,
    } as any;

    const insights = GoalAnalyticsCalculator.generateInsights(analytics, []);

    expect(insights).toContainEqual(
      expect.objectContaining({
        type: 'success',
        title: '5-Week Streak!',
        icon: '🔥',
      })
    );
  });

  it('should suggest goal variety for single goal type', () => {
    const analytics = {
      totalGoals: 5,
      completionRate: 60,
      streakData: { currentStreak: 1 },
      personalBests: [],
      goalsByType: { DISTANCE: 5 }, // Only one type
      completedGoals: 3,
    } as any;

    const insights = GoalAnalyticsCalculator.generateInsights(analytics, []);

    expect(insights).toContainEqual(
      expect.objectContaining({
        type: 'tip',
        title: 'Try Different Goal Types',
        icon: '🌟',
      })
    );
  });

  it('should limit insights to 4 items', () => {
    const analytics = {
      totalGoals: 10,
      completionRate: 85,
      streakData: { currentStreak: 5 },
      personalBests: [
        {
          achievedDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
          type: 'DISTANCE',
          value: 50,
          unit: 'km',
        },
      ],
      goalsByType: { DISTANCE: 10 }, // Single type for variety suggestion
      completedGoals: 8,
    } as any;

    const insights = GoalAnalyticsCalculator.generateInsights(analytics, []);

    expect(insights.length).toBeLessThanOrEqual(4);
  });
});

describe('GoalAnalyticsCalculator.calculateGoalTrends', () => {
  it('should calculate trends with sufficient data', () => {
    const goals = [
      createMockGoal({
        startDate: new Date('2024-01-01'),
        isCompleted: true,
      }),
      createMockGoal({
        startDate: new Date('2024-02-01'),
        isCompleted: false,
      }),
    ];

    const trends = GoalAnalyticsCalculator.calculateGoalTrends(goals);

    expect(trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          period: 'Monthly',
          value: expect.any(Number),
          change: expect.any(Number),
          changeType: expect.stringMatching(/increase|decrease|stable/),
        }),
      ])
    );
  });

  it('should return empty array for insufficient data', () => {
    const goals = [createMockGoal()];

    const trends = GoalAnalyticsCalculator.calculateGoalTrends(goals);

    expect(trends).toEqual([]);
  });
});

describe('GoalAnalyticsCalculator.calculatePerformanceMetrics', () => {
  it('should calculate performance metrics correctly', () => {
    const goal = createMockGoal({
      startDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
      endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
    });

    const progress = createMockGoalProgress({
      progressPercentage: 60, // 60% complete at 50% time elapsed
    });

    const metrics = GoalAnalyticsCalculator.calculatePerformanceMetrics(goal, progress);

    expect(metrics).toEqual(
      expect.objectContaining({
        consistency: expect.any(Number),
        improvement: expect.any(Number),
        challengeLevel: expect.stringMatching(/easy|moderate|challenging|too_hard/),
        recommendedAdjustment: expect.any(String),
      })
    );
  });

  it('should identify easy goals', () => {
    const goal = createMockGoal({
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });

    const progress = createMockGoalProgress({
      progressPercentage: 80, // Much ahead of schedule
    });

    const metrics = GoalAnalyticsCalculator.calculatePerformanceMetrics(goal, progress);

    expect(metrics.challengeLevel).toBe('easy');
    expect(metrics.recommendedAdjustment).toContain('increasing your target');
  });

  it('should identify too hard goals', () => {
    const goal = createMockGoal({
      startDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    const progress = createMockGoalProgress({
      progressPercentage: 30, // Far behind schedule
    });

    const metrics = GoalAnalyticsCalculator.calculatePerformanceMetrics(goal, progress);

    expect(metrics.challengeLevel).toBe('too_hard');
    expect(metrics.recommendedAdjustment).toContain('reducing your target');
  });
});
