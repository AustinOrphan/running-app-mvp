import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requestLogger,
  correlationId,
  errorLogger,
  REQUEST_ID_HEADER,
} from '../src/adapters/express.js';
import { createLogger, type LogEntry } from '../src/logger.js';

describe('Express Adapters', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let loggedEntries: LogEntry[];

  beforeEach(() => {
    loggedEntries = [];

    mockReq = {
      headers: {},
      path: '/api/test',
      method: 'GET',
    };

    const listeners: Record<string, Function[]> = {};
    mockRes = {
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
        return mockRes as Response;
      }),
      setHeader: vi.fn(),
      statusCode: 200,
      emit: vi.fn((event: string) => {
        if (listeners[event]) {
          listeners[event].forEach((handler) => handler());
        }
        return true;
      }),
    };

    mockNext = vi.fn();
  });

  describe('requestLogger', () => {
    it('should add requestId and logger to request', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      const middleware = requestLogger({ logger });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.requestId).toBeDefined();
      expect(mockReq.logger).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use existing request ID from header', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      mockReq.headers = { [REQUEST_ID_HEADER]: 'existing-id' };

      const middleware = requestLogger({ logger });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.requestId).toBe('existing-id');
    });

    it('should extract userId if function provided', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      const extractUserId = vi.fn(() => 'user-123');

      const middleware = requestLogger({
        logger,
        extractUserId,
      });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(extractUserId).toHaveBeenCalledWith(mockReq);
    });

    it('should log request on response finish', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      const middleware = requestLogger({ logger, component: 'api' });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      (mockRes as any).emit('finish');

      expect(loggedEntries).toHaveLength(1);
      expect(loggedEntries[0]).toMatchObject({
        level: 'info',
        component: 'api',
        operation: 'http-request',
        message: 'GET /api/test 200',
      });
      expect(loggedEntries[0].context?.statusCode).toBe(200);
      expect(loggedEntries[0].context?.duration).toBeDefined();
    });

    it('should log error level for 500+ status codes', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      mockRes.statusCode = 500;

      const middleware = requestLogger({ logger });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      (mockRes as any).emit('finish');

      expect(loggedEntries[0].level).toBe('error');
    });

    it('should skip logging for configured paths', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      mockReq.path = '/health';

      const middleware = requestLogger({
        logger,
        skipPaths: ['/health', '/metrics'],
      });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.logger).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('correlationId', () => {
    it('should add requestId to request', () => {
      const middleware = correlationId();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.requestId).toBeDefined();
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        REQUEST_ID_HEADER,
        mockReq.requestId
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use existing request ID from header', () => {
      mockReq.headers = { [REQUEST_ID_HEADER]: 'existing-id' };

      const middleware = correlationId();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.requestId).toBe('existing-id');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        REQUEST_ID_HEADER,
        'existing-id'
      );
    });

    it('should use custom header', () => {
      const customHeader = 'x-correlation-id';
      mockReq.headers = { [customHeader]: 'custom-id' };

      const middleware = correlationId({ header: customHeader });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.requestId).toBe('custom-id');
      expect(mockRes.setHeader).toHaveBeenCalledWith(customHeader, 'custom-id');
    });

    it('should use custom ID generator', () => {
      const customId = 'custom-generated-id';
      const generateId = vi.fn(() => customId);

      const middleware = correlationId({ generateId });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(generateId).toHaveBeenCalled();
      expect(mockReq.requestId).toBe(customId);
    });
  });

  describe('errorLogger', () => {
    it('should log errors', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      const error = new Error('Test error');
      const middleware = errorLogger(logger, 'api');

      mockReq.requestId = 'req-123';

      middleware(
        error,
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction
      );

      expect(loggedEntries).toHaveLength(1);
      expect(loggedEntries[0]).toMatchObject({
        level: 'error',
        message: 'Request error',
        component: 'api',
        operation: 'error-handler',
      });
      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should use request logger if available', () => {
      const logger = createLogger({
        service: 'test-service',
        env: 'test',
        backend: {
          log: (entry) => loggedEntries.push(entry),
        },
      });

      const requestLogger = logger.child({
        requestId: 'req-123',
        component: 'custom',
      });

      mockReq.requestId = 'req-123';
      mockReq.logger = requestLogger;

      const error = new Error('Test error');
      const middleware = errorLogger(logger);

      middleware(
        error,
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction
      );

      expect(loggedEntries[0].requestId).toBe('req-123');
    });
  });
});
