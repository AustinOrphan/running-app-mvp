// import { jest } from '@jest/globals';

/**
 * Standard API response validation utilities
 * These utilities ensure consistent response structure across all API endpoints
 */

export interface ApiErrorResponse {
  error: true;
  message: string;
  status?: number;
  details?: any;
  timestamp?: string;
}

export interface ApiSuccessResponse {
  message?: string;
  [key: string]: any;
}

/**
 * Validate that a response follows the standard error format
 */
export function expectErrorResponse(responseBody: any, expectedMessage?: string | RegExp) {
  expect(responseBody).toHaveProperty('error', true);
  expect(responseBody).toHaveProperty('message');
  expect(typeof responseBody.message).toBe('string');

  if (expectedMessage) {
    if (typeof expectedMessage === 'string') {
      expect(responseBody.message).toContain(expectedMessage);
    } else {
      expect(responseBody.message).toMatch(expectedMessage);
    }
  }
}

/**
 * Validate that a response follows the standard success format
 */
export function expectSuccessResponse(responseBody: any, expectedMessage?: string) {
  // Should not have error: true
  expect(responseBody.error).not.toBe(true);

  if (expectedMessage) {
    expect(responseBody).toHaveProperty('message', expectedMessage);
  }
}

/**
 * Validate authentication responses (login/register)
 */
export function expectAuthResponse(responseBody: any) {
  expectSuccessResponse(responseBody);
  expect(responseBody).toHaveProperty('accessToken');
  expect(responseBody).toHaveProperty('refreshToken');
  expect(responseBody).toHaveProperty('user');
  expect(responseBody.user).toHaveProperty('id');
  expect(responseBody.user).toHaveProperty('email');
  expect(responseBody.user).not.toHaveProperty('password');

  // Validate JWT format
  expect(responseBody.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  expect(responseBody.refreshToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
}

/**
 * Validate list responses (GET endpoints that return arrays)
 */
export function expectListResponse(responseBody: any, minItems: number = 0) {
  expect(Array.isArray(responseBody)).toBe(true);
  expect(responseBody.length).toBeGreaterThanOrEqual(minItems);
}

/**
 * Validate item responses (GET/POST endpoints that return single objects)
 */
export function expectItemResponse(responseBody: any, requiredFields: string[] = ['id']) {
  expect(typeof responseBody).toBe('object');
  expect(responseBody).not.toBeNull();

  requiredFields.forEach(field => {
    expect(responseBody).toHaveProperty(field);
  });
}

/**
 * Validate goal object structure
 */
export function expectGoalResponse(responseBody: any) {
  expectItemResponse(responseBody, [
    'id',
    'title',
    'type',
    'period',
    'targetValue',
    'targetUnit',
    'startDate',
    'endDate',
    'currentValue',
    'isActive',
    'isCompleted',
    'userId',
  ]);

  // Validate types
  expect(typeof responseBody.title).toBe('string');
  expect(['DISTANCE', 'TIME', 'FREQUENCY']).toContain(responseBody.type);
  expect(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).toContain(responseBody.period);
  expect(typeof responseBody.targetValue).toBe('number');
  expect(typeof responseBody.currentValue).toBe('number');
  expect(typeof responseBody.isActive).toBe('boolean');
  expect(typeof responseBody.isCompleted).toBe('boolean');
}

/**
 * Validate run object structure
 */
export function expectRunResponse(responseBody: any) {
  expectItemResponse(responseBody, ['id', 'date', 'distance', 'duration', 'userId']);

  // Validate types
  expect(typeof responseBody.distance).toBe('number');
  expect(typeof responseBody.duration).toBe('number');
  expect(responseBody.distance).toBeGreaterThan(0);
  expect(responseBody.duration).toBeGreaterThan(0);
}

/**
 * Validate user object structure (without sensitive data)
 */
export function expectUserResponse(responseBody: any) {
  expectItemResponse(responseBody, ['id', 'email']);
  expect(responseBody).not.toHaveProperty('password');
  expect(responseBody).not.toHaveProperty('passwordHash');
  expect(typeof responseBody.email).toBe('string');
  expect(responseBody.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
}

/**
 * Validate stats response structure
 */
export function expectStatsResponse(responseBody: any) {
  expect(Array.isArray(responseBody)).toBe(true);

  responseBody.forEach((stat: any) => {
    expect(typeof stat).toBe('object');
    // Stats can have various structures depending on endpoint
    // but should always be objects
  });
}

/**
 * Common HTTP status code validation
 */
export function expectStatus(actual: number, expected: number) {
  expect(actual).toBe(expected);
}

/**
 * Validate empty response (for DELETE operations)
 */
export function expectEmptyResponse(responseBody: any) {
  expect(responseBody).toEqual({});
}

/**
 * Validate pagination response structure
 */
export function expectPaginatedResponse(responseBody: any) {
  expect(responseBody).toHaveProperty('data');
  expect(responseBody).toHaveProperty('pagination');
  expect(Array.isArray(responseBody.data)).toBe(true);

  const pagination = responseBody.pagination;
  expect(pagination).toHaveProperty('page');
  expect(pagination).toHaveProperty('limit');
  expect(pagination).toHaveProperty('total');
  expect(typeof pagination.page).toBe('number');
  expect(typeof pagination.limit).toBe('number');
  expect(typeof pagination.total).toBe('number');
}

/**
 * Enhanced response matcher for common error scenarios
 */
export const responseMatchers = {
  unauthorized: (responseBody: any) => {
    expectErrorResponse(responseBody, /unauthorized|invalid credentials|authentication/i);
  },

  forbidden: (responseBody: any) => {
    expectErrorResponse(responseBody, /forbidden|permission|access denied/i);
  },

  notFound: (responseBody: any) => {
    expectErrorResponse(responseBody, /not found|does not exist/i);
  },

  validation: (responseBody: any) => {
    expectErrorResponse(responseBody, /validation|invalid|required|format/i);
  },

  conflict: (responseBody: any) => {
    expectErrorResponse(responseBody, /already exists|conflict|duplicate/i);
  },

  serverError: (responseBody: any) => {
    expectErrorResponse(responseBody, /internal server error|server error/i);
  },
};

/**
 * Test helper to validate response status and body in one call
 */
export function validateResponse(
  response: any,
  expectedStatus: number,
  validator?: (body: any) => void
) {
  expect(response.status).toBe(expectedStatus);

  if (validator) {
    validator(response.body);
  }
}

/**
 * Utility to create test response assertions with better error messages
 */
export function createResponseAssertion(testName: string) {
  return {
    expectStatus: (response: any, expectedStatus: number) => {
      try {
        expect(response.status).toBe(expectedStatus);
      } catch {
        throw new Error(
          `${testName}: Expected status ${expectedStatus} but got ${response.status}. ` +
            `Response body: ${JSON.stringify(response.body, null, 2)}`
        );
      }
    },

    expectBody: (response: any, validator: (body: any) => void) => {
      try {
        validator(response.body);
      } catch (error) {
        throw new Error(
          `${testName}: Response body validation failed. ` +
            `Response body: ${JSON.stringify(response.body, null, 2)}. ` +
            `Original error: ${error}`
        );
      }
    },
  };
}
