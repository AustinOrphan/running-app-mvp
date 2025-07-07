/**
 * Shared mock utilities for API testing
 * Provides consistent mocking patterns across all test files
 */

import { vi } from 'vitest';
import { ApiResponse, ApiFetchError } from '../../utils/apiFetch';

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
 * Helper function to create API error responses
 */
export const createApiError = (
  message: string,
  status = 500,
  data?: unknown
): MockApiError => {
  return new MockApiError(message, status, undefined, data);
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
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data)),
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