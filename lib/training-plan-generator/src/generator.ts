import {
  TrainingPlanConfig,
  TrainingPlan,
  TrainingBlock,
  TrainingPhase,
  WeeklyMicrocycle,
  PlannedWorkout,
  PlanSummary,
  IntensityDistribution,
  RunData,
  FitnessAssessment,
} from './types';
import {
  PROGRESSION_RATES,
} from './constants';
import { WORKOUT_TEMPLATES } from './workouts';
import { calculateFitnessMetrics, analyzeWeeklyPatterns } from './calculator';
import { addDays, addWeeks, differenceInWeeks } from 'date-fns';

export class TrainingPlanGenerator {
  private config: TrainingPlanConfig;
  private fitness: FitnessAssessment;

  constructor(config: TrainingPlanConfig) {
    this.config = config;
    this.fitness = config.currentFitness || this.createDefaultFitness();
  }

  /**
   * Generate a complete training plan
   */
  generatePlan(): TrainingPlan {
    const blocks = this.createTrainingBlocks();
    const workouts = this.generateAllWorkouts(blocks);
    const summary = this.createPlanSummary(blocks, workouts);

    return {
      config: this.config,
      blocks,
      workouts,
      summary,
    };
  }

  /**
   * Analyze recent runs and generate a plan
   */
  static fromRunHistory(
    runs: RunData[],
    goal: TrainingPlanConfig['goal'],
    targetDate: Date
  ): TrainingPlan {
    const fitness = this.assessFitnessFromRuns(runs);
    const weeklyPatterns = analyzeWeeklyPatterns(runs);

    const config: TrainingPlanConfig = {
      name: `${goal} Training Plan`,
      goal,
      targetDate,
      startDate: new Date(),
      endDate: targetDate,
      currentFitness: fitness,
      preferences: {
        availableDays: weeklyPatterns.optimalDays,
        preferredIntensity: 'moderate',
        crossTraining: false,
        strengthTraining: false,
      },
    };

    const generator = new TrainingPlanGenerator(config);
    return generator.generatePlan();
  }

  /**
   * Create training blocks based on goal and timeline
   */
  private createTrainingBlocks(): TrainingBlock[] {
    const totalWeeks = differenceInWeeks(
      this.config.endDate || this.config.targetDate || addWeeks(this.config.startDate, 16),
      this.config.startDate
    );

    const blocks: TrainingBlock[] = [];
    const phaseDistribution = this.getPhaseDistribution(totalWeeks);

    let currentDate = this.config.startDate;
    let blockId = 1;

    // Create blocks for each phase
    Object.entries(phaseDistribution).forEach(([phase, weeks]) => {
      if (weeks > 0) {
        const block: TrainingBlock = {
          id: `block-${blockId++}`,
          phase: phase as TrainingPhase,
          startDate: currentDate,
          endDate: addWeeks(currentDate, weeks),
          weeks,
          focusAreas: this.getFocusAreas(phase as TrainingPhase),
          microcycles: [],
        };

        // Generate microcycles for this block
        block.microcycles = this.generateMicrocycles(block);
        blocks.push(block);
        currentDate = block.endDate;
      }
    });

    return blocks;
  }

  /**
   * Determine phase distribution based on total weeks and goal
   */
  private getPhaseDistribution(totalWeeks: number): Record<TrainingPhase, number> {
    const distribution: Record<TrainingPhase, number> = {
      base: 0,
      build: 0,
      peak: 0,
      taper: 0,
      recovery: 0,
    };

    if (totalWeeks <= 8) {
      // Short plan - focus on key phases
      distribution.base = Math.floor(totalWeeks * 0.4);
      distribution.build = Math.floor(totalWeeks * 0.4);
      distribution.taper = Math.floor(totalWeeks * 0.2);
    } else if (totalWeeks <= 16) {
      // Standard plan
      distribution.base = Math.floor(totalWeeks * 0.35);
      distribution.build = Math.floor(totalWeeks * 0.35);
      distribution.peak = Math.floor(totalWeeks * 0.2);
      distribution.taper = Math.floor(totalWeeks * 0.1);
    } else {
      // Long plan - include all phases
      distribution.base = Math.floor(totalWeeks * 0.3);
      distribution.build = Math.floor(totalWeeks * 0.3);
      distribution.peak = Math.floor(totalWeeks * 0.25);
      distribution.taper = Math.floor(totalWeeks * 0.1);
      distribution.recovery = Math.floor(totalWeeks * 0.05);
    }

    return distribution;
  }

  /**
   * Get focus areas for each training phase
   */
  private getFocusAreas(phase: TrainingPhase): string[] {
    const focusMap: Record<TrainingPhase, string[]> = {
      base: ['Aerobic capacity', 'Running economy', 'Injury prevention'],
      build: ['Lactate threshold', 'VO2max development', 'Race pace familiarity'],
      peak: ['Race-specific fitness', 'Speed endurance', 'Mental preparation'],
      taper: ['Recovery', 'Maintenance', 'Race readiness'],
      recovery: ['Active recovery', 'Reflection', 'Planning'],
    };

    return focusMap[phase];
  }

  /**
   * Generate weekly microcycles for a training block
   */
  private generateMicrocycles(block: TrainingBlock): WeeklyMicrocycle[] {
    const microcycles: WeeklyMicrocycle[] = [];
    const baseVolume = this.fitness.weeklyMileage;

    for (let week = 0; week < block.weeks; week++) {
      const isRecoveryWeek = (week + 1) % 4 === 0;
      const weekNumber = microcycles.length + 1;

      // Calculate weekly volume with progression
      const progressionFactor = this.calculateProgressionFactor(block.phase, week, block.weeks);
      const weeklyVolume = isRecoveryWeek
        ? baseVolume * 0.7 * progressionFactor
        : baseVolume * progressionFactor;

      // Generate workout pattern for the week
      const pattern = this.generateWeeklyPattern(block.phase, isRecoveryWeek);
      const workouts = this.generateWeeklyWorkouts(
        block,
        weekNumber,
        pattern,
        weeklyVolume,
        addWeeks(block.startDate, week)
      );

      const totalLoad = workouts.reduce((sum, w) => sum + w.workout.estimatedTSS, 0);
      const totalDistance = workouts.reduce((sum, w) => sum + (w.targetMetrics.distance || 0), 0);

      microcycles.push({
        weekNumber,
        pattern,
        workouts,
        totalLoad,
        totalDistance,
        recoveryRatio: this.calculateRecoveryRatio(workouts),
      });
    }

    return microcycles;
  }

  /**
   * Calculate progression factor for volume
   */
  private calculateProgressionFactor(
    phase: TrainingPhase,
    week: number,
    _totalWeeks: number
  ): number {
    const progressionRate =
      this.fitness.trainingAge && this.fitness.trainingAge > 2
        ? PROGRESSION_RATES.advanced
        : this.fitness.trainingAge && this.fitness.trainingAge > 1
          ? PROGRESSION_RATES.intermediate
          : PROGRESSION_RATES.beginner;

    switch (phase) {
      case 'base':
        return 1 + week * progressionRate;
      case 'build':
        return 1.2 + week * progressionRate * 0.8;
      case 'peak':
        return 1.3 + week * progressionRate * 0.5;
      case 'taper':
        return 1.0 - week * 0.2; // Reduce volume
      case 'recovery':
        return 0.6;
      default:
        return 1.0;
    }
  }

  /**
   * Generate weekly workout pattern
   */
  private generateWeeklyPattern(phase: TrainingPhase, isRecovery: boolean): string {
    if (isRecovery) {
      return 'Easy-Recovery-Easy-Recovery-Rest-Easy-Recovery';
    }

    const patterns: Record<TrainingPhase, string[]> = {
      base: [
        'Easy-Steady-Easy-Tempo-Rest-Long-Recovery',
        'Easy-Hills-Recovery-Steady-Rest-Long-Easy',
      ],
      build: [
        'Easy-Intervals-Recovery-Tempo-Rest-Long-Recovery',
        'Easy-Threshold-Recovery-Hills-Rest-Progression-Recovery',
      ],
      peak: [
        'Easy-VO2max-Recovery-RacePace-Rest-Long-Recovery',
        'Easy-Speed-Recovery-Threshold-Rest-TimeTrial-Recovery',
      ],
      taper: [
        'Easy-Tempo-Recovery-Easy-Rest-MediumLong-Recovery',
        'Easy-Strides-Recovery-Easy-Rest-Easy-Rest',
      ],
      recovery: ['Easy-Recovery-Rest-Easy-Rest-Easy-Recovery'],
    };

    const phasePatterns = patterns[phase];
    return phasePatterns[Math.floor(Math.random() * phasePatterns.length)];
  }

  /**
   * Generate workouts for a week
   */
  private generateWeeklyWorkouts(
    block: TrainingBlock,
    weekNumber: number,
    pattern: string,
    weeklyVolume: number,
    weekStart: Date
  ): PlannedWorkout[] {
    const workoutTypes = pattern.split('-');
    const workouts: PlannedWorkout[] = [];
    const availableDays = this.config.preferences?.availableDays || [0, 2, 4, 6];

    let volumeRemaining = weeklyVolume;
    let dayIndex = 0;

    workoutTypes.forEach((type, index) => {
      if (type === 'Rest') {
        return;
      }

      // Find next available day
      while (!availableDays.includes(dayIndex % 7)) {
        dayIndex++;
      }

      const date = addDays(weekStart, dayIndex);
      const workout = this.selectWorkout(type, block.phase, volumeRemaining);
      const targetDistance = this.calculateWorkoutDistance(
        workout,
        volumeRemaining,
        workoutTypes.length - index
      );

      workouts.push({
        id: `workout-${weekNumber}-${index + 1}`,
        date,
        type: workout.type,
        name: this.generateWorkoutName(workout.type, block.phase),
        description: this.generateWorkoutDescription(workout),
        workout,
        targetMetrics: {
          duration: workout.segments.reduce((sum: number, s: any) => sum + s.duration, 0),
          distance: targetDistance,
          tss: workout.estimatedTSS,
          load: workout.estimatedTSS,
          intensity:
            workout.segments.reduce((sum: number, s: any) => sum + s.intensity, 0) /
            workout.segments.length,
        },
      });

      volumeRemaining -= targetDistance;
      dayIndex++;
    });

    return workouts;
  }

  /**
   * Select appropriate workout based on type string
   */
  private selectWorkout(typeString: string, _phase: TrainingPhase, _volumeRemaining: number): any {
    const workoutMap: Record<string, string[]> = {
      Easy: ['EASY_AEROBIC'],
      Recovery: ['RECOVERY_JOG'],
      Steady: ['EASY_AEROBIC'],
      Tempo: ['TEMPO_CONTINUOUS'],
      Threshold: ['LACTATE_THRESHOLD_2X20', 'THRESHOLD_PROGRESSION'],
      Intervals: ['VO2MAX_4X4', 'VO2MAX_5X3'],
      Hills: ['HILL_REPEATS_6X2'],
      Long: ['LONG_RUN'],
      Progression: ['PROGRESSION_3_STAGE'],
      VO2max: ['VO2MAX_4X4', 'VO2MAX_5X3'],
      Speed: ['SPEED_200M_REPS'],
      RacePace: ['TEMPO_CONTINUOUS'],
      TimeTrial: ['THRESHOLD_PROGRESSION'],
      MediumLong: ['EASY_AEROBIC'],
      Strides: ['SPEED_200M_REPS'],
    };

    const templates = workoutMap[typeString] || ['EASY_AEROBIC'];
    const templateName = templates[Math.floor(Math.random() * templates.length)];

    return { ...WORKOUT_TEMPLATES[templateName] };
  }

  /**
   * Calculate workout distance based on time and remaining volume
   */
  private calculateWorkoutDistance(
    workout: any,
    volumeRemaining: number,
    workoutsLeft: number
  ): number {
    const totalMinutes = workout.segments.reduce((sum: number, s: any) => sum + s.duration, 0);
    const avgIntensity =
      workout.segments.reduce((sum: number, s: any) => sum + s.intensity, 0) /
      workout.segments.length;

    // Estimate pace based on intensity and fitness
    const thresholdPace = 5.0; // min/km at threshold (simplified)
    const workoutPace = thresholdPace / (avgIntensity / 88); // Scale from threshold

    const estimatedDistance = totalMinutes / workoutPace;
    const targetDistance = Math.min(estimatedDistance, volumeRemaining / workoutsLeft);

    return Math.round(targetDistance * 10) / 10;
  }

  /**
   * Generate all workouts from blocks
   */
  private generateAllWorkouts(blocks: TrainingBlock[]): PlannedWorkout[] {
    return blocks.flatMap(block => block.microcycles.flatMap(cycle => cycle.workouts));
  }

  /**
   * Create plan summary
   */
  private createPlanSummary(blocks: TrainingBlock[], workouts: PlannedWorkout[]): PlanSummary {
    const phases = blocks.map(block => ({
      phase: block.phase,
      weeks: block.weeks,
      focus: block.focusAreas,
      volumeProgression: block.microcycles.map(m => m.totalDistance),
      intensityDistribution: this.calculateIntensityDistribution(
        block.microcycles.flatMap(m => m.workouts)
      ),
    }));

    const weeklyDistances = blocks.flatMap(b => b.microcycles.map(m => m.totalDistance));

    return {
      totalWeeks: blocks.reduce((sum, b) => sum + b.weeks, 0),
      totalWorkouts: workouts.length,
      totalDistance: workouts.reduce((sum, w) => sum + (w.targetMetrics.distance || 0), 0),
      totalTime: workouts.reduce((sum, w) => sum + w.targetMetrics.duration, 0),
      peakWeeklyDistance: Math.max(...weeklyDistances),
      averageWeeklyDistance:
        weeklyDistances.reduce((sum, d) => sum + d, 0) / weeklyDistances.length,
      keyWorkouts: workouts.filter(w => ['threshold', 'vo2max', 'race_pace'].includes(w.type))
        .length,
      recoveryDays: workouts.filter(w => w.type === 'recovery').length,
      phases,
    };
  }

  /**
   * Calculate intensity distribution for workouts
   */
  private calculateIntensityDistribution(workouts: PlannedWorkout[]): IntensityDistribution {
    let easy = 0;
    let moderate = 0;
    let hard = 0;

    workouts.forEach(workout => {
      const intensity = workout.targetMetrics.intensity;
      if (intensity < 75) easy++;
      else if (intensity < 88) moderate++;
      else hard++;
    });

    const total = workouts.length;
    return {
      easy: Math.round((easy / total) * 100),
      moderate: Math.round((moderate / total) * 100),
      hard: Math.round((hard / total) * 100),
    };
  }

  /**
   * Calculate recovery ratio for a set of workouts
   */
  private calculateRecoveryRatio(workouts: PlannedWorkout[]): number {
    const recoveryWorkouts = workouts.filter(w => w.type === 'recovery' || w.type === 'easy');
    return recoveryWorkouts.length / workouts.length;
  }

  /**
   * Generate workout name
   */
  private generateWorkoutName(type: string, phase: TrainingPhase): string {
    const nameMap: Record<string, string> = {
      recovery: 'Recovery Run',
      easy: 'Easy Aerobic Run',
      steady: 'Steady State Run',
      tempo: 'Tempo Run',
      threshold: 'Lactate Threshold Workout',
      vo2max: 'VO2max Intervals',
      speed: 'Speed Development',
      hill_repeats: 'Hill Repeats',
      fartlek: 'Fartlek Run',
      progression: 'Progression Run',
      long_run: 'Long Run',
      race_pace: 'Race Pace Practice',
      time_trial: 'Time Trial',
    };

    return `${phase.charAt(0).toUpperCase() + phase.slice(1)} Phase: ${nameMap[type] || 'Training Run'}`;
  }

  /**
   * Generate workout description
   */
  private generateWorkoutDescription(workout: any): string {
    const segments = workout.segments
      .map((s: any) => `${s.duration}min ${s.description}`)
      .join(', ');
    return `${workout.adaptationTarget}. Workout: ${segments}`;
  }

  /**
   * Create default fitness assessment
   */
  private createDefaultFitness(): FitnessAssessment {
    return {
      weeklyMileage: 30,
      longestRecentRun: 10,
      vdot: 40,
      trainingAge: 1,
    };
  }

  /**
   * Assess fitness from run history
   */
  private static assessFitnessFromRuns(runs: RunData[]): FitnessAssessment {
    const metrics = calculateFitnessMetrics(runs);
    const patterns = analyzeWeeklyPatterns(runs);

    return {
      vdot: metrics.vdot,
      criticalSpeed: metrics.criticalSpeed,
      runningEconomy: metrics.runningEconomy,
      lactateThreshold: metrics.lactateThreshold,
      weeklyMileage: patterns.avgWeeklyMileage,
      longestRecentRun: Math.max(...runs.map(r => r.distance)),
      trainingAge: 1, // Would need more data to calculate
      recoveryRate: metrics.recoveryScore,
    };
  }
}
