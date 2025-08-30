import express from 'express';

import { prisma } from '../../lib/prisma.js';
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import {
  createNotFoundError,
  createValidationError,
  createForbiddenError,
} from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { sanitizeInput } from '../middleware/validation.js';
import { GOAL_TYPES, GOAL_PERIODS, type GoalType, type GoalPeriod } from '../../src/types/goals.js';

const router = express.Router();

// Apply input sanitization to all goals routes
router.use(sanitizeInput);

// GET /api/goals - Get all goals for user
router.get(
  '/',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const goals = await prisma.goal.findMany({
      where: {
        userId: req.user!.id,
        isActive: true,
      },
      orderBy: [
        { isCompleted: 'asc' }, // Active goals first
        { createdAt: 'desc' },
      ],
    });

    res.json(goals);
  })
);

// GET /api/goals/:id - Get specific goal
router.get(
  '/:id',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Check if goal exists AND belongs to user (combined for security)
    const goal = await prisma.goal.findUnique({
      where: { id: req.params.id },
    });

    if (!goal) {
      throw createNotFoundError('Goal');
    }

    if (goal.userId !== req.user!.id) {
      throw createForbiddenError('You do not have permission to access this goal');
    }

    res.json(goal);
  })
);

// POST /api/goals - Create new goal
router.post(
  '/',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const {
      title,
      description,
      type,
      period,
      targetValue,
      targetUnit,
      startDate,
      endDate,
      color,
      icon,
    } = req.body;

    // Validation
    if (!title || !type || !period || !targetValue || !targetUnit || !startDate || !endDate) {
      throw createValidationError(
        'Missing required fields: title, type, period, targetValue, targetUnit, startDate, endDate',
        'all'
      );
    }

    // Validate type
    if (!Object.values(GOAL_TYPES).includes(type as GoalType)) {
      throw createValidationError('Invalid goal type', 'type');
    }

    // Validate period
    if (!Object.values(GOAL_PERIODS).includes(period as GoalPeriod)) {
      throw createValidationError('Invalid goal period', 'period');
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
      throw createValidationError('End date must be after start date', 'endDate');
    }

    // Validate target value
    if (targetValue <= 0) {
      throw createValidationError('Target value must be positive', 'targetValue');
    }

    // Use transaction for atomic creation
    const goal = await prisma.$transaction(async tx => {
      return await tx.goal.create({
        data: {
          userId: req.user!.id,
          title: title.trim(),
          description: description?.trim(),
          type,
          period,
          targetValue: Number.parseFloat(targetValue),
          targetUnit,
          startDate: start,
          endDate: end,
          currentValue: 0,
          color,
          icon,
          isActive: true,
          isCompleted: false,
        },
      });
    });

    res.status(201).json(goal);
  })
);

// PUT /api/goals/:id - Update goal
router.put(
  '/:id',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const goalId = req.params.id;
    const {
      title,
      description,
      type,
      period,
      targetValue,
      targetUnit,
      startDate,
      endDate,
      color,
      icon,
      isActive,
      currentValue,
    } = req.body;

    // Use transaction to ensure atomic updates
    const updatedGoal = await prisma.$transaction(async tx => {
      // Check if goal exists first
      const existingGoal = await tx.goal.findUnique({
        where: { id: req.params.id },
      });

      if (!existingGoal) {
        throw createNotFoundError('Goal');
      }

      // Then check authorization
      if (existingGoal.userId !== req.user!.id) {
        throw createForbiddenError('You do not have permission to update this goal');
      }

      // Prevent editing completed goals
      if (existingGoal.isCompleted) {
        throw createValidationError('Cannot edit completed goals', 'isCompleted');
      }

      // Validate type if provided
      if (type && !Object.values(GOAL_TYPES).includes(type as GoalType)) {
        throw createValidationError('Invalid goal type', 'type');
      }

      if (period && !Object.values(GOAL_PERIODS).includes(period as GoalPeriod)) {
        throw createValidationError('Invalid goal period', 'period');
      }

      // Validate dates if both are provided
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start >= end) {
          throw createValidationError('End date must be after start date', 'endDate');
        }
      }

      if (targetValue !== undefined && targetValue <= 0) {
        throw createValidationError('Target value must be positive', 'targetValue');
      }

      if (currentValue !== undefined && currentValue < 0) {
        throw createValidationError('Current value cannot be negative', 'currentValue');
      }

      // Prepare update data
      const updateData: Record<string, unknown> = {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() }),
        ...(type && { type }),
        ...(period && { period }),
        ...(targetValue !== undefined && { targetValue: Number.parseFloat(targetValue) }),
        ...(targetUnit && { targetUnit }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(isActive !== undefined && { isActive }),
        ...(currentValue !== undefined && { currentValue: Number.parseFloat(currentValue) }),
      };

      // Auto-complete goal if currentValue reaches or exceeds targetValue
      if (currentValue !== undefined) {
        const newCurrentValue = Number.parseFloat(currentValue);
        const goalTargetValue =
          targetValue !== undefined ? Number.parseFloat(targetValue) : existingGoal.targetValue;

        if (newCurrentValue >= goalTargetValue && !existingGoal.isCompleted) {
          updateData.isCompleted = true;
          updateData.completedAt = new Date();
        }
      }

      // Update goal within transaction
      return await tx.goal.update({
        where: { id: goalId },
        data: updateData,
      });
    });

    res.json(updatedGoal);
  })
);

// DELETE /api/goals/:id - Delete goal (soft delete)
router.delete(
  '/:id',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Use transaction for atomic soft delete
    await prisma.$transaction(async tx => {
      // Check if goal exists first
      const goal = await tx.goal.findUnique({
        where: { id: req.params.id },
      });

      if (!goal) {
        throw createNotFoundError('Goal');
      }

      // Then check authorization
      if (goal.userId !== req.user!.id) {
        throw createForbiddenError('You do not have permission to delete this goal');
      }

      // Soft delete by setting isActive to false
      await tx.goal.update({
        where: { id: goal.id },
        data: { isActive: false },
      });
    });

    res.status(204).send();
  })
);

// POST /api/goals/:id/complete - Mark goal as completed
router.post(
  '/:id/complete',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Use transaction for atomic completion
    const completedGoal = await prisma.$transaction(async tx => {
      // Check if goal exists first
      const goal = await tx.goal.findUnique({
        where: { id: req.params.id },
      });

      if (!goal) {
        throw createNotFoundError('Goal');
      }

      // Then check authorization
      if (goal.userId !== req.user!.id) {
        throw createForbiddenError('You do not have permission to complete this goal');
      }

      // Check if goal is active
      if (!goal.isActive) {
        throw createNotFoundError('Goal');
      }

      if (goal.isCompleted) {
        throw createValidationError('Goal is already completed', 'isCompleted');
      }

      // Mark as completed
      return await tx.goal.update({
        where: { id: goal.id },
        data: {
          isCompleted: true,
          completedAt: new Date(),
          currentValue: goal.targetValue, // Set current to target when manually completed
        },
      });
    });

    res.json(completedGoal);
  })
);

// GET /api/goals/progress - Get progress for all active goals
router.get(
  '/progress/all',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const goals = await prisma.goal.findMany({
      where: {
        userId: req.user!.id,
        isActive: true,
        isCompleted: false,
      },
    });

    // Calculate progress for each goal
    const progressData = await Promise.all(
      goals.map(async goal => {
        const currentValue = await calculateGoalProgress(goal, req.user!.id);
        const progressPercentage = Math.min((currentValue / goal.targetValue) * 100, 100);
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
          isCompleted: currentValue >= goal.targetValue,
          remainingValue,
          daysRemaining,
          goal,
        };
      })
    );

    res.json(progressData);
  })
);

// Helper function to calculate current progress for a goal
async function calculateGoalProgress(
  goal: {
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
  },
  userId: string
): Promise<number> {
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

export default router;
