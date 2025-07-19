import prisma from '../server/prisma.js';
import { TrainingPlan, WorkoutTemplate, User, Race } from '@prisma/client';
import { addDays, addWeeks, differenceInWeeks, startOfWeek } from 'date-fns';

interface TrainingPlanConfig {
  userId: string;
  name: string;
  description?: string;
  goal: 'FIRST_5K' | 'IMPROVE_5K' | 'FIRST_10K' | 'HALF_MARATHON' | 'MARATHON' | 'GENERAL_FITNESS';
  targetRaceId?: string;
  startDate: Date;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  currentWeeklyMileage?: number;
}

interface WorkoutDefinition {
  type: 'easy' | 'tempo' | 'interval' | 'long' | 'recovery' | 'race';
  name: string;
  description: string;
  intensityPercentage: number; // Percentage of target race pace
  durationFactor: number; // Multiplier for base duration
  distanceFactor: number; // Multiplier for base distance
}

export class TrainingPlanService {
  private static readonly WORKOUT_TYPES: Record<string, WorkoutDefinition> = {
    EASY_RUN: {
      type: 'easy',
      name: 'Easy Run',
      description: 'Comfortable pace, conversational',
      intensityPercentage: 70,
      durationFactor: 0.6,
      distanceFactor: 0.7,
    },
    TEMPO_RUN: {
      type: 'tempo',
      name: 'Tempo Run',
      description: 'Comfortably hard pace',
      intensityPercentage: 85,
      durationFactor: 0.5,
      distanceFactor: 0.5,
    },
    INTERVALS: {
      type: 'interval',
      name: 'Interval Training',
      description: 'High intensity intervals with recovery',
      intensityPercentage: 95,
      durationFactor: 0.4,
      distanceFactor: 0.4,
    },
    LONG_RUN: {
      type: 'long',
      name: 'Long Run',
      description: 'Extended duration at easy pace',
      intensityPercentage: 70,
      durationFactor: 1.5,
      distanceFactor: 1.5,
    },
    RECOVERY: {
      type: 'recovery',
      name: 'Recovery Run',
      description: 'Very easy pace for active recovery',
      intensityPercentage: 60,
      durationFactor: 0.4,
      distanceFactor: 0.4,
    },
  };

  /**
   * Generate a personalized training plan
   */
  static async generateTrainingPlan(config: TrainingPlanConfig): Promise<TrainingPlan> {
    // Get user's running history
    const userStats = await this.analyzeUserCapabilities(config.userId);

    // Determine plan duration and target metrics
    const planDetails = this.getPlanDetails(config.goal, config.difficulty);

    // Calculate end date
    const endDate = addWeeks(config.startDate, planDetails.weeks);

    // Create the training plan
    const trainingPlan = await prisma.trainingPlan.create({
      data: {
        userId: config.userId,
        name: config.name,
        description: config.description || planDetails.description,
        startDate: config.startDate,
        endDate,
        goal: config.goal,
        targetRaceId: config.targetRaceId,
        difficulty: config.difficulty,
        weeklyMileageStart: config.currentWeeklyMileage || userStats.currentWeeklyMileage,
        weeklyMileageTarget: planDetails.targetWeeklyMileage,
      },
    });

    // Generate workouts for each week
    await this.generateWorkouts(trainingPlan, planDetails, userStats);

    return trainingPlan;
  }

  /**
   * Analyze user's current capabilities based on recent runs
   */
  private static async analyzeUserCapabilities(userId: string) {
    const recentRuns = await prisma.run.findMany({
      where: {
        userId,
        date: {
          gte: addDays(new Date(), -42), // Last 6 weeks
        },
      },
      include: {
        detail: true,
      },
      orderBy: {
        date: 'desc',
      },
    });

    // Calculate current weekly mileage
    const weeklyDistances = new Map<string, number>();

    recentRuns.forEach(run => {
      const weekStart = startOfWeek(run.date).toISOString();
      const current = weeklyDistances.get(weekStart) || 0;
      weeklyDistances.set(weekStart, current + run.distance);
    });

    const weeklyMileages = Array.from(weeklyDistances.values());
    const currentWeeklyMileage =
      weeklyMileages.length > 0
        ? weeklyMileages.reduce((sum, d) => sum + d, 0) / weeklyMileages.length
        : 10; // Default for beginners

    // Find typical paces
    const paces = recentRuns.map(run => run.duration / run.distance);
    const avgPace = paces.length > 0 ? paces.reduce((sum, p) => sum + p, 0) / paces.length : 6; // Default 6 min/km

    // Find longest run
    const longestRun = recentRuns.length > 0 ? Math.max(...recentRuns.map(run => run.distance)) : 3; // Default 3km

    return {
      currentWeeklyMileage,
      avgPace,
      longestRun,
      runCount: recentRuns.length,
      hasHeartRateData: recentRuns.some(run => run.detail?.avgHeartRate),
    };
  }

  /**
   * Get plan details based on goal and difficulty
   */
  private static getPlanDetails(goal: string, difficulty: string) {
    const planMap: Record<string, any> = {
      FIRST_5K: {
        beginner: {
          weeks: 8,
          targetWeeklyMileage: 20,
          description: 'Build up to running 5K continuously',
        },
        intermediate: {
          weeks: 6,
          targetWeeklyMileage: 25,
          description: 'Improve your 5K time',
        },
        advanced: {
          weeks: 6,
          targetWeeklyMileage: 35,
          description: 'Advanced 5K speed training',
        },
      },
      IMPROVE_5K: {
        beginner: {
          weeks: 8,
          targetWeeklyMileage: 25,
          description: 'Improve your 5K personal best',
        },
        intermediate: {
          weeks: 10,
          targetWeeklyMileage: 35,
          description: 'Structured 5K improvement plan',
        },
        advanced: {
          weeks: 12,
          targetWeeklyMileage: 45,
          description: 'Elite 5K training program',
        },
      },
      FIRST_10K: {
        beginner: {
          weeks: 10,
          targetWeeklyMileage: 30,
          description: 'Build endurance for your first 10K',
        },
        intermediate: {
          weeks: 8,
          targetWeeklyMileage: 40,
          description: 'Structured 10K training',
        },
        advanced: {
          weeks: 8,
          targetWeeklyMileage: 50,
          description: 'Advanced 10K performance',
        },
      },
      HALF_MARATHON: {
        beginner: {
          weeks: 12,
          targetWeeklyMileage: 40,
          description: 'Complete your first half marathon',
        },
        intermediate: {
          weeks: 12,
          targetWeeklyMileage: 55,
          description: 'Improve half marathon time',
        },
        advanced: {
          weeks: 14,
          targetWeeklyMileage: 70,
          description: 'Advanced half marathon training',
        },
      },
      MARATHON: {
        beginner: {
          weeks: 18,
          targetWeeklyMileage: 50,
          description: 'Train for your first marathon',
        },
        intermediate: {
          weeks: 18,
          targetWeeklyMileage: 65,
          description: 'Structured marathon improvement',
        },
        advanced: {
          weeks: 20,
          targetWeeklyMileage: 80,
          description: 'Advanced marathon performance',
        },
      },
      GENERAL_FITNESS: {
        beginner: {
          weeks: 12,
          targetWeeklyMileage: 20,
          description: 'Build running fitness',
        },
        intermediate: {
          weeks: 12,
          targetWeeklyMileage: 35,
          description: 'Maintain and improve fitness',
        },
        advanced: {
          weeks: 12,
          targetWeeklyMileage: 50,
          description: 'Advanced fitness training',
        },
      },
    };

    return planMap[goal][difficulty];
  }

  /**
   * Generate workouts for the training plan
   */
  private static async generateWorkouts(
    plan: TrainingPlan,
    planDetails: any,
    userStats: any
  ): Promise<void> {
    const totalWeeks = differenceInWeeks(plan.endDate, plan.startDate);
    const baseDistance = userStats.currentWeeklyMileage / 4; // Average run distance
    const basePace = userStats.avgPace;

    for (let week = 0; week < totalWeeks; week++) {
      // Progressive overload
      const weekProgress = week / totalWeeks;
      const mileageProgress = 0.7 + weekProgress * 0.3; // Start at 70%, build to 100%

      // Tapering for final weeks
      const taperFactor = week >= totalWeeks - 2 ? 0.7 : 1.0;

      const weeklyMileage =
        (userStats.currentWeeklyMileage +
          (planDetails.targetWeeklyMileage - userStats.currentWeeklyMileage) * weekProgress) *
        taperFactor;

      // Generate workouts based on difficulty and week
      const workouts = this.generateWeeklyWorkouts(
        plan.id,
        week + 1,
        weeklyMileage,
        baseDistance,
        basePace,
        plan.difficulty,
        plan.goal
      );

      // Create workout templates
      for (const workout of workouts) {
        await prisma.workoutTemplate.create({
          data: workout,
        });
      }
    }
  }

  /**
   * Generate workouts for a specific week
   */
  private static generateWeeklyWorkouts(
    trainingPlanId: string,
    weekNumber: number,
    weeklyMileage: number,
    baseDistance: number,
    basePace: number,
    difficulty: string,
    goal: string
  ): any[] {
    const workouts = [];

    // Determine workout structure based on difficulty
    const weeklyStructure = this.getWeeklyStructure(difficulty, weekNumber);

    let remainingMileage = weeklyMileage;
    let dayOfWeek = 1; // Start with Monday

    for (const workoutType of weeklyStructure) {
      const workoutDef = this.WORKOUT_TYPES[workoutType];
      const distance = baseDistance * workoutDef.distanceFactor;
      const duration = distance * basePace * (100 / workoutDef.intensityPercentage);

      workouts.push({
        trainingPlanId,
        weekNumber,
        dayOfWeek,
        type: workoutDef.type,
        name: workoutDef.name,
        description: workoutDef.description,
        targetDistance: Math.min(distance, remainingMileage),
        targetDuration: Math.round(duration),
        targetPace: basePace * (100 / workoutDef.intensityPercentage),
        intensity: this.getIntensityLevel(workoutDef.intensityPercentage),
        notes: this.generateWorkoutNotes(workoutDef.type, weekNumber, goal),
      });

      remainingMileage -= distance;
      dayOfWeek = (dayOfWeek + 1) % 7 || 7;
    }

    return workouts;
  }

  /**
   * Get weekly workout structure based on difficulty
   */
  private static getWeeklyStructure(difficulty: string, weekNumber: number): string[] {
    const structures: Record<string, string[]> = {
      beginner: ['EASY_RUN', 'RECOVERY', 'EASY_RUN', 'LONG_RUN'],
      intermediate: ['EASY_RUN', 'TEMPO_RUN', 'RECOVERY', 'INTERVALS', 'EASY_RUN', 'LONG_RUN'],
      advanced: [
        'EASY_RUN',
        'INTERVALS',
        'TEMPO_RUN',
        'EASY_RUN',
        'INTERVALS',
        'RECOVERY',
        'LONG_RUN',
      ],
    };

    // Modify structure based on week (e.g., add more intensity mid-plan)
    let structure = [...structures[difficulty]];

    if (weekNumber % 4 === 0) {
      // Recovery week - replace one hard workout with easy
      const hardWorkoutIndex = structure.findIndex(w => ['TEMPO_RUN', 'INTERVALS'].includes(w));
      if (hardWorkoutIndex >= 0) {
        structure[hardWorkoutIndex] = 'EASY_RUN';
      }
    }

    return structure;
  }

  /**
   * Get intensity level description
   */
  private static getIntensityLevel(percentage: number): string {
    if (percentage >= 95) return 'max';
    if (percentage >= 85) return 'hard';
    if (percentage >= 70) return 'moderate';
    return 'easy';
  }

  /**
   * Generate workout-specific notes
   */
  private static generateWorkoutNotes(type: string, weekNumber: number, goal: string): string {
    const notes: Record<string, string[]> = {
      easy: [
        'Maintain conversational pace',
        'Focus on form and breathing',
        'Should feel comfortable throughout',
      ],
      tempo: [
        'Comfortably hard pace',
        'Include 10min warmup and cooldown',
        'Maintain steady effort',
      ],
      interval: [
        'Warm up thoroughly before intervals',
        'Focus on consistent pacing',
        'Full recovery between intervals',
      ],
      long: ['Start conservatively', 'Practice race nutrition', 'Focus on time on feet'],
      recovery: ['Very easy effort', 'Focus on form', 'Active recovery'],
    };

    const baseNote = notes[type][weekNumber % notes[type].length];

    // Add goal-specific notes
    if (goal.includes('MARATHON') && type === 'long') {
      return `${baseNote}. Practice race-day fueling strategy.`;
    }

    return baseNote;
  }

  /**
   * Adjust training plan based on performance
   */
  static async adjustTrainingPlan(
    planId: string,
    performance: 'ahead' | 'on_track' | 'behind'
  ): Promise<void> {
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      include: {
        workouts: {
          where: {
            isCompleted: false,
          },
          orderBy: {
            weekNumber: 'asc',
          },
        },
      },
    });

    if (!plan) return;

    // Adjust future workouts based on performance
    const adjustmentFactor = performance === 'ahead' ? 1.1 : performance === 'behind' ? 0.9 : 1.0;

    for (const workout of plan.workouts) {
      await prisma.workoutTemplate.update({
        where: { id: workout.id },
        data: {
          targetDistance: workout.targetDistance ? workout.targetDistance * adjustmentFactor : null,
          targetDuration: workout.targetDuration
            ? Math.round(workout.targetDuration * adjustmentFactor)
            : null,
        },
      });
    }
  }
}
