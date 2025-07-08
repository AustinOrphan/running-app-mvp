/**
 * Shared type definitions for E2E tests
 */

export interface TestUser {
  id: string;
  email: string;
  password?: string;
}

export interface TestRun {
  id: string;
  userId: string;
  distance: number;
  duration: number;
  type: string;
  date: string;
  notes?: string;
}

export interface TestGoal {
  id: string;
  userId: string;
  title: string;
  type: string;
  target: number;
  period: string;
  deadline?: string;
}
