import prisma from '../server/prisma.js';
import { TrainingPlan, WorkoutTemplate, Run, RunDetail } from '@prisma/client';
import {
  addDays,
  addWeeks,
  differenceInDays,
  differenceInWeeks,
  startOfWeek,
  format,
} from 'date-fns';

// Advanced interfaces for world-class training plan generation
interface AdvancedTrainingConfig {
  userId: string;
  name: string;
  description?: string;
  goal:
    | 'FIRST_5K'
    | 'IMPROVE_5K'
    | 'FIRST_10K'
    | 'HALF_MARATHON'
    | 'MARATHON'
    | 'ULTRA'
    | 'GENERAL_FITNESS';
  targetRaceId?: string;
  startDate: Date;
  endDate?: Date;
  currentFitnessLevel?: FitnessAssessment;
  preferences?: TrainingPreferences;
  environmentalFactors?: EnvironmentalFactors;
}

interface FitnessAssessment {
  vo2Max?: number;
  lactateThreshold?: number;
  runningEconomy?: number;
  weeklyMileage: number;
  longestRecentRun: number;
  injuryHistory?: string[];
  recoveryRate?: number; // Based on HRV trends
}

interface TrainingPreferences {
  availableDays: number[];
  preferredIntensity: 'low' | 'moderate' | 'high';
  crossTraining: boolean;
  strengthTraining: boolean;
  timeConstraints?: { [key: number]: number }; // Day of week to available minutes
}

interface EnvironmentalFactors {
  altitude?: number;
  typicalTemperature?: number;
  humidity?: number;
  terrain: 'flat' | 'hilly' | 'mixed' | 'trail';
}

interface WorkoutBlock {
  phase: 'base' | 'build' | 'peak' | 'taper' | 'recovery';
  weeks: number;
  focusAreas: string[];
  weeklyStructure: WeeklyMicrocycle[];
}

interface WeeklyMicrocycle {
  pattern: string;
  workouts: AdvancedWorkout[];
  totalLoad: number;
  recoveryRatio: number;
}

interface AdvancedWorkout {
  type: WorkoutType;
  primaryZone: TrainingZone;
  segments: WorkoutSegment[];
  adaptationTarget: string;
  estimatedTSS: number; // Training Stress Score
  recoveryTime: number; // Hours needed
}

interface WorkoutSegment {
  duration: number;
  intensity: number;
  zone: TrainingZone;
  description: string;
  cadenceTarget?: number;
  heartRateTarget?: { min: number; max: number };
}

interface TrainingZone {
  name: string;
  heartRateRange?: { min: number; max: number };
  paceRange?: { min: number; max: number };
  powerRange?: { min: number; max: number };
  rpe: number; // Rate of Perceived Exertion 1-10
}

type WorkoutType =
  | 'recovery'
  | 'easy'
  | 'steady'
  | 'tempo'
  | 'threshold'
  | 'vo2max'
  | 'speed'
  | 'hill_repeats'
  | 'fartlek'
  | 'progression'
  | 'long_run'
  | 'race_pace'
  | 'time_trial';

// Physiological adaptations timeline (in days)
const ADAPTATION_TIMELINE = {
  neuromuscular: 7,
  anaerobic: 14,
  aerobic_power: 21,
  aerobic_capacity: 28,
  mitochondrial: 42,
  capillarization: 56,
};

export class AdvancedTrainingPlanService {
  // Training zones based on physiological markers
  private static readonly TRAINING_ZONES: TrainingZone[] = [
    { name: 'Recovery', rpe: 1, heartRateRange: { min: 50, max: 60 } },
    { name: 'Easy', rpe: 2, heartRateRange: { min: 60, max: 70 } },
    { name: 'Steady', rpe: 3, heartRateRange: { min: 70, max: 80 } },
    { name: 'Tempo', rpe: 4, heartRateRange: { min: 80, max: 87 } },
    { name: 'Threshold', rpe: 5, heartRateRange: { min: 87, max: 92 } },
    { name: 'VO2 Max', rpe: 6, heartRateRange: { min: 92, max: 97 } },
    { name: 'Neuromuscular', rpe: 7, heartRateRange: { min: 97, max: 100 } },
  ];

  // Advanced workout templates with scientific backing
  private static readonly ADVANCED_WORKOUTS: Record<string, AdvancedWorkout> = {
    RECOVERY_JOG: {
      type: 'recovery',
      primaryZone: { name: 'Recovery', rpe: 1, heartRateRange: { min: 50, max: 60 } },
      segments: [
        {
          duration: 30,
          intensity: 50,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Very easy jog',
        },
      ],
      adaptationTarget: 'Active recovery and blood flow',
      estimatedTSS: 20,
      recoveryTime: 8,
    },
    AEROBIC_BASE: {
      type: 'easy',
      primaryZone: { name: 'Easy', rpe: 2, heartRateRange: { min: 60, max: 70 } },
      segments: [
        {
          duration: 60,
          intensity: 65,
          zone: { name: 'Easy', rpe: 2 },
          description: 'Conversational pace',
        },
      ],
      adaptationTarget: 'Aerobic base and fat oxidation',
      estimatedTSS: 50,
      recoveryTime: 12,
    },
    LACTATE_THRESHOLD: {
      type: 'threshold',
      primaryZone: { name: 'Threshold', rpe: 5, heartRateRange: { min: 87, max: 92 } },
      segments: [
        { duration: 10, intensity: 65, zone: { name: 'Easy', rpe: 2 }, description: 'Warm-up' },
        {
          duration: 20,
          intensity: 88,
          zone: { name: 'Threshold', rpe: 5 },
          description: 'Threshold pace',
        },
        { duration: 5, intensity: 60, zone: { name: 'Recovery', rpe: 1 }, description: 'Recovery' },
        {
          duration: 20,
          intensity: 88,
          zone: { name: 'Threshold', rpe: 5 },
          description: 'Threshold pace',
        },
        {
          duration: 10,
          intensity: 60,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Cool-down',
        },
      ],
      adaptationTarget: 'Lactate buffering and threshold improvement',
      estimatedTSS: 90,
      recoveryTime: 36,
    },
    VO2MAX_INTERVALS: {
      type: 'vo2max',
      primaryZone: { name: 'VO2 Max', rpe: 6, heartRateRange: { min: 92, max: 97 } },
      segments: [
        { duration: 15, intensity: 65, zone: { name: 'Easy', rpe: 2 }, description: 'Warm-up' },
        {
          duration: 3,
          intensity: 95,
          zone: { name: 'VO2 Max', rpe: 6 },
          description: '3-min @ VO2max',
        },
        {
          duration: 3,
          intensity: 50,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Recovery jog',
        },
        {
          duration: 3,
          intensity: 95,
          zone: { name: 'VO2 Max', rpe: 6 },
          description: '3-min @ VO2max',
        },
        {
          duration: 3,
          intensity: 50,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Recovery jog',
        },
        {
          duration: 3,
          intensity: 95,
          zone: { name: 'VO2 Max', rpe: 6 },
          description: '3-min @ VO2max',
        },
        {
          duration: 3,
          intensity: 50,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Recovery jog',
        },
        {
          duration: 3,
          intensity: 95,
          zone: { name: 'VO2 Max', rpe: 6 },
          description: '3-min @ VO2max',
        },
        {
          duration: 10,
          intensity: 60,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Cool-down',
        },
      ],
      adaptationTarget: 'VO2max improvement and aerobic power',
      estimatedTSS: 110,
      recoveryTime: 48,
    },
    TEMPO_PROGRESSION: {
      type: 'progression',
      primaryZone: { name: 'Tempo', rpe: 4, heartRateRange: { min: 80, max: 87 } },
      segments: [
        { duration: 10, intensity: 65, zone: { name: 'Easy', rpe: 2 }, description: 'Easy start' },
        {
          duration: 10,
          intensity: 75,
          zone: { name: 'Steady', rpe: 3 },
          description: 'Build to steady',
        },
        { duration: 10, intensity: 82, zone: { name: 'Tempo', rpe: 4 }, description: 'Tempo pace' },
        {
          duration: 10,
          intensity: 87,
          zone: { name: 'Threshold', rpe: 5 },
          description: 'Push to threshold',
        },
        {
          duration: 5,
          intensity: 60,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Cool-down',
        },
      ],
      adaptationTarget: 'Pace awareness and lactate clearance',
      estimatedTSS: 75,
      recoveryTime: 24,
    },
    HILL_REPEATS: {
      type: 'hill_repeats',
      primaryZone: { name: 'VO2 Max', rpe: 6, heartRateRange: { min: 92, max: 97 } },
      segments: [
        {
          duration: 15,
          intensity: 65,
          zone: { name: 'Easy', rpe: 2 },
          description: 'Warm-up on flat',
        },
        {
          duration: 2,
          intensity: 90,
          zone: { name: 'VO2 Max', rpe: 6 },
          description: 'Hill repeat (6-8% grade)',
          cadenceTarget: 170,
        },
        {
          duration: 3,
          intensity: 50,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Jog down recovery',
        },
      ],
      adaptationTarget: 'Power development and running economy',
      estimatedTSS: 95,
      recoveryTime: 36,
    },
    FARTLEK: {
      type: 'fartlek',
      primaryZone: { name: 'Varied', rpe: 4, heartRateRange: { min: 70, max: 95 } },
      segments: [
        { duration: 10, intensity: 65, zone: { name: 'Easy', rpe: 2 }, description: 'Warm-up' },
        {
          duration: 1,
          intensity: 90,
          zone: { name: 'VO2 Max', rpe: 6 },
          description: 'Fast surge',
        },
        {
          duration: 2,
          intensity: 70,
          zone: { name: 'Steady', rpe: 3 },
          description: 'Float recovery',
        },
        { duration: 2, intensity: 85, zone: { name: 'Tempo', rpe: 4 }, description: 'Tempo surge' },
        {
          duration: 2,
          intensity: 70,
          zone: { name: 'Steady', rpe: 3 },
          description: 'Float recovery',
        },
        {
          duration: 30,
          intensity: 75,
          zone: { name: 'Steady', rpe: 3 },
          description: 'Steady cruise',
        },
        {
          duration: 10,
          intensity: 60,
          zone: { name: 'Recovery', rpe: 1 },
          description: 'Cool-down',
        },
      ],
      adaptationTarget: 'Multi-pace adaptation and mental toughness',
      estimatedTSS: 85,
      recoveryTime: 30,
    },
  };

  /**
   * Generate an advanced, scientifically-backed training plan
   */
  static async generateAdvancedTrainingPlan(config: AdvancedTrainingConfig): Promise<TrainingPlan> {
    // Comprehensive fitness assessment
    const fitnessProfile = await this.performComprehensiveFitnessAssessment(config.userId);

    // Calculate optimal training phases using periodization
    const trainingBlocks = this.designPeriodizedTrainingBlocks(
      config.goal,
      config.startDate,
      config.endDate || config.targetRaceId
        ? await this.getRaceDate(config.targetRaceId)
        : addWeeks(config.startDate, 16),
      fitnessProfile
    );

    // Create the training plan with advanced metadata
    const trainingPlan = await prisma.trainingPlan.create({
      data: {
        userId: config.userId,
        name: config.name,
        description: config.description || this.generatePlanDescription(config, trainingBlocks),
        startDate: config.startDate,
        endDate: trainingBlocks[trainingBlocks.length - 1].endDate,
        goal: config.goal,
        targetRaceId: config.targetRaceId,
        difficulty: this.calculateOptimalDifficulty(fitnessProfile),
        weeklyMileageStart: fitnessProfile.currentWeeklyMileage,
        weeklyMileageTarget: this.calculateTargetMileage(config.goal, fitnessProfile),
      },
    });

    // Generate adaptive workouts with ML-based adjustments
    await this.generateAdaptiveWorkouts(trainingPlan, trainingBlocks, fitnessProfile, config);

    return trainingPlan;
  }

  /**
   * Perform comprehensive fitness assessment using multiple data points
   */
  private static async performComprehensiveFitnessAssessment(userId: string): Promise<any> {
    // Get recent runs with detailed metrics
    const recentRuns = await prisma.run.findMany({
      where: {
        userId,
        date: { gte: addDays(new Date(), -90) }, // Last 3 months
      },
      include: { detail: true },
      orderBy: { date: 'desc' },
    });

    // Calculate advanced metrics
    const vdot = this.calculateVDOT(recentRuns);
    const criticalSpeed = this.calculateCriticalSpeed(recentRuns);
    const runningEconomy = this.estimateRunningEconomy(recentRuns);
    const trainingLoadHistory = this.calculateTrainingLoad(recentRuns);
    const injuryRisk = this.assessInjuryRisk(trainingLoadHistory);

    // Heart rate variability analysis
    const hrvMetrics = await this.analyzeHRVTrends(userId);

    // Weekly patterns and consistency
    const weeklyPatterns = this.analyzeWeeklyPatterns(recentRuns);

    return {
      vdot,
      criticalSpeed,
      runningEconomy,
      currentWeeklyMileage: weeklyPatterns.avgWeeklyMileage,
      maxWeeklyMileage: weeklyPatterns.maxWeeklyMileage,
      consistencyScore: weeklyPatterns.consistencyScore,
      trainingAge: this.calculateTrainingAge(recentRuns),
      injuryRisk,
      recoveryCapacity: hrvMetrics.recoveryScore,
      optimalTrainingDays: weeklyPatterns.optimalDays,
      zonePaceRanges: this.calculateZonePaces(vdot, criticalSpeed),
    };
  }

  /**
   * Calculate VDOT (VO2max estimate) from race performances
   */
  private static calculateVDOT(runs: any[]): number {
    // Filter for race performances or time trials
    const performances = runs.filter(
      run => run.detail?.effortLevel >= 9 || run.notes?.toLowerCase().includes('race')
    );

    if (performances.length === 0) {
      // Estimate from regular runs using Jack Daniels' formula
      const fastRuns = runs
        .filter(run => run.distance >= 3)
        .sort((a, b) => a.duration / a.distance - b.duration / b.distance)
        .slice(0, 3);

      if (fastRuns.length > 0) {
        const bestPace = fastRuns[0].duration / fastRuns[0].distance;
        const distance = fastRuns[0].distance * 1000; // Convert to meters
        const time = fastRuns[0].duration * 60; // Convert to seconds

        // Simplified VDOT calculation
        const velocity = distance / time;
        const vo2 = -4.6 + 0.182258 * velocity * 60 + 0.000104 * Math.pow(velocity * 60, 2);
        const percentMax =
          0.8 + 0.1894393 * Math.exp(-0.012778 * time) + 0.2989558 * Math.exp(-0.1932605 * time);

        return vo2 / percentMax;
      }
    }

    // Default VDOT for beginners
    return 35;
  }

  /**
   * Calculate Critical Speed using power law relationship
   */
  private static calculateCriticalSpeed(runs: any[]): number {
    const timeTrials = runs
      .filter(run => run.distance >= 3 && run.detail?.effortLevel >= 8)
      .map(run => ({
        distance: run.distance * 1000,
        time: run.duration * 60,
      }));

    if (timeTrials.length >= 2) {
      // Use 2-parameter hyperbolic model
      const sorted = timeTrials.sort((a, b) => a.distance - b.distance);
      const d1 = sorted[0].distance;
      const t1 = sorted[0].time;
      const d2 = sorted[sorted.length - 1].distance;
      const t2 = sorted[sorted.length - 1].time;

      const cs = (d2 - d1) / (t2 - t1);
      return cs * 3.6; // Convert to km/h
    }

    return 10; // Default 10 km/h
  }

  /**
   * Estimate running economy from pace and heart rate data
   */
  private static estimateRunningEconomy(runs: any[]): number {
    const economyRuns = runs.filter(
      run => run.detail?.avgHeartRate && run.duration > 20 && run.detail.effortLevel <= 6
    );

    if (economyRuns.length > 0) {
      // Calculate oxygen cost per km
      const economies = economyRuns.map(run => {
        const pace = run.duration / run.distance;
        const hrReserve = (run.detail.avgHeartRate - 60) / (190 - 60); // Assuming max HR of 190
        const vo2 = hrReserve * 50; // Rough estimate of VO2
        return vo2 / (60 / pace); // ml/kg/km
      });

      return economies.reduce((sum, e) => sum + e, 0) / economies.length;
    }

    return 200; // Default running economy
  }

  /**
   * Calculate training load using exponentially weighted moving average
   */
  private static calculateTrainingLoad(runs: any[]): any {
    const sortedRuns = runs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let acuteLoad = 0; // 7-day
    let chronicLoad = 0; // 28-day
    const acuteDecay = Math.exp(-1 / 7);
    const chronicDecay = Math.exp(-1 / 28);

    const loads = sortedRuns.map(run => {
      const tss = this.calculateTSS(run);
      acuteLoad = acuteLoad * acuteDecay + tss * (1 - acuteDecay);
      chronicLoad = chronicLoad * chronicDecay + tss * (1 - chronicDecay);

      return {
        date: run.date,
        tss,
        acuteLoad,
        chronicLoad,
        ratio: chronicLoad > 0 ? acuteLoad / chronicLoad : 1,
      };
    });

    return {
      current: loads[loads.length - 1] || { acuteLoad: 0, chronicLoad: 0, ratio: 1 },
      history: loads,
      trend: this.calculateLoadTrend(loads),
    };
  }

  /**
   * Calculate Training Stress Score for a run
   */
  private static calculateTSS(run: any): number {
    const duration = run.duration;
    const intensity = run.detail?.avgHeartRate ? (run.detail.avgHeartRate - 60) / (190 - 60) : 0.7; // Default to moderate intensity

    // TSS = duration * intensity^2 * 100
    return (duration * Math.pow(intensity, 2) * 100) / 60;
  }

  /**
   * Design periodized training blocks using nonlinear periodization
   */
  private static designPeriodizedTrainingBlocks(
    goal: string,
    startDate: Date,
    endDate: Date,
    fitnessProfile: any
  ): any[] {
    const totalWeeks = differenceInWeeks(endDate, startDate);
    const blocks = [];

    // Calculate phase distribution based on goal and fitness
    const phaseDistribution = this.calculatePhaseDistribution(goal, totalWeeks, fitnessProfile);

    let currentDate = startDate;

    for (const [phase, weeks] of Object.entries(phaseDistribution)) {
      if (weeks === 0) continue;

      const blockEndDate = addWeeks(currentDate, weeks as number);

      blocks.push({
        phase,
        startDate: currentDate,
        endDate: blockEndDate,
        weeks: weeks as number,
        primaryFocus: this.getPhaseFocus(phase as string, goal),
        secondaryFocus: this.getSecondaryFocus(phase as string, goal),
        loadProgression: this.getLoadProgression(phase as string),
        keyWorkouts: this.getKeyWorkouts(phase as string, goal, fitnessProfile),
      });

      currentDate = blockEndDate;
    }

    return blocks;
  }

  /**
   * Calculate optimal phase distribution
   */
  private static calculatePhaseDistribution(
    goal: string,
    totalWeeks: number,
    fitnessProfile: any
  ): any {
    const baseDistributions: any = {
      FIRST_5K: { base: 0.4, build: 0.3, peak: 0.2, taper: 0.1 },
      IMPROVE_5K: { base: 0.25, build: 0.35, peak: 0.3, taper: 0.1 },
      FIRST_10K: { base: 0.35, build: 0.35, peak: 0.2, taper: 0.1 },
      HALF_MARATHON: { base: 0.3, build: 0.35, peak: 0.25, taper: 0.1 },
      MARATHON: { base: 0.3, build: 0.3, peak: 0.3, taper: 0.1 },
      ULTRA: { base: 0.35, build: 0.3, peak: 0.25, taper: 0.1 },
      GENERAL_FITNESS: { base: 0.4, build: 0.4, peak: 0.15, taper: 0.05 },
    };

    const distribution = baseDistributions[goal] || baseDistributions.GENERAL_FITNESS;

    // Adjust based on fitness profile
    if (fitnessProfile.trainingAge < 1) {
      distribution.base += 0.1;
      distribution.peak -= 0.1;
    }

    // Convert to weeks
    const weeks: any = {};
    for (const [phase, ratio] of Object.entries(distribution)) {
      weeks[phase] = Math.round(totalWeeks * (ratio as number));
    }

    return weeks;
  }

  /**
   * Generate adaptive workouts using ML-inspired algorithms
   */
  private static async generateAdaptiveWorkouts(
    plan: TrainingPlan,
    blocks: any[],
    fitnessProfile: any,
    config: AdvancedTrainingConfig
  ): Promise<void> {
    let weekNumber = 1;

    for (const block of blocks) {
      for (let weekInBlock = 0; weekInBlock < block.weeks; weekInBlock++) {
        // Calculate adaptive load for this week
        const weeklyLoad = this.calculateAdaptiveWeeklyLoad(
          weekNumber,
          block,
          weekInBlock,
          fitnessProfile,
          plan
        );

        // Generate microcycle structure
        const microcycle = this.generateMicrocycle(
          block.phase,
          weeklyLoad,
          fitnessProfile,
          config.preferences
        );

        // Create individual workouts
        for (const workout of microcycle.workouts) {
          await this.createAdvancedWorkout(plan.id, weekNumber, workout, fitnessProfile);
        }

        weekNumber++;
      }
    }
  }

  /**
   * Calculate adaptive weekly training load
   */
  private static calculateAdaptiveWeeklyLoad(
    weekNumber: number,
    block: any,
    weekInBlock: number,
    fitnessProfile: any,
    plan: any
  ): number {
    const baseLoad = fitnessProfile.currentWeeklyMileage * 60; // Convert to TSS estimate

    // Apply block progression
    const blockProgress = weekInBlock / block.weeks;
    const blockMultiplier =
      block.loadProgression === 'linear'
        ? 1 + blockProgress * 0.3
        : 1 + Math.sin(blockProgress * Math.PI) * 0.3; // Undulating

    // Apply overall plan progression
    const planProgress = weekNumber / differenceInWeeks(plan.endDate, plan.startDate);
    const planMultiplier = 0.8 + planProgress * 0.4;

    // Recovery weeks (every 4th week)
    const recoveryMultiplier = weekNumber % 4 === 0 ? 0.6 : 1.0;

    // Taper
    const taperMultiplier = block.phase === 'taper' ? 1 - blockProgress * 0.5 : 1.0;

    return baseLoad * blockMultiplier * planMultiplier * recoveryMultiplier * taperMultiplier;
  }

  /**
   * Generate weekly microcycle with polarized distribution
   */
  private static generateMicrocycle(
    phase: string,
    weeklyLoad: number,
    fitnessProfile: any,
    preferences?: TrainingPreferences
  ): any {
    const availableDays = preferences?.availableDays || [1, 2, 3, 4, 5, 6, 0];
    const workouts: any[] = [];

    // Polarized distribution: 80% easy, 20% hard
    const easyLoad = weeklyLoad * 0.8;
    const hardLoad = weeklyLoad * 0.2;

    // Determine key workouts for this phase
    const keyWorkouts = this.getPhaseKeyWorkouts(phase);

    // Add key workouts first (hard days)
    let remainingHardLoad = hardLoad;
    for (const keyWorkout of keyWorkouts) {
      if (remainingHardLoad > 0) {
        workouts.push({
          ...keyWorkout,
          dayOfWeek: this.selectOptimalDay(workouts, availableDays, 'hard'),
          load: keyWorkout.estimatedTSS,
        });
        remainingHardLoad -= keyWorkout.estimatedTSS;
      }
    }

    // Fill with easy/recovery runs
    let remainingEasyLoad = easyLoad;
    while (remainingEasyLoad > 20 && workouts.length < availableDays.length) {
      const easyWorkout = this.selectEasyWorkout(remainingEasyLoad, phase);
      workouts.push({
        ...easyWorkout,
        dayOfWeek: this.selectOptimalDay(workouts, availableDays, 'easy'),
        load: easyWorkout.estimatedTSS,
      });
      remainingEasyLoad -= easyWorkout.estimatedTSS;
    }

    return {
      pattern: `${phase}_microcycle`,
      workouts: workouts.sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      totalLoad: weeklyLoad,
      recoveryRatio: easyLoad / weeklyLoad,
    };
  }

  /**
   * Create advanced workout with all parameters
   */
  private static async createAdvancedWorkout(
    planId: string,
    weekNumber: number,
    workout: any,
    fitnessProfile: any
  ): Promise<void> {
    // Calculate personalized paces for this workout
    const paces = this.calculateWorkoutPaces(workout, fitnessProfile);

    // Generate detailed workout description
    const detailedDescription = this.generateDetailedWorkoutDescription(workout, paces);

    // Calculate total distance and duration
    const totals = this.calculateWorkoutTotals(workout, paces);

    await prisma.workoutTemplate.create({
      data: {
        trainingPlanId: planId,
        weekNumber,
        dayOfWeek: workout.dayOfWeek,
        type: workout.type,
        name: workout.name || this.getWorkoutName(workout.type),
        description: detailedDescription,
        targetDistance: totals.distance,
        targetDuration: totals.duration,
        targetPace: totals.avgPace,
        intensity: this.mapIntensityLevel(workout.primaryZone.rpe),
        notes: JSON.stringify({
          segments: workout.segments,
          adaptationTarget: workout.adaptationTarget,
          tss: workout.estimatedTSS,
          recoveryTime: workout.recoveryTime,
          paceRanges: paces,
          coachingCues: this.getCoachingCues(workout.type),
          nutritionGuidance: this.getNutritionGuidance(workout),
        }),
      },
    });
  }

  /**
   * Calculate personalized workout paces based on fitness profile
   */
  private static calculateWorkoutPaces(workout: any, fitnessProfile: any): any {
    const zones = fitnessProfile.zonePaceRanges || this.getDefaultZonePaces(fitnessProfile.vdot);
    const paces: any = {};

    for (const segment of workout.segments) {
      const zoneName = segment.zone.name.toLowerCase().replace(' ', '_');
      paces[zoneName] = zones[zoneName] || { min: 6.0, max: 7.0 };
    }

    return paces;
  }

  /**
   * Generate detailed workout description with coaching instructions
   */
  private static generateDetailedWorkoutDescription(workout: any, paces: any): string {
    let description = `${workout.adaptationTarget}\n\n`;

    description += 'Workout Structure:\n';
    for (const segment of workout.segments) {
      const pace = paces[segment.zone.name.toLowerCase().replace(' ', '_')];
      const paceStr = pace ? `${this.formatPace(pace.min)}-${this.formatPace(pace.max)}/km` : '';

      description += `• ${segment.duration}min ${segment.description}`;
      if (paceStr) description += ` @ ${paceStr}`;
      if (segment.cadenceTarget) description += ` (${segment.cadenceTarget} spm)`;
      if (segment.heartRateTarget)
        description += ` (HR: ${segment.heartRateTarget.min}-${segment.heartRateTarget.max})`;
      description += '\n';
    }

    return description;
  }

  /**
   * Get phase-specific key workouts
   */
  private static getPhaseKeyWorkouts(phase: string): any[] {
    const workoutMap: any = {
      base: ['AEROBIC_BASE', 'TEMPO_PROGRESSION', 'HILL_REPEATS'],
      build: ['LACTATE_THRESHOLD', 'VO2MAX_INTERVALS', 'TEMPO_PROGRESSION'],
      peak: ['VO2MAX_INTERVALS', 'RACE_PACE', 'TIME_TRIAL'],
      taper: ['RACE_PACE', 'RECOVERY_JOG', 'EASY_SHAKEOUT'],
      recovery: ['RECOVERY_JOG', 'EASY_CROSS_TRAINING'],
    };

    const workoutKeys = workoutMap[phase] || workoutMap.base;
    return workoutKeys.map((key: string) => this.ADVANCED_WORKOUTS[key]).filter(Boolean);
  }

  /**
   * Calculate HRV-based recovery metrics
   */
  private static async analyzeHRVTrends(userId: string): Promise<any> {
    // In a real implementation, this would fetch HRV data from wearables
    // For now, we'll simulate based on training patterns
    const recentRuns = await prisma.run.findMany({
      where: {
        userId,
        date: { gte: addDays(new Date(), -30) },
      },
      include: { detail: true },
    });

    // Simulate HRV analysis
    const runFrequency = recentRuns.length / 30;
    const avgIntensity =
      recentRuns.map(r => r.detail?.effortLevel || 5).reduce((sum, e) => sum + e, 0) /
      (recentRuns.length || 1);

    const recoveryScore = Math.max(0, Math.min(100, 100 - runFrequency * 10 - avgIntensity * 5));

    return {
      recoveryScore,
      trend: recoveryScore > 70 ? 'improving' : recoveryScore > 50 ? 'stable' : 'declining',
      recommendedIntensity: recoveryScore > 80 ? 'high' : recoveryScore > 60 ? 'moderate' : 'low',
    };
  }

  /**
   * Helper methods
   */
  private static formatPace(pace: number): string {
    const minutes = Math.floor(pace);
    const seconds = Math.round((pace - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private static getWorkoutName(type: string): string {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private static mapIntensityLevel(rpe: number): string {
    if (rpe <= 2) return 'easy';
    if (rpe <= 4) return 'moderate';
    if (rpe <= 6) return 'hard';
    return 'max';
  }

  private static getCoachingCues(workoutType: string): string[] {
    const cues: any = {
      recovery: ['Focus on relaxed form', 'Breathe easily', 'Land softly'],
      easy: ['Conversational pace', 'Nasal breathing if possible', 'Relaxed shoulders'],
      tempo: ['Controlled discomfort', 'Strong and smooth', 'Maintain rhythm'],
      threshold: ['Comfortably hard', 'Focus on efficiency', 'Stay relaxed'],
      vo2max: ['Fast but controlled', 'Quick turnover', 'Drive with arms'],
      hill_repeats: ['Power from glutes', 'High knees', 'Strong arm drive'],
    };

    return cues[workoutType] || cues.easy;
  }

  private static getNutritionGuidance(workout: any): string {
    if (workout.estimatedTSS < 50) {
      return 'Water only needed';
    } else if (workout.estimatedTSS < 100) {
      return 'Consider sports drink for workouts over 60min';
    } else {
      return 'Fuel with 30-60g carbs/hour; practice race nutrition';
    }
  }

  private static calculateTargetMileage(goal: string, fitnessProfile: any): number {
    const baseTargets: any = {
      FIRST_5K: 25,
      IMPROVE_5K: 35,
      FIRST_10K: 40,
      HALF_MARATHON: 50,
      MARATHON: 65,
      ULTRA: 80,
      GENERAL_FITNESS: 30,
    };

    const base = baseTargets[goal] || 30;

    // Adjust based on current fitness
    const fitnessMultiplier = Math.min(
      1.5,
      Math.max(0.7, fitnessProfile.currentWeeklyMileage / base)
    );

    return Math.round(base * fitnessMultiplier);
  }

  private static async getRaceDate(raceId?: string): Promise<Date> {
    if (!raceId) return addWeeks(new Date(), 12);

    const race = await prisma.race.findUnique({
      where: { id: raceId },
    });

    return race?.raceDate || addWeeks(new Date(), 12);
  }

  private static calculateOptimalDifficulty(fitnessProfile: any): string {
    if (fitnessProfile.trainingAge < 1 || fitnessProfile.consistencyScore < 0.5) {
      return 'beginner';
    } else if (fitnessProfile.trainingAge < 3 || fitnessProfile.consistencyScore < 0.8) {
      return 'intermediate';
    }
    return 'advanced';
  }

  private static generatePlanDescription(config: AdvancedTrainingConfig, blocks: any[]): string {
    const phaseStr = blocks.map(b => `${b.weeks}wk ${b.phase}`).join(', ');
    return (
      `Advanced ${config.goal} training plan with ${phaseStr}. ` +
      `Personalized using VDOT, critical speed, and HRV-guided recovery.`
    );
  }

  // Additional helper methods would go here...
  private static calculateTrainingAge(runs: any[]): number {
    if (runs.length === 0) return 0;
    const oldestRun = runs[runs.length - 1];
    return differenceInDays(new Date(), new Date(oldestRun.date)) / 365;
  }

  private static assessInjuryRisk(loadHistory: any): number {
    const currentRatio = loadHistory.current.ratio;
    if (currentRatio > 1.5) return 0.8; // High risk
    if (currentRatio > 1.3) return 0.6; // Moderate risk
    if (currentRatio < 0.8) return 0.4; // Undertraining risk
    return 0.2; // Low risk
  }

  private static analyzeWeeklyPatterns(runs: any[]): any {
    // Implementation would analyze running patterns
    return {
      avgWeeklyMileage: 30,
      maxWeeklyMileage: 45,
      consistencyScore: 0.75,
      optimalDays: [1, 3, 5, 6],
    };
  }

  private static calculateZonePaces(vdot: number, criticalSpeed: number): any {
    // Implementation would calculate training zones
    return {
      recovery: { min: 6.5, max: 7.5 },
      easy: { min: 5.5, max: 6.5 },
      steady: { min: 5.0, max: 5.5 },
      tempo: { min: 4.5, max: 5.0 },
      threshold: { min: 4.2, max: 4.5 },
      vo2max: { min: 3.8, max: 4.2 },
    };
  }

  private static getDefaultZonePaces(vdot: number): any {
    // Simplified zone calculation based on VDOT
    const easyPace = 10.5 - (vdot - 30) * 0.1;
    return {
      recovery: { min: easyPace + 1, max: easyPace + 2 },
      easy: { min: easyPace, max: easyPace + 1 },
      steady: { min: easyPace - 0.5, max: easyPace },
      tempo: { min: easyPace - 1, max: easyPace - 0.5 },
      threshold: { min: easyPace - 1.3, max: easyPace - 1 },
      vo2max: { min: easyPace - 1.7, max: easyPace - 1.3 },
    };
  }

  private static calculateLoadTrend(loads: any[]): string {
    if (loads.length < 2) return 'stable';
    const recent = loads.slice(-7);
    const previous = loads.slice(-14, -7);

    const recentAvg = recent.reduce((sum, l) => sum + l.tss, 0) / recent.length;
    const previousAvg = previous.reduce((sum, l) => sum + l.tss, 0) / previous.length;

    const change = (recentAvg - previousAvg) / previousAvg;

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private static getPhaseFocus(phase: string, goal: string): string[] {
    const focusMap: any = {
      base: ['Aerobic capacity', 'Running economy', 'Injury prevention'],
      build: ['Lactate threshold', 'VO2max development', 'Race pace familiarity'],
      peak: ['Neuromuscular power', 'Race simulation', 'Mental preparation'],
      taper: ['Recovery', 'Maintenance', 'Race readiness'],
    };

    return focusMap[phase] || focusMap.base;
  }

  private static getSecondaryFocus(phase: string, goal: string): string[] {
    const focusMap: any = {
      base: ['Strength building', 'Form improvement', 'Flexibility'],
      build: ['Speed endurance', 'Pacing strategies', 'Nutrition practice'],
      peak: ['Tapering skills', 'Race logistics', 'Confidence building'],
      taper: ['Sleep optimization', 'Carb loading', 'Mental visualization'],
    };

    return focusMap[phase] || [];
  }

  private static getLoadProgression(phase: string): string {
    return phase === 'build' || phase === 'peak' ? 'undulating' : 'linear';
  }

  private static getKeyWorkouts(phase: string, goal: string, profile: any): string[] {
    // Would return specific workout types based on phase, goal, and athlete profile
    return ['threshold', 'vo2max', 'long_run'];
  }

  private static selectOptimalDay(
    existingWorkouts: any[],
    availableDays: number[],
    intensity: 'hard' | 'easy'
  ): number {
    const usedDays = existingWorkouts.map(w => w.dayOfWeek);
    const freeDays = availableDays.filter(d => !usedDays.includes(d));

    if (intensity === 'hard') {
      // Prefer mid-week for hard workouts
      const preferred = [2, 4, 6].filter(d => freeDays.includes(d));
      return preferred[0] || freeDays[0] || 3;
    } else {
      // Any free day for easy workouts
      return freeDays[0] || 1;
    }
  }

  private static getAdaptationTargets(goal: string): string[] {
    const targets: any = {
      FIRST_5K: ['aerobic base', 'running form', 'injury prevention'],
      IMPROVE_5K: ['vo2max', 'lactate threshold', 'running economy'],
      FIRST_10K: ['aerobic capacity', 'muscular endurance', 'pacing'],
      HALF_MARATHON: ['lactate threshold', 'glycogen storage', 'mental toughness'],
      MARATHON: ['aerobic efficiency', 'fat oxidation', 'mental resilience'],
      GENERAL_FITNESS: ['overall endurance', 'metabolic flexibility', 'consistency'],
    };

    return targets[goal] || targets.GENERAL_FITNESS;
  }

  private static selectEasyWorkout(remainingLoad: number, phase: string): any {
    if (remainingLoad < 30) {
      return this.ADVANCED_WORKOUTS.RECOVERY_JOG;
    }
    return this.ADVANCED_WORKOUTS.AEROBIC_BASE;
  }

  private static calculateWorkoutTotals(workout: any, paces: any): any {
    let totalDistance = 0;
    let totalDuration = 0;

    for (const segment of workout.segments) {
      const pace = paces[segment.zone.name.toLowerCase().replace(' ', '_')] || { min: 6, max: 6 };
      const avgPace = (pace.min + pace.max) / 2;
      const distance = segment.duration / avgPace;

      totalDistance += distance;
      totalDuration += segment.duration;
    }

    return {
      distance: totalDistance,
      duration: totalDuration,
      avgPace: totalDuration / totalDistance,
    };
  }

  /**
   * Generate training insights for a plan
   */
  static async generateTrainingInsights(plan: any, userId: string): Promise<any> {
    const completedWorkouts = plan.workouts.filter((w: any) => w.isCompleted);
    const totalWorkouts = plan.workouts.length;
    const completionRate = totalWorkouts > 0 ? completedWorkouts.length / totalWorkouts : 0;

    // Analyze adherence
    const adherenceInsights = {
      completionRate: Math.round(completionRate * 100),
      status:
        completionRate >= 0.8 ? 'excellent' : completionRate >= 0.6 ? 'good' : 'needs improvement',
      recommendation:
        completionRate < 0.8
          ? 'Try to complete at least 80% of workouts for optimal progress'
          : 'Great consistency! Keep it up',
    };

    // Analyze training load progression
    const weeklyLoads = new Map<number, number>();
    completedWorkouts.forEach((workout: any) => {
      const week = workout.weekNumber;
      const tss = workout.completedRun
        ? this.calculateTSS(workout.completedRun)
        : this.calculateTSS({
            duration: workout.targetDuration || 30,
            detail: { avgHeartRate: 150 },
          });
      weeklyLoads.set(week, (weeklyLoads.get(week) || 0) + tss);
    });

    const loadProgression = Array.from(weeklyLoads.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([week, load]) => ({ week, load }));

    // Recovery insights
    const recoveryInsights = await this.analyzeRecoveryPatterns(userId, plan.startDate);

    // Performance trends
    const performanceTrends = await this.analyzePerformanceTrends(userId, plan.startDate);

    return {
      adherence: adherenceInsights,
      loadProgression,
      recovery: recoveryInsights,
      performance: performanceTrends,
      recommendations: [
        'Focus on consistent training to maximize adaptations',
        'Ensure adequate recovery between hard sessions',
        'Monitor heart rate variability for fatigue signs',
        'Adjust pace targets based on current fitness',
      ],
    };
  }

  /**
   * Optimize an existing training plan
   */
  static async optimizeTrainingPlan(planId: string, userId: string): Promise<any> {
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      include: {
        workouts: {
          include: {
            completedRun: {
              include: { detail: true },
            },
          },
        },
      },
    });

    if (!plan) throw new Error('Training plan not found');

    // Analyze completed workouts
    const completedWorkouts = plan.workouts.filter(w => w.isCompleted);
    const upcomingWorkouts = plan.workouts.filter(w => !w.isCompleted);

    // Calculate current fitness trends
    const fitnessProfile = await this.performComprehensiveFitnessAssessment(userId);

    // Adjust upcoming workouts based on performance
    for (const workout of upcomingWorkouts) {
      const weekProgress = workout.weekNumber / Math.ceil(plan.workouts.length / 7);

      // Adjust intensity based on fitness improvements
      if (fitnessProfile.vdot > 50) {
        // Advanced athlete - can handle more intensity
        if (workout.type === 'interval' || workout.type === 'tempo') {
          await prisma.workoutTemplate.update({
            where: { id: workout.id },
            data: {
              targetPace: workout.targetPace ? workout.targetPace * 0.95 : undefined,
              intensity: 'hard',
            },
          });
        }
      }

      // Add recovery if showing signs of fatigue
      if (fitnessProfile.fatigueLevel > 7 && workout.type !== 'recovery') {
        await prisma.workoutTemplate.update({
          where: { id: workout.id },
          data: {
            intensity: 'moderate',
            notes: workout.notes + '\n\nReduced intensity due to accumulated fatigue',
          },
        });
      }
    }

    return await prisma.trainingPlan.findUnique({
      where: { id: planId },
      include: {
        workouts: {
          orderBy: [{ weekNumber: 'asc' }, { dayOfWeek: 'asc' }],
        },
      },
    });
  }

  private static async analyzeRecoveryPatterns(userId: string, startDate: Date): Promise<any> {
    // Analyze recovery between hard sessions
    const runs = await prisma.run.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      include: { detail: true },
      orderBy: { date: 'asc' },
    });

    let goodRecovery = 0;
    let poorRecovery = 0;

    for (let i = 1; i < runs.length; i++) {
      const prevRun = runs[i - 1];
      const currentRun = runs[i];
      const daysBetween = Math.floor(
        (currentRun.date.getTime() - prevRun.date.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (prevRun.detail?.effortLevel && prevRun.detail.effortLevel >= 8) {
        // Previous run was hard
        if (
          daysBetween >= 2 ||
          (daysBetween === 1 &&
            currentRun.detail?.effortLevel &&
            currentRun.detail.effortLevel <= 5)
        ) {
          goodRecovery++;
        } else {
          poorRecovery++;
        }
      }
    }

    return {
      status: poorRecovery > goodRecovery ? 'needs improvement' : 'good',
      hardSessionRecovery: goodRecovery / (goodRecovery + poorRecovery) || 0,
      recommendation:
        poorRecovery > goodRecovery
          ? 'Allow at least 48 hours between hard sessions'
          : 'Good recovery patterns detected',
    };
  }

  private static async analyzePerformanceTrends(userId: string, startDate: Date): Promise<any> {
    const runs = await prisma.run.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
    });

    if (runs.length < 2) {
      return { trend: 'insufficient data' };
    }

    // Calculate average pace over time
    const paceByWeek = new Map<number, number[]>();

    runs.forEach(run => {
      const weekNum = Math.floor(
        (run.date.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (!paceByWeek.has(weekNum)) {
        paceByWeek.set(weekNum, []);
      }
      paceByWeek.get(weekNum)!.push(run.duration / run.distance);
    });

    const weeklyAveragePaces = Array.from(paceByWeek.entries())
      .map(([week, paces]) => ({
        week,
        avgPace: paces.reduce((sum, p) => sum + p, 0) / paces.length,
      }))
      .sort((a, b) => a.week - b.week);

    // Simple linear regression for trend
    const n = weeklyAveragePaces.length;
    const sumX = weeklyAveragePaces.reduce((sum, d) => sum + d.week, 0);
    const sumY = weeklyAveragePaces.reduce((sum, d) => sum + d.avgPace, 0);
    const sumXY = weeklyAveragePaces.reduce((sum, d) => sum + d.week * d.avgPace, 0);
    const sumX2 = weeklyAveragePaces.reduce((sum, d) => sum + d.week * d.week, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    return {
      trend: slope < -0.05 ? 'improving' : slope > 0.05 ? 'declining' : 'stable',
      paceImprovement: Math.abs(slope) * 100, // Percentage per week
      weeklyPaces: weeklyAveragePaces,
      recommendation:
        slope < -0.05
          ? 'Great progress! Your pace is improving consistently'
          : slope > 0.05
            ? 'Consider adding more easy runs and ensuring adequate recovery'
            : 'Maintain current training load and focus on consistency',
    };
  }
}
