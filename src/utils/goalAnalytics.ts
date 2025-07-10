import {
  GoalAnalytics,
  MonthlyGoalProgress,
  StreakData,
  PersonalBest,
  GoalInsight,
  GoalTrend,
  GoalPerformanceMetrics,
} from '../types/goalAnalytics';
import { Goal, GoalProgress } from '../types/goals';

export class GoalAnalyticsCalculator {
  static calculateAnalytics(goals: Goal[], goalProgress: GoalProgress[]): GoalAnalytics {
    const completedGoals = goals.filter(goal => goal.isCompleted);
    const activeGoals = goals.filter(goal => !goal.isCompleted);

    return {
      totalGoals: goals.length,
      activeGoals: activeGoals.length,
      completedGoals: completedGoals.length,
      completionRate: goals.length > 0 ? (completedGoals.length / goals.length) * 100 : 0,
      averageTimeToCompletion: this.calculateAverageTimeToCompletion(completedGoals),
      mostCommonGoalType: this.getMostCommonGoalType(goals),
      goalsByType: this.getGoalsByType(goals),
      goalsByDifficulty: this.getGoalsByDifficulty(goals),
      monthlyProgress: this.calculateMonthlyProgress(goals),
      streakData: this.calculateStreakData(goals, goalProgress),
      personalBests: this.calculatePersonalBests(completedGoals),
    };
  }

  private static calculateAverageTimeToCompletion(completedGoals: Goal[]): number {
    if (completedGoals.length === 0) return 0;

    let validGoalsCount = 0;
    const totalDays = completedGoals.reduce((sum, goal) => {
      if (!goal.completedAt) return sum;

      try {
        const startDate = new Date(goal.startDate);
        const completedDate = new Date(goal.completedAt);

        // Check if dates are valid
        if (isNaN(startDate.getTime()) || isNaN(completedDate.getTime())) {
          return sum;
        }

        const daysDiff = Math.ceil(
          (completedDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only count positive differences
        if (daysDiff > 0) {
          validGoalsCount++;
          return sum + daysDiff;
        }
        return sum;
      } catch {
        // Handle any date parsing errors
        return sum;
      }
    }, 0);

    return validGoalsCount > 0 ? Math.round(totalDays / validGoalsCount) : 0;
  }

  private static getMostCommonGoalType(goals: Goal[]): string {
    const typeCounts = this.getGoalsByType(goals);
    const entries = Object.entries(typeCounts);

    if (entries.length === 0) return 'No goals yet';

    return entries.reduce((most, current) => (current[1] > most[1] ? current : most))[0];
  }

  private static getGoalsByType(goals: Goal[]): Record<string, number> {
    return goals.reduce(
      (acc, goal) => {
        acc[goal.type] = (acc[goal.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  private static getGoalsByDifficulty(goals: Goal[]): Record<string, number> {
    // Estimate difficulty based on target values and periods
    return goals.reduce(
      (acc, goal) => {
        const difficulty = this.estimateGoalDifficulty(goal);
        acc[difficulty] = (acc[difficulty] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  private static estimateGoalDifficulty(goal: Goal): string {
    // Simple heuristic based on goal type and target
    switch (goal.type) {
      case 'DISTANCE':
        if (goal.targetValue < 20) return 'beginner';
        if (goal.targetValue < 50) return 'intermediate';
        return 'advanced';
      case 'TIME':
        if (goal.targetValue > 3600) return 'beginner';
        if (goal.targetValue > 1800) return 'intermediate';
        return 'advanced';
      case 'FREQUENCY':
        if (goal.targetValue < 3) return 'beginner';
        if (goal.targetValue < 5) return 'intermediate';
        return 'advanced';
      default:
        return 'intermediate';
    }
  }

  private static calculateMonthlyProgress(goals: Goal[]): MonthlyGoalProgress[] {
    const monthlyData: Record<string, { total: number; completed: number }> = {};

    goals.forEach(goal => {
      try {
        const startDate = new Date(goal.startDate);
        if (isNaN(startDate.getTime())) return; // Skip invalid dates

        const startMonth = startDate.toISOString().slice(0, 7);

        if (!monthlyData[startMonth]) {
          monthlyData[startMonth] = { total: 0, completed: 0 };
        }

        monthlyData[startMonth].total++;
        if (goal.isCompleted) {
          monthlyData[startMonth].completed++;
        }
      } catch {
        // Skip goals with invalid dates
      }
    });

    return Object.entries(monthlyData)
      .map(([month, data]) => ({
        month,
        totalGoals: data.total,
        completedGoals: data.completed,
        completionRate: data.total > 0 ? (data.completed / data.total) * 100 : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // Last 12 months
  }

  private static calculateStreakData(goals: Goal[], _goalProgress: GoalProgress[]): StreakData {
    const completedGoals = goals.filter(goal => goal.isCompleted);
    const weeks = this.groupGoalsByWeek(completedGoals);

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const sortedWeeks = Object.keys(weeks).sort();
    const currentWeek = this.getWeekKey(new Date());

    // Calculate streaks
    for (let i = sortedWeeks.length - 1; i >= 0; i--) {
      const week = sortedWeeks[i];

      if (weeks[week] > 0) {
        tempStreak++;
        if (week === currentWeek || i === sortedWeeks.length - 1) {
          currentStreak = tempStreak;
        }
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        if (i === sortedWeeks.length - 1) {
          currentStreak = 0;
        }
        tempStreak = 0;
      }
    }

    const totalActiveWeeks = Object.values(weeks).filter(count => count > 0).length;
    const totalCompletedGoals = completedGoals.length;

    return {
      currentStreak,
      longestStreak,
      totalActiveWeeks,
      averageGoalsPerWeek: totalActiveWeeks > 0 ? totalCompletedGoals / totalActiveWeeks : 0,
    };
  }

  private static groupGoalsByWeek(goals: Goal[]): Record<string, number> {
    return goals.reduce(
      (acc, goal) => {
        if (goal.completedAt) {
          const weekKey = this.getWeekKey(new Date(goal.completedAt));
          acc[weekKey] = (acc[weekKey] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );
  }

  private static getWeekKey(date: Date): string {
    const year = date.getFullYear();
    const weekNumber = this.getWeekNumber(date);
    return `${year}-W${weekNumber.toString().padStart(2, '0')}`;
  }

  private static getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  private static calculatePersonalBests(completedGoals: Goal[]): PersonalBest[] {
    const bestsByType: Record<string, PersonalBest> = {};

    completedGoals.forEach(goal => {
      const key = `${goal.type}-${goal.period}`;

      if (!bestsByType[key] || this.isNewPersonalBest(goal, bestsByType[key])) {
        bestsByType[key] = {
          type: goal.type,
          value: goal.targetValue,
          unit: goal.targetUnit,
          goalTitle: goal.title,
          achievedDate: goal.completedAt
            ? goal.completedAt.toISOString()
            : goal.endDate.toISOString(),
          period: goal.period,
        };
      }
    });

    return Object.values(bestsByType).sort(
      (a, b) => new Date(b.achievedDate).getTime() - new Date(a.achievedDate).getTime()
    );
  }

  private static isNewPersonalBest(goal: Goal, currentBest: PersonalBest): boolean {
    // For time goals, lower is better
    if (goal.type === 'TIME') {
      return goal.targetValue < currentBest.value;
    }
    // For distance, frequency, and other goals, higher is better
    return goal.targetValue > currentBest.value;
  }

  static generateInsights(analytics: GoalAnalytics, _goals: Goal[]): GoalInsight[] {
    const insights: GoalInsight[] = [];

    // Completion rate insights
    if (analytics.completionRate >= 80) {
      insights.push({
        type: 'success',
        title: 'Excellent Goal Achievement!',
        message: `You've completed ${analytics.completionRate.toFixed(0)}% of your goals. Keep up the great work!`,
        icon: '🏆',
      });
    } else if (analytics.completionRate >= 50) {
      insights.push({
        type: 'info',
        title: 'Good Progress',
        message: `You've completed ${analytics.completionRate.toFixed(0)}% of your goals. Consider breaking down larger goals into smaller milestones.`,
        icon: '📈',
      });
    } else if (analytics.totalGoals > 0) {
      insights.push({
        type: 'warning',
        title: 'Room for Improvement',
        message:
          'Your completion rate could be higher. Consider setting more achievable goals or adjusting your targets.',
        icon: '💡',
      });
    }

    // Streak insights
    if (analytics.streakData.currentStreak >= 4) {
      insights.push({
        type: 'success',
        title: `${analytics.streakData.currentStreak}-Week Streak!`,
        message: "You're on fire! Maintain this momentum by setting your next goal.",
        icon: '🔥',
      });
    } else if (analytics.streakData.currentStreak === 0 && analytics.completedGoals > 0) {
      insights.push({
        type: 'tip',
        title: 'Time for a New Goal',
        message:
          "You haven't completed a goal recently. Set a new challenge to keep your momentum going!",
        icon: '🎯',
      });
    }

    // Goal variety insights
    const goalTypes = Object.keys(analytics.goalsByType);
    if (goalTypes.length === 1 && analytics.totalGoals >= 3) {
      insights.push({
        type: 'tip',
        title: 'Try Different Goal Types',
        message:
          'Consider mixing different types of goals (distance, speed, consistency) for well-rounded training.',
        icon: '🌟',
      });
    }

    // Personal best insights
    if (analytics.personalBests.length > 0) {
      const recentPB = analytics.personalBests[0];
      const pbDate = new Date(recentPB.achievedDate);
      const daysSincePB = Math.floor((Date.now() - pbDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSincePB <= 7) {
        insights.push({
          type: 'success',
          title: 'New Personal Best!',
          message: `Congratulations on your recent ${recentPB.type.toLowerCase()} achievement: ${recentPB.value} ${recentPB.unit}!`,
          icon: '🥇',
        });
      }
    }

    return insights.slice(0, 4); // Limit to 4 insights
  }

  static calculateGoalTrends(goals: Goal[]): GoalTrend[] {
    const monthlyData = this.calculateMonthlyProgress(goals);

    if (monthlyData.length < 2) return [];

    const trends: GoalTrend[] = [];

    // Completion rate trend
    const recent = monthlyData.slice(-2);
    if (recent.length === 2) {
      const change = recent[1].completionRate - recent[0].completionRate;
      trends.push({
        period: 'Monthly',
        value: recent[1].completionRate,
        change: Math.abs(change),
        changeType: change > 5 ? 'increase' : change < -5 ? 'decrease' : 'stable',
      });
    }

    return trends;
  }

  static calculatePerformanceMetrics(goal: Goal, progress: GoalProgress): GoalPerformanceMetrics {
    const daysElapsed = Math.floor(
      (Date.now() - new Date(goal.startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    const totalDays = Math.floor(
      (new Date(goal.endDate).getTime() - new Date(goal.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const expectedProgress = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;

    const consistency = Math.min(
      100,
      Math.max(0, 100 - Math.abs(progress.progressPercentage - expectedProgress))
    );

    let challengeLevel: 'easy' | 'moderate' | 'challenging' | 'too_hard' = 'moderate';

    if (progress.progressPercentage > expectedProgress + 20) {
      challengeLevel = 'easy';
    } else if (progress.progressPercentage < expectedProgress - 30) {
      challengeLevel = 'too_hard';
    } else if (progress.progressPercentage < expectedProgress - 10) {
      challengeLevel = 'challenging';
    }

    return {
      consistency: Math.round(consistency),
      improvement: 0, // Would need historical data to calculate
      challengeLevel,
      recommendedAdjustment: this.getRecommendedAdjustment(challengeLevel, progress),
    };
  }

  private static getRecommendedAdjustment(
    challengeLevel: 'easy' | 'moderate' | 'challenging' | 'too_hard',
    _progress: GoalProgress
  ): string {
    switch (challengeLevel) {
      case 'easy':
        return 'Consider increasing your target or adding a new challenge.';
      case 'too_hard':
        return 'Consider reducing your target or extending the timeline.';
      case 'challenging':
        return 'Stay focused! You can achieve this with consistent effort.';
      case 'moderate':
      default:
        return "You're on track! Keep up the good work.";
    }
  }
}
