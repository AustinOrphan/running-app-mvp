/**
 * Shared mock utilities for API testing
 * Provides consistent mocking patterns across all test files
 */

import { vi } from 'vitest';
import { ApiResponse, ApiFetchError } from '../../src/utils/apiFetch';

// Re-export the real types for convenience
export type { ApiResponse };

// Mock ApiError class that extends the real ApiFetchError interface
export class MockApiError extends Error implements InstanceType<typeof ApiFetchError> {
  status?: number;
  response?: Response;
  data?: unknown;

  constructor(message: string, status?: number, response?: Response, data?: unknown) {
    super(message);
    this.name = 'ApiFetchError'; // Match the real ApiFetchError name
    this.status = status;
    this.response = response;
    this.data = data;
  }
}

/**
 * Helper function to create properly structured API responses
 */
export const createApiResponse = <T>(data: T, status = 200): ApiResponse<T> => ({
  data,
  status,
  headers: new Headers(),
});

/**
 * Get HTTP status text for status codes
 */
function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return statusTexts[status] || 'Unknown';
}

/**
 * Helper function to create API error responses with proper Response object
 */
export const createApiError = (message: string, status = 500, data?: unknown): MockApiError => {
  // Create a mock Response object for better error handling
  const mockResponse = {
    status,
    statusText: getStatusText(status),
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data || { error: message }),
    text: () => Promise.resolve(JSON.stringify(data || { error: message })),
  } as Response;

  return new MockApiError(message, status, mockResponse, data);
};

/**
 * Mock API fetch utilities factory
 * Returns mocked versions of all API fetch functions
 */
export const createMockApiFetch = () => {
  const mockApiGet = vi.fn();
  const mockApiPost = vi.fn();
  const mockApiPut = vi.fn();
  const mockApiDelete = vi.fn();

  // Set up default successful responses
  const setupDefaultResponses = () => {
    mockApiGet.mockResolvedValue(createApiResponse([]));
    mockApiPost.mockResolvedValue(createApiResponse({}));
    mockApiPut.mockResolvedValue(createApiResponse({}));
    mockApiDelete.mockResolvedValue(createApiResponse({}));
  };

  // Reset all mocks and set defaults
  const resetMocks = () => {
    vi.clearAllMocks();
    setupDefaultResponses();
  };

  return {
    mockApiGet,
    mockApiPost,
    mockApiPut,
    mockApiDelete,
    setupDefaultResponses,
    resetMocks,
  };
};

/**
 * Legacy fetch mock utilities for gradual migration
 * Provides structured response creation for tests still using global fetch
 */
export const createFetchResponse = <T>(data: T, ok = true, status = 200) => ({
  ok,
  status,
  statusText: getStatusText(status),
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data)),
  blob: () => Promise.resolve(new Blob([JSON.stringify(data)])),
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  clone: function () {
    return createFetchResponse(data, ok, status);
  },
});

/**
 * Helper to setup multiple fetch responses in sequence
 */
export const setupFetchSequence = (mockFetch: any, responses: any[]) => {
  mockFetch.mockClear();
  responses.forEach(response => {
    mockFetch.mockResolvedValueOnce(response);
  });
};

/**
 * Common test setup for API-based hooks
 */
export const setupApiTest = () => {
  // Mock console.error to avoid noise in tests
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Setup localStorage with auth token
  localStorage.setItem('authToken', 'valid-token');

  return {
    cleanup: () => {
      vi.restoreAllMocks();
      localStorage.clear();
    },
  };
};

/**
 * Create network timeout error for testing edge cases
 */
export const createNetworkError = (type: 'timeout' | 'connection' | 'dns' = 'connection') => {
  const errors = {
    timeout: 'ETIMEDOUT',
    connection: 'ECONNREFUSED',
    dns: 'ENOTFOUND',
  };

  const error = new Error(`Network error: ${errors[type]}`);
  (error as any).code = errors[type];
  return error;
};

/**
 * Create a comprehensive error response for testing various failure scenarios
 */
export const createDetailedApiError = (
  message: string,
  status: number,
  code?: string,
  details?: Record<string, any>
): MockApiError => {
  const errorData = {
    error: true,
    message,
    code,
    details,
    timestamp: new Date().toISOString(),
  };

  const mockResponse = {
    status,
    statusText: getStatusText(status),
    ok: false,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(errorData),
    text: () => Promise.resolve(JSON.stringify(errorData)),
  } as Response;

  return new MockApiError(message, status, mockResponse, errorData);
};
