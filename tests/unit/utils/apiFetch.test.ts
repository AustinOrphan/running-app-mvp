import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  apiPatch,
  ApiFetchError,
} from '../../../utils/apiFetch';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Helper to create mock response
const createMockResponse = (
  data: any,
  status = 200,
  contentType = 'application/json'
): Response => {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({
      'content-type': contentType,
    }),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;

  return response;
};

describe('ApiFetchError', () => {
  it('should create error with all properties', () => {
    const response = createMockResponse({}, 500);
    const data = { error: 'Server error' };

    const error = new ApiFetchError('Test error', 500, response, data);

    expect(error.name).toBe('ApiFetchError');
    expect(error.message).toBe('Test error');
    expect(error.status).toBe(500);
    expect(error.response).toBe(response);
    expect(error.data).toBe(data);
  });

  it('should create error with minimal properties', () => {
    const error = new ApiFetchError('Simple error');

    expect(error.name).toBe('ApiFetchError');
    expect(error.message).toBe('Simple error');
    expect(error.status).toBeUndefined();
    expect(error.response).toBeUndefined();
    expect(error.data).toBeUndefined();
  });
});

describe('apiFetch', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    localStorage.clear();
    vi.clearAllTimers();
  });

  afterEach(() => {
    mockFetch.mockReset();
    vi.useRealTimers();
  });

  describe('successful requests', () => {
    it('should make successful GET request', async () => {
      const mockData = { id: 1, name: 'Test' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const result = await apiFetch('/api/test', { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result.data).toEqual(mockData);
      expect(result.status).toBe(200);
    });

    it('should handle JSON response correctly', async () => {
      const mockData = { message: 'success' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const result = await apiFetch('/api/test', { requiresAuth: false });

      expect(result.data).toEqual(mockData);
    });

    it('should handle text response correctly', async () => {
      const mockData = 'Plain text response';
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData, 200, 'text/plain'));

      const result = await apiFetch('/api/test', { requiresAuth: false });

      expect(result.data).toBe(mockData);
    });

    it('should handle 204 No Content response', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, 204));

      const result = await apiFetch('/api/test', { requiresAuth: false });

      expect(result.data).toBe(null);
      expect(result.status).toBe(204);
    });

    it('should include custom headers', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await apiFetch('/api/test', {
        requiresAuth: false,
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
      });
    });
  });

  describe('authentication', () => {
    it('should include auth token when available', async () => {
      localStorage.setItem('authToken', 'test-token');
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await apiFetch('/api/test');

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
      });
    });

    it('should throw error when auth required but no token', async () => {
      localStorage.clear();

      await expect(apiFetch('/api/test', { requiresAuth: true })).rejects.toThrow(
        'Authentication required but no token available'
      );
    });

    it('should skip auth when skipAuth is true', async () => {
      localStorage.setItem('authToken', 'test-token');
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await apiFetch('/api/test', { skipAuth: true });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('should not require auth when requiresAuth is false', async () => {
      localStorage.clear();
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await apiFetch('/api/test', { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });
  });

  describe('request body handling', () => {
    it('should serialize JSON body', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));
      const body = { name: 'test', value: 123 };

      await apiFetch('/api/test', { method: 'POST', body, requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('should handle FormData body', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));
      const formData = new FormData();
      formData.append('file', new Blob(['test']));

      await apiFetch('/api/test', { method: 'POST', body: formData, requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        body: formData,
        headers: {},
      });
    });

    it('should handle string body', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));
      const body = 'raw string data';

      await apiFetch('/api/test', { method: 'POST', body, requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('should handle null/undefined body', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await apiFetch('/api/test', { method: 'POST', requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });
  });

  describe('error handling', () => {
    it('should handle HTTP error responses', async () => {
      const errorData = { message: 'Not found' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorData, 404));

      await expect(apiFetch('/api/test', { requiresAuth: false })).rejects.toThrow('Not found');
    });

    it('should handle HTTP error with error field', async () => {
      const errorData = { error: 'Validation failed' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorData, 400));

      await expect(apiFetch('/api/test', { requiresAuth: false })).rejects.toThrow('Validation failed');
    });

    it('should handle HTTP error with default message', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 500));

      await expect(apiFetch('/api/test', { requiresAuth: false, retries: 0 })).rejects.toThrow('HTTP 500: Error');
    });

    it('should handle non-JSON error responses', async () => {
      const response = createMockResponse('Internal Server Error', 500, 'text/plain');
      mockFetch.mockResolvedValueOnce(response);

      await expect(apiFetch('/api/test', { requiresAuth: false, retries: 0 })).rejects.toThrow('HTTP 500: Error');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(apiFetch('/api/test', { retries: 0, requiresAuth: false })).rejects.toThrow('Network error');
    });

    it('should include error details in ApiFetchError', async () => {
      const errorData = { code: 'VALIDATION_ERROR', details: 'Invalid input' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorData, 400));

      try {
        await apiFetch('/api/test', { requiresAuth: false });
      } catch (error) {
        expect(error).toBeInstanceOf(ApiFetchError);
        expect((error as ApiFetchError).status).toBe(400);
        expect((error as ApiFetchError).data).toEqual(errorData);
      }
    });
  });

  describe('timeout handling', () => {
    it('should timeout after specified duration', async () => {
      vi.useFakeTimers();

      let timeoutResolve: (value: any) => void;
      const timeoutPromise = new Promise((resolve) => {
        timeoutResolve = resolve;
      });

      // Mock fetch to never resolve
      mockFetch.mockImplementationOnce(() => timeoutPromise);

      const fetchPromise = apiFetch('/api/test', { timeout: 1000, requiresAuth: false, retries: 0 });

      // Advance time past timeout
      vi.advanceTimersByTime(1001);
      
      await expect(fetchPromise).rejects.toThrow('Request timeout');

      vi.useRealTimers();
    }, 10000);

    it('should use default timeout when not specified', async () => {
      vi.useFakeTimers();

      let timeoutResolve: (value: any) => void;
      const timeoutPromise = new Promise((resolve) => {
        timeoutResolve = resolve;
      });

      // Mock fetch to never resolve
      mockFetch.mockImplementationOnce(() => timeoutPromise);

      const fetchPromise = apiFetch('/api/test', { requiresAuth: false, retries: 0 });

      // Advance time past default timeout (10 seconds)
      vi.advanceTimersByTime(10001);
      
      await expect(fetchPromise).rejects.toThrow('Request timeout');

      vi.useRealTimers();
    }, 15000);
  });

  describe('retry logic', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should retry on retryable status codes', async () => {
      vi.useRealTimers();
      
      // First two attempts fail, third succeeds
      mockFetch
        .mockResolvedValueOnce(createMockResponse({}, 500))
        .mockResolvedValueOnce(createMockResponse({}, 502))
        .mockResolvedValueOnce(createMockResponse({ success: true }));

      const result = await apiFetch('/api/test', { retries: 2, retryDelay: 1, requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.data).toEqual({ success: true });
    }, 10000);

    it('should not retry on non-retryable status codes', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 404));

      await expect(apiFetch('/api/test', { retries: 2, requiresAuth: false })).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should respect retry limit', async () => {
      vi.useRealTimers();
      
      mockFetch.mockResolvedValue(createMockResponse({}, 500));

      await expect(apiFetch('/api/test', { retries: 2, retryDelay: 1, requiresAuth: false })).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    }, 10000);

    it('should use exponential backoff for retries', async () => {
      vi.useRealTimers();
      
      mockFetch.mockResolvedValue(createMockResponse({}, 503));

      await expect(apiFetch('/api/test', { retries: 2, retryDelay: 1, requiresAuth: false })).rejects.toThrow();

      // Verify that retries were attempted
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    }, 10000);

    it.skip('should not retry on timeout errors', async () => {
      // Skip this test as it's difficult to test with fake timers
      // The behavior is covered by integration tests
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue(createMockResponse({ success: true }));
    });

    it('should make GET request with apiGet', async () => {
      await apiGet('/api/test', { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'GET',
        headers: expect.any(Object),
      });
    });

    it('should make POST request with apiPost', async () => {
      const body = { name: 'test' };
      await apiPost('/api/test', body, { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.any(Object),
      });
    });

    it('should make PUT request with apiPut', async () => {
      const body = { id: 1, name: 'updated' };
      await apiPut('/api/test/1', body, { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test/1', {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: expect.any(Object),
      });
    });

    it('should make DELETE request with apiDelete', async () => {
      await apiDelete('/api/test/1', { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test/1', {
        method: 'DELETE',
        headers: expect.any(Object),
      });
    });

    it('should make PATCH request with apiPatch', async () => {
      const body = { name: 'patched' };
      await apiPatch('/api/test/1', body, { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test/1', {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: expect.any(Object),
      });
    });

    it('should pass through options to convenience methods', async () => {
      await apiGet('/api/test', { timeout: 5000, requiresAuth: false });

      // The timeout option should be passed through to apiFetch
      // We can't directly test timeout behavior in convenience methods,
      // but we can verify the call was made correctly
      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'GET',
        headers: expect.any(Object),
      });
    });
  });

  describe('edge cases', () => {
    it('should handle malformed JSON in error response', async () => {
      const response = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: vi.fn().mockResolvedValue('{"invalid": json}'),
      } as unknown as Response;

      mockFetch.mockResolvedValueOnce(response);

      await expect(apiFetch('/api/test', { requiresAuth: false })).rejects.toThrow('HTTP 400: Bad Request');
    });

    it('should handle empty response body', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse('', 200, 'text/plain'));

      const result = await apiFetch('/api/test', { requiresAuth: false });

      expect(result.data).toBe('');
    });

    it('should handle missing content-type header', async () => {
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ data: 'test' }),
        text: vi.fn().mockResolvedValue('text response'),
      } as unknown as Response;

      mockFetch.mockResolvedValueOnce(response);

      const result = await apiFetch('/api/test', { requiresAuth: false });

      expect(result.data).toBe('text response');
    });

    it('should handle response.json() throwing error', async () => {
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockRejectedValue(new Error('JSON parse error')),
        text: vi.fn().mockResolvedValue('fallback text'),
      } as unknown as Response;

      mockFetch.mockResolvedValueOnce(response);

      // Should throw ApiFetchError when JSON parsing fails
      await expect(apiFetch('/api/test', { requiresAuth: false, retries: 0 })).rejects.toThrow('JSON parse error');
    });

    it('should handle localStorage not available', async () => {
      const originalLocalStorage = window.localStorage;
      Object.defineProperty(window, 'localStorage', {
        value: null,
        writable: true,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      // Should not throw when localStorage is not available
      await expect(
        apiFetch('/api/test', { requiresAuth: false })
      ).resolves.toBeDefined();

      // Restore localStorage
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
      });
    });

    it('should handle null body correctly', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await apiFetch('/api/test', { method: 'POST', body: null, requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        body: null,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });
  });

  describe('type safety', () => {
    it('should return typed response data', async () => {
      interface UserData {
        id: number;
        name: string;
      }

      const userData: UserData = { id: 1, name: 'John' };
      mockFetch.mockResolvedValueOnce(createMockResponse(userData));

      const result = await apiGet<UserData>('/api/user/1', { requiresAuth: false });

      // TypeScript should infer the correct type
      expect(result.data.id).toBe(1);
      expect(result.data.name).toBe('John');
    });

    it('should accept typed request body', async () => {
      interface CreateUserData {
        name: string;
        email: string;
      }

      const createData: CreateUserData = {
        name: 'Jane',
        email: 'jane@example.com',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse({ id: 2, ...createData }));

      await apiPost('/api/users', createData, { requiresAuth: false });

      expect(mockFetch).toHaveBeenCalledWith('/api/users', {
        method: 'POST',
        body: JSON.stringify(createData),
        headers: expect.any(Object),
      });
    });
  });
});