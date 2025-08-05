import { Response } from 'supertest';

/**
 * Helper utilities for consistent response testing in integration tests
 */

/**
 * Standard error response structure that matches our error handler
 */
export interface StandardErrorResponse {
  error: boolean;
  message: string;
  statusCode: number;
  category: string;
  timestamp: string;
  path: string;
  method: string;
  errorCode?: string;
  field?: string;
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * Helper to assert on error responses with proper structure validation
 */
export const expectErrorResponse = (
  response: Response,
  expectedStatus: number,
  expectedMessage?: string | RegExp
) => {
  // Assert status code
  expect(response.status).toBe(expectedStatus);

  // Assert error response structure
  expect(response.body).toHaveProperty('error', true);
  expect(response.body).toHaveProperty('message');
  expect(response.body).toHaveProperty('statusCode', expectedStatus);
  expect(response.body).toHaveProperty('category');
  expect(response.body).toHaveProperty('timestamp');
  expect(response.body).toHaveProperty('path');
  expect(response.body).toHaveProperty('method');

  // Assert message if provided
  if (expectedMessage) {
    if (typeof expectedMessage === 'string') {
      expect(response.body.message).toBe(expectedMessage);
    } else {
      expect(response.body.message).toMatch(expectedMessage);
    }
  }

  // Assert category based on status code
  if (expectedStatus >= 400 && expectedStatus < 500) {
    expect(response.body.category).toBe('client_error');
  } else if (expectedStatus >= 500) {
    expect(response.body.category).toBe('server_error');
  }
};

/**
 * Helper to assert on success responses
 */
export const expectSuccessResponse = (
  response: Response,
  expectedStatus: number = 200,
  expectedProperties?: string[]
) => {
  // Assert status code
  expect(response.status).toBe(expectedStatus);

  // Should not have error property or it should be false
  if (response.body.hasOwnProperty('error')) {
    expect(response.body.error).toBe(false);
  }

  // Assert expected properties if provided
  if (expectedProperties) {
    expectedProperties.forEach(property => {
      expect(response.body).toHaveProperty(property);
    });
  }
};

/**
 * Helper to assert JWT token format
 */
export const expectValidJWT = (token: string) => {
  expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
};

/**
 * Helper to assert on auth response structure
 */
export const expectAuthResponse = (response: Response) => {
  expectSuccessResponse(response, 200, ['accessToken', 'refreshToken', 'user']);
  expectValidJWT(response.body.accessToken);
  expectValidJWT(response.body.refreshToken);
  expect(response.body.user).toHaveProperty('id');
  expect(response.body.user).toHaveProperty('email');
  expect(response.body.user).not.toHaveProperty('password');
};

/**
 * Helper to assert on registration response structure
 */
export const expectRegistrationResponse = (response: Response) => {
  expectSuccessResponse(response, 201, ['message', 'accessToken', 'refreshToken', 'user']);
  expect(response.body.message).toBe('User created successfully');
  expectValidJWT(response.body.accessToken);
  expectValidJWT(response.body.refreshToken);
  expect(response.body.user).toHaveProperty('id');
  expect(response.body.user).toHaveProperty('email');
  expect(response.body.user).not.toHaveProperty('password');
};

/**
 * Helper to assert on pagination response structure
 */
export const expectPaginatedResponse = (response: Response, expectedProperties?: string[]) => {
  expectSuccessResponse(response, 200);
  expect(Array.isArray(response.body)).toBe(true);

  if (expectedProperties && response.body.length > 0) {
    expectedProperties.forEach(property => {
      expect(response.body[0]).toHaveProperty(property);
    });
  }
};

/**
 * Helper to standardize status code assertions between .expect() and expect().toBe()
 */
export const expectStatus = (response: Response, expectedStatus: number) => {
  expect(response.status).toBe(expectedStatus);
};

/**
 * Mock response factory for consistent test data
 */
export const createMockResponse = (statusCode: number, body: any) => ({
  status: statusCode,
  body,
  headers: {},
  type: 'application/json',
});

/**
 * Mock error response factory
 */
export const createMockErrorResponse = (
  statusCode: number,
  message: string,
  errorCode?: string,
  field?: string
): StandardErrorResponse => ({
  error: true,
  message,
  statusCode,
  category: statusCode >= 400 && statusCode < 500 ? 'client_error' : 'server_error',
  timestamp: new Date().toISOString(),
  path: '/test',
  method: 'POST',
  ...(errorCode && { errorCode }),
  ...(field && { field }),
});

/**
 * Enhanced async response helpers for better mocking
 */
export const asyncResponseHelpers = {
  /**
   * Simulate async operation with controlled delay
   */
  asyncResponse: async <T>(data: T, delay: number = 0): Promise<T> => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return data;
  },

  /**
   * Simulate timeout scenarios
   */
  timeoutResponse: async (timeoutMs: number = 1000): Promise<never> => {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    });
  },

  /**
   * Simulate network errors
   */
  networkErrorResponse: async (): Promise<never> => {
    throw new Error('Network error - connection refused');
  },

  /**
   * Simulate intermittent failures
   */
  flakyResponse: async <T>(
    successData: T,
    failureRate: number = 0.3,
    errorMessage: string = 'Intermittent failure'
  ): Promise<T> => {
    if (Math.random() < failureRate) {
      throw new Error(errorMessage);
    }
    return successData;
  },

  /**
   * Simulate gradual response degradation
   */
  degradedResponse: async <T>(
    data: T,
    baseDelay: number = 100,
    degradationFactor: number = 1.5
  ): Promise<T> => {
    const delay = baseDelay * degradationFactor;
    await new Promise(resolve => setTimeout(resolve, delay));
    return data;
  },
};

/**
 * Response status code utilities for consistent testing
 */
export const statusCodeHelpers = {
  /**
   * Generate proper error response with correct status codes
   */
  createErrorResponse: (
    statusCode: number,
    message: string,
    path: string = '/test',
    method: string = 'POST'
  ) => ({
    status: statusCode,
    body: {
      error: true,
      message,
      statusCode,
      category: statusCode >= 400 && statusCode < 500 ? 'client_error' : 'server_error',
      timestamp: new Date().toISOString(),
      path,
      method,
    },
  }),

  /**
   * Common HTTP status codes for API testing
   */
  codes: {
    // Success
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,

    // Client errors
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,

    // Server errors
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
  },

  /**
   * Validate status code categories
   */
  isSuccessStatus: (status: number): boolean => status >= 200 && status < 300,
  isClientError: (status: number): boolean => status >= 400 && status < 500,
  isServerError: (status: number): boolean => status >= 500,
};

/**
 * Enhanced validation helpers for common response patterns
 */
export const responseValidators = {
  /**
   * Validates that response contains proper error structure
   */
  isValidErrorResponse: (response: any): response is StandardErrorResponse => {
    return (
      typeof response === 'object' &&
      response.error === true &&
      typeof response.message === 'string' &&
      typeof response.statusCode === 'number' &&
      typeof response.category === 'string' &&
      typeof response.timestamp === 'string' &&
      typeof response.path === 'string' &&
      typeof response.method === 'string'
    );
  },

  /**
   * Validates JWT token format
   */
  isValidJWT: (token: string): boolean => {
    return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
  },

  /**
   * Validates user object structure
   */
  isValidUserObject: (user: any): boolean => {
    return (
      typeof user === 'object' &&
      typeof user.id === 'string' &&
      typeof user.email === 'string' &&
      !user.hasOwnProperty('password')
    );
  },

  /**
   * Validates response timing is within acceptable range
   */
  isValidResponseTime: (startTime: number, maxMs: number = 5000): boolean => {
    const elapsed = Date.now() - startTime;
    return elapsed <= maxMs;
  },

  /**
   * Validates response has proper headers
   */
  hasValidHeaders: (response: Response): boolean => {
    return (
      response.headers &&
      response.headers['content-type'] &&
      response.headers['content-type'].includes('application/json')
    );
  },
};

/**
 * Enhanced async request mocking for testing network scenarios
 */
export const mockAsyncRequest = (
  shouldSucceed: boolean = true,
  responseData?: any,
  errorType?: 'validation' | 'auth' | 'notfound' | 'server' | 'timeout' | 'network',
  delay: number = 10
): Promise<any> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldSucceed) {
        resolve(responseData || { success: true });
      } else {
        const errors = {
          validation: createMockErrorResponse(400, 'Validation error', 'VALIDATION_FAILED'),
          auth: createMockErrorResponse(401, 'Unauthorized', 'AUTH_FAILED'),
          notfound: createMockErrorResponse(404, 'Not found', 'NOT_FOUND'),
          server: createMockErrorResponse(500, 'Internal server error', 'SERVER_ERROR'),
          timeout: { code: 'ETIMEDOUT', message: 'Request timeout' },
          network: { code: 'ECONNREFUSED', message: 'Network error' },
        };
        reject(errors[errorType || 'server']);
      }
    }, delay);
  });
};

/**
 * Mock network errors for testing edge cases
 */
export const mockNetworkError = (type: 'timeout' | 'connection' | 'dns' | 'ssl' = 'connection') => {
  const errors = {
    timeout: { code: 'ETIMEDOUT', message: 'Request timeout', errno: -110 },
    connection: { code: 'ECONNREFUSED', message: 'Connection refused', errno: -111 },
    dns: { code: 'ENOTFOUND', message: 'DNS resolution failed', errno: -3008 },
    ssl: { code: 'EPROTO', message: 'SSL/TLS error', errno: -71 },
  };

  const error = new Error(errors[type].message) as any;
  error.code = errors[type].code;
  error.errno = errors[type].errno;
  return error;
};

/**
 * Enhanced response assertions for edge cases
 */
export const expectEdgeCaseResponse = {
  /**
   * Validate 401 Unauthorized responses
   */
  unauthorized: (response: Response) => {
    expectErrorResponse(response, 401, /unauthorized|invalid credentials|authentication/i);
  },

  /**
   * Validate 403 Forbidden responses
   */
  forbidden: (response: Response) => {
    expectErrorResponse(response, 403, /forbidden|permission|access denied/i);
  },

  /**
   * Validate 404 Not Found responses
   */
  notFound: (response: Response) => {
    expectErrorResponse(response, 404, /not found|does not exist/i);
  },

  /**
   * Validate 409 Conflict responses
   */
  conflict: (response: Response) => {
    expectErrorResponse(response, 409, /already exists|conflict|duplicate/i);
  },

  /**
   * Validate 422 Unprocessable Entity responses
   */
  validationError: (response: Response) => {
    expectErrorResponse(response, 422, /validation|invalid|required|format/i);
  },

  /**
   * Validate 500 Internal Server Error responses
   */
  serverError: (response: Response) => {
    expectErrorResponse(response, 500, /internal server error|server error/i);
  },

  /**
   * Validate empty responses (204 No Content)
   */
  emptyResponse: (response: Response) => {
    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  },

  /**
   * Validate rate limit responses (429 Too Many Requests)
   */
  rateLimited: (response: Response) => {
    expectErrorResponse(response, 429, /rate limit|too many requests/i);
  },
};

/**
 * Response timing and performance testing utilities
 */
export const responsePerformance = {
  /**
   * Measure response time and validate it's under threshold
   */
  expectResponseTime: (startTime: number, maxTime: number = 1000) => {
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    expect(responseTime).toBeLessThan(maxTime);
    return responseTime;
  },

  /**
   * Create a timer for response time measurement
   */
  startTimer: () => Date.now(),

  /**
   * Mock slow response for testing timeouts
   */
  mockSlowResponse: (delay: number = 5000) => {
    return new Promise(resolve => setTimeout(resolve, delay));
  },
};

/**
 * Response content validation utilities
 */
export const contentValidators = {
  /**
   * Validate JSON response is properly formatted
   */
  isValidJSON: (responseText: string): boolean => {
    try {
      JSON.parse(responseText);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Validate response headers contain expected values
   */
  hasExpectedHeaders: (headers: any, expectedHeaders: Record<string, string>) => {
    Object.entries(expectedHeaders).forEach(([key, value]) => {
      expect(headers[key.toLowerCase()]).toBe(value);
    });
  },

  /**
   * Validate security headers are present
   */
  hasSecurityHeaders: (headers: any) => {
    const securityHeaders = ['x-content-type-options', 'x-frame-options', 'x-xss-protection'];

    securityHeaders.forEach(header => {
      expect(headers).toHaveProperty(header);
    });
  },

  /**
   * Validate CORS headers for cross-origin requests
   */
  hasCORSHeaders: (headers: any, origin?: string) => {
    expect(headers).toHaveProperty('access-control-allow-origin');
    if (origin) {
      expect(headers['access-control-allow-origin']).toBe(origin);
    }
  },
};

/**
 * Comprehensive response validation for complex scenarios
 */
export const validateComplexResponse = {
  /**
   * Validate paginated list with metadata
   */
  paginatedList: (
    response: Response,
    options?: {
      minItems?: number;
      maxItems?: number;
      hasNextPage?: boolean;
      hasPrevPage?: boolean;
    }
  ) => {
    expectSuccessResponse(response, 200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body).toHaveProperty('pagination');

    if (options?.minItems !== undefined) {
      expect(response.body.data.length).toBeGreaterThanOrEqual(options.minItems);
    }

    if (options?.maxItems !== undefined) {
      expect(response.body.data.length).toBeLessThanOrEqual(options.maxItems);
    }

    const pagination = response.body.pagination;
    expect(pagination).toHaveProperty('page');
    expect(pagination).toHaveProperty('limit');
    expect(pagination).toHaveProperty('total');

    if (options?.hasNextPage !== undefined) {
      expect(pagination).toHaveProperty('hasNextPage', options.hasNextPage);
    }

    if (options?.hasPrevPage !== undefined) {
      expect(pagination).toHaveProperty('hasPrevPage', options.hasPrevPage);
    }
  },

  /**
   * Validate nested object response with required fields
   */
  nestedObject: (response: Response, schema: Record<string, any>) => {
    expectSuccessResponse(response, 200);

    const validateSchema = (obj: any, schemaObj: Record<string, any>, path: string = '') => {
      Object.entries(schemaObj).forEach(([key, expectedType]) => {
        const currentPath = path ? `${path}.${key}` : key;

        expect(obj).toHaveProperty(key);

        if (typeof expectedType === 'string') {
          expect(typeof obj[key]).toBe(expectedType);
        } else if (typeof expectedType === 'object' && expectedType !== null) {
          validateSchema(obj[key], expectedType, currentPath);
        }
      });
    };

    validateSchema(response.body, schema);
  },

  /**
   * Validate array of objects with consistent structure
   */
  arrayOfObjects: (
    response: Response,
    itemSchema: Record<string, string>,
    minItems: number = 0
  ) => {
    expectSuccessResponse(response, 200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(minItems);

    if (response.body.length > 0) {
      response.body.forEach((item: any, _index: number) => {
        Object.entries(itemSchema).forEach(([key, expectedType]) => {
          expect(item).toHaveProperty(key);
          expect(typeof item[key]).toBe(expectedType);
        });
      });
    }
  },
};
