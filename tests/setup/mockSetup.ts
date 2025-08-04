// Mock setup for Jest tests
// This file contains all the jest.mock calls that are used across multiple test files

import { jest } from '@jest/globals';

// Enhanced mock utilities for better error handling and response consistency
export const mockApiResponse = (data: any, status = 200) => ({
  status,
  data,
  headers: { 'content-type': 'application/json' },
  statusText: status >= 400 ? 'Error' : 'OK',
});

export const mockApiError = (message: string, status = 500, details?: any) => ({
  error: true,
  message,
  statusCode: status,
  category: status >= 400 && status < 500 ? 'client-error' : 'server-error',
  timestamp: new Date().toISOString(),
  details,
});

// Mock secureLogger with proper async handling
jest.mock('../../server/utils/secureLogger.ts', () => ({
  secureLogger: {
    info: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue(undefined),
  },
  logUserAction: jest
    .fn()
    .mockResolvedValue({ success: true, timestamp: new Date().toISOString() }),
}));

// Mock logger with proper async handling
jest.mock('../../server/utils/logger.ts', () => ({
  logError: jest.fn().mockResolvedValue(undefined),
  logInfo: jest.fn().mockResolvedValue(undefined),
  logAuth: jest.fn().mockResolvedValue(undefined),
  logDebug: jest.fn().mockResolvedValue(undefined),
  logWarn: jest.fn().mockResolvedValue(undefined),
}));

// Mock winstonLogger - moved to individual test files

// Mock auditLogger and related exports
jest.mock('../../server/utils/auditLogger.js', () => ({
  auditLogger: {
    logEvent: jest.fn().mockResolvedValue(true),
    queryEvents: jest.fn().mockResolvedValue([]),
    getStatistics: jest.fn().mockResolvedValue({}),
  },
  auditAuth: {
    login: jest.fn().mockResolvedValue(true),
    logout: jest.fn().mockResolvedValue(true),
    register: jest.fn().mockResolvedValue(true),
    refresh: jest.fn().mockResolvedValue(true),
    passwordChange: jest.fn().mockResolvedValue(true),
  },
  auditData: {
    create: jest.fn().mockResolvedValue(true),
    read: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true),
  },
  auditSecurity: {
    attackDetected: jest.fn().mockResolvedValue(true),
    rateLimitExceeded: jest.fn().mockResolvedValue(true),
    suspiciousActivity: jest.fn().mockResolvedValue(true),
  },
}));

// Remove errorHandler mock to allow real error responses
// jest.mock('../../server/middleware/errorHandler.ts', () => ({
//   errorHandler: jest.fn(),
// }));

// Enhanced JWT Utils Mock with proper error handling and response patterns
jest.mock('../../server/utils/jwtUtils.ts', () => ({
  generateTokens: jest.fn(user => {
    if (!user || !user.id || !user.email) {
      throw new Error('Invalid user data for token generation');
    }
    return {
      accessToken:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QtdXNlci1pZCIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSJ9.test-signature',
      refreshToken:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QtdXNlci1pZCIsInR5cGUiOiJyZWZyZXNoIn0.refresh-signature',
    };
  }),
  verifyToken: jest.fn((token, type = 'access') => {
    if (!token || token === 'invalid.token' || token === 'expired.token') {
      const error = new Error('Invalid token');
      (error as any).statusCode = 401;
      throw error;
    }
    return {
      id: 'test-user-id',
      email: 'test@example.com',
      type,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'test-token-id',
    };
  }),
  validateToken: jest.fn((token, type = 'access') => {
    if (!token || token === 'invalid.refresh.token') {
      const error = new Error('Invalid token');
      (error as any).statusCode = 401;
      throw error;
    }
    return {
      id: 'test-user-id',
      email: 'test@example.com',
      type,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'test-token-id',
    };
  }),
  extractTokenFromHeader: jest.fn(header => {
    if (!header) return null;
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
  }),
  blacklistToken: jest.fn().mockResolvedValue(true),
}));

// Enhanced HTTP response mocking utilities
global.mockHttpResponse = {
  // Mock successful responses with proper JSON structure
  success: (data: any, statusCode = 200) => ({
    statusCode,
    json: jest.fn().mockReturnValue(data),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnValue(data),
  }),

  // Mock error responses with proper error structure
  error: (message: string, statusCode = 500, errorCode?: string) => ({
    statusCode,
    json: jest.fn().mockReturnValue({
      error: true,
      message,
      statusCode,
      category: statusCode >= 500 ? 'server_error' : 'client_error',
      timestamp: new Date().toISOString(),
      ...(errorCode && { errorCode }),
    }),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  }),

  // Mock async operations with proper promise handling
  async: (data: any, delay = 0) =>
    new Promise(resolve => {
      setTimeout(() => resolve(data), delay);
    }),

  // Mock edge cases like timeouts and network errors
  timeout: () =>
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 100);
    }),

  networkError: () => Promise.reject(new Error('Network error')),
};

// Declare global types for TypeScript
declare global {
  var mockHttpResponse: {
    success: (data: any, statusCode?: number) => any;
    error: (message: string, statusCode?: number, errorCode?: string) => any;
    async: (data: any, delay?: number) => Promise<any>;
    timeout: () => Promise<never>;
    networkError: () => Promise<never>;
  };
}
