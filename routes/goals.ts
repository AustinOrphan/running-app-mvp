import express from 'express';

import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { createError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { prisma } from '../server.js';
import { GOAL_TYPES, GOAL_PERIODS, type GoalType, type GoalPeriod } from '../src/types/goals.js';

const router = express.Router();

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
    const goal = await prisma.goal.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!goal) {
      throw createError('Goal not found', 404);
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
      throw createError(
        'Missing required fields: title, type, period, targetValue, targetUnit, startDate, endDate',
        400
      );
    }

    // Validate goal type
    if (!Object.values(GOAL_TYPES).includes(type as GoalType)) {
      throw createError('Invalid goal type', 400);
    }

    // Validate goal period
    if (!Object.values(GOAL_PERIODS).includes(period as GoalPeriod)) {
      throw createError('Invalid goal period', 400);
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
      throw createError('End date must be after start date', 400);
    }

    // Validate target value
    if (targetValue <= 0) {
      throw createError('Target value must be positive', 400);
    }

    const goal = await prisma.goal.create({
      data: {
        userId: req.user!.id,
        title: title.trim(),
        description: description?.trim(),
        type,
        period,
        targetValue: parseFloat(targetValue),
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
    } = req.body;

    // Check if goal exists and belongs to user
    const existingGoal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: req.user!.id,
      },
    });

    if (!existingGoal) {
      throw createError('Goal not found', 404);
    }

    // Prevent editing completed goals
    if (existingGoal.isCompleted) {
      throw createError('Cannot edit completed goals', 400);
    }

    // Validation (only validate provided fields)
    if (type && !Object.values(GOAL_TYPES).includes(type as GoalType)) {
      throw createError('Invalid goal type', 400);
    }

    if (period && !Object.values(GOAL_PERIODS).includes(period as GoalPeriod)) {
      throw createError('Invalid goal period', 400);
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start >= end) {
        throw createError('End date must be after start date', 400);
      }
    }

    if (targetValue !== undefined && targetValue <= 0) {
      throw createError('Target value must be positive', 400);
    }

    // Update goal
    const updatedGoal = await prisma.goal.update({
      where: { id: goalId },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() }),
        ...(type && { type }),
        ...(period && { period }),
        ...(targetValue !== undefined && { targetValue: parseFloat(targetValue) }),
        ...(targetUnit && { targetUnit }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updatedGoal);
  })
);

// DELETE /api/goals/:id - Delete goal (soft delete)
router.delete(
  '/:id',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const goalId = req.params.id;

    // Check if goal exists and belongs to user
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: req.user!.id,
      },
    });

    if (!goal) {
      throw createError('Goal not found', 404);
    }

    // Soft delete by setting isActive to false
    await prisma.goal.update({
      where: { id: goalId },
      data: { isActive: false },
    });

    res.json({ message: 'Goal deleted successfully' });
  })
);

// POST /api/goals/:id/complete - Mark goal as completed
router.post(
  '/:id/complete',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const goalId = req.params.id;

    // Check if goal exists and belongs to user
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: req.user!.id,
        isActive: true,
      },
    });

    if (!goal) {
      throw createError('Goal not found', 404);
    }

    if (goal.isCompleted) {
      throw createError('Goal is already completed', 400);
    }

    // Mark as completed
    const completedGoal = await prisma.goal.update({
      where: { id: goalId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        currentValue: goal.targetValue, // Set current to target when manually completed
      },
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
async function calculateGoalProgress(goal: {
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
}, userId: string): Promise<number> {
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
      const avgPace =
        runs.reduce((total, run) => {
          const pace = run.distance > 0 ? run.duration / run.distance : 0;
          return total + pace;
        }, 0) / runs.length;
      return avgPace;
    }

    case GOAL_TYPES.LONGEST_RUN:
      return runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0;

    default:
      return 0;
  }
}

export default router;
