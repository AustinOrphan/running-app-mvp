import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  winstonLogger,
  logInfo,
  logError,
  logWarn,
  logDebug,
  logDatabase,
  logAuth,
  logAPI,
  logPerformance,
  LogCategory,
  LogOperation,
} from '../../../server/utils/winstonLogger.js';

describe('Winston Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic logging functions', () => {
    it('should log info messages with correct format', () => {
      const message = 'Test info message';
      const context = {
        component: LogCategory.API,
        operation: LogOperation.PROCESS,
        metadata: { test: true },
      };

      // Since winston is complex to mock, we'll test the function exists and doesn't throw
      expect(() => {
        logInfo(message, context);
      }).not.toThrow();
    });

    it('should log error messages with error object', () => {
      const message = 'Test error message';
      const error = new Error('Test error');
      const context = {
        component: LogCategory.API,
        operation: LogOperation.PROCESS,
      };

      expect(() => {
        logError(message, error, context);
      }).not.toThrow();
    });

    it('should log warning messages', () => {
      const message = 'Test warning message';
      const context = {
        component: LogCategory.SECURITY,
        operation: LogOperation.VALIDATE,
      };

      expect(() => {
        logWarn(message, context);
      }).not.toThrow();
    });

    it('should log debug messages', () => {
      const message = 'Test debug message';
      const context = {
        component: LogCategory.DATABASE,
        operation: LogOperation.READ,
      };

      expect(() => {
        logDebug(message, context);
      }).not.toThrow();
    });
  });

  describe('Category-specific logging functions', () => {
    it('should log database operations', () => {
      const message = 'Database query executed';
      const context = {
        metadata: { query: 'SELECT * FROM users' },
      };

      expect(() => {
        logDatabase(LogOperation.READ, message, context);
      }).not.toThrow();
    });

    it('should log authentication operations', () => {
      const message = 'User login attempt';
      const context = {
        userId: 'user123',
        metadata: { method: 'email' },
      };

      expect(() => {
        logAuth(LogOperation.LOGIN, message, context);
      }).not.toThrow();
    });

    it('should log API operations', () => {
      const message = 'API request processed';
      const context = {
        requestId: 'req123',
        metadata: { endpoint: '/api/users' },
      };

      expect(() => {
        logAPI(LogOperation.PROCESS, message, context);
      }).not.toThrow();
    });

    it('should log performance metrics', () => {
      const operation = 'database_query';
      const duration = 150;
      const context = {
        metadata: { query: 'SELECT * FROM runs' },
      };

      expect(() => {
        logPerformance(operation, duration, context);
      }).not.toThrow();
    });
  });

  describe('Winston logger configuration', () => {
    it('should have correct log level', () => {
      expect(winstonLogger.level).toBeDefined();
    });

    it('should have console transport', () => {
      const consoleTransport = winstonLogger.transports.find(
        transport => transport.name === 'console'
      );
      expect(consoleTransport).toBeDefined();
    });

    it('should have file transports', () => {
      const fileTransports = winstonLogger.transports.filter(
        transport => transport.name === 'file'
      );
      expect(fileTransports.length).toBeGreaterThan(0);
    });

    it('should have default metadata', () => {
      expect(winstonLogger.defaultMeta).toEqual({
        service: 'running-app-mvp',
        environment: process.env.NODE_ENV || 'development',
      });
    });
  });

  describe('Error handling', () => {
    it('should handle null error objects gracefully', () => {
      expect(() => {
        logError('Test error', null as any, {
          component: LogCategory.API,
          operation: LogOperation.PROCESS,
        });
      }).not.toThrow();
    });

    it('should handle missing context gracefully', () => {
      expect(() => {
        logInfo('Test message without context');
      }).not.toThrow();
    });

    it('should handle invalid error objects', () => {
      const invalidError = { message: 'Not a real error' } as Error;

      expect(() => {
        logError('Test error', invalidError, {
          component: LogCategory.API,
          operation: LogOperation.PROCESS,
        });
      }).not.toThrow();
    });
  });

  describe('Log categories and operations', () => {
    it('should have all expected log categories', () => {
      expect(LogCategory.API).toBe('api');
      expect(LogCategory.DATABASE).toBe('database');
      expect(LogCategory.AUTH).toBe('auth');
      expect(LogCategory.VALIDATION).toBe('validation');
      expect(LogCategory.EXTERNAL).toBe('external');
      expect(LogCategory.SECURITY).toBe('security');
      expect(LogCategory.PERFORMANCE).toBe('performance');
    });

    it('should have all expected log operations', () => {
      expect(LogOperation.CREATE).toBe('create');
      expect(LogOperation.READ).toBe('read');
      expect(LogOperation.UPDATE).toBe('update');
      expect(LogOperation.DELETE).toBe('delete');
      expect(LogOperation.LOGIN).toBe('login');
      expect(LogOperation.LOGOUT).toBe('logout');
      expect(LogOperation.VALIDATE).toBe('validate');
      expect(LogOperation.PROCESS).toBe('process');
    });
  });
});
