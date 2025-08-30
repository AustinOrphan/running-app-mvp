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

/**
 * Helper function to assert testUser is defined
 */
export function assertTestUser(testUser: TestUser | undefined): TestUser {
  if (!testUser) {
    throw new Error(
      'Test user not created - this should not happen if beforeEach hook ran correctly'
    );
  }
  return testUser;
}
