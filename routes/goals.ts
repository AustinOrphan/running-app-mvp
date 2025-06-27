import express from 'express';

import { createError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { validateCreateGoal, validateUpdateGoal, validateIdParam, sanitizeInput, securityHeaders } from '../middleware/validation.js';
import { createRateLimit, readRateLimit, apiRateLimit } from '../middleware/rateLimiting.js';
import { logUserAction, logError } from '../utils/secureLogger.js';
import { prisma } from '../server.js';
import { GOAL_TYPES, GOAL_PERIODS, type GoalType, type GoalPeriod } from '../src/types/goals.js';

const router = express.Router();

// Apply security headers to all goals routes
router.use(securityHeaders);

// Apply input sanitization to all goals routes
router.use(sanitizeInput);

// GET /api/goals - Get all goals for user
router.get('/', readRateLimit, requireAuth, async (req: AuthRequest, res) => {
  try {
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
  } catch (error) {
    logError('Failed to fetch goals', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to fetch goals', 500);
  }
});

// GET /api/goals/:id - Get specific goal
router.get('/:id', readRateLimit, validateIdParam, requireAuth, async (req: AuthRequest, res) => {
  try {
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
  } catch (error) {
    logError('Failed to fetch goal', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to fetch goal', 500);
  }
});

// POST /api/goals - Create new goal
router.post('/', createRateLimit, validateCreateGoal, requireAuth, async (req: AuthRequest, res) => {
  try {
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

    // Dates are already validated by Zod, just parse them
    const start = new Date(startDate);
    const end = new Date(endDate);

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

    logUserAction('Goal created', req, { 
      goalType: type, 
      period, 
      targetValue: parseFloat(targetValue),
      targetUnit 
    });

    res.status(201).json(goal);
  } catch (error) {
    logError('Failed to create goal', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to create goal', 500);
  }
});

// PUT /api/goals/:id - Update goal
router.put('/:id', apiRateLimit, validateIdParam, validateUpdateGoal, requireAuth, async (req: AuthRequest, res) => {
  try {
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

    // All validation is now handled by Zod middleware

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
  } catch (error) {
    logError('Failed to update goal', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to update goal', 500);
  }
});

// DELETE /api/goals/:id - Delete goal (soft delete)
router.delete('/:id', apiRateLimit, validateIdParam, requireAuth, async (req: AuthRequest, res) => {
  try {
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
  } catch (error) {
    logError('Failed to delete goal', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to delete goal', 500);
  }
});

// POST /api/goals/:id/complete - Mark goal as completed
router.post('/:id/complete', apiRateLimit, validateIdParam, requireAuth, async (req: AuthRequest, res) => {
  try {
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
  } catch (error) {
    logError('Failed to complete goal', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to complete goal', 500);
  }
});

// GET /api/goals/progress - Get progress for all active goals
router.get('/progress/all', readRateLimit, requireAuth, async (req: AuthRequest, res) => {
  try {
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
  } catch (error) {
    logError('Failed to fetch goal progress', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to fetch goal progress', 500);
  }
});

// Helper function to calculate current progress for a goal
async function calculateGoalProgress(goal: any, userId: string): Promise<number> {
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
