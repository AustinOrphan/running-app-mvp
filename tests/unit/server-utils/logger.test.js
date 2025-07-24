import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request } from 'express';
import {
  logger,
  logError,
  logWarn,
  logInfo,
  logDatabase,
  logAuth,
  correlationMiddleware,
} from '../../../server/utils/logger.js';
import { secureLogger } from '../../../server/utils/secureLogger.js';

// Mock dependencies
vi.mock('../../../server/utils/secureLogger.js', () => ({
  secureLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-12345'),
}));

describe('Enhanced Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Error Categorization', () => {
    it('should categorize JWT errors as AuthenticationError', () => {
      const error = new Error('JsonWebTokenError');
      error.constructor = { name: 'JsonWebTokenError' };

      logger.error(
        { component: 'auth', operation: 'login', req: undefined },
        error,
        'JWT validation failed'
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        'JWT validation failed',
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'AuthenticationError',
          }),
        })
      );
    });

    it('should categorize Prisma errors as DatabaseError', () => {
      const error = new Error('Database connection failed');
      error.constructor = { name: 'PrismaClientKnownRequestError' };

      logger.error(
        { component: 'database', operation: 'query', req: undefined },
        error
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'DatabaseError',
          }),
        })
      );
    });

    it('should categorize Zod errors as ValidationError', () => {
      const error = new Error('Validation failed');
      error.constructor = { name: 'ZodError' };

      logger.error(
        { component: 'api', operation: 'validate', req: undefined },
        error
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'ValidationError',
          }),
        })
      );
    });

    it('should use status code for categorization when available', () => {
      const error = new Error('Not found');

      logger.error(
        { 
          component: 'api', 
          operation: 'fetch', 
          req: undefined,
          context: { statusCode: 404 }
        },
        error
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'NotFoundError',
          }),
        })
      );
    });

    it('should fallback to string matching for error categorization', () => {
      const testCases = [
        { message: 'unauthorized access', expectedType: 'AuthenticationError' },
        { message: 'access denied', expectedType: 'AuthorizationError' },
        { message: 'field is required', expectedType: 'ValidationError' },
        { message: 'already exists', expectedType: 'ConflictError' },
        { message: 'network timeout', expectedType: 'NetworkError' },
        { message: 'config not found', expectedType: 'NotFoundError' },
      ];

      testCases.forEach(({ message, expectedType }) => {
        const error = new Error(message);

        logger.error(
          { component: 'test', operation: 'test', req: undefined },
          error
        );

        expect(secureLogger.error).toHaveBeenCalledWith(
          expect.any(String),
          undefined,
          error,
          expect.objectContaining({
            error: expect.objectContaining({
              type: expectedType,
            }),
          })
        );

        vi.clearAllMocks();
      });
    });

    it('should categorize unknown errors as UnknownError', () => {
      const error = new Error('Something went wrong');

      logger.error(
        { component: 'test', operation: 'test', req: undefined },
        error
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'UnknownError',
          }),
        })
      );
    });
  });

  describe('Correlation ID Management', () => {
    it('should generate correlation ID when not present', () => {
      const mockReq = {};

      logger.info(
        { component: 'api', operation: 'request', req: mockReq },
        'New request'
      );

      expect(mockReq.correlationId).toBe('mock-uuid-12345');
      expect(secureLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        mockReq,
        expect.objectContaining({
          correlationId: 'mock-uuid-12345',
        })
      );
    });

    it('should use existing correlation ID from request', () => {
      const mockReq = { correlationId: 'existing-correlation-id' };

      logger.info(
        { component: 'api', operation: 'request', req: mockReq },
        'Request with correlation ID'
      );

      expect(secureLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        mockReq,
        expect.objectContaining({
          correlationId: 'existing-correlation-id',
        })
      );
    });

    it('should handle missing request object', () => {
      logger.info(
        { component: 'system', operation: 'startup', req: undefined },
        'System starting'
      );

      expect(secureLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.objectContaining({
          correlationId: 'mock-uuid-12345',
        })
      );
    });
  });

  describe('Structured Logging', () => {
    it('should create structured log data with all fields', () => {
      const mockReq = { correlationId: 'test-correlation' };
      const context = { userId: 'user123', action: 'create' };

      logger.info(
        { 
          component: 'api', 
          operation: 'createUser', 
          req: mockReq,
          context 
        },
        'User created'
      );

      expect(secureLogger.info).toHaveBeenCalledWith(
        'api:createUser - User created',
        mockReq,
        expect.objectContaining({
          timestamp: expect.any(String),
          level: 'info',
          correlationId: 'test-correlation',
          component: 'api',
          operation: 'createUser',
          context,
        })
      );
    });

    it('should include error details in structured data', () => {
      const error = new Error('Test error');
      error.code = 'ERR_TEST';
      process.env.NODE_ENV = 'development';

      logger.error(
        { component: 'test', operation: 'test', req: undefined },
        error
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Test error',
            type: expect.any(String),
            code: 'ERR_TEST',
            stack: expect.stringContaining('Error: Test error'),
          }),
        })
      );
    });

    it('should exclude stack trace in production', () => {
      const error = new Error('Production error');
      process.env.NODE_ENV = 'production';

      logger.error(
        { component: 'test', operation: 'test', req: undefined },
        error
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        error,
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Production error',
            stack: undefined,
          }),
        })
      );
    });
  });

  describe('Log Levels', () => {
    it('should log error messages', () => {
      const error = new Error('Error message');

      logger.error(
        { component: 'test', operation: 'test', req: undefined },
        error,
        'Custom error message'
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        'Custom error message',
        undefined,
        error,
        expect.any(Object)
      );
    });

    it('should log warning messages', () => {
      logger.warn(
        { component: 'test', operation: 'test', req: undefined },
        'Warning message'
      );

      expect(secureLogger.warn).toHaveBeenCalledWith(
        'test:test - Warning message',
        undefined,
        expect.any(Object)
      );
    });

    it('should log info messages', () => {
      logger.info(
        { component: 'test', operation: 'test', req: undefined },
        'Info message'
      );

      expect(secureLogger.info).toHaveBeenCalledWith(
        'test:test - Info message',
        undefined,
        expect.any(Object)
      );
    });

    it('should log debug messages only in development', () => {
      process.env.NODE_ENV = 'development';

      logger.debug(
        { component: 'test', operation: 'test', req: undefined },
        'Debug message'
      );

      expect(secureLogger.debug).toHaveBeenCalledWith(
        'test:test - Debug message',
        undefined,
        expect.any(Object)
      );
    });

    it('should not log debug messages in production', () => {
      process.env.NODE_ENV = 'production';

      logger.debug(
        { component: 'test', operation: 'test', req: undefined },
        'Debug message'
      );

      expect(secureLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe('Specialized Logging Methods', () => {
    it('should log database operations', () => {
      const mockReq = {};

      logger.database('SELECT', mockReq, null, { table: 'users' });

      expect(secureLogger.info).toHaveBeenCalledWith(
        'database:SELECT - Database operation completed: SELECT',
        mockReq,
        expect.objectContaining({
          component: 'database',
          operation: 'SELECT',
          context: { table: 'users' },
        })
      );
    });

    it('should log database errors', () => {
      const error = new Error('Connection lost');
      const mockReq = {};

      logger.database('INSERT', mockReq, error, { table: 'runs' });

      expect(secureLogger.error).toHaveBeenCalledWith(
        'Database operation failed: INSERT',
        mockReq,
        error,
        expect.objectContaining({
          component: 'database',
          operation: 'INSERT',
          context: { table: 'runs' },
        })
      );
    });

    it('should log authentication events', () => {
      const mockReq = {};

      logger.auth('login', mockReq, null, { userId: 'user123' });

      expect(secureLogger.info).toHaveBeenCalledWith(
        'auth:login - Authentication login successful',
        mockReq,
        expect.objectContaining({
          component: 'auth',
          operation: 'login',
          context: { userId: 'user123' },
        })
      );
    });

    it('should log authentication failures', () => {
      const error = new Error('Invalid credentials');
      const mockReq = {};

      logger.auth('login', mockReq, error, { email: 'test@example.com' });

      expect(secureLogger.error).toHaveBeenCalledWith(
        'Authentication login failed',
        mockReq,
        error,
        expect.objectContaining({
          component: 'auth',
          operation: 'login',
          context: { email: 'test@example.com' },
        })
      );
    });
  });

  describe('Convenience Functions', () => {
    it('should provide logError convenience function', () => {
      const error = new Error('Test error');
      const mockReq = {};

      logError('api', 'test', error, mockReq, { extra: 'data' });

      expect(secureLogger.error).toHaveBeenCalled();
    });

    it('should provide logWarn convenience function', () => {
      const mockReq = {};

      logWarn('api', 'test', 'Warning message', mockReq, { extra: 'data' });

      expect(secureLogger.warn).toHaveBeenCalled();
    });

    it('should provide logInfo convenience function', () => {
      const mockReq = {};

      logInfo('api', 'test', 'Info message', mockReq, { extra: 'data' });

      expect(secureLogger.info).toHaveBeenCalled();
    });

    it('should provide logDatabase convenience function', () => {
      const mockReq = {};

      logDatabase('SELECT', mockReq, null, { table: 'users' });

      expect(secureLogger.info).toHaveBeenCalled();
    });

    it('should provide logAuth convenience function', () => {
      const mockReq = {};

      logAuth('logout', mockReq, null, { userId: 'user123' });

      expect(secureLogger.info).toHaveBeenCalled();
    });
  });

  describe('Correlation Middleware', () => {
    it('should create correlation middleware', () => {
      const middleware = correlationMiddleware();
      const mockReq = {};
      const mockRes = {};
      const mockNext = vi.fn();

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBe('mock-uuid-12345');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should preserve existing correlation ID', () => {
      const middleware = correlationMiddleware();
      const mockReq = { correlationId: 'existing-id' };
      const mockRes = {};
      const mockNext = vi.fn();

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBe('existing-id');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle non-Error objects', () => {
      const notAnError = 'String error';

      logger.error(
        { component: 'test', operation: 'test', req: undefined },
        notAnError
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.any(Error),
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'String error',
          }),
        })
      );
    });

    it('should handle null/undefined errors gracefully', () => {
      logger.error(
        { component: 'test', operation: 'test', req: undefined },
        null
      );

      expect(secureLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.any(Error),
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'null',
          }),
        })
      );
    });
  });
});