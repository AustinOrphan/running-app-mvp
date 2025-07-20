/**
 * Integration Test Database and Infrastructure Mocking
 *
 * This module provides comprehensive mocking for integration tests to prevent:
 * - Real database connections
 * - Actual server spawning
 * - Real HTTP requests
 * - File system dependencies
 *
 * Based on Jest best practices for integration testing
 */

import { vi } from 'vitest';

// Mock Prisma Client globally
export const mockPrismaClient = {
  user: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  run: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  goal: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  race: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn(),
};

// Mock test database utilities
export const mockTestDb = {
  prisma: mockPrismaClient,
  cleanupDatabase: vi.fn().mockResolvedValue(undefined),
  createTestUser: vi.fn().mockResolvedValue({
    id: 'test-user-1',
    email: 'test@example.com',
    password: 'hashedpassword',
  }),
  createTestGoals: vi.fn().mockResolvedValue([]),
  createTestRuns: vi.fn().mockResolvedValue([]),
  generateTestToken: vi.fn().mockReturnValue('mock-jwt-token'),
};

// Mock Express app factory for integration tests
export const createMockExpressApp = () => {
  const mockApp = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    listen: vi.fn(),
    close: vi.fn(),
  };

  return mockApp;
};

// Setup integration test environment
export const setupIntegrationTestMocks = () => {
  // Mock all database-related imports
  vi.mock('../fixtures/testDatabase.js', () => ({
    testDb: mockTestDb,
  }));

  // Mock Prisma client
  vi.mock('../../lib/prisma.ts', () => ({
    prisma: mockPrismaClient,
  }));

  // Mock server routes to prevent actual server startup
  vi.mock('../../server/routes/auth.js', () => ({
    default: vi.fn(),
  }));

  vi.mock('../../server/routes/goals.js', () => ({
    default: vi.fn(),
  }));

  vi.mock('../../server/routes/runs.js', () => ({
    default: vi.fn(),
  }));

  vi.mock('../../server/routes/stats.js', () => ({
    default: vi.fn(),
  }));

  vi.mock('../../server/routes/races.js', () => ({
    default: vi.fn(),
  }));

  // Mock supertest with realistic responses
  vi.mock('supertest', async () => {
    const { integrationTestUtils } = await import('../fixtures/integrationTestFixtures');
    return {
      default: vi.fn().mockImplementation(app => integrationTestUtils.mockRequest(app)),
    };
  });

  // Mock cors
  vi.mock('cors', () => ({
    default: vi.fn().mockReturnValue(vi.fn()),
  }));

  // Mock bcrypt for auth tests
  vi.mock('bcrypt', () => ({
    hash: vi.fn().mockResolvedValue('hashedpassword'),
    compare: vi.fn().mockResolvedValue(true),
  }));

  // Mock jsonwebtoken
  vi.mock('jsonwebtoken', () => ({
    sign: vi.fn().mockReturnValue('mock-jwt-token'),
    verify: vi.fn().mockReturnValue({ userId: 'test-user-1' }),
  }));
};

// Reset all integration test mocks
export const resetIntegrationTestMocks = () => {
  Object.values(mockPrismaClient).forEach(table => {
    if (typeof table === 'object') {
      Object.values(table).forEach(method => {
        if (vi.isMockFunction(method)) {
          method.mockReset();
        }
      });
    }
  });

  Object.values(mockTestDb).forEach(method => {
    if (vi.isMockFunction(method)) {
      method.mockReset();
    }
  });
};

// Configure default successful responses for common operations
export const configureSuccessfulResponses = () => {
  // User operations
  mockPrismaClient.user.create.mockResolvedValue({
    id: 'test-user-1',
    email: 'test@example.com',
    password: 'hashedpassword',
  });

  mockPrismaClient.user.findFirst.mockResolvedValue({
    id: 'test-user-1',
    email: 'test@example.com',
    password: 'hashedpassword',
  });

  // Goal operations
  mockPrismaClient.goal.findMany.mockResolvedValue([
    {
      id: 'goal-1',
      title: 'Test Goal',
      type: 'distance',
      targetValue: 100,
      targetUnit: 'km',
      isCompleted: false,
      userId: 'test-user-1',
    },
  ]);

  // Run operations
  mockPrismaClient.run.findMany.mockResolvedValue([
    {
      id: 'run-1',
      distance: 5.0,
      duration: 1800,
      pace: 360,
      date: new Date(),
      userId: 'test-user-1',
    },
  ]);
};
