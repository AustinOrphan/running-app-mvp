import { vi } from 'vitest';

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

// Create a mock server setup for API mocking
export const createMockServer = () => {
  const mockFetch = vi.fn();

  global.fetch = mockFetch;

  const mockAPI = {
    // Auth endpoints
    mockLogin: (response: any, status = 200) => {
      mockFetch.mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        statusText: getStatusText(status),
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(JSON.stringify(response)),
      });
    },

    mockRegister: (response: any, status = 201) => {
      mockFetch.mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        statusText: getStatusText(status),
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(JSON.stringify(response)),
      });
    },

    // Stats endpoints
    mockInsightsSummary: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });
    },

    mockTypeBreakdown: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });
    },

    mockTrends: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });
    },

    mockPersonalRecords: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });
    },

    // Runs endpoints
    mockRuns: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });
    },

    // Error responses
    mockError: (status: number, message: string, data?: any) => {
      const errorResponse = {
        error: true,
        message,
        ...(data && { details: data }),
        timestamp: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: getStatusText(status),
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(errorResponse),
        text: () => Promise.resolve(JSON.stringify(errorResponse)),
      });
    },

    // Network error
    mockNetworkError: () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
    },

    // Reset mocks
    reset: () => {
      mockFetch.mockClear();
    },
  };

  return mockAPI;
};

export type MockAPI = ReturnType<typeof createMockServer>;
