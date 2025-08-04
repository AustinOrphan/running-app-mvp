import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Enhanced request/response mocking utilities for integration tests
 * Addresses the issues identified in task: "Fix request/response mocking"
 */

/**
 * Create an enhanced mock Express request object with better type safety
 */
export function createEnhancedMockRequest(options: {
  method?: string;
  url?: string;
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  user?: any;
  cookies?: Record<string, string>;
  ip?: string;
  protocol?: string;
  hostname?: string;
  path?: string;
}): Partial<Request> {
  const headers = { ...options.headers };

  return {
    method: options.method || 'GET',
    url: options.url || '/',
    originalUrl: options.url || '/',
    path: options.path || '/',
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    headers,
    user: options.user,
    cookies: options.cookies || {},
    ip: options.ip || '127.0.0.1',
    protocol: options.protocol || 'http',
    hostname: options.hostname || 'localhost',
    get: jest.fn((name: string) => headers[name.toLowerCase()]),
    header: jest.fn((name: string) => headers[name.toLowerCase()]),
    accepts: jest.fn().mockReturnValue(true),
    acceptsCharsets: jest.fn().mockReturnValue(true),
    acceptsEncodings: jest.fn().mockReturnValue(true),
    acceptsLanguages: jest.fn().mockReturnValue(true),
    is: jest.fn().mockReturnValue(false),
    param: jest.fn((name: string) => options.params?.[name] || options.query?.[name]),
    range: jest.fn(),
  } as Partial<Request>;
}

/**
 * Create an enhanced mock Express response object with better status tracking
 */
export function createEnhancedMockResponse(): Partial<Response> {
  let statusCode = 200;
  let sentData: any = null;
  let jsonData: any = null;
  const headers: Record<string, string> = {};
  let headersSent = false;

  const res: Partial<Response> = {
    statusCode,
    statusMessage: 'OK',
    headersSent,
    locals: {},

    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    }),

    json: jest.fn().mockImplementation((data: any) => {
      jsonData = data;
      headersSent = true;
      res.headersSent = true;
      return res;
    }),

    send: jest.fn().mockImplementation((data: any) => {
      sentData = data;
      headersSent = true;
      res.headersSent = true;
      return res;
    }),

    set: jest.fn().mockImplementation((field: string | Record<string, string>, value?: string) => {
      if (typeof field === 'object') {
        Object.assign(headers, field);
      } else if (typeof field === 'string' && value !== undefined) {
        headers[field.toLowerCase()] = value;
      }
      return res;
    }),

    header: jest.fn().mockImplementation((field: string, value: string) => {
      headers[field.toLowerCase()] = value;
      return res;
    }),

    setHeader: jest.fn().mockImplementation((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
      return res;
    }),

    getHeader: jest.fn().mockImplementation((name: string) => {
      return headers[name.toLowerCase()];
    }),

    getHeaders: jest.fn().mockImplementation(() => ({ ...headers })),

    removeHeader: jest.fn().mockImplementation((name: string) => {
      delete headers[name.toLowerCase()];
      return res;
    }),

    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),

    redirect: jest.fn().mockImplementation((urlOrStatus?: string | number, url?: string) => {
      if (typeof urlOrStatus === 'number') {
        statusCode = urlOrStatus;
        res.statusCode = urlOrStatus;
      }
      headersSent = true;
      res.headersSent = true;
      return res;
    }),

    end: jest.fn().mockImplementation((data?: any) => {
      if (data !== undefined) {
        sentData = data;
      }
      headersSent = true;
      res.headersSent = true;
      return res;
    }),
  };

  return res;
}

/**
 * Enhanced assertion helpers with better error messages
 */
export function assertEnhancedResponse(
  res: Partial<Response>,
  expectedStatus: number,
  expectedBody?: any,
  options: {
    strict?: boolean;
    checkHeaders?: Record<string, string>;
  } = {}
) {
  // Assert status was called with expected value
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  expect(res.statusCode).toBe(expectedStatus);

  if (expectedBody !== undefined) {
    if (options.strict) {
      expect(res.json).toHaveBeenCalledWith(expectedBody);
    } else if (typeof expectedBody === 'object' && expectedBody !== null) {
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining(expectedBody));
    } else {
      expect(res.json).toHaveBeenCalledWith(expectedBody);
    }
  }

  // Check headers if specified
  if (options.checkHeaders) {
    Object.entries(options.checkHeaders).forEach(([key, value]) => {
      expect(res.set).toHaveBeenCalledWith(expect.stringMatching(new RegExp(key, 'i')), value);
    });
  }
}

/**
 * Assert response error with proper error structure
 */
export function assertErrorResponse(
  res: Partial<Response>,
  expectedStatus: number,
  expectedErrorMessage?: string,
  expectedErrorCode?: string
) {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);

  const jsonCalls = (res.json as jest.Mock).mock.calls;
  expect(jsonCalls.length).toBeGreaterThan(0);

  const errorResponse = jsonCalls[jsonCalls.length - 1][0];
  expect(errorResponse).toHaveProperty('error', true);

  if (expectedErrorMessage) {
    expect(errorResponse.message).toContain(expectedErrorMessage);
  }

  if (expectedErrorCode) {
    expect(errorResponse.code).toBe(expectedErrorCode);
  }
}

/**
 * Assert that redirect was called correctly
 */
export function assertRedirectResponse(
  res: Partial<Response>,
  expectedUrl: string,
  expectedStatus?: number
) {
  if (expectedStatus) {
    expect(res.status).toHaveBeenCalledWith(expectedStatus);
  }
  expect(res.redirect).toHaveBeenCalledWith(expectedUrl);
}

/**
 * Mock HTTP request with proper status code simulation
 */
export function mockHttpRequest(
  method: string,
  path: string,
  options: {
    body?: any;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    params?: Record<string, string>;
    user?: any;
    expectedStatus?: number;
    expectedResponse?: any;
  } = {}
) {
  const req = createEnhancedMockRequest({
    method: method.toUpperCase(),
    url: path,
    path,
    body: options.body,
    headers: options.headers,
    query: options.query,
    params: options.params,
    user: options.user,
  });

  const res = createEnhancedMockResponse();
  const next = jest.fn();

  return { req, res, next };
}

/**
 * Create comprehensive mock for API endpoint testing
 */
export function createApiTestMock(
  endpoint: string,
  method: string,
  scenario: {
    requestBody?: any;
    queryParams?: Record<string, string>;
    headers?: Record<string, string>;
    user?: any;
    expectedStatus: number;
    expectedResponse?: any;
    expectedHeaders?: Record<string, string>;
  }
) {
  const { req, res, next } = mockHttpRequest(method, endpoint, {
    body: scenario.requestBody,
    query: scenario.queryParams,
    headers: scenario.headers,
    user: scenario.user,
  });

  return {
    req,
    res,
    next,
    assertResponse: () => {
      assertEnhancedResponse(res, scenario.expectedStatus, scenario.expectedResponse, {
        checkHeaders: scenario.expectedHeaders,
      });
    },
    assertError: (message?: string, code?: string) => {
      assertErrorResponse(res, scenario.expectedStatus, message, code);
    },
  };
}

/**
 * Edge case handler for response mocking
 */
export function handleMockEdgeCases(res: Partial<Response>) {
  // Handle double status calls
  const originalStatus = res.status as jest.Mock;
  (res.status as jest.Mock).mockImplementation((code: number) => {
    if (res.headersSent) {
      throw new Error('Cannot set headers after they are sent');
    }
    return originalStatus(code);
  });

  // Handle double response sends
  const originalJson = res.json as jest.Mock;
  const originalSend = res.send as jest.Mock;

  let responseSent = false;

  (res.json as jest.Mock).mockImplementation((data: any) => {
    if (responseSent) {
      throw new Error('Cannot set headers after they are sent');
    }
    responseSent = true;
    return originalJson(data);
  });

  (res.send as jest.Mock).mockImplementation((data: any) => {
    if (responseSent) {
      throw new Error('Cannot set headers after they are sent');
    }
    responseSent = true;
    return originalSend(data);
  });

  return res;
}

/**
 * Create mock for async operations with proper promise handling
 */
export async function mockAsyncOperation<T>(
  operation: () => Promise<T>,
  mockResult?: T,
  shouldThrow?: Error
): Promise<T> {
  const mockFn = jest.fn();

  if (shouldThrow) {
    mockFn.mockRejectedValue(shouldThrow);
  } else if (mockResult !== undefined) {
    mockFn.mockResolvedValue(mockResult);
  } else {
    mockFn.mockImplementation(operation);
  }

  return mockFn();
}

/**
 * Reset all enhanced mocks
 */
export function resetEnhancedMocks(mocks: { req: any; res: any; next: any }) {
  jest.clearAllMocks();

  // Reset specific mock states
  if (mocks.res) {
    mocks.res.headersSent = false;
    mocks.res.statusCode = 200;
  }
}
