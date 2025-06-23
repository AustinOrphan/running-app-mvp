import { useState, useEffect, useCallback } from 'react';
import { Goal, GoalProgress, CreateGoalData } from '../types/goals';

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

  // Computed values
  const activeGoals = goals.filter(goal => !goal.isCompleted);
  const completedGoals = goals.filter(goal => goal.isCompleted);
  
  // Detect newly achieved goals based on progress
  const newlyAchievedGoals = goalProgress
    .filter(progress => 
      progress.isCompleted && 
      !seenAchievements.has(progress.goalId) &&
      activeGoals.some(goal => goal.id === progress.goalId)
    )
    .map(progress => goals.find(goal => goal.id === progress.goalId))
    .filter((goal): goal is Goal => goal !== undefined);

  // Helper function for API calls
  const makeApiCall = async (url: string, options: RequestInit = {}) => {
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }

    return response.json();
  };

  // Fetch goals
  const fetchGoals = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const goalsData = await makeApiCall('/api/goals');
      setGoals(goalsData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch goals';
      setError(errorMessage);
      console.error('Error fetching goals:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch goal progress
  const refreshProgress = useCallback(async () => {
    if (!token) return;

    try {
      const progressData = await makeApiCall('/api/goals/progress/all');
      setGoalProgress(progressData);
    } catch (err) {
      console.error('Error fetching goal progress:', err);
      // Don't set error state for progress fetch failures
    }
  }, [token]);

  // Create goal
  const createGoal = useCallback(async (goalData: CreateGoalData): Promise<Goal> => {
    const newGoal = await makeApiCall('/api/goals', {
      method: 'POST',
      body: JSON.stringify(goalData),
    });

    // Update local state
    setGoals(prev => [...prev, newGoal]);
    
    // Refresh progress data
    refreshProgress();
    
    return newGoal;
  }, [token, refreshProgress]);

  // Update goal
  const updateGoal = useCallback(async (goalId: string, goalData: Partial<Goal>): Promise<Goal> => {
    const updatedGoal = await makeApiCall(`/api/goals/${goalId}`, {
      method: 'PUT',
      body: JSON.stringify(goalData),
    });

    // Update local state
    setGoals(prev => prev.map(goal => 
      goal.id === goalId ? updatedGoal : goal
    ));
    
    // Refresh progress data
    refreshProgress();
    
    return updatedGoal;
  }, [token, refreshProgress]);

  // Delete goal
  const deleteGoal = useCallback(async (goalId: string): Promise<void> => {
    await makeApiCall(`/api/goals/${goalId}`, {
      method: 'DELETE',
    });

    // Update local state
    setGoals(prev => prev.filter(goal => goal.id !== goalId));
    setGoalProgress(prev => prev.filter(progress => progress.goalId !== goalId));
  }, [token]);

  // Complete goal
  const completeGoal = useCallback(async (goalId: string): Promise<Goal> => {
    const completedGoal = await makeApiCall(`/api/goals/${goalId}/complete`, {
      method: 'POST',
    });

    // Update local state
    setGoals(prev => prev.map(goal => 
      goal.id === goalId ? completedGoal : goal
    ));
    
    // Refresh progress data
    refreshProgress();
    
    return completedGoal;
  }, [token, refreshProgress]);

  // Get progress for specific goal
  const getGoalProgress = useCallback((goalId: string): GoalProgress | undefined => {
    return goalProgress.find(p => p.goalId === goalId);
  }, [goalProgress]);

  // Mark achievement as seen
  const markAchievementSeen = useCallback((goalId: string) => {
    setSeenAchievements(prev => new Set([...prev, goalId]));
  }, []);

  // Auto-complete goals when they reach 100% progress
  useEffect(() => {
    const autoCompleteGoals = async () => {
      for (const progress of goalProgress) {
        if (progress.isCompleted && !progress.goal?.isCompleted) {
          const goal = goals.find(g => g.id === progress.goalId);
          if (goal && !goal.isCompleted) {
            try {
              await completeGoal(goal.id);
            } catch (error) {
              console.error('Failed to auto-complete goal:', error);
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