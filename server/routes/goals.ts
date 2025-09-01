import express, { NextFunction } from 'express';

import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { asyncAuthHandler } from '../middleware/asyncHandler';
import { createNotFoundError, createValidationError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { sanitizeInput } from '../middleware/validation.js';
import { verifyGoalOwnership, ResourceAuthRequest } from '../middleware/ownershipMiddleware.js';
import { GOAL_TYPES, GOAL_PERIODS, type GoalType, type GoalPeriod } from '../../src/types/goals.js';
import { calculateGoalProgressData } from '../utils/goalUtils';

// Validation utilities for goal operations
interface GoalUpdateData {
  title?: string;
  description?: string | null;
  type?: string;
  period?: string;
  targetValue?: number;
  targetUnit?: string;
  startDate?: Date;
  endDate?: Date;
  color?: string;
  icon?: string;
  isActive?: boolean;
  currentValue?: number;
}

const validateGoalUpdateData = (data: GoalUpdateData): void => {
  const { type, period, startDate, endDate, targetValue, currentValue } = data;

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
};

const buildGoalUpdateData = (requestBody: any): Record<string, unknown> => {
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
  } = requestBody;

  return {
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
};

interface ExistingGoal {
  targetValue: number;
  isCompleted: boolean;
}

const handleGoalAutoCompletion = (
  updateData: Record<string, unknown>,
  currentValue: number | undefined,
  existingGoal: ExistingGoal
): void => {
  if (currentValue !== undefined) {
    const newCurrentValue = Number.parseFloat(currentValue.toString());
    const goalTargetValue = existingGoal.targetValue;

    if (newCurrentValue >= goalTargetValue && !existingGoal.isCompleted) {
      updateData.isCompleted = true;
      updateData.completedAt = new Date();
    }
  }
};
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
  verifyGoalOwnership,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Resource is already verified by middleware, cast req to ResourceAuthRequest
    const resourceReq = req as ResourceAuthRequest;
    res.json(resourceReq.resource);
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
    const goal = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
  verifyGoalOwnership,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const resourceReq = req as ResourceAuthRequest; // Cast to ResourceAuthRequest after ownership middleware
    const { currentValue } = resourceReq.body;

    const existingGoal = resourceReq.resource; // Already verified by middleware

    // Prevent editing completed goals
    if (existingGoal.isCompleted) {
      throw createValidationError('Cannot edit completed goals', 'isCompleted');
    }

    // Validate input data using extracted utility
    validateGoalUpdateData(resourceReq.body);

    // Use transaction to ensure atomic updates
    const updatedGoal = await prisma.$transaction(async tx => {
      // Build update data using extracted utility
      const updateData = buildGoalUpdateData(resourceReq.body);

      // Handle auto-completion using extracted utility
      handleGoalAutoCompletion(updateData, currentValue, existingGoal);

      // Update goal within transaction
      return await tx.goal.update({
        where: { id: existingGoal.id },
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
  verifyGoalOwnership,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const resourceReq = req as ResourceAuthRequest; // Cast to ResourceAuthRequest after ownership middleware
    const goal = resourceReq.resource; // Already verified by middleware

    // Use transaction for atomic soft delete
    await prisma.$transaction(async tx => {
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
  verifyGoalOwnership,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const resourceReq = req as ResourceAuthRequest; // Cast to ResourceAuthRequest after ownership middleware
    const goal = resourceReq.resource; // Already verified by middleware

    // Check if goal is active
    if (!goal.isActive) {
      throw createNotFoundError('Goal');
    }

    if (goal.isCompleted) {
      throw createValidationError('Goal is already completed', 'isCompleted');
    }

    // Use transaction for atomic completion
    const completedGoal = await prisma.$transaction(async tx => {
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

    // Calculate progress for each goal using utility
    const progressData = await Promise.all(
      goals.map(goal => calculateGoalProgressData(goal, req.user!.id))
    );

    res.json(progressData);
  })
);

export default router;
