import {
  errorHandler,
  createError,
  createValidationError,
  createNotFoundError,
  createUnauthorizedError,
  createForbiddenError,
  createConflictError,
  createDatabaseError,
} from '../../../server/middleware/errorHandler.js';
import * as logger from '../../../server/utils/logger.js';
import type { Request, Response, NextFunction } from 'express';

describe('ErrorHandler Middleware - Complete Coverage', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      originalUrl: '/api/test',
      method: 'GET',
      headers: {},
      ip: '127.0.0.1',
      user: undefined,
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Error Creation Functions', () => {
    it('should create a basic error', () => {
      const error = createError('Test error', 400);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
    });

    it('should create a validation error', () => {
      const error = createValidationError('Invalid input');
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
    });

    it('should create a not found error', () => {
      const error = createNotFoundError('Resource not found');
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
    });

    it('should create an unauthorized error', () => {
      const error = createUnauthorizedError('Unauthorized access');
      expect(error.message).toBe('Unauthorized access');
      expect(error.statusCode).toBe(401);
    });

    it('should create a forbidden error', () => {
      const error = createForbiddenError('Access denied');
      expect(error.message).toBe('Access denied');
      expect(error.statusCode).toBe(403);
    });

    it('should create a conflict error', () => {
      const error = createConflictError('Resource conflict');
      expect(error.message).toBe('Resource conflict');
      expect(error.statusCode).toBe(409);
    });

    it('should create a database error', () => {
      const error = createDatabaseError('Database connection failed');
      expect(error.message).toBe('Database connection failed');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('Error Handler Middleware', () => {
    it('should handle standard errors with status code', () => {
      const error = createError('Test error', 400) as Error & { statusCode: number };

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Test error',
        statusCode: 400,
      });
      expect(logger.logError).toHaveBeenCalledWith('api', 'error-handler', error, mockRequest, {
        statusCode: 400,
        method: 'GET',
        url: '/api/test',
        ip: '127.0.0.1',
      });
    });

    it('should handle errors without status code (default to 500)', () => {
      const error = new Error('Internal error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        statusCode: 500,
      });
    });

    it('should handle Zod validation errors', () => {
      const zodError = {
        name: 'ZodError',
        message: 'Validation failed',
        issues: [
          { path: ['email'], message: 'Invalid email' },
          { path: ['password'], message: 'Password too short' },
        ],
      } as any;

      errorHandler(zodError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Validation Error',
        statusCode: 400,
        details: [
          { field: 'email', message: 'Invalid email' },
          { field: 'password', message: 'Password too short' },
        ],
      });
    });

    it('should handle Prisma unique constraint errors', () => {
      const prismaError = {
        code: 'P2002',
        message: 'Unique constraint failed',
        meta: { target: ['email'] },
      } as any;

      errorHandler(prismaError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'A record with this email already exists',
        statusCode: 409,
      });
    });

    it('should handle Prisma record not found errors', () => {
      const prismaError = {
        code: 'P2025',
        message: 'Record not found',
      } as any;

      errorHandler(prismaError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Record not found',
        statusCode: 404,
      });
    });

    it('should handle JWT token errors', () => {
      const jwtError = {
        name: 'JsonWebTokenError',
        message: 'Invalid token',
      } as any;

      errorHandler(jwtError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid token',
        statusCode: 401,
      });
    });

    it('should handle expired JWT tokens', () => {
      const expiredError = {
        name: 'TokenExpiredError',
        message: 'Token expired',
      } as any;

      errorHandler(expiredError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Token expired',
        statusCode: 401,
      });
    });

    it('should include stack trace in development mode', () => {
      process.env.NODE_ENV = 'development';
      const error = createError('Test error', 400) as Error & { statusCode: number };
      error.stack = 'Error stack trace';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Test error',
        statusCode: 400,
        stack: 'Error stack trace',
      });
    });

    it('should not include stack trace in production mode', () => {
      process.env.NODE_ENV = 'production';
      const error = createError('Test error', 400) as Error & { statusCode: number };
      error.stack = 'Error stack trace';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Test error',
        statusCode: 400,
      });
    });

    it('should handle errors when headers are already sent', () => {
      const error = createError('Test error', 400);
      mockResponse.headersSent = true;

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should include user ID in logging context when available', () => {
      const error = createError('Test error', 400) as Error & { statusCode: number };
      mockRequest.user = { id: 123, email: 'test@example.com' } as any;

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.logError).toHaveBeenCalledWith('api', 'error-handler', error, mockRequest, {
        statusCode: 400,
        method: 'GET',
        url: '/api/test',
        ip: '127.0.0.1',
        userId: 123,
      });
    });

    it('should handle non-Error objects', () => {
      const stringError = 'String error message';

      errorHandler(stringError as any, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        statusCode: 500,
      });
    });

    it('should handle null errors', () => {
      const nullError = null;

      errorHandler(nullError as any, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        statusCode: 500,
      });
    });
  });

  describe('Error Logging', () => {
    it('should log errors with appropriate context', () => {
      const error = createError('Test error', 400) as Error & { statusCode: number };
      mockRequest.headers = { 'user-agent': 'Test Agent' };

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.logError).toHaveBeenCalledWith('api', 'error-handler', error, mockRequest, {
        statusCode: 400,
        method: 'GET',
        url: '/api/test',
        ip: '127.0.0.1',
      });
    });

    it('should not log 404 errors', () => {
      const error = createNotFoundError('Not found') as Error & { statusCode: number };

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.logError).not.toHaveBeenCalled();
    });

    it('should log 5xx errors as high priority', () => {
      const error = createDatabaseError('Database error') as Error & { statusCode: number };

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.logError).toHaveBeenCalledWith(
        'api',
        'error-handler',
        error,
        mockRequest,
        expect.objectContaining({
          statusCode: 500,
        })
      );
    });
  });
});
