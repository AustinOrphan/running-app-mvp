import { useMemo } from 'react';

import {
  GoalAnalytics,
  GoalInsight,
  GoalTrend,
  GoalPerformanceMetrics,
} from '../types/goalAnalytics';
import { Goal, GoalProgress } from '../types/goals';
import { GoalAnalyticsCalculator } from '../utils/goalAnalytics';

interface UseGoalAnalyticsReturn {
  analytics: GoalAnalytics;
  insights: GoalInsight[];
  trends: GoalTrend[];
  getGoalPerformanceMetrics: (goalId: string) => GoalPerformanceMetrics | null;
  isLoading: boolean;
}

export const useGoalAnalytics = (
  goals: Goal[],
  goalProgress: GoalProgress[],
  loading: boolean = false
): UseGoalAnalyticsReturn => {
  const analytics = useMemo(() => {
    if (goals.length === 0) {
      return {
        totalGoals: 0,
        activeGoals: 0,
        completedGoals: 0,
        completionRate: 0,
        averageTimeToCompletion: 0,
        mostCommonGoalType: 'No goals yet',
        goalsByType: {},
        goalsByDifficulty: {},
        monthlyProgress: [],
        streakData: {
          currentStreak: 0,
          longestStreak: 0,
          totalActiveWeeks: 0,
          averageGoalsPerWeek: 0,
        },
        personalBests: [],
      };
    }

    return GoalAnalyticsCalculator.calculateAnalytics(goals, goalProgress);
  }, [goals, goalProgress]);

  const insights = useMemo(() => {
    return GoalAnalyticsCalculator.generateInsights(analytics, goals);
  }, [analytics, goals]);

  const trends = useMemo(() => {
    return GoalAnalyticsCalculator.calculateGoalTrends(goals);
  }, [goals]);

  const getGoalPerformanceMetrics = useMemo(() => {
    return (goalId: string): GoalPerformanceMetrics | null => {
      const goal = goals.find(g => g.id === goalId);
      const progress = goalProgress.find(p => p.goalId === goalId);

      if (!goal || !progress) return null;

      return GoalAnalyticsCalculator.calculatePerformanceMetrics(goal, progress);
    };
  }, [goals, goalProgress]);

  return {
    analytics,
    insights,
    trends,
    getGoalPerformanceMetrics,
    isLoading: loading,
  };
};
