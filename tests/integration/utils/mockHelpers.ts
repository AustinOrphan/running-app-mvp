import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Create a mock Express request object
 */
export function createMockRequest(options: {
  method?: string;
  url?: string;
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  user?: any;
}): Partial<Request> {
  return {
    method: options.method || 'GET',
    url: options.url || '/',
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    headers: options.headers || {},
    user: options.user,
    get: jest.fn((name: string) => options.headers?.[name.toLowerCase()]),
    header: jest.fn((name: string) => options.headers?.[name.toLowerCase()]),
    accepts: jest.fn(),
    is: jest.fn(),
  } as Partial<Request>;
}

/**
 * Create a mock Express response object
 */
export function createMockResponse(): Partial<Response> {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    removeHeader: jest.fn().mockReturnThis(),
    getHeader: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({}),
    headersSent: false,
    statusCode: 200,
    statusMessage: 'OK',
    locals: {},
  };

  // Enhanced chaining with status code tracking
  const statusMock = res.status as jest.Mock;
  statusMock.mockImplementation((code: number) => {
    res.statusCode = code;
    res.statusMessage = getStatusMessage(code);
    return res;
  });

  // Enhanced JSON mock with better validation
  const jsonMock = res.json as jest.Mock;
  jsonMock.mockImplementation((body: any) => {
    // Validate JSON-serializable content
    try {
      JSON.stringify(body);
    } catch {
      throw new Error('Response body is not JSON serializable');
    }
    return res;
  });

  // Add circular reference for chaining
  (res.send as any).mockReturnValue(res);
  (res.set as any).mockReturnValue(res);
  (res.header as any).mockReturnValue(res);
  (res.cookie as any).mockReturnValue(res);
  (res.clearCookie as any).mockReturnValue(res);
  (res.redirect as any).mockReturnValue(res);
  (res.end as any).mockReturnValue(res);
  (res.setHeader as any).mockReturnValue(res);
  (res.removeHeader as any).mockReturnValue(res);

  return res;
}

/**
 * Get HTTP status message for status code
 */
function getStatusMessage(code: number): string {
  const statusMessages: Record<number, string> = {
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
  return statusMessages[code] || 'Unknown';
}

/**
 * Create a mock Next function
 */
export function createMockNext(): NextFunction {
  return jest.fn() as any;
}

/**
 * Helper to wait for async middleware
 */
export async function callMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
  req: Partial<Request>,
  res: Partial<Response>,
  next: NextFunction
): Promise<void> {
  const result = middleware(req as Request, res as Response, next);
  if (result instanceof Promise) {
    await result;
  }
}

/**
 * Assert that a response has a specific status and JSON body
 */
export function assertResponse(res: Partial<Response>, expectedStatus: number, expectedBody?: any) {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);

  if (expectedBody !== undefined) {
    if (typeof expectedBody === 'object' && expectedBody !== null && !Array.isArray(expectedBody)) {
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining(expectedBody));
    } else {
      expect(res.json).toHaveBeenCalledWith(expectedBody);
    }
  }
}

/**
 * Assert that an error was passed to next()
 */
export function assertErrorPassed(next: NextFunction, errorMessage?: string) {
  expect(next).toHaveBeenCalledWith(expect.any(Error));

  if (errorMessage) {
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error.message).toContain(errorMessage);
  }
}

/**
 * Mock database operations
 */
export function mockPrismaOperation(prismaModel: any, operation: string, returnValue: any) {
  if (!prismaModel[operation]) {
    prismaModel[operation] = jest.fn();
  }
  return (prismaModel[operation] as jest.Mock).mockResolvedValue(returnValue);
}

/**
 * Mock database error
 */
export function mockPrismaError(prismaModel: any, operation: string, error: Error) {
  if (!prismaModel[operation]) {
    prismaModel[operation] = jest.fn();
  }
  return (prismaModel[operation] as jest.Mock).mockRejectedValue(error);
}

/**
 * Create a mock Prisma client with common operations
 */
export function createMockPrismaClient() {
  return {
    user: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    run: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    goal: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    race: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(fn => {
      if (typeof fn === 'function') {
        return Promise.resolve(fn(this));
      }
      return Promise.resolve(fn);
    }),
    $on: jest.fn(),
    $use: jest.fn(),
    $extends: jest.fn(),
  };
}

/**
 * Reset all mocks in a Prisma client
 */
export function resetMockPrismaClient(mockPrisma: any) {
  Object.values(mockPrisma).forEach((model: any) => {
    if (typeof model === 'object') {
      Object.values(model).forEach((operation: any) => {
        if (typeof operation === 'function' && 'mockReset' in operation) {
          operation.mockReset();
        }
      });
    } else if (typeof model === 'function' && 'mockReset' in model) {
      model.mockReset();
    }
  });
}

/**
 * Enhanced response assertion with better structure validation
 */
export function assertResponseStructure(
  res: Partial<Response>,
  expectedStatus: number,
  options?: {
    hasError?: boolean;
    hasMessage?: boolean;
    hasData?: boolean;
    customFields?: string[];
    exactBody?: any;
  }
) {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);

  if (options?.exactBody) {
    expect(res.json).toHaveBeenCalledWith(options.exactBody);
    return;
  }

  const calls = (res.json as jest.Mock).mock.calls;
  expect(calls).toHaveLength(1);
  const responseBody = calls[0][0];

  if (options?.hasError !== undefined) {
    if (options.hasError) {
      expect(responseBody).toHaveProperty('error', true);
    } else {
      expect(responseBody).not.toHaveProperty('error', true);
    }
  }

  if (options?.hasMessage) {
    expect(responseBody).toHaveProperty('message');
    expect(typeof responseBody.message).toBe('string');
  }

  if (options?.hasData) {
    expect(responseBody).toHaveProperty('data');
  }

  if (options?.customFields) {
    options.customFields.forEach(field => {
      expect(responseBody).toHaveProperty(field);
    });
  }
}

/**
 * Mock HTTP error responses with proper status codes and structure
 */
export function createMockErrorResponse(status: number, message: string, details?: any) {
  return {
    error: true,
    message,
    status,
    ...(details && { details }),
    timestamp: expect.any(String),
  };
}

/**
 * Mock successful API responses with consistent structure
 */
export function createMockSuccessResponse(data?: any, message?: string) {
  const response: any = {};

  if (message) {
    response.message = message;
  }

  if (data !== undefined) {
    if (Array.isArray(data) || typeof data === 'object') {
      Object.assign(response, data);
    } else {
      response.data = data;
    }
  }

  return response;
}

/**
 * Mock network timeout/error scenarios
 */
export function mockNetworkError(type: 'timeout' | 'connection' | 'server_error' = 'connection') {
  const errors = {
    timeout: new Error('ETIMEDOUT'),
    connection: new Error('ECONNREFUSED'),
    server_error: new Error('Internal Server Error'),
  };

  const error = errors[type];
  (error as any).code = type.toUpperCase();
  return error;
}

/**
 * Enhanced mock response for supertest integration
 */
export function mockSupertestResponse(statusCode: number, body: any) {
  return {
    status: statusCode,
    body,
    headers: {},
    get: jest.fn((header: string) => {
      const headerMap: Record<string, string> = {
        'content-type': 'application/json',
        'x-request-id': 'test-request-id',
      };
      return headerMap[header.toLowerCase()];
    }),
    expect: jest.fn().mockReturnThis(),
  };
}

/**
 * Mock async request handling with proper error simulation
 */
export function mockAsyncRequest(
  shouldSucceed: boolean = true,
  responseData?: any,
  errorType?: 'validation' | 'auth' | 'notfound' | 'server'
) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldSucceed) {
        resolve(responseData || { success: true });
      } else {
        const errors = {
          validation: { status: 400, message: 'Validation error' },
          auth: { status: 401, message: 'Unauthorized' },
          notfound: { status: 404, message: 'Not found' },
          server: { status: 500, message: 'Internal server error' },
        };
        reject(errors[errorType || 'server']);
      }
    }, 10); // Small delay to simulate async
  });
}

/**
 * Validate response body structure matches expected patterns
 */
export function validateApiResponse(
  responseBody: any,
  expectedPattern: 'success' | 'error' | 'list' | 'item'
) {
  switch (expectedPattern) {
    case 'success':
      expect(responseBody).toHaveProperty('message');
      expect(responseBody.error).not.toBe(true);
      break;
    case 'error':
      expect(responseBody).toHaveProperty('error', true);
      expect(responseBody).toHaveProperty('message');
      expect(typeof responseBody.message).toBe('string');
      break;
    case 'list':
      expect(Array.isArray(responseBody)).toBe(true);
      break;
    case 'item':
      expect(responseBody).toHaveProperty('id');
      expect(typeof responseBody).toBe('object');
      break;
  }
}
