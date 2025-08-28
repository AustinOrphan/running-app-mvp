import { Workout, WorkoutType, WorkoutSegment } from './types';
import { TRAINING_ZONES, TrainingZone } from './zones';

/**
 * Predefined workout templates based on scientific training principles
 */
export const WORKOUT_TEMPLATES: Record<string, Workout> = {
  // Recovery Workouts
  RECOVERY_JOG: {
    type: 'recovery',
    primaryZone: TRAINING_ZONES.RECOVERY,
    segments: [
      {
        duration: 30,
        intensity: 50,
        zone: TRAINING_ZONES.RECOVERY,
        description: 'Very easy jog, focus on form',
      },
    ],
    adaptationTarget: 'Active recovery and blood flow',
    estimatedTSS: 20,
    recoveryTime: 8,
  },

  // Aerobic Base Workouts
  EASY_AEROBIC: {
    type: 'easy',
    primaryZone: TRAINING_ZONES.EASY,
    segments: [
      {
        duration: 60,
        intensity: 65,
        zone: TRAINING_ZONES.EASY,
        description: 'Conversational pace, nose breathing',
      },
    ],
    adaptationTarget: 'Aerobic base, fat oxidation, capillarization',
    estimatedTSS: 50,
    recoveryTime: 12,
  },

  LONG_RUN: {
    type: 'long_run',
    primaryZone: TRAINING_ZONES.EASY,
    segments: [
      {
        duration: 120,
        intensity: 65,
        zone: TRAINING_ZONES.EASY,
        description: 'Steady aerobic effort, maintain form',
      },
    ],
    adaptationTarget: 'Aerobic endurance, glycogen storage, mental resilience',
    estimatedTSS: 120,
    recoveryTime: 24,
  },

  // Tempo Workouts
  TEMPO_CONTINUOUS: {
    type: 'tempo',
    primaryZone: TRAINING_ZONES.TEMPO,
    segments: [
      { duration: 10, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      {
        duration: 30,
        intensity: 84,
        zone: TRAINING_ZONES.TEMPO,
        description: 'Steady tempo effort',
      },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Lactate clearance, aerobic power',
    estimatedTSS: 65,
    recoveryTime: 24,
  },

  // Threshold Workouts
  LACTATE_THRESHOLD_2X20: {
    type: 'threshold',
    primaryZone: TRAINING_ZONES.THRESHOLD,
    segments: [
      { duration: 10, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      {
        duration: 20,
        intensity: 88,
        zone: TRAINING_ZONES.THRESHOLD,
        description: 'Threshold pace',
      },
      { duration: 5, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      {
        duration: 20,
        intensity: 88,
        zone: TRAINING_ZONES.THRESHOLD,
        description: 'Threshold pace',
      },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Lactate threshold improvement',
    estimatedTSS: 90,
    recoveryTime: 36,
  },

  THRESHOLD_PROGRESSION: {
    type: 'threshold',
    primaryZone: TRAINING_ZONES.THRESHOLD,
    segments: [
      { duration: 10, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      { duration: 10, intensity: 80, zone: TRAINING_ZONES.STEADY, description: 'Build' },
      { duration: 10, intensity: 85, zone: TRAINING_ZONES.TEMPO, description: 'Tempo' },
      { duration: 10, intensity: 90, zone: TRAINING_ZONES.THRESHOLD, description: 'Threshold' },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Progressive lactate tolerance',
    estimatedTSS: 75,
    recoveryTime: 24,
  },

  // VO2max Workouts
  VO2MAX_4X4: {
    type: 'vo2max',
    primaryZone: TRAINING_ZONES.VO2_MAX,
    segments: [
      { duration: 15, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      { duration: 4, intensity: 95, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 3, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 4, intensity: 95, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 3, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 4, intensity: 95, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 3, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 4, intensity: 95, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'VO2max improvement, aerobic power',
    estimatedTSS: 100,
    recoveryTime: 48,
  },

  VO2MAX_5X3: {
    type: 'vo2max',
    primaryZone: TRAINING_ZONES.VO2_MAX,
    segments: [
      { duration: 15, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      { duration: 3, intensity: 96, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 2, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 3, intensity: 96, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 2, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 3, intensity: 96, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 2, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 3, intensity: 96, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 2, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Recovery' },
      { duration: 3, intensity: 96, zone: TRAINING_ZONES.VO2_MAX, description: 'VO2max interval' },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'VO2max and running economy',
    estimatedTSS: 95,
    recoveryTime: 48,
  },

  // Speed Workouts
  SPEED_200M_REPS: {
    type: 'speed',
    primaryZone: TRAINING_ZONES.NEUROMUSCULAR,
    segments: [
      { duration: 15, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: '200m rep' },
      { duration: 2, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Walk recovery' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: '200m rep' },
      { duration: 2, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Walk recovery' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: '200m rep' },
      { duration: 2, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Walk recovery' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: '200m rep' },
      { duration: 2, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Walk recovery' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: '200m rep' },
      { duration: 2, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Walk recovery' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: '200m rep' },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Neuromuscular power, running economy',
    estimatedTSS: 70,
    recoveryTime: 36,
  },

  // Hill Workouts
  HILL_REPEATS_6X2: {
    type: 'hill_repeats',
    primaryZone: TRAINING_ZONES.VO2_MAX,
    segments: [
      { duration: 15, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up to hills' },
      { duration: 2, intensity: 92, zone: TRAINING_ZONES.VO2_MAX, description: 'Hill repeat' },
      { duration: 3, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Jog down' },
      { duration: 2, intensity: 92, zone: TRAINING_ZONES.VO2_MAX, description: 'Hill repeat' },
      { duration: 3, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Jog down' },
      { duration: 2, intensity: 92, zone: TRAINING_ZONES.VO2_MAX, description: 'Hill repeat' },
      { duration: 3, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Jog down' },
      { duration: 2, intensity: 92, zone: TRAINING_ZONES.VO2_MAX, description: 'Hill repeat' },
      { duration: 3, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Jog down' },
      { duration: 2, intensity: 92, zone: TRAINING_ZONES.VO2_MAX, description: 'Hill repeat' },
      { duration: 3, intensity: 50, zone: TRAINING_ZONES.RECOVERY, description: 'Jog down' },
      { duration: 2, intensity: 92, zone: TRAINING_ZONES.VO2_MAX, description: 'Hill repeat' },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Power, strength, VO2max',
    estimatedTSS: 85,
    recoveryTime: 36,
  },

  // Fartlek Workouts
  FARTLEK_VARIED: {
    type: 'fartlek',
    primaryZone: TRAINING_ZONES.TEMPO,
    segments: [
      { duration: 10, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Warm-up' },
      { duration: 2, intensity: 90, zone: TRAINING_ZONES.THRESHOLD, description: 'Hard surge' },
      { duration: 3, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Easy recovery' },
      { duration: 1, intensity: 95, zone: TRAINING_ZONES.VO2_MAX, description: 'Sprint' },
      { duration: 4, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Easy recovery' },
      { duration: 3, intensity: 85, zone: TRAINING_ZONES.TEMPO, description: 'Tempo surge' },
      { duration: 2, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Easy recovery' },
      { duration: 0.5, intensity: 98, zone: TRAINING_ZONES.NEUROMUSCULAR, description: 'Sprint' },
      { duration: 4.5, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Easy recovery' },
      { duration: 10, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Speed variation, mental adaptation',
    estimatedTSS: 65,
    recoveryTime: 24,
  },

  // Progression Runs
  PROGRESSION_3_STAGE: {
    type: 'progression',
    primaryZone: TRAINING_ZONES.TEMPO,
    segments: [
      { duration: 20, intensity: 65, zone: TRAINING_ZONES.EASY, description: 'Easy start' },
      { duration: 20, intensity: 78, zone: TRAINING_ZONES.STEADY, description: 'Steady pace' },
      { duration: 20, intensity: 85, zone: TRAINING_ZONES.TEMPO, description: 'Tempo finish' },
      { duration: 5, intensity: 60, zone: TRAINING_ZONES.RECOVERY, description: 'Cool-down' },
    ],
    adaptationTarget: 'Pacing, fatigue resistance',
    estimatedTSS: 75,
    recoveryTime: 24,
  },
};

/**
 * Generate a custom workout based on parameters
 */
export function createCustomWorkout(
  type: WorkoutType,
  duration: number,
  primaryIntensity: number,
  segments?: WorkoutSegment[]
): Workout {
  // Implementation would create custom workout based on parameters
  // This is a simplified version
  const zone = getZoneForIntensity(primaryIntensity);

  return {
    type,
    primaryZone: zone,
    segments: segments || [
      {
        duration,
        intensity: primaryIntensity,
        zone,
        description: `Custom ${type} workout`,
      },
    ],
    adaptationTarget: `Custom ${type} adaptations`,
    estimatedTSS: calculateTSS(duration, primaryIntensity),
    recoveryTime: calculateRecoveryTime(type, duration, primaryIntensity),
  };
}

/**
 * Calculate Training Stress Score
 */
function calculateTSS(duration: number, intensity: number): number {
  // Simplified TSS calculation
  const intensityFactor = intensity / 100;
  return Math.round((duration * Math.pow(intensityFactor, 2) * 100) / 60);
}

/**
 * Calculate recovery time needed
 */
function calculateRecoveryTime(type: WorkoutType, duration: number, intensity: number): number {
  const baseRecovery = {
    recovery: 8,
    easy: 12,
    steady: 18,
    tempo: 24,
    threshold: 36,
    vo2max: 48,
    speed: 36,
    hill_repeats: 36,
    fartlek: 24,
    progression: 24,
    long_run: 24,
    race_pace: 36,
    time_trial: 48,
    cross_training: 12,
    strength: 24,
  };

  const base = baseRecovery[type] || 24;
  const intensityMultiplier = intensity / 80;
  const durationMultiplier = duration / 60;

  return Math.round(base * intensityMultiplier * durationMultiplier);
}

/**
 * Get appropriate zone for intensity
 */
function getZoneForIntensity(intensity: number): TrainingZone {
  if (intensity < 60) return TRAINING_ZONES.RECOVERY;
  if (intensity < 70) return TRAINING_ZONES.EASY;
  if (intensity < 80) return TRAINING_ZONES.STEADY;
  if (intensity < 87) return TRAINING_ZONES.TEMPO;
  if (intensity < 92) return TRAINING_ZONES.THRESHOLD;
  if (intensity < 97) return TRAINING_ZONES.VO2_MAX;
  return TRAINING_ZONES.NEUROMUSCULAR;
}
