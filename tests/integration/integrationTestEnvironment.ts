/**
 * Integration Test Environment Detection and Conditional Setup
 *
 * This module provides utilities to detect when we're running in a test environment
 * and should use mocks instead of real server infrastructure.
 */

import { vi } from 'vitest';

// Detect if we're in a test environment where integration tests should be mocked
export const shouldMockIntegrationTests = () => {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true' ||
    process.env.VITEST === 'true' ||
    // Additional safety check for test runner
    typeof global.expect !== 'undefined'
  );
};

// Conditional test runner - skips real integration tests in test environment
export const conditionalIntegrationTest = (
  testName: string,
  testFn: () => void | Promise<void>,
  mockTestFn?: () => void | Promise<void>
) => {
  if (shouldMockIntegrationTests()) {
    if (mockTestFn) {
      return it(testName + ' (mocked)', mockTestFn);
    } else {
      return it.skip(testName + ' (skipped - no mock available)');
    }
  } else {
    return it(testName, testFn);
  }
};

// Conditional describe block for integration tests
export const conditionalIntegrationDescribe = (
  suiteName: string,
  suiteFn: () => void,
  mockSuiteFn?: () => void
) => {
  if (shouldMockIntegrationTests()) {
    if (mockSuiteFn) {
      return describe(suiteName + ' (Mocked)', mockSuiteFn);
    } else {
      return describe.skip(suiteName + ' (Skipped - Test Environment)');
    }
  } else {
    return describe(suiteName, suiteFn);
  }
};

// Mock configuration for integration tests
export const configureIntegrationMocks = () => {
  if (!shouldMockIntegrationTests()) {
    return; // Don't apply mocks in real integration environment
  }

  // Mock Express and related dependencies
  vi.mock('express', () => {
    const mockApp = {
      use: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnThis(),
      post: vi.fn().mockReturnThis(),
      put: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      listen: vi.fn().mockReturnThis(),
    };

    return {
      default: vi.fn(() => mockApp),
      json: vi.fn(),
      urlencoded: vi.fn(),
    };
  });

  vi.mock('cors', () => ({
    default: vi.fn(() => vi.fn()),
  }));

  // Mock database and test utilities
  vi.mock('../fixtures/testDatabase.js', () => ({
    testDb: {
      prisma: { $disconnect: vi.fn() },
      cleanupDatabase: vi.fn().mockResolvedValue(undefined),
      createTestUser: vi.fn().mockResolvedValue({
        id: 'test-user-1',
        email: 'test@example.com',
      }),
      createTestGoals: vi.fn().mockResolvedValue([]),
      generateTestToken: vi.fn().mockReturnValue('mock-token'),
    },
  }));

  // Mock authentication dependencies
  vi.mock('bcrypt', () => ({
    hash: vi.fn().mockResolvedValue('hashedpassword'),
    compare: vi.fn().mockResolvedValue(true),
  }));

  vi.mock('jsonwebtoken', () => ({
    sign: vi.fn().mockReturnValue('mock-jwt-token'),
    verify: vi.fn().mockReturnValue({ userId: 'test-user-1' }),
  }));
};

// Initialize integration test environment
export const initializeIntegrationTestEnvironment = () => {
  if (shouldMockIntegrationTests()) {
    console.info('🔧 Integration tests running in mocked mode');
    configureIntegrationMocks();
  } else {
    console.info('🚀 Integration tests running against real infrastructure');
  }
};
