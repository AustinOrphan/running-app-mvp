import express from 'express';
import { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { TrainingPlanService } from '../services/trainingPlanService.js';
import { AdvancedTrainingPlanService } from '../services/advancedTrainingPlanService.js';
import { createRateLimit, apiRateLimit } from '../middleware/rateLimiting.js';
import { validateBody, validateParams } from '../middleware/validation.js';
import { z } from 'zod';
import prisma from '../server/prisma.js';

const router = express.Router();

// Validation schemas
const createTrainingPlanSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  goal: z.enum([
    'FIRST_5K',
    'IMPROVE_5K',
    'FIRST_10K',
    'HALF_MARATHON',
    'MARATHON',
    'GENERAL_FITNESS',
  ]),
  targetRaceId: z.string().uuid().optional(),
  startDate: z.string().datetime(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  currentWeeklyMileage: z.number().min(0).max(200).optional(),
});

const updateTrainingPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

const completeWorkoutSchema = z.object({
  runId: z.string().uuid(),
  notes: z.string().max(500).optional(),
  effortLevel: z.number().min(1).max(10).optional(),
});

const adjustPlanSchema = z.object({
  performance: z.enum(['ahead', 'on_track', 'behind']),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * GET /api/training-plans
 * Get all training plans for the user
 */
router.get(
  '/',
  apiRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { active } = req.query;

    const trainingPlans = await prisma.trainingPlan.findMany({
      where: {
        userId,
        ...(active === 'true' ? { isActive: true } : {}),
      },
      include: {
        targetRace: {
          select: {
            id: true,
            name: true,
            raceDate: true,
            distance: true,
          },
        },
        workouts: {
          select: {
            id: true,
            weekNumber: true,
            dayOfWeek: true,
            type: true,
            name: true,
            isCompleted: true,
            targetDistance: true,
            targetDuration: true,
          },
          orderBy: [{ weekNumber: 'asc' }, { dayOfWeek: 'asc' }],
        },
        _count: {
          select: {
            workouts: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate progress for each plan
    const plansWithProgress = trainingPlans.map(plan => {
      const completedWorkouts = plan.workouts.filter(w => w.isCompleted).length;
      const totalWorkouts = plan.workouts.length;
      const progress = totalWorkouts > 0 ? (completedWorkouts / totalWorkouts) * 100 : 0;

      return {
        ...plan,
        progress: Math.round(progress),
        completedWorkouts,
        totalWorkouts,
      };
    });

    res.json({ trainingPlans: plansWithProgress });
  })
);

/**
 * POST /api/training-plans
 * Create a new training plan
 */
router.post(
  '/',
  createRateLimit,
  requireAuth,
  validateBody(createTrainingPlanSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { useAdvanced } = req.query;

    // Check if user has enough run history for advanced planning
    const recentRuns = await prisma.run.count({
      where: {
        userId,
        date: {
          gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
        },
      },
    });

    let trainingPlan;

    // Use advanced service if explicitly requested or user has sufficient history
    if (useAdvanced === 'true' || recentRuns >= 10) {
      const advancedConfig = {
        userId,
        name: req.body.name,
        goal: req.body.goal,
        targetRaceId: req.body.targetRaceId,
        startDate: new Date(req.body.startDate),
        endDate: req.body.targetRaceId
          ? (await prisma.race.findUnique({ where: { id: req.body.targetRaceId } }))?.raceDate
          : undefined,
        fitnessLevel:
          req.body.difficulty === 'beginner'
            ? 'recreational'
            : req.body.difficulty === 'intermediate'
              ? 'trained'
              : ('highly_trained' as any),
        preferences: {
          maxTrainingDays:
            req.body.difficulty === 'beginner' ? 4 : req.body.difficulty === 'intermediate' ? 5 : 6,
          includeStrengthTraining: true,
          includeRecoveryWeeks: true,
          preferredWorkoutDays: [],
          availableDays: [1, 2, 3, 4, 5, 6, 7], // All days available by default
          preferredIntensity:
            req.body.difficulty === 'beginner'
              ? 'low'
              : req.body.difficulty === 'intermediate'
                ? 'moderate'
                : ('high' as any),
          crossTraining: false,
          strengthTraining: true,
        },
      };

      trainingPlan = await AdvancedTrainingPlanService.generateAdvancedTrainingPlan(advancedConfig);
    } else {
      // Use standard service for beginners or when requested
      const trainingPlanData = {
        ...req.body,
        userId,
        startDate: new Date(req.body.startDate),
      };

      trainingPlan = await TrainingPlanService.generateTrainingPlan(trainingPlanData);
    }

    // Get the full plan with workouts
    const fullPlan = await prisma.trainingPlan.findUnique({
      where: { id: trainingPlan.id },
      include: {
        targetRace: true,
        workouts: {
          orderBy: [{ weekNumber: 'asc' }, { dayOfWeek: 'asc' }],
        },
      },
    });

    res.status(201).json({
      message: 'Training plan created successfully',
      trainingPlan: fullPlan,
      advanced: useAdvanced === 'true' || recentRuns >= 10,
    });
  })
);

/**
 * GET /api/training-plans/:id
 * Get a specific training plan
 */
router.get(
  '/:id',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    const trainingPlan = await prisma.trainingPlan.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        targetRace: true,
        workouts: {
          include: {
            completedRun: {
              select: {
                id: true,
                date: true,
                distance: true,
                duration: true,
                detail: {
                  select: {
                    avgHeartRate: true,
                    effortLevel: true,
                  },
                },
              },
            },
          },
          orderBy: [{ weekNumber: 'asc' }, { dayOfWeek: 'asc' }],
        },
      },
    });

    if (!trainingPlan) {
      res.status(404).json({
        message: 'Training plan not found',
      });
      return;
    }

    // Calculate weekly progress
    const weeklyProgress = new Map<number, any>();

    trainingPlan.workouts.forEach(workout => {
      const week = workout.weekNumber;
      if (!weeklyProgress.has(week)) {
        weeklyProgress.set(week, {
          weekNumber: week,
          totalWorkouts: 0,
          completedWorkouts: 0,
          totalDistance: 0,
          completedDistance: 0,
        });
      }

      const weekData = weeklyProgress.get(week);
      weekData.totalWorkouts++;
      weekData.totalDistance += workout.targetDistance || 0;

      if (workout.isCompleted) {
        weekData.completedWorkouts++;
        weekData.completedDistance += workout.completedRun?.distance || workout.targetDistance || 0;
      }
    });

    res.json({
      trainingPlan: {
        ...trainingPlan,
        weeklyProgress: Array.from(weeklyProgress.values()),
      },
    });
  })
);

/**
 * PUT /api/training-plans/:id
 * Update a training plan
 */
router.put(
  '/:id',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  validateBody(updateTrainingPlanSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    const trainingPlan = await prisma.trainingPlan.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!trainingPlan) {
      res.status(404).json({
        message: 'Training plan not found',
      });
      return;
    }

    const updatedPlan = await prisma.trainingPlan.update({
      where: { id },
      data: req.body,
      include: {
        targetRace: true,
        workouts: {
          orderBy: [{ weekNumber: 'asc' }, { dayOfWeek: 'asc' }],
        },
      },
    });

    res.json({
      message: 'Training plan updated successfully',
      trainingPlan: updatedPlan,
    });
  })
);

/**
 * DELETE /api/training-plans/:id
 * Delete a training plan
 */
router.delete(
  '/:id',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    const trainingPlan = await prisma.trainingPlan.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!trainingPlan) {
      res.status(404).json({
        message: 'Training plan not found',
      });
      return;
    }

    await prisma.trainingPlan.delete({
      where: { id },
    });

    res.json({
      message: 'Training plan deleted successfully',
    });
  })
);

/**
 * GET /api/training-plans/:id/workouts
 * Get workouts for a specific week
 */
router.get(
  '/:id/workouts',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const { week } = req.query;

    const whereClause: any = {
      trainingPlan: {
        id,
        userId,
      },
    };

    if (week) {
      whereClause.weekNumber = parseInt(week as string);
    }

    const workouts = await prisma.workoutTemplate.findMany({
      where: whereClause,
      include: {
        completedRun: {
          select: {
            id: true,
            date: true,
            distance: true,
            duration: true,
            detail: {
              select: {
                avgHeartRate: true,
                effortLevel: true,
              },
            },
          },
        },
      },
      orderBy: [{ weekNumber: 'asc' }, { dayOfWeek: 'asc' }],
    });

    res.json({ workouts });
  })
);

/**
 * POST /api/training-plans/:id/workouts/:workoutId/complete
 * Mark a workout as completed
 */
router.post(
  '/:id/workouts/:workoutId/complete',
  apiRateLimit,
  requireAuth,
  validateParams(
    z.object({
      id: z.string().uuid(),
      workoutId: z.string().uuid(),
    })
  ),
  validateBody(completeWorkoutSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id, workoutId } = req.params;
    const { runId, notes, effortLevel } = req.body;

    // Verify the workout belongs to the user's training plan
    const workout = await prisma.workoutTemplate.findFirst({
      where: {
        id: workoutId,
        trainingPlan: {
          id,
          userId,
        },
      },
    });

    if (!workout) {
      res.status(404).json({
        message: 'Workout not found',
      });
      return;
    }

    // Verify the run belongs to the user
    const run = await prisma.run.findFirst({
      where: {
        id: runId,
        userId,
      },
    });

    if (!run) {
      res.status(404).json({
        message: 'Run not found',
      });
      return;
    }

    // Update workout as completed
    const updatedWorkout = await prisma.workoutTemplate.update({
      where: { id: workoutId },
      data: {
        isCompleted: true,
        completedRunId: runId,
        notes: notes ? `${workout.notes || ''}\n\nCompletion notes: ${notes}` : workout.notes,
      },
    });

    // Update run detail with effort level if provided
    if (effortLevel) {
      await prisma.runDetail.upsert({
        where: { runId },
        update: { effortLevel },
        create: {
          runId,
          effortLevel,
        },
      });
      return;
    }

    res.json({
      message: 'Workout marked as completed',
      workout: updatedWorkout,
    });
  })
);

/**
 * POST /api/training-plans/:id/adjust
 * Adjust training plan based on performance
 */
router.post(
  '/:id/adjust',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  validateBody(adjustPlanSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const { performance } = req.body;

    // Verify plan ownership
    const trainingPlan = await prisma.trainingPlan.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!trainingPlan) {
      res.status(404).json({
        message: 'Training plan not found',
      });
      return;
    }

    await TrainingPlanService.adjustTrainingPlan(id, performance);

    res.json({
      message: `Training plan adjusted for ${performance} performance`,
    });
  })
);

/**
 * GET /api/training-plans/:id/insights
 * Get advanced insights and recommendations for a training plan
 */
router.get(
  '/:id/insights',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    // Verify plan ownership
    const trainingPlan = await prisma.trainingPlan.findFirst({
      where: { id, userId },
      include: {
        workouts: {
          include: {
            completedRun: {
              include: {
                detail: true,
              },
            },
          },
        },
      },
    });

    if (!trainingPlan) {
      res.status(404).json({ message: 'Training plan not found' });
      return;
    }

    // Generate insights using advanced service
    const insights = await AdvancedTrainingPlanService.generateTrainingInsights(
      trainingPlan,
      userId
    );

    res.json({ insights });
  })
);

/**
 * POST /api/training-plans/:id/optimize
 * Optimize a training plan based on current performance
 */
router.post(
  '/:id/optimize',
  apiRateLimit,
  requireAuth,
  validateParams(idParamSchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    // Verify plan ownership
    const trainingPlan = await prisma.trainingPlan.findFirst({
      where: { id, userId },
    });

    if (!trainingPlan) {
      res.status(404).json({ message: 'Training plan not found' });
      return;
    }

    // Optimize using advanced service
    const optimizedPlan = await AdvancedTrainingPlanService.optimizeTrainingPlan(id, userId);

    res.json({
      message: 'Training plan optimized successfully',
      trainingPlan: optimizedPlan,
    });
  })
);

/**
 * GET /api/training-plans/templates
 * Get available training plan templates
 */
router.get(
  '/templates',
  apiRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const templates = [
      {
        goal: 'FIRST_5K',
        name: 'Couch to 5K',
        description: 'Perfect for beginners who want to run their first 5K',
        duration: '8-10 weeks',
        difficulty: ['beginner'],
      },
      {
        goal: 'IMPROVE_5K',
        name: '5K Speed Training',
        description: 'Improve your 5K personal best time',
        duration: '6-12 weeks',
        difficulty: ['beginner', 'intermediate', 'advanced'],
      },
      {
        goal: 'FIRST_10K',
        name: '10K Training',
        description: 'Build endurance for your first 10K race',
        duration: '8-10 weeks',
        difficulty: ['beginner', 'intermediate', 'advanced'],
      },
      {
        goal: 'HALF_MARATHON',
        name: 'Half Marathon Training',
        description: 'Complete or improve your half marathon time',
        duration: '12-16 weeks',
        difficulty: ['beginner', 'intermediate', 'advanced'],
      },
      {
        goal: 'MARATHON',
        name: 'Marathon Training',
        description: 'Train for the ultimate running challenge',
        duration: '16-20 weeks',
        difficulty: ['beginner', 'intermediate', 'advanced'],
      },
      {
        goal: 'GENERAL_FITNESS',
        name: 'General Fitness',
        description: 'Build and maintain running fitness',
        duration: '12 weeks',
        difficulty: ['beginner', 'intermediate', 'advanced'],
      },
    ];

    res.json({ templates });
  })
);

export default router;
