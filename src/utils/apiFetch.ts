// Comprehensive fetch wrapper with error handling, auth, and retry logic
import { clientLogger } from './clientLogger.js';
import { reportApiError, reportNetworkError, reportAuthError } from './errorReporting.js';

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
  return localStorage.getItem('authToken');
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

        // Report authentication errors
        if (response.status === 401) {
          const authError = new ApiFetchError(errorMessage, response.status, response, errorData);
          reportAuthError(authError, `${fetchOptions.method || 'GET'} ${url}`);
        }

        // Check if this is a retryable error
        if (attempt < retries && isRetryableStatus(response.status)) {
          // eslint-disable-next-line no-console -- Intentional retry warning for debugging
          console.warn(
            `API request failed (attempt ${attempt + 1}/${retries + 1}): ${errorMessage}. Retrying...`
          );
          
          // Report network error if on last retry
          if (attempt === retries - 1) {
            const networkError = new ApiFetchError(errorMessage, response.status, response, errorData);
            reportNetworkError(networkError, url, attempt + 1);
          }
          
          await delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
          continue;
        }

        // Report API error
        const apiError = new ApiFetchError(errorMessage, response.status, response, errorData);
        reportApiError(apiError, url, fetchOptions.method || 'GET', response.status);
        
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
        const networkError = new ApiFetchError(errorMessage, 0, undefined, { originalError: error });
        reportNetworkError(networkError, url, attempt);
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

// Export the error class and types for use in other modules
export { ApiFetchError };
