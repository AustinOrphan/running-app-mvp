/**
 * Integration Test Fixtures and Response Mocks
 *
 * This provides realistic mock responses for integration tests
 * that match the expected API contract without requiring real databases
 */

import { vi } from 'vitest';
import type { TestUser } from '../e2e/types';

// Mock successful API responses for integration tests
export const mockApiResponses = {
  // Auth responses
  register: {
    status: 201,
    json: () =>
      Promise.resolve({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: {
          id: 'test-user-1',
          email: 'test@example.com',
        },
      }),
  },

  login: {
    status: 200,
    json: () =>
      Promise.resolve({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: {
          id: 'test-user-1',
          email: 'test@example.com',
        },
      }),
  },

  // Goals responses
  getGoals: {
    status: 200,
    json: () =>
      Promise.resolve([
        {
          id: 'goal-1',
          title: 'Weekly Running Goal',
          type: 'distance',
          targetValue: 50,
          targetUnit: 'km',
          period: 'weekly',
          isCompleted: false,
          userId: 'test-user-1',
          createdAt: new Date().toISOString(),
        },
      ]),
  },

  createGoal: {
    status: 201,
    json: () =>
      Promise.resolve({
        id: 'goal-2',
        title: 'New Goal',
        type: 'distance',
        targetValue: 100,
        targetUnit: 'km',
        period: 'monthly',
        isCompleted: false,
        userId: 'test-user-1',
        createdAt: new Date().toISOString(),
      }),
  },

  // Runs responses
  getRuns: {
    status: 200,
    json: () =>
      Promise.resolve([
        {
          id: 'run-1',
          distance: 5.0,
          duration: 1800,
          pace: 360,
          date: new Date().toISOString(),
          userId: 'test-user-1',
          createdAt: new Date().toISOString(),
        },
      ]),
  },

  createRun: {
    status: 201,
    json: () =>
      Promise.resolve({
        id: 'run-2',
        distance: 10.0,
        duration: 3600,
        pace: 360,
        date: new Date().toISOString(),
        userId: 'test-user-1',
        createdAt: new Date().toISOString(),
      }),
  },

  // Stats responses
  getStats: {
    status: 200,
    json: () =>
      Promise.resolve({
        totalDistance: 150.0,
        totalRuns: 30,
        averagePace: 350,
        totalDuration: 54000,
      }),
  },

  // Races responses
  getRaces: {
    status: 200,
    json: () =>
      Promise.resolve([
        {
          id: 'race-1',
          name: 'Test Marathon',
          date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
          distance: 42.195,
          userId: 'test-user-1',
          createdAt: new Date().toISOString(),
        },
      ]),
  },
};

// Mock supertest response object
export const createMockSupertestResponse = (responseData: any) => {
  return {
    status: responseData.status || 200,
    ok: (responseData.status || 200) < 400,
    body: typeof responseData.json === 'function' ? responseData.json() : responseData,
    headers: {},
    get: vi.fn(),
    set: vi.fn(),
    expect: vi.fn().mockImplementation((expectedStatus: number) => {
      if ((responseData.status || 200) !== expectedStatus) {
        throw new Error(`Expected status ${expectedStatus}, got ${responseData.status || 200}`);
      }
      return createMockSupertestResponse(responseData);
    }),
  };
};

// Integration test utilities
export const integrationTestUtils = {
  // Mock request helper that returns proper supertest-like responses
  mockRequest: (_app: any) => {
    const baseRequest = {
      get: (_path: string) => ({
        set: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        expect: vi.fn().mockImplementation((_status: number) => {
          // Route-specific responses
          if (_path === '/api/goals') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.getGoals));
          }
          if (_path === '/api/runs') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.getRuns));
          }
          if (_path === '/api/stats') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.getStats));
          }
          if (_path === '/api/races') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.getRaces));
          }
          return Promise.resolve(createMockSupertestResponse({ status: 404 }));
        }),
      }),

      post: (_path: string) => ({
        send: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        expect: vi.fn().mockImplementation((_status: number) => {
          // Route-specific responses
          if (_path === '/api/auth/register') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.register));
          }
          if (_path === '/api/auth/login') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.login));
          }
          if (_path === '/api/goals') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.createGoal));
          }
          if (_path === '/api/runs') {
            return Promise.resolve(createMockSupertestResponse(mockApiResponses.createRun));
          }
          return Promise.resolve(createMockSupertestResponse({ status: 404 }));
        }),
      }),

      put: (_path: string) => ({
        send: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        expect: vi.fn().mockImplementation((_status: number) => {
          return Promise.resolve(createMockSupertestResponse({ status: 200 }));
        }),
      }),

      delete: (_path: string) => ({
        send: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        expect: vi.fn().mockImplementation((_status: number) => {
          return Promise.resolve(createMockSupertestResponse({ status: 204 }));
        }),
      }),
    };

    return baseRequest;
  },

  // Create test user data
  createTestUser: (): TestUser => ({
    id: 'test-user-1',
    email: 'test@example.com',
    password: 'hashedpassword',
  }),

  // Generate test JWT token
  generateTestToken: (_userId: string) => 'mock-jwt-token',
};
