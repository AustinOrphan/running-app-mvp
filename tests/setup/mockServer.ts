import { vi } from 'vitest';

// Create a mock server setup for API mocking
export const createMockServer = () => {
  const mockFetch = vi.fn();
  
  global.fetch = mockFetch;

  const mockAPI = {
    // Auth endpoints
    mockLogin: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },
    
    mockRegister: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },

    // Stats endpoints
    mockInsightsSummary: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },
    
    mockTypeBreakdown: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },
    
    mockTrends: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },
    
    mockPersonalRecords: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },

    // Runs endpoints
    mockRuns: (response: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      });
    },

    // Error responses
    mockError: (status: number, message: string) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        json: () => Promise.resolve({ error: message })
      });
    },

    // Network error
    mockNetworkError: () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
    },

    // Reset mocks
    reset: () => {
      mockFetch.mockClear();
    }
  };

  return mockAPI;
};

export type MockAPI = ReturnType<typeof createMockServer>;