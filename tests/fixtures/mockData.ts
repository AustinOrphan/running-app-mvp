import {
  WeeklyInsights,
  RunTypeBreakdown,
  TrendsDataPoint,
  PersonalRecord,
  Run,
  User,
  Race,
} from '../../src/types';
import { Goal, GoalProgress, CreateGoalData, GoalType, GoalPeriod } from '../../src/types/goals';

// Mock User Data
export const mockUser: User = {
  id: 'user-123',
  email: 'test@example.com',
};

export const mockTestUser = {
  id: 'user-123',
  email: 'test@example.com',
  password: 'hashedpassword123',
};

// Mock Runs Data
export const mockRuns: Run[] = [
  {
    id: 'run-1',
    date: '2024-06-15',
    distance: 5.2,
    duration: 1800, // 30 minutes
    tag: 'Easy Run',
    notes: 'Morning jog',
    userId: 'user-123',
    createdAt: '2024-06-15T06:00:00Z',
    updatedAt: '2024-06-15T06:00:00Z',
  },
  {
    id: 'run-2',
    date: '2024-06-13',
    distance: 10.5,
    duration: 3000, // 50 minutes
    tag: 'Long Run',
    notes: 'Weekly long run',
    userId: 'user-123',
    createdAt: '2024-06-13T07:00:00Z',
    updatedAt: '2024-06-13T07:00:00Z',
  },
  {
    id: 'run-3',
    date: '2024-06-11',
    distance: 3.1,
    duration: 960, // 16 minutes
    tag: 'Speed Work',
    notes: 'Interval training',
    userId: 'user-123',
    createdAt: '2024-06-11T18:00:00Z',
    updatedAt: '2024-06-11T18:00:00Z',
  },
  {
    id: 'run-4',
    date: '2024-06-09',
    distance: 21.1,
    duration: 6300, // 1h 45m
    tag: 'Race',
    notes: 'Half marathon PR!',
    userId: 'user-123',
    createdAt: '2024-06-09T08:00:00Z',
    updatedAt: '2024-06-09T08:00:00Z',
  },
];

// Mock Weekly Insights
export const mockWeeklyInsights: WeeklyInsights = {
  totalDistance: 39.9,
  totalDuration: 12060, // 3h 21m
  totalRuns: 4,
  avgPace: 302, // ~5:02/km
  weekStart: '2024-06-09T00:00:00Z',
  weekEnd: '2024-06-15T23:59:59Z',
};

export const mockEmptyWeeklyInsights: WeeklyInsights = {
  totalDistance: 0,
  totalDuration: 0,
  totalRuns: 0,
  avgPace: 0,
  weekStart: '2024-06-16T00:00:00Z',
  weekEnd: '2024-06-22T23:59:59Z',
};

// Mock Run Type Breakdown
export const mockRunTypeBreakdown: RunTypeBreakdown[] = [
  {
    tag: 'Easy Run',
    count: 8,
    totalDistance: 42.5,
    totalDuration: 15300,
    avgPace: 360,
  },
  {
    tag: 'Long Run',
    count: 3,
    totalDistance: 45.2,
    totalDuration: 13680,
    avgPace: 302,
  },
  {
    tag: 'Speed Work',
    count: 4,
    totalDistance: 16.8,
    totalDuration: 4200,
    avgPace: 250,
  },
  {
    tag: 'Race',
    count: 2,
    totalDistance: 26.3,
    totalDuration: 7500,
    avgPace: 285,
  },
];

// Mock Trends Data
export const mockTrendsData: TrendsDataPoint[] = [
  {
    date: '2024-04-01',
    distance: 25.5,
    duration: 9000,
    pace: 353,
    weeklyDistance: 25.5,
  },
  {
    date: '2024-04-08',
    distance: 32.1,
    duration: 10800,
    pace: 336,
    weeklyDistance: 32.1,
  },
  {
    date: '2024-04-15',
    distance: 28.7,
    duration: 9660,
    pace: 336,
    weeklyDistance: 28.7,
  },
  {
    date: '2024-04-22',
    distance: 35.2,
    duration: 11760,
    pace: 334,
    weeklyDistance: 35.2,
  },
  {
    date: '2024-04-29',
    distance: 41.8,
    duration: 13680,
    pace: 327,
    weeklyDistance: 41.8,
  },
  {
    date: '2024-05-06',
    distance: 38.9,
    duration: 12600,
    pace: 323,
    weeklyDistance: 38.9,
  },
  {
    date: '2024-05-13',
    distance: 44.3,
    duration: 14100,
    pace: 318,
    weeklyDistance: 44.3,
  },
  {
    date: '2024-05-20',
    distance: 42.1,
    duration: 13320,
    pace: 316,
    weeklyDistance: 42.1,
  },
  {
    date: '2024-05-27',
    distance: 46.8,
    duration: 14760,
    pace: 315,
    weeklyDistance: 46.8,
  },
  {
    date: '2024-06-03',
    distance: 39.7,
    duration: 12420,
    pace: 312,
    weeklyDistance: 39.7,
  },
  {
    date: '2024-06-10',
    distance: 41.2,
    duration: 12660,
    pace: 307,
    weeklyDistance: 41.2,
  },
  {
    date: '2024-06-17',
    distance: 38.5,
    duration: 11700,
    pace: 303,
    weeklyDistance: 38.5,
  },
];

// Mock Personal Records
export const mockPersonalRecords: PersonalRecord[] = [
  {
    distance: 1,
    bestTime: 240, // 4:00
    bestPace: 240,
    date: '2024-05-15T00:00:00Z',
    runId: 'run-pr-1k',
  },
  {
    distance: 2,
    bestTime: 510, // 8:30
    bestPace: 255,
    date: '2024-04-22T00:00:00Z',
    runId: 'run-pr-2k',
  },
  {
    distance: 5,
    bestTime: 1320, // 22:00
    bestPace: 264,
    date: '2024-05-01T00:00:00Z',
    runId: 'run-pr-5k',
  },
  {
    distance: 10,
    bestTime: 2760, // 46:00
    bestPace: 276,
    date: '2024-04-10T00:00:00Z',
    runId: 'run-pr-10k',
  },
  {
    distance: 21.1,
    bestTime: 6300, // 1:45:00
    bestPace: 298,
    date: '2024-06-09T00:00:00Z',
    runId: 'run-pr-half',
  },
];

// Mock Authentication Responses
export const mockAuthResponse = {
  success: true,
  token: 'mock-jwt-token-123',
  user: mockUser,
};

export const mockAuthError = {
  success: false,
  message: 'Invalid credentials',
};

// Mock API Error Response
export const mockApiError = {
  error: 'Unauthorized',
  message: 'Invalid or expired token',
};

// Mock Form Data
export const mockRunFormData = {
  date: '2024-06-20',
  distance: '5.5',
  duration: '1980', // 33 minutes
  tag: 'Easy Run',
  notes: 'Nice weather today',
};

// Mock Loading States
export const mockLoadingStates = {
  loading: true,
  error: null,
  data: null,
};

// Mock Empty States
export const mockEmptyStates = {
  emptyRuns: [],
  emptyBreakdown: [],
  emptyTrends: [],
  emptyRecords: [],
};

// Test Utilities
export const createMockRun = (overrides: Partial<Run> = {}): Run => ({
  id: `run-${Date.now()}`,
  date: '2024-06-20',
  distance: 5.0,
  duration: 1800,
  tag: 'Easy Run',
  notes: '',
  userId: 'user-123',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: `user-${Date.now()}`,
  email: 'test@example.com',
  ...overrides,
});

export const createMockTrendsData = (weeks: number = 12): TrendsDataPoint[] => {
  return Array.from({ length: weeks }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (weeks - i) * 7);
    const distance = 20 + Math.random() * 30;
    const duration = distance * (300 + Math.random() * 60);

    return {
      date: date.toISOString().split('T')[0],
      distance: Number(distance.toFixed(1)),
      duration: Math.round(duration),
      pace: Math.round(duration / distance),
      weeklyDistance: Number(distance.toFixed(1)),
    };
  });
};

// Mock Goals Data
export const mockGoals: Goal[] = [
  {
    id: 'goal-1',
    title: 'Run 50km this month',
    description: 'Build up weekly mileage for half marathon training',
    type: 'DISTANCE' as GoalType,
    targetValue: 50,
    targetUnit: 'km',
    currentValue: 32.5,
    period: 'MONTHLY' as GoalPeriod,
    startDate: new Date('2024-06-01'),
    endDate: new Date('2024-06-30'),
    isCompleted: false,
    isActive: true,
    completedAt: undefined,
    color: '#3b82f6',
    icon: '🏃‍♂️',
    userId: 'user-123',
    createdAt: new Date('2024-06-01T00:00:00Z'),
    updatedAt: new Date('2024-06-15T12:00:00Z'),
  },
  {
    id: 'goal-2',
    title: 'Sub-25 minute 5K',
    description: 'Improve 5K personal best by 2 minutes',
    type: 'PACE' as GoalType,
    targetValue: 1500, // 25:00 in seconds
    targetUnit: 'seconds',
    currentValue: 1620, // 27:00 current best
    period: 'YEARLY' as GoalPeriod,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    isCompleted: false,
    isActive: true,
    completedAt: undefined,
    color: '#ef4444',
    icon: '⚡',
    userId: 'user-123',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-06-15T12:00:00Z'),
  },
  {
    id: 'goal-3',
    title: 'Run 3 times per week',
    description: 'Maintain consistent running schedule',
    type: 'FREQUENCY' as GoalType,
    targetValue: 3,
    targetUnit: 'runs',
    currentValue: 2,
    period: 'WEEKLY' as GoalPeriod,
    startDate: new Date('2024-06-10'),
    endDate: new Date('2024-06-16'),
    isCompleted: false,
    isActive: true,
    completedAt: undefined,
    color: '#10b981',
    icon: '🗓️',
    userId: 'user-123',
    createdAt: new Date('2024-06-10T00:00:00Z'),
    updatedAt: new Date('2024-06-15T12:00:00Z'),
  },
  {
    id: 'goal-4',
    title: 'Complete first half marathon',
    description: 'Training goal for upcoming race',
    type: 'DISTANCE' as GoalType,
    targetValue: 21.1,
    targetUnit: 'km',
    currentValue: 21.1,
    period: 'YEARLY' as GoalPeriod,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    isCompleted: true,
    isActive: true,
    completedAt: new Date('2024-06-09T10:30:00Z'),
    color: '#8b5cf6',
    icon: '🏅',
    userId: 'user-123',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-06-09T10:30:00Z'),
  },
];

export const mockGoalProgress: GoalProgress[] = [
  {
    goalId: 'goal-1',
    currentValue: 32.5,
    progressPercentage: 65,
    remainingValue: 17.5,
    daysRemaining: 15,
    isCompleted: false,
  },
  {
    goalId: 'goal-2',
    currentValue: 1620,
    progressPercentage: 12.5, // Calculated based on improvement needed
    remainingValue: 120, // Still need to improve by 2 minutes
    daysRemaining: 200,
    isCompleted: false,
  },
  {
    goalId: 'goal-3',
    currentValue: 2,
    progressPercentage: 66.7,
    remainingValue: 1,
    daysRemaining: 1,
    isCompleted: false,
  },
  {
    goalId: 'goal-4',
    currentValue: 21.1,
    progressPercentage: 100,
    remainingValue: 0,
    daysRemaining: 0,
    isCompleted: true,
  },
];

export const mockCreateGoalData: CreateGoalData = {
  title: 'New Goal',
  description: 'Test goal description',
  type: 'DISTANCE' as GoalType,
  targetValue: 25,
  targetUnit: 'km',
  period: 'WEEKLY' as GoalPeriod,
  startDate: new Date('2024-06-17'),
  endDate: new Date('2024-06-23'),
  color: '#3b82f6',
  icon: '🎯',
};

// Mock Streak Data for Goal Visualization
export const mockStreakData = [
  { date: '2024-06-01', hasActivity: true, value: 5.2 },
  { date: '2024-06-02', hasActivity: false, value: 0 },
  { date: '2024-06-03', hasActivity: true, value: 3.1 },
  { date: '2024-06-04', hasActivity: true, value: 8.0 },
  { date: '2024-06-05', hasActivity: false, value: 0 },
  { date: '2024-06-06', hasActivity: true, value: 6.2 },
  { date: '2024-06-07', hasActivity: true, value: 4.8 },
  { date: '2024-06-08', hasActivity: false, value: 0 },
  { date: '2024-06-09', hasActivity: true, value: 21.1 },
  { date: '2024-06-10', hasActivity: false, value: 0 },
  { date: '2024-06-11', hasActivity: true, value: 3.1 },
  { date: '2024-06-12', hasActivity: false, value: 0 },
  { date: '2024-06-13', hasActivity: true, value: 10.5 },
  { date: '2024-06-14', hasActivity: false, value: 0 },
  { date: '2024-06-15', hasActivity: true, value: 5.2 },
];

export const mockTimelineData = [
  { date: '2024-06-01', value: 5.2, cumulative: 5.2 },
  { date: '2024-06-03', value: 3.1, cumulative: 8.3 },
  { date: '2024-06-04', value: 8.0, cumulative: 16.3 },
  { date: '2024-06-06', value: 6.2, cumulative: 22.5 },
  { date: '2024-06-07', value: 4.8, cumulative: 27.3 },
  { date: '2024-06-09', value: 21.1, cumulative: 48.4 },
  { date: '2024-06-11', value: 3.1, cumulative: 51.5 },
  { date: '2024-06-13', value: 10.5, cumulative: 62.0 },
  { date: '2024-06-15', value: 5.2, cumulative: 67.2 },
];

// Goal Test Utilities
export const createMockGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: `goal-${Date.now()}`,
  title: 'Test Goal',
  description: 'Test goal description',
  type: 'DISTANCE' as GoalType,
  targetValue: 10,
  targetUnit: 'km',
  currentValue: 5,
  period: 'WEEKLY' as GoalPeriod,
  startDate: new Date(),
  endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  isCompleted: false,
  isActive: true,
  completedAt: undefined,
  color: '#3b82f6',
  icon: '🎯',
  userId: 'user-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockGoalProgress = (overrides: Partial<GoalProgress> = {}): GoalProgress => ({
  goalId: 'goal-1',
  currentValue: 5,
  progressPercentage: 50,
  remainingValue: 5,
  daysRemaining: 7,
  isCompleted: false,
  ...overrides,
});

export const createMockCreateGoalData = (
  overrides: Partial<CreateGoalData> = {}
): CreateGoalData => ({
  title: 'Test Goal',
  description: 'Test goal description',
  type: 'DISTANCE' as GoalType,
  targetValue: 10,
  targetUnit: 'km',
  period: 'WEEKLY' as GoalPeriod,
  startDate: new Date(),
  endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  color: '#3b82f6',
  icon: '🎯',
  ...overrides,
});

// Mock Races Data
export const mockRaces: Race[] = [
  {
    id: 'race-1',
    userId: 'user-123',
    name: 'City Half Marathon',
    raceDate: '2024-07-15',
    distance: 21.1,
    targetTime: 6300, // 1:45:00
    actualTime: undefined,
    notes: 'Training for first half marathon',
    isRegistered: true,
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-15T10:00:00Z',
  },
  {
    id: 'race-2',
    userId: 'user-123',
    name: 'Local 10K',
    raceDate: '2024-06-30',
    distance: 10,
    targetTime: 2700, // 45:00
    actualTime: 2640, // 44:00
    notes: 'Great pace improvement!',
    isRegistered: true,
    createdAt: '2024-05-15T00:00:00Z',
    updatedAt: '2024-07-01T09:00:00Z',
  },
];
