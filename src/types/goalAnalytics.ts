export interface GoalAnalytics {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  completionRate: number;
  averageTimeToCompletion: number;
  mostCommonGoalType: string;
  goalsByType: Record<string, number>;
  goalsByDifficulty: Record<string, number>;
  monthlyProgress: MonthlyGoalProgress[];
  streakData: StreakData;
  personalBests: PersonalBest[];
}

export interface MonthlyGoalProgress {
  month: string;
  totalGoals: number;
  completedGoals: number;
  completionRate: number;
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  totalActiveWeeks: number;
  averageGoalsPerWeek: number;
}

export interface PersonalBest {
  type: string;
  value: number;
  unit: string;
  goalTitle: string;
  achievedDate: string;
  period: string;
}

export interface GoalInsight {
  type: 'success' | 'warning' | 'info' | 'tip';
  title: string;
  message: string;
  icon: string;
  actionText?: string;
  actionHandler?: () => void;
}

export interface GoalTrend {
  period: string;
  value: number;
  change: number;
  changeType: 'increase' | 'decrease' | 'stable';
}

export interface GoalPerformanceMetrics {
  consistency: number; // 0-100 score
  improvement: number; // percentage improvement over time
  challengeLevel: 'easy' | 'moderate' | 'challenging' | 'too_hard';
  recommendedAdjustment?: string;
}