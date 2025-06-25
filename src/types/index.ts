export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface Run {
  id: string;
  date: string;
  distance: number;
  duration: number;
  tag?: string;
  notes?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunFormData {
  date: string;
  distance: string;
  duration: string;
  tag: string;
  notes: string;
}

export interface User {
  id: string;
  email: string;
}

export interface WeeklyInsights {
  totalDistance: number;
  totalDuration: number;
  totalRuns: number;
  avgPace: number;
  weekStart: string;
  weekEnd: string;
}

export interface RunTypeBreakdown {
  tag: string;
  count: number;
  totalDistance: number;
  totalDuration: number;
  avgPace: number;
}

export interface TrendsDataPoint {
  date: string;
  distance: number;
  duration: number;
  pace: number;
  weeklyDistance?: number;
}

export interface PersonalRecord {
  distance: number;
  bestTime: number;
  bestPace: number;
  date: string;
  runId: string;
}
