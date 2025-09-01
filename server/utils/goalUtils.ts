import { prisma } from '../lib/prisma.js';
import { GOAL_TYPES } from '../../src/types/goals.js';

/**
 * Goal calculation utilities
 * Extracted from goals.ts for better separation of concerns and testability
 */

interface Goal {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  targetValue: number;
  targetUnit: string;
  startDate: Date;
  endDate: Date;
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

/**
 * Calculate current progress for a goal based on user's runs
 * @param goal - The goal to calculate progress for
 * @param userId - The user ID to filter runs by
 * @returns Promise<number> - Current progress value
 */
export async function calculateGoalProgress(goal: Goal, userId: string): Promise<number> {
  const runs = await prisma.run.findMany({
    where: {
      userId,
      date: {
        gte: goal.startDate,
        lte: goal.endDate,
      },
    },
  });

  switch (goal.type) {
    case GOAL_TYPES.DISTANCE:
      return runs.reduce((total, run) => total + run.distance, 0);

    case GOAL_TYPES.TIME: {
      const totalMinutes = runs.reduce((total, run) => total + run.duration, 0);
      return goal.targetUnit === 'hours' ? totalMinutes / 60 : totalMinutes;
    }

    case GOAL_TYPES.FREQUENCY:
      return runs.length;

    case GOAL_TYPES.PACE: {
      if (runs.length === 0) {
        return 0;
      }
      return (
        runs.reduce((total, run) => {
          const pace = run.distance > 0 ? run.duration / run.distance : 0;
          return total + pace;
        }, 0) / runs.length
      );
    }

    case GOAL_TYPES.LONGEST_RUN:
      return runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0;

    default:
      return 0;
  }
}

/**
 * Calculate goal progress percentage
 * @param goal - The goal to calculate progress for
 * @param userId - The user ID to filter runs by
 * @returns Promise<{ currentValue: number, progressPercentage: number, isCompleted: boolean }>
 */
export async function calculateGoalProgressData(goal: Goal, userId: string) {
  const currentValue = await calculateGoalProgress(goal, userId);
  const progressPercentage = Math.min((currentValue / goal.targetValue) * 100, 100);
  const isCompleted = currentValue >= goal.targetValue;
  const remainingValue = Math.max(goal.targetValue - currentValue, 0);

  const now = new Date();
  const daysRemaining = Math.max(
    Math.ceil((goal.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    0
  );

  return {
    goalId: goal.id,
    currentValue,
    progressPercentage,
    isCompleted,
    remainingValue,
    daysRemaining,
    goal,
  };
}