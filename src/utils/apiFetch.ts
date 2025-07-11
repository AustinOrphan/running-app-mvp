// Comprehensive fetch wrapper with error handling, auth, and retry logic
import { clientLogger } from './clientLogger.js';

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
        authEvents.dispatchEvent(new CustomEvent('authenticationFailed', {
          detail: { message: 'No refresh token available' }
        }));
        return false;
      }

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        clearTokens();
        authEvents.dispatchEvent(new CustomEvent('authenticationFailed', {
          detail: { message: 'Failed to refresh token' }
        }));
        return false;
      }

      const data = await response.json();
      setTokens(data.accessToken, data.refreshToken);
      
      authEvents.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: { accessToken: data.accessToken }
      }));
      
      return true;
    } catch (error) {
      clearTokens();
      authEvents.dispatchEvent(new CustomEvent('authenticationFailed', {
        detail: { message: 'Token refresh failed' }
      }));
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
