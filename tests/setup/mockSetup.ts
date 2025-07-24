// Mock setup for Jest tests
// This file contains all the jest.mock calls that are used across multiple test files

import { jest } from '@jest/globals';

// Mock secureLogger
jest.mock('../../server/utils/secureLogger.ts', () => ({
  secureLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn()
  }
}));

// Mock logger
jest.mock('../../server/utils/logger.ts', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logAuth: jest.fn(),
  logDebug: jest.fn(),
  logWarn: jest.fn()
}));

// Mock winstonLogger - moved to individual test files

// Mock auditLogger and related exports
jest.mock('../../server/utils/auditLogger.js', () => ({
  auditLogger: {
    logEvent: jest.fn(),
    queryEvents: jest.fn(),
    getStatistics: jest.fn()
  },
  auditAuth: {
    login: jest.fn(),
    logout: jest.fn(),
    register: jest.fn(),
    refresh: jest.fn(),
    passwordChange: jest.fn()
  },
  auditData: {
    create: jest.fn(),
    read: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  auditSecurity: {
    attackDetected: jest.fn(),
    rateLimitExceeded: jest.fn(),
    suspiciousActivity: jest.fn()
  }
}));

// Mock errorHandler
jest.mock('../../server/middleware/errorHandler.ts', () => ({
  errorHandler: jest.fn()
}));

// Mock jwtUtils
jest.mock('../../server/utils/jwtUtils.ts', () => ({
  generateTokens: jest.fn(),
  verifyToken: jest.fn()
}));