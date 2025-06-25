// Goal type constants and TypeScript definitions
export const GOAL_TYPES = {
  DISTANCE: 'DISTANCE',
  TIME: 'TIME',
  FREQUENCY: 'FREQUENCY',
  PACE: 'PACE',
  LONGEST_RUN: 'LONGEST_RUN',
} as const;

export const GOAL_PERIODS = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
  CUSTOM: 'CUSTOM',
} as const;

export type GoalType = (typeof GOAL_TYPES)[keyof typeof GOAL_TYPES];
export type GoalPeriod = (typeof GOAL_PERIODS)[keyof typeof GOAL_PERIODS];

// Goal configuration interface
export interface Goal {
  id: string;
  userId: string;
  title: string;
  description?: string;
  type: GoalType;
  period: GoalPeriod;
  targetValue: number;
  targetUnit: string;
  startDate: Date;
  endDate: Date;
  currentValue: number;
  isCompleted: boolean;
  completedAt?: Date;
  color?: string;
  icon?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Goal creation/update interface
export interface CreateGoalData {
  title: string;
  description?: string;
  type: GoalType;
  period: GoalPeriod;
  targetValue: number;
  targetUnit: string;
  startDate: Date;
  endDate: Date;
  color?: string;
  icon?: string;
}

// Goal progress interface
export interface GoalProgress {
  goalId: string;
  currentValue: number;
  progressPercentage: number;
  isCompleted: boolean;
  remainingValue: number;
  daysRemaining: number;
  averageRequired?: number; // For time-based goals
}

// Goal type configurations
export interface GoalTypeConfig {
  type: GoalType;
  label: string;
  description: string;
  defaultUnit: string;
  units: string[];
  icon: string;
  color: string;
}

export const GOAL_TYPE_CONFIGS: Record<GoalType, GoalTypeConfig> = {
  [GOAL_TYPES.DISTANCE]: {
    type: GOAL_TYPES.DISTANCE,
    label: 'Distance Goal',
    description: 'Total distance to run over time period',
    defaultUnit: 'km',
    units: ['km', 'miles'],
    icon: '🎯',
    color: '#3b82f6',
  },
  [GOAL_TYPES.TIME]: {
    type: GOAL_TYPES.TIME,
    label: 'Time Goal',
    description: 'Total time to spend running',
    defaultUnit: 'minutes',
    units: ['minutes', 'hours'],
    icon: '⏱️',
    color: '#10b981',
  },
  [GOAL_TYPES.FREQUENCY]: {
    type: GOAL_TYPES.FREQUENCY,
    label: 'Frequency Goal',
    description: 'Number of runs to complete',
    defaultUnit: 'runs',
    units: ['runs'],
    icon: '🔄',
    color: '#f59e0b',
  },
  [GOAL_TYPES.PACE]: {
    type: GOAL_TYPES.PACE,
    label: 'Pace Goal',
    description: 'Target average pace to maintain',
    defaultUnit: 'min/km',
    units: ['min/km', 'min/mile'],
    icon: '⚡',
    color: '#8b5cf6',
  },
  [GOAL_TYPES.LONGEST_RUN]: {
    type: GOAL_TYPES.LONGEST_RUN,
    label: 'Longest Run Goal',
    description: 'Distance to achieve in a single run',
    defaultUnit: 'km',
    units: ['km', 'miles'],
    icon: '🏃‍♂️',
    color: '#ef4444',
  },
};

export const GOAL_PERIOD_CONFIGS = {
  [GOAL_PERIODS.WEEKLY]: {
    period: GOAL_PERIODS.WEEKLY,
    label: 'Weekly',
    duration: 7, // days
  },
  [GOAL_PERIODS.MONTHLY]: {
    period: GOAL_PERIODS.MONTHLY,
    label: 'Monthly',
    duration: 30, // days
  },
  [GOAL_PERIODS.YEARLY]: {
    period: GOAL_PERIODS.YEARLY,
    label: 'Yearly',
    duration: 365, // days
  },
  [GOAL_PERIODS.CUSTOM]: {
    period: GOAL_PERIODS.CUSTOM,
    label: 'Custom',
    duration: null, // Variable
  },
};
