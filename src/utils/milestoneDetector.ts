import { Goal, GoalProgress } from '../types/goals';
import { logError } from './clientLogger';

export interface MilestoneCheckResult {
  newMilestones: number[];
  hasNewMilestones: boolean;
  nextMilestone: number | null;
  progressToNextMilestone: number;
}

export interface DeadlineCheckResult {
  shouldNotify: boolean;
  daysRemaining: number;
  isUrgent: boolean;
  notificationLevel: 'info' | 'warning' | 'urgent';
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  streakType: 'daily' | 'weekly' | 'monthly';
  isNewRecord: boolean;
  shouldCelebrate: boolean;
}

// Milestone detection and tracking
export class MilestoneDetector {
  private static readonly MILESTONE_STORAGE_KEY = 'goalMilestones';
  private static readonly MILESTONES = [25, 50, 75, 100];

  // Get stored milestones for a goal
  private static getStoredMilestones(goalId: string): number[] {
    try {
      const stored = localStorage.getItem(this.MILESTONE_STORAGE_KEY);
      if (stored) {
        const milestones = JSON.parse(stored);
        return milestones[goalId] || [];
      }
    } catch (error) {
      logError(
        'Error loading stored milestones',
        error instanceof Error ? error : new Error(String(error))
      );
    }
    return [];
  }

  // Store achieved milestones for a goal
  private static storeMilestones(goalId: string, achievedMilestones: number[]): void {
    try {
      const stored = localStorage.getItem(this.MILESTONE_STORAGE_KEY) || '{}';
      const milestones = JSON.parse(stored);
      milestones[goalId] = achievedMilestones;
      localStorage.setItem(this.MILESTONE_STORAGE_KEY, JSON.stringify(milestones));
    } catch (error) {
      logError(
        'Error storing milestones',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Check for new milestones
  static checkMilestones(goal: Goal, progress: GoalProgress): MilestoneCheckResult {
    const currentProgressPercentage = Math.floor(progress.progressPercentage);
    const achievedMilestones = this.getStoredMilestones(goal.id);

    // Find new milestones that haven't been notified yet
    const newMilestones = this.MILESTONES.filter(
      milestone => currentProgressPercentage >= milestone && !achievedMilestones.includes(milestone)
    );

    // Store new milestones
    if (newMilestones.length > 0) {
      const updatedMilestones = [...achievedMilestones, ...newMilestones];
      this.storeMilestones(goal.id, updatedMilestones);
    }

    // Find next milestone
    const nextMilestone =
      this.MILESTONES.find(milestone => currentProgressPercentage < milestone) || null;

    // Calculate progress to next milestone
    let progressToNextMilestone = 0;
    if (nextMilestone) {
      const previousMilestone = this.MILESTONES.findLast(m => m < nextMilestone) || 0;
      const rangeSize = nextMilestone - previousMilestone;
      const currentInRange = currentProgressPercentage - previousMilestone;
      progressToNextMilestone = (currentInRange / rangeSize) * 100;
    }

    return {
      newMilestones,
      hasNewMilestones: newMilestones.length > 0,
      nextMilestone,
      progressToNextMilestone: Math.max(0, Math.min(100, progressToNextMilestone)),
    };
  }

  // Clear milestones for a goal (when goal is reset or deleted)
  static clearMilestones(goalId: string): void {
    try {
      const stored = localStorage.getItem(this.MILESTONE_STORAGE_KEY) || '{}';
      const milestones = JSON.parse(stored);
      delete milestones[goalId];
      localStorage.setItem(this.MILESTONE_STORAGE_KEY, JSON.stringify(milestones));
    } catch (error) {
      logError(
        'Error clearing milestones',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Get all achieved milestones for a goal
  static getAchievedMilestones(goalId: string): number[] {
    return this.getStoredMilestones(goalId);
  }
}

// Deadline reminder detection
export class DeadlineDetector {
  private static readonly DEADLINE_STORAGE_KEY = 'goalDeadlineNotifications';

  // Get last notification dates for deadline reminders
  private static getLastNotificationDates(goalId: string): Record<number, string> {
    try {
      const stored = localStorage.getItem(this.DEADLINE_STORAGE_KEY);
      if (stored) {
        const notifications = JSON.parse(stored);
        return notifications[goalId] || {};
      }
    } catch (error) {
      logError(
        'Error loading deadline notifications',
        error instanceof Error ? error : new Error(String(error))
      );
    }
    return {};
  }

  // Store last notification date
  private static storeNotificationDate(goalId: string, daysRemaining: number): void {
    try {
      const stored = localStorage.getItem(this.DEADLINE_STORAGE_KEY) || '{}';
      const notifications = JSON.parse(stored);
      if (!notifications[goalId]) {
        notifications[goalId] = {};
      }
      notifications[goalId][daysRemaining] = new Date().toISOString();
      localStorage.setItem(this.DEADLINE_STORAGE_KEY, JSON.stringify(notifications));
    } catch (error) {
      logError(
        'Error storing deadline notification',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Check if deadline reminder should be sent
  static checkDeadlineReminder(
    goal: Goal,
    progress: GoalProgress,
    reminderDays: number[]
  ): DeadlineCheckResult {
    const daysRemaining = progress.daysRemaining;
    const lastNotifications = this.getLastNotificationDates(goal.id);

    // Check if we should send a reminder for this day count
    const shouldNotifyForDays = reminderDays.some(reminderDay => {
      if (daysRemaining !== reminderDay) return false;

      // Check if we already notified for this day count today
      const lastNotified = lastNotifications[reminderDay];
      if (!lastNotified) return true;

      const lastNotifiedDate = new Date(lastNotified);
      const today = new Date();
      return lastNotifiedDate.toDateString() !== today.toDateString();
    });

    // Special case for "due today" (0 days remaining)
    const shouldNotifyToday = daysRemaining === 0 && !lastNotifications[0];

    const shouldNotify = shouldNotifyForDays || shouldNotifyToday;

    if (shouldNotify) {
      this.storeNotificationDate(goal.id, daysRemaining);
    }

    // Determine notification level
    let notificationLevel: 'info' | 'warning' | 'urgent';
    if (daysRemaining === 0) {
      notificationLevel = 'urgent';
    } else if (daysRemaining <= 1) {
      notificationLevel = 'urgent';
    } else if (daysRemaining <= 3) {
      notificationLevel = 'warning';
    } else {
      notificationLevel = 'info';
    }

    return {
      shouldNotify,
      daysRemaining,
      isUrgent: notificationLevel === 'urgent',
      notificationLevel,
    };
  }

  // Clear deadline notifications for a goal
  static clearDeadlineNotifications(goalId: string): void {
    try {
      const stored = localStorage.getItem(this.DEADLINE_STORAGE_KEY) || '{}';
      const notifications = JSON.parse(stored);
      delete notifications[goalId];
      localStorage.setItem(this.DEADLINE_STORAGE_KEY, JSON.stringify(notifications));
    } catch (error) {
      logError(
        'Error clearing deadline notifications',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

// Streak detection and tracking
export class StreakDetector {
  private static readonly STREAK_STORAGE_KEY = 'goalStreaks';

  // Calculate streak from run history
  static calculateRunningStreak(runDates: string[]): StreakInfo {
    if (runDates.length === 0) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        streakType: 'daily',
        isNewRecord: false,
        shouldCelebrate: false,
      };
    }

    // Sort dates in descending order (most recent first)
    const sortedDates = [...runDates]
      .map(date => new Date(date))
      .sort((a, b) => b.getTime() - a.getTime());

    // Calculate daily streak
    let currentStreak = 0;
    let longestStreak = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check for current streak (consecutive days with runs)
    for (const [i, sortedDate] of sortedDates.entries()) {
      const runDate = new Date(sortedDate);
      runDate.setHours(0, 0, 0, 0);

      const expectedDate = new Date(today);
      expectedDate.setDate(today.getDate() - i);

      if (runDate.getTime() === expectedDate.getTime()) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Calculate longest streak in history
    let currentTempStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const currentDate = new Date(sortedDates[i]);
      const previousDate = new Date(sortedDates[i - 1]);
      currentDate.setHours(0, 0, 0, 0);
      previousDate.setHours(0, 0, 0, 0);

      const dayDiff = Math.abs(
        (previousDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (dayDiff === 1) {
        currentTempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentTempStreak);
        currentTempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentTempStreak);

    // Check if current streak is a new record
    const isNewRecord = currentStreak > longestStreak;

    // Determine if we should celebrate (milestone streaks)
    const celebrationMilestones = [3, 7, 14, 21, 30, 60, 90, 180, 365];
    const shouldCelebrate = celebrationMilestones.includes(currentStreak);

    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      streakType: 'daily',
      isNewRecord,
      shouldCelebrate,
    };
  }

  // Get stored streak information
  static getStoredStreak(goalId?: string): StreakInfo | null {
    try {
      const key = goalId ? `${this.STREAK_STORAGE_KEY}_${goalId}` : this.STREAK_STORAGE_KEY;
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      logError(
        'Error loading stored streak',
        error instanceof Error ? error : new Error(String(error))
      );
    }
    return null;
  }

  // Store streak information
  static storeStreak(streakInfo: StreakInfo, goalId?: string): void {
    try {
      const key = goalId ? `${this.STREAK_STORAGE_KEY}_${goalId}` : this.STREAK_STORAGE_KEY;
      localStorage.setItem(key, JSON.stringify(streakInfo));
    } catch (error) {
      logError('Error storing streak', error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Check if streak notification should be sent
  static shouldNotifyStreak(newStreak: StreakInfo, oldStreak: StreakInfo | null): boolean {
    if (!oldStreak) {
      return newStreak.shouldCelebrate;
    }

    // Notify if:
    // 1. New record achieved
    // 2. Reached a celebration milestone
    // 3. Streak increased and it's a notable milestone
    return (
      newStreak.isNewRecord ||
      newStreak.shouldCelebrate ||
      (newStreak.currentStreak > oldStreak.currentStreak && newStreak.currentStreak % 7 === 0)
    ); // Weekly milestones
  }
}

// Goal analytics for summary notifications
export class GoalAnalytics {
  static calculateGoalStats(
    goals: Goal[],
    progressData: GoalProgress[]
  ): {
    goalsCompleted: number;
    totalGoals: number;
    averageProgress: number;
    topPerformingGoal?: string;
    strugglingGoals: string[];
    improvementSuggestions: string[];
  } {
    const activeGoals = goals.filter(goal => !goal.isCompleted && goal.isActive);
    const completedGoals = goals.filter(goal => goal.isCompleted);

    const progressMap = new Map(progressData.map(p => [p.goalId, p]));

    // Calculate average progress for active goals
    const activeProgressValues = activeGoals.map(
      goal => progressMap.get(goal.id)?.progressPercentage || 0
    );

    const averageProgress =
      activeProgressValues.length > 0
        ? activeProgressValues.reduce((sum, progress) => sum + progress, 0) /
          activeProgressValues.length
        : 0;

    // Find top performing goal
    let topPerformingGoal: string | undefined;
    let highestProgress = 0;

    activeGoals.forEach(goal => {
      const progress = progressMap.get(goal.id);
      if (progress && progress.progressPercentage > highestProgress) {
        highestProgress = progress.progressPercentage;
        topPerformingGoal = goal.title;
      }
    });

    // Find struggling goals (< 25% progress with < 50% time remaining)
    const strugglingGoals = activeGoals
      .filter(goal => {
        const progress = progressMap.get(goal.id);
        if (!progress) return false;

        const timeProgress = this.calculateTimeProgress(goal);
        return progress.progressPercentage < 25 && timeProgress > 50;
      })
      .map(goal => goal.title);

    // Generate improvement suggestions
    const improvementSuggestions = this.generateImprovementSuggestions(
      activeGoals,
      progressMap,
      averageProgress
    );

    return {
      goalsCompleted: completedGoals.length,
      totalGoals: goals.filter(goal => goal.isActive).length,
      averageProgress,
      topPerformingGoal,
      strugglingGoals,
      improvementSuggestions,
    };
  }

  private static calculateTimeProgress(goal: Goal): number {
    const now = new Date();
    const start = new Date(goal.startDate);
    const end = new Date(goal.endDate);

    const totalTime = end.getTime() - start.getTime();
    const elapsedTime = now.getTime() - start.getTime();

    return Math.min(100, Math.max(0, (elapsedTime / totalTime) * 100));
  }

  private static generateImprovementSuggestions(
    goals: Goal[],
    progressMap: Map<string, GoalProgress>,
    averageProgress: number
  ): string[] {
    const suggestions: string[] = [];

    // Check for goals behind schedule
    const behindScheduleCount = goals.filter(goal => {
      const progress = progressMap.get(goal.id);
      const timeProgress = this.calculateTimeProgress(goal);
      return progress && progress.progressPercentage < timeProgress - 10;
    }).length;

    if (behindScheduleCount > 0) {
      suggestions.push(
        `${behindScheduleCount} goal(s) are behind schedule. Consider adjusting targets or increasing frequency.`
      );
    }

    // Check average progress
    if (averageProgress < 30) {
      suggestions.push('Overall progress is low. Try setting smaller, more achievable milestones.');
    } else if (averageProgress > 80) {
      suggestions.push('Great progress! Consider setting more challenging goals to keep growing.');
    }

    // Check for goal variety
    const goalTypes = new Set(goals.map(goal => goal.type));
    if (goalTypes.size === 1) {
      suggestions.push(
        'Consider diversifying your goals with different types (distance, time, frequency, pace).'
      );
    }

    return suggestions;
  }
}
