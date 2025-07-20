/**
 * Integration Test Setup for API Tests
 *
 * This setup mocks all server dependencies to prevent real server creation
 * and database connections in integration tests.
 */

import { vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Mock all server dependencies before any imports
vi.mock('express', () => ({
  default: vi.fn(() => ({
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    listen: vi.fn(),
  })),
}));

vi.mock('cors', () => ({
  default: vi.fn(() => vi.fn()),
}));

vi.mock('supertest', () => ({
  default: vi.fn(_app => ({
    get: vi.fn().mockReturnThis(),
    post: vi.fn().mockReturnThis(),
    put: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    expect: vi.fn().mockResolvedValue({
      status: 200,
      body: { message: 'Mock response' },
    }),
  })),
}));

vi.mock('../../../server/routes/auth.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../../server/routes/goals.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../../server/routes/runs.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../../server/routes/stats.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../../server/routes/races.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../fixtures/testDatabase.js', () => ({
  testDb: {
    prisma: {
      $disconnect: vi.fn(),
    },
    cleanupDatabase: vi.fn().mockResolvedValue(undefined),
    createTestUser: vi.fn().mockResolvedValue({
      id: 'test-user-1',
      email: 'test@example.com',
    }),
    createTestGoals: vi.fn().mockResolvedValue([]),
    generateTestToken: vi.fn().mockReturnValue('mock-token'),
  },
}));

vi.mock('../../e2e/types/index.js', () => ({
  assertTestUser: vi.fn(user => user),
}));

// Mock bcrypt and JWT for auth tests
vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hashedpassword'),
  compare: vi.fn().mockResolvedValue(true),
}));

vi.mock('jsonwebtoken', () => ({
  sign: vi.fn().mockReturnValue('mock-jwt-token'),
  verify: vi.fn().mockReturnValue({ userId: 'test-user-1' }),
}));

export const mockApiResponse = (status: number, data: any) => ({
  status,
  body: data,
  ok: status < 400,
});

export const setupIntegrationApiTest = () => {
  beforeAll(() => {
    // Any global setup
  });

  afterAll(() => {
    // Any global cleanup
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
};
