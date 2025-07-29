// Comprehensive fetch wrapper with error handling, auth, and retry logic
import { clientLogger } from './clientLogger.js';
import { devConfig } from './environment.js';

// Event emitter for authentication events
export const authEvents = new EventTarget();

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  requiresAuth?: boolean;
  skipAuth?: boolean;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export interface ApiError extends Error {
  status?: number;
  response?: Response;
  data?: unknown;
}

class ApiFetchError extends Error implements ApiError {
  status?: number;
  response?: Response;
  data?: unknown;

  constructor(message: string, status?: number, response?: Response, data?: unknown) {
    super(message);
    this.name = 'ApiFetchError';
    this.status = status;
    this.response = response;
    this.data = data;
  }
}

// Default configuration
const DEFAULT_CONFIG: Required<Pick<ApiFetchOptions, 'timeout' | 'retries' | 'retryDelay'>> = {
  timeout: 10000, // 10 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
};

// Authentication token management
const getAuthToken = (): string | null => {
  return localStorage.getItem('accessToken');
};

const getRefreshToken = (): string | null => {
  return localStorage.getItem('refreshToken');
};

const setTokens = (accessToken: string, refreshToken: string): void => {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
};

const clearTokens = (): void => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  // Keep backward compatibility
  localStorage.removeItem('authToken');
};

// Auth events for communicating with useAuth hook

// Token refresh functionality
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

const refreshAccessToken = async (): Promise<boolean> => {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearTokens();
        authEvents.dispatchEvent(
          new CustomEvent('authenticationFailed', {
            detail: { message: 'No refresh token available' },
          })
        );
        return false;
      }

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        clearTokens();
        authEvents.dispatchEvent(
          new CustomEvent('authenticationFailed', {
            detail: { message: 'Failed to refresh token' },
          })
        );
        return false;
      }

      const data = await response.json();
      setTokens(data.accessToken, data.refreshToken);

      authEvents.dispatchEvent(
        new CustomEvent('tokenRefreshed', {
          detail: { accessToken: data.accessToken },
        })
      );

      return true;
    } catch (error) {
      clientLogger.error('Token refresh failed', error instanceof Error ? error : undefined, {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      clearTokens();
      authEvents.dispatchEvent(
        new CustomEvent('authenticationFailed', {
          detail: { message: 'Token refresh failed' },
        })
      );
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// Retry-able HTTP status codes
const isRetryableStatus = (status: number): boolean => {
  return [408, 429, 500, 502, 503, 504].includes(status);
};

// Create timeout promise
const createTimeoutPromise = (timeout: number): Promise<never> => {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new ApiFetchError('Request timeout', 408)), timeout);
  });
};

// Delay utility for retries
const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Development mock response function
const mockApiResponse = async <T = unknown>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<ApiResponse<T>> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Mock responses for common endpoints
  const mockData = generateMockData<T>(url, options);

  return {
    data: mockData,
    status: 200,
    headers: new Headers(),
  };
};

const generateMockData = <T = unknown>(url: string, options: ApiFetchOptions): T => {
  // Mock data based on URL patterns
  if (url.includes('/api/runs')) {
    if (options.method === 'GET') {
      return [
        {
          id: 'dev-run-1',
          distance: 5.2,
          duration: 1800, // 30 minutes
          pace: '5:45',
          date: new Date().toISOString(),
          notes: 'Development mock run - great weather!',
        },
        {
          id: 'dev-run-2',
          distance: 3.1,
          duration: 1200, // 20 minutes
          pace: '6:30',
          date: new Date(Date.now() - 86400000).toISOString(), // yesterday
          notes: 'Development mock run - easy pace',
        },
      ] as T;
    } else if (options.method === 'POST') {
      return {
        id: 'dev-run-' + Date.now(),
        ...(options.body as object),
        date: new Date().toISOString(),
      } as T;
    }
  }

  if (url.includes('/api/goals')) {
    // Handle goal progress endpoint
    if (url.includes('/api/goals/progress/all')) {
      return [
        {
          goalId: 'dev-goal-1',
          currentValue: 32.5,
          progressPercentage: 65,
          isCompleted: false,
          remainingValue: 17.5,
          daysRemaining: 15,
          averageRequired: 1.17, // per day
        },
        {
          goalId: 'dev-goal-2',
          currentValue: 2,
          progressPercentage: 67,
          isCompleted: false,
          remainingValue: 1,
          daysRemaining: 3,
          averageRequired: 0.33, // per day
        },
      ] as T;
    }

    // Handle regular goals endpoint
    return [
      {
        id: 'dev-goal-1',
        userId: 'dev-user-1',
        title: 'Run 50km this month',
        description: 'Monthly distance goal',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 50,
        targetUnit: 'km',
        startDate: new Date(Date.now() - 15 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 15 * 86400000).toISOString(),
        currentValue: 32.5,
        isCompleted: false,
        color: '#3b82f6',
        icon: '🎯',
        isActive: true,
        createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      },
      {
        id: 'dev-goal-2',
        userId: 'dev-user-1',
        title: 'Run 3 times per week',
        description: 'Weekly frequency goal',
        type: 'FREQUENCY',
        period: 'WEEKLY',
        targetValue: 3,
        targetUnit: 'runs',
        startDate: new Date(Date.now() - 30 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 60 * 86400000).toISOString(),
        currentValue: 2,
        isCompleted: false,
        color: '#f59e0b',
        icon: '📅',
        isActive: true,
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ] as T;
  }

  if (url.includes('/api/stats')) {
    // Handle different stats endpoints
    if (url.includes('/api/stats/personal-records')) {
      return [
        {
          distance: 5,
          bestTime: 1500, // 25 minutes
          bestPace: '5:00',
          date: new Date(Date.now() - 7 * 86400000).toISOString(), // 1 week ago
          runId: 'dev-pr-1',
        },
        {
          distance: 10,
          bestTime: 3300, // 55 minutes
          bestPace: '5:30',
          date: new Date(Date.now() - 14 * 86400000).toISOString(), // 2 weeks ago
          runId: 'dev-pr-2',
        },
        {
          distance: 21.1, // Half marathon
          bestTime: 7200, // 2 hours
          bestPace: '5:41',
          date: new Date(Date.now() - 30 * 86400000).toISOString(), // 1 month ago
          runId: 'dev-pr-3',
        },
      ] as T;
    }

    if (url.includes('/api/stats/insights-summary')) {
      return {
        totalRuns: 12,
        totalDistance: 68.4,
        avgWeeklyDistance: 17.1,
        weekOverWeekChange: 15.2,
        consistencyScore: 85,
      } as T;
    }

    if (url.includes('/api/stats/type-breakdown')) {
      return [
        {
          tag: 'easy',
          count: 8,
          totalDistance: 45.6,
          totalDuration: 10800, // 3 hours
          avgPace: 4.21,
        },
        {
          tag: 'tempo',
          count: 3,
          totalDistance: 18.5,
          totalDuration: 3600, // 1 hour
          avgPace: 3.24,
        },
        {
          tag: 'long',
          count: 1,
          totalDistance: 21.1,
          totalDuration: 7200, // 2 hours
          avgPace: 5.68,
        },
      ] as T;
    }

    if (url.includes('/api/stats/trends')) {
      const weeks = 12;
      const trends = [];
      for (let i = weeks; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i * 7);
        trends.push({
          week: date.toISOString(),
          distance: Math.floor(Math.random() * 20) + 10,
          runs: Math.floor(Math.random() * 4) + 1,
          avgPace: '5:' + (Math.floor(Math.random() * 30) + 15),
        });
      }
      return trends as T;
    }

    // Default stats response
    return {
      totalRuns: 12,
      totalDistance: 68.4,
      totalTime: 21600, // 6 hours
      averagePace: '6:15',
      weeklyDistance: 15.2,
    } as T;
  }

  // Default empty response - return appropriate type
  if (url.includes('/api/') && url.includes('/')) {
    // For API endpoints that expect arrays, return empty array
    const arrayEndpoints = ['runs', 'goals', 'records', 'trends', 'breakdown'];
    if (arrayEndpoints.some(endpoint => url.includes(endpoint))) {
      return [] as T;
    }
  }

  return {} as T;
};

// Main apiFetch function
export const apiFetch = async <T = unknown>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<ApiResponse<T>> => {
  const {
    body,
    timeout = DEFAULT_CONFIG.timeout,
    retries = DEFAULT_CONFIG.retries,
    retryDelay = DEFAULT_CONFIG.retryDelay,
    requiresAuth = true,
    skipAuth = false,
    headers: customHeaders = {},
    ...fetchOptions
  } = options;

  // Prepare headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  // Add authentication if required and available
  if (requiresAuth && !skipAuth) {
    const token = getAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;

      // Development mode: handle mock tokens by returning mock data
      if (devConfig.enableLoginBypass && token.startsWith('dev-mock-token-')) {
        return mockApiResponse<T>(url, options);
      }
    } else if (requiresAuth) {
      throw new ApiFetchError('Authentication required but no token available', 401);
    }
  }

  // Prepare request config
  const requestConfig: RequestInit = {
    ...fetchOptions,
    headers,
  };

  // Handle JSON body serialization
  if (body !== undefined) {
    if (typeof body === 'object' && body !== null && !(body instanceof FormData)) {
      requestConfig.body = JSON.stringify(body);
    } else {
      requestConfig.body = body as BodyInit;
      // Remove Content-Type for FormData to let browser set boundary
      if (body instanceof FormData) {
        delete headers['Content-Type'];
      }
    }
  }

  // Retry logic
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create fetch promise with timeout
      const fetchPromise = fetch(url, requestConfig);
      const response = await Promise.race([fetchPromise, createTimeoutPromise(timeout)]);

      // Handle HTTP error status codes
      if (!response.ok) {
        let errorData: unknown;
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            errorData = await response.json();
            // Use server error message if available
            const errorObj = errorData as { message?: string; error?: string };
            errorMessage = errorObj.message || errorObj.error || errorMessage;
          } else {
            errorData = { message: await response.text() };
          }
        } catch {
          // If parsing fails, use default error message
          errorData = { message: errorMessage };
        }

        // Handle 401 errors with token refresh (but not for auth endpoints)
        if (response.status === 401 && !url.includes('/api/auth/') && attempt === 0) {
          const refreshSuccess = await refreshAccessToken();
          if (refreshSuccess) {
            // Update authorization header with new token
            const newToken = getAuthToken();
            if (newToken) {
              headers.Authorization = `Bearer ${newToken}`;
              requestConfig.headers = headers;
              // Retry the request with new token
              continue;
            }
          }
          // If refresh failed, clear tokens and emit auth failure
          clearTokens();

          // Enhanced error messaging
          if (errorMessage.toLowerCase().includes('expired')) {
            errorMessage = 'Your session has expired. Please log in again.';
          } else {
            errorMessage = 'Authentication failed. Please log in again.';
          }

          authEvents.dispatchEvent(
            new CustomEvent('authenticationFailed', {
              detail: { status: response.status, message: errorMessage, url },
            })
          );

          // Log authentication error for debugging
          clientLogger.error('Authentication error', undefined, {
            status: response.status,
            message: errorMessage,
            url,
            originalError: errorData,
          });
        } else if (response.status === 401) {
          // Handle direct 401 without refresh attempt (auth endpoints)
          if (errorMessage.toLowerCase().includes('expired')) {
            errorMessage = 'Your session has expired. Please log in again.';
          } else {
            errorMessage = 'Authentication failed. Please log in again.';
          }

          // Clear invalid token from storage
          clearTokens();

          // Emit authentication failure event
          authEvents.dispatchEvent(
            new CustomEvent('authenticationFailed', {
              detail: {
                status: response.status,
                message: errorMessage,
                url,
              },
            })
          );

          // Log authentication error for debugging
          clientLogger.error('Authentication error', undefined, {
            status: response.status,
            message: errorMessage,
            url,
            originalError: errorData,
          });
        }

        // Check if this is a retryable error
        if (attempt < retries && isRetryableStatus(response.status)) {
          // eslint-disable-next-line no-console -- Intentional retry warning for debugging
          console.warn(
            `API request failed (attempt ${attempt + 1}/${retries + 1}): ${errorMessage}. Retrying...`
          );

          // Report network error if on last retry
          if (attempt === retries - 1) {
            clientLogger.warn(`Network error on final retry: ${errorMessage}`, {
              url,
              attempt: attempt + 1,
              status: response.status,
            });
          }

          await delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
          continue;
        }

        // Enhance error messages for common status codes
        if (response.status === 403) {
          errorMessage = 'You do not have permission to perform this action.';
        } else if (response.status === 404) {
          errorMessage = 'The requested resource was not found.';
        } else if (response.status === 422) {
          errorMessage = 'Invalid data provided. Please check your input.';
        } else if (response.status >= 500) {
          errorMessage = 'Server error. Please try again later.';
        }

        // Log API error (for non-auth errors)
        const apiError = new ApiFetchError(errorMessage, response.status, response, errorData);
        clientLogger.error('API error', apiError, {
          url,
          method: fetchOptions.method || 'GET',
          status: response.status,
        });

        throw apiError;
      }

      // Parse successful response
      let data: T;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else if (response.status === 204) {
        // No content response
        data = null as T;
      } else {
        data = (await response.text()) as unknown as T;
      }

      return {
        data,
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      // If it's the last attempt or not a retryable error, throw
      if (
        attempt === retries ||
        !(error instanceof ApiFetchError) ||
        !isRetryableStatus(error.status || 0)
      ) {
        // Enhance error with additional context if needed
        if (error instanceof ApiFetchError) {
          throw error;
        }

        // Handle network errors, timeouts, etc.
        const defaultNetworkErrorMessage = 'Network error';
        const errorMessage = error instanceof Error ? error.message : defaultNetworkErrorMessage;
        const networkError = new ApiFetchError(errorMessage, 0, undefined, {
          originalError: error,
        });
        clientLogger.error('Network error', networkError, {
          url,
          attempt,
        });
        throw networkError;
      }

      // Retry for retryable errors

      const { message } = error as Error;
      clientLogger.warn(
        `API request failed (attempt ${attempt + 1}/${retries + 1}): ${message}. Retrying...`
      );
      await delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
    }
  }

  // This should never be reached due to the throw in the catch block
  throw new ApiFetchError('Maximum retries exceeded', 0);
};

// Convenience methods for common HTTP verbs
export const apiGet = <T = unknown>(
  url: string,
  options?: Omit<ApiFetchOptions, 'method'>
): Promise<ApiResponse<T>> => {
  return apiFetch<T>(url, { ...options, method: 'GET' });
};

export const apiPost = <T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<ApiFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> => {
  return apiFetch<T>(url, { ...options, method: 'POST', body });
};

export const apiPut = <T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<ApiFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> => {
  return apiFetch<T>(url, { ...options, method: 'PUT', body });
};

export const apiDelete = <T = unknown>(
  url: string,
  options?: Omit<ApiFetchOptions, 'method'>
): Promise<ApiResponse<T>> => {
  return apiFetch<T>(url, { ...options, method: 'DELETE' });
};

export const apiPatch = <T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<ApiFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> => {
  return apiFetch<T>(url, { ...options, method: 'PATCH', body });
};

// Export the error class, types, and token management functions for use in other modules
export { ApiFetchError, setTokens, clearTokens, getAuthToken, getRefreshToken };
