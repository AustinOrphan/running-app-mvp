import { vi } from 'vitest';
import {
  mockGoals,
  mockWeeklyInsights,
  mockAuthResponse,
  mockGoalProgress,
} from '../fixtures/mockData';

/**
 * Factory for creating endpoint-specific mock responses
 * This replaces the generic empty array responses with realistic test data
 */
export const createEndpointMocks = () => {
  return vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    // Parse the URL to handle both absolute and relative paths
    const endpoint =
      url.includes('http://') || url.includes('https://') ? new URL(url).pathname : url;

    // Health check endpoint
    if (endpoint === '/api/health') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
        text: async () => 'ok',
      };
    }

    // Authentication endpoints
    if (endpoint === '/api/auth/login' || endpoint === '/api/auth/register') {
      const body = options?.body ? JSON.parse(options.body as string) : {};

      // Simulate validation errors
      if (!body.email || !body.password) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Email and password are required' }),
        };
      }

      // Simulate successful auth
      return {
        ok: true,
        status: 200,
        json: async () => mockAuthResponse,
      };
    }

    // Goals endpoints
    if (endpoint === '/api/goals') {
      // Check for auth header - handle both object and Headers instance
      let authHeader: string | null = null;

      if (options?.headers instanceof Headers) {
        authHeader = options.headers.get('Authorization');
      } else if (options?.headers) {
        authHeader = options.headers['Authorization'] || options.headers['authorization'];
      }

      if (!authHeader || !authHeader.includes('Bearer')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        };
      }

      // GET request - return list of goals
      if (!options?.method || options.method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => mockGoals,
        };
      }

      // POST request - create new goal
      if (options.method === 'POST') {
        const newGoal = JSON.parse(options.body as string);
        return {
          ok: true,
          status: 201,
          json: async () => ({ ...newGoal, id: `goal-${Date.now()}` }),
        };
      }
    }

    // Goal progress endpoint
    if (endpoint.match(/\/api\/goals\/\w+\/progress/)) {
      return {
        ok: true,
        status: 200,
        json: async () => mockGoalProgress[0], // Return first goal progress
      };
    }

    // Stats endpoints
    if (endpoint === '/api/stats/insights-summary') {
      // Check for auth header - handle both object and Headers instance
      let authHeader: string | null = null;

      if (options?.headers instanceof Headers) {
        authHeader = options.headers.get('Authorization');
      } else if (options?.headers) {
        authHeader = options.headers['Authorization'] || options.headers['authorization'];
      }

      if (!authHeader || !authHeader.includes('Bearer')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => mockWeeklyInsights,
      };
    }

    // Runs endpoints
    if (endpoint === '/api/runs') {
      return {
        ok: true,
        status: 200,
        json: async () => [], // Empty array for runs by default
      };
    }

    // Default fallback for unhandled endpoints
    console.warn(`Unhandled endpoint in test mock: ${endpoint}`);
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
      text: async () => 'Not found',
    };
  });
};

/**
 * Helper to create a mock that fails after N successful calls
 * Useful for testing retry logic
 */
export const createFlakeyMock = (successfulCalls = 1) => {
  let callCount = 0;

  return vi.fn().mockImplementation(async (url: string) => {
    callCount++;

    if (callCount <= successfulCalls) {
      return createEndpointMocks()(url);
    }

    // Simulate network error
    throw new Error('Network request failed');
  });
};

/**
 * Helper to create a mock with specific delay
 * Useful for testing loading states
 */
export const createDelayedMock = (delayMs = 100) => {
  const baseMock = createEndpointMocks();

  return vi.fn().mockImplementation(async (...args) => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return baseMock(...args);
  });
};
