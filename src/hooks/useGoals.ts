import { useState, useEffect, useCallback, useRef } from 'react';

import { Goal, GoalProgress, CreateGoalData } from '../types/goals';
import { MilestoneDetector, DeadlineDetector } from '../utils/milestoneDetector';
import { logError } from '../utils/clientLogger';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiFetch';

import { useNotifications } from './useNotifications';

interface UseGoalsReturn {
  goals: Goal[];
  goalProgress: GoalProgress[];
  loading: boolean;
  error: string | null;
  activeGoals: Goal[];
  completedGoals: Goal[];
  newlyAchievedGoals: Goal[];
  fetchGoals: () => Promise<void>;
  createGoal: (goalData: CreateGoalData) => Promise<Goal>;
  updateGoal: (goalId: string, goalData: Partial<Goal>) => Promise<Goal>;
  deleteGoal: (goalId: string) => Promise<void>;
  completeGoal: (goalId: string) => Promise<Goal>;
  getGoalProgress: (goalId: string) => GoalProgress | undefined;
  refreshProgress: () => Promise<void>;
  markAchievementSeen: (goalId: string) => void;
}

export const useGoals = (token: string | null): UseGoalsReturn => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seenAchievements, setSeenAchievements] = useState<Set<string>>(new Set());

  // Notification system integration
  const {
    showMilestoneNotification,
    showDeadlineNotification,
    preferences: notificationPreferences,
  } = useNotifications();

  // Track previous progress to detect changes
  const previousProgressRef = useRef<Map<string, GoalProgress>>(new Map());

  // Computed values
  const activeGoals = goals.filter(goal => !goal.isCompleted);
  const completedGoals = goals.filter(goal => goal.isCompleted);

  // Detect newly achieved goals based on progress
  const newlyAchievedGoals = goalProgress
    .filter(
      progress =>
        progress.isCompleted &&
        !seenAchievements.has(progress.goalId) &&
        activeGoals.some(goal => goal.id === progress.goalId)
    )
    .map(progress => goals.find(goal => goal.id === progress.goalId))
    .filter((goal): goal is Goal => goal !== undefined);

  // Helper function for API calls
  // Remove the custom makeApiCall since we're using apiFetch now

  // Fetch goals
  const fetchGoals = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const response = await apiGet<Goal[]>('/api/goals');
      setGoals(response.data || []);
    } catch (error_) {
      const errorMessage = error_ instanceof Error ? error_.message : 'Failed to fetch goals';
      setError(errorMessage);
      logError(
        'Error fetching goals',
        error_ instanceof Error ? error_ : new Error(String(error_))
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch goal progress
  const refreshProgress = useCallback(async () => {
    if (!token) return;

    try {
      const response = await apiGet<GoalProgress[]>('/api/goals/progress/all');
      setGoalProgress(response.data || []);
    } catch (error_) {
      logError(
        'Error fetching goal progress',
        error_ instanceof Error ? error_ : new Error(String(error_))
      );
      // Don't set error state for progress fetch failures
    }
  }, [token]);

  // Check for milestone and deadline notifications
  const checkNotifications = useCallback(() => {
    if (
      !notificationPreferences.enableMilestoneNotifications &&
      !notificationPreferences.enableDeadlineReminders
    ) {
      return;
    }

    goalProgress.forEach(progress => {
      const goal = goals.find(g => g.id === progress.goalId);
      if (!goal || goal.isCompleted) return;

      // Check for milestone notifications
      if (notificationPreferences.enableMilestoneNotifications) {
        const milestoneResult = MilestoneDetector.checkMilestones(goal, progress);

        if (milestoneResult.hasNewMilestones) {
          milestoneResult.newMilestones.forEach(milestone => {
            showMilestoneNotification(goal, progress, milestone);
          });
        }
      }

      // Check for deadline notifications
      if (notificationPreferences.enableDeadlineReminders) {
        const deadlineResult = DeadlineDetector.checkDeadlineReminder(
          goal,
          progress,
          notificationPreferences.deadlineReminderDays
        );

        if (deadlineResult.shouldNotify) {
          showDeadlineNotification(goal, progress);
        }
      }

      // Update previous progress tracking
      previousProgressRef.current.set(progress.goalId, progress);
    });
  }, [
    goals,
    goalProgress,
    notificationPreferences.enableMilestoneNotifications,
    notificationPreferences.enableDeadlineReminders,
    notificationPreferences.deadlineReminderDays,
    showMilestoneNotification,
    showDeadlineNotification,
  ]);

  // Create goal
  const createGoal = useCallback(
    async (goalData: CreateGoalData): Promise<Goal> => {
      const response = await apiPost<Goal>('/api/goals', goalData);
      const newGoal = response.data;

      // Update local state
      setGoals(prev => [...prev, newGoal]);

      // Refresh progress data
      refreshProgress();

      return newGoal;
    },
    [refreshProgress]
  );

  // Update goal
  const updateGoal = useCallback(
    async (goalId: string, goalData: Partial<Goal>): Promise<Goal> => {
      const response = await apiPut<Goal>(`/api/goals/${goalId}`, goalData);
      const updatedGoal = response.data;

      // Update local state
      setGoals(prev => prev.map(goal => (goal.id === goalId ? updatedGoal : goal)));

      // Refresh progress data
      refreshProgress();

      return updatedGoal;
    },
    [refreshProgress]
  );

  // Delete goal
  const deleteGoal = useCallback(async (goalId: string): Promise<void> => {
    await apiDelete(`/api/goals/${goalId}`);

    // Update local state
    setGoals(prev => prev.filter(goal => goal.id !== goalId));
    setGoalProgress(prev => prev.filter(progress => progress.goalId !== goalId));
  }, []);

  // Complete goal
  const completeGoal = useCallback(
    async (goalId: string): Promise<Goal> => {
      const response = await apiPost<Goal>(`/api/goals/${goalId}/complete`);
      const completedGoal = response.data;

      // Update local state
      setGoals(prev => prev.map(goal => (goal.id === goalId ? completedGoal : goal)));

      // Refresh progress data
      refreshProgress();

      return completedGoal;
    },
    [refreshProgress]
  );

  // Get progress for specific goal
  const getGoalProgress = useCallback(
    (goalId: string): GoalProgress | undefined => {
      return goalProgress.find(p => p.goalId === goalId);
    },
    [goalProgress]
  );

  // Mark achievement as seen
  const markAchievementSeen = useCallback((goalId: string) => {
    setSeenAchievements(prev => new Set(prev).add(goalId));
  }, []);

  // Auto-complete goals when they reach 100% progress
  useEffect(() => {
    const autoCompleteGoals = async () => {
      for (const progress of goalProgress) {
        if (progress.isCompleted) {
          const goal = goals.find(g => g.id === progress.goalId);
          if (goal && !goal.isCompleted) {
            try {
              await completeGoal(goal.id);
            } catch (error) {
              logError(
                'Failed to auto-complete goal',
                error instanceof Error ? error : new Error(String(error))
              );
            }
          }
        }
      }
    };

    if (goalProgress.length > 0 && goals.length > 0) {
      autoCompleteGoals();
    }
  }, [goalProgress, goals, completeGoal]);

  // Initial fetch
  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  // Fetch progress when goals are loaded
  useEffect(() => {
    if (goals.length > 0) {
      refreshProgress();
    }
  }, [goals.length, refreshProgress]);

  // Check for notifications when progress updates
  useEffect(() => {
    if (goalProgress.length > 0 && goals.length > 0) {
      checkNotifications();
    }
  }, [goalProgress, goals, checkNotifications]);

  return {
    goals,
    goalProgress,
    loading,
    error,
    activeGoals,
    completedGoals,
    newlyAchievedGoals,
    fetchGoals,
    createGoal,
    updateGoal,
    deleteGoal,
    completeGoal,
    getGoalProgress,
    refreshProgress,
    markAchievementSeen,
  };
};
