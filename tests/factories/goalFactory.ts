import { Goal } from '@prisma/client';
import { testDb } from '../fixtures/testDatabase.js';

/**
 * Goal Factory
 * Functions for creating test goal data with various configurations
 */

export interface GoalFactoryOptions {
  userId: string;
  title?: string;
  description?: string;
  type?: string;
  period?: string;
  targetValue?: number;
  targetUnit?: string;
  currentValue?: number;
  startDate?: Date;
  endDate?: Date;
  isCompleted?: boolean;
  completedAt?: Date | null;
  color?: string;
  icon?: string;
  isActive?: boolean;
}

/**
 * Create a basic goal
 */
export async function createGoal(options: GoalFactoryOptions): Promise<Goal> {
  const startDate = options.startDate || new Date();
  const endDate = options.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  return testDb.prisma.goal.create({
    data: {
      userId: options.userId,
      title: options.title || 'Test Goal',
      description: options.description || 'Test goal description',
      type: options.type || 'DISTANCE',
      period: options.period || 'MONTHLY',
      targetValue: options.targetValue || 100,
      targetUnit: options.targetUnit || 'km',
      currentValue: options.currentValue || 0,
      startDate,
      endDate,
      isCompleted: options.isCompleted || false,
      completedAt: options.completedAt || null,
      color: options.color || '#3b82f6',
      icon: options.icon || '<�',
      isActive: options.isActive !== undefined ? options.isActive : true,
    },
  });
}

/**
 * Create a distance goal
 */
export async function createDistanceGoal(
  userId: string,
  targetKm: number = 100,
  period: 'WEEKLY' | 'MONTHLY' | 'YEARLY' = 'MONTHLY'
): Promise<Goal> {
  const periodDays = period === 'WEEKLY' ? 7 : period === 'MONTHLY' ? 30 : 365;

  return createGoal({
    userId,
    title: `Run ${targetKm}km this ${period.toLowerCase()}`,
    type: 'DISTANCE',
    period,
    targetValue: targetKm,
    targetUnit: 'km',
    startDate: new Date(),
    endDate: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000),
  });
}

/**
 * Create a completed goal
 */
export async function createCompletedGoal(userId: string, daysAgo: number = 7): Promise<Goal> {
  const completedAt = new Date();
  completedAt.setDate(completedAt.getDate() - daysAgo);

  return createGoal({
    userId,
    title: 'Completed Goal',
    targetValue: 50,
    currentValue: 55,
    isCompleted: true,
    completedAt,
    startDate: new Date(completedAt.getTime() - 30 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
  });
}

/**
 * Create an active goal with progress
 */
export async function createActiveGoal(
  userId: string,
  progressPercentage: number = 50
): Promise<Goal> {
  const targetValue = 100;
  const currentValue = (targetValue * progressPercentage) / 100;

  return createGoal({
    userId,
    title: `${progressPercentage}% Complete Goal`,
    targetValue,
    currentValue,
    isActive: true,
    isCompleted: false,
  });
}
