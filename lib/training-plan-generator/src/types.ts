import { TrainingZone } from './zones';

export interface TrainingPlanConfig {
  name: string;
  description?: string;
  goal: TrainingGoal;
  targetDate?: Date;
  startDate: Date;
  endDate?: Date;
  currentFitness?: FitnessAssessment;
  preferences?: TrainingPreferences;
  environment?: EnvironmentalFactors;
}

export type TrainingGoal =
  | 'FIRST_5K'
  | 'IMPROVE_5K'
  | 'FIRST_10K'
  | 'HALF_MARATHON'
  | 'MARATHON'
  | 'ULTRA'
  | 'GENERAL_FITNESS';

export interface FitnessAssessment {
  vdot?: number;
  criticalSpeed?: number;
  lactateThreshold?: number;
  runningEconomy?: number;
  weeklyMileage: number;
  longestRecentRun: number;
  trainingAge?: number; // years
  injuryHistory?: string[];
  recoveryRate?: number; // 0-100 based on HRV trends
}

export interface TrainingPreferences {
  availableDays: number[]; // 0 = Sunday, 6 = Saturday
  preferredIntensity: 'low' | 'moderate' | 'high';
  crossTraining: boolean;
  strengthTraining: boolean;
  timeConstraints?: Record<number, number>; // Day of week to available minutes
}

export interface EnvironmentalFactors {
  altitude?: number; // meters
  typicalTemperature?: number; // celsius
  humidity?: number; // percentage
  terrain: 'flat' | 'hilly' | 'mixed' | 'trail';
}

export interface TrainingPlan {
  id?: string;
  config: TrainingPlanConfig;
  blocks: TrainingBlock[];
  summary: PlanSummary;
  workouts: PlannedWorkout[];
}

export interface TrainingBlock {
  id: string;
  phase: TrainingPhase;
  startDate: Date;
  endDate: Date;
  weeks: number;
  focusAreas: string[];
  microcycles: WeeklyMicrocycle[];
}

export type TrainingPhase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';

export interface WeeklyMicrocycle {
  weekNumber: number;
  pattern: string; // e.g., "Easy-Tempo-Easy-Intervals-Rest-Long-Recovery"
  workouts: PlannedWorkout[];
  totalLoad: number;
  totalDistance: number;
  recoveryRatio: number;
}

export interface PlannedWorkout {
  id: string;
  date: Date;
  type: WorkoutType;
  name: string;
  description: string;
  workout: Workout;
  targetMetrics: WorkoutMetrics;
}

export interface Workout {
  type: WorkoutType;
  primaryZone: TrainingZone;
  segments: WorkoutSegment[];
  adaptationTarget: string;
  estimatedTSS: number;
  recoveryTime: number; // hours
}

export interface WorkoutSegment {
  duration: number; // minutes
  distance?: number; // km
  intensity: number; // percentage of max
  zone: TrainingZone;
  description: string;
  cadenceTarget?: number;
  heartRateTarget?: { min: number; max: number };
  paceTarget?: { min: number; max: number }; // min/km
}

export interface WorkoutMetrics {
  duration: number;
  distance?: number;
  tss: number;
  load: number;
  intensity: number;
}

export type WorkoutType =
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
  | 'time_trial'
  | 'cross_training'
  | 'strength';

export interface PlanSummary {
  totalWeeks: number;
  totalWorkouts: number;
  totalDistance: number;
  totalTime: number;
  peakWeeklyDistance: number;
  averageWeeklyDistance: number;
  keyWorkouts: number;
  recoveryDays: number;
  phases: PhaseSummary[];
}

export interface PhaseSummary {
  phase: TrainingPhase;
  weeks: number;
  focus: string[];
  volumeProgression: number[];
  intensityDistribution: IntensityDistribution;
}

export interface IntensityDistribution {
  easy: number; // percentage
  moderate: number;
  hard: number;
}

// Run data for analysis
export interface RunData {
  date: Date;
  distance: number; // km
  duration: number; // minutes
  avgPace?: number; // min/km
  avgHeartRate?: number;
  maxHeartRate?: number;
  elevation?: number; // meters
  effortLevel?: number; // 1-10
  notes?: string;
  temperature?: number;
  isRace?: boolean;
}

export interface RunAnalysis {
  recentRuns: RunData[];
  weeklyPatterns: WeeklyPatterns;
  fitness: FitnessMetrics;
}

export interface WeeklyPatterns {
  avgWeeklyMileage: number;
  maxWeeklyMileage: number;
  avgRunsPerWeek: number;
  consistencyScore: number; // 0-100
  optimalDays: number[];
  typicalLongRunDay: number;
}

export interface FitnessMetrics {
  vdot: number;
  criticalSpeed: number; // km/h
  runningEconomy: number; // ml/kg/km
  lactateThreshold: number; // km/h
  trainingLoad: TrainingLoad;
  injuryRisk: number; // 0-100
  recoveryScore: number; // 0-100
}

export interface TrainingLoad {
  acute: number; // 7-day
  chronic: number; // 28-day
  ratio: number; // acute:chronic
  trend: 'increasing' | 'stable' | 'decreasing';
  recommendation: string;
}
