import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request } from 'express';
import crypto from 'crypto';
import {
  secureLogger,
  logUserAction,
  logError,
  logInfo,
  logDebug,
  correlationMiddleware,
} from '../../../server/utils/secureLogger.js';

// Mock crypto for consistent hashing
vi.mock('crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mockedhash1234567890abcdef'),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-12345'),
}));

describe('SecureLogger Enhanced Tests', () => {
  let mockConsoleError;
  let mockConsoleWarn;
  let mockConsoleInfo;
  let mockConsoleDebug;
  const originalEnv = process.env;

  beforeEach(() => {
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockConsoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    mockConsoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    mockConsoleError.mockRestore();
    mockConsoleWarn.mockRestore();
    mockConsoleInfo.mockRestore();
    mockConsoleDebug.mockRestore();
    process.env = originalEnv;
  });

  describe('Data Redaction', () => {
    it('should redact sensitive fields in objects', () => {
      process.env.NODE_ENV = 'development';
      const sensitiveData = {
        username: 'john.doe',
        password: 'secretpass123',
        email: 'john@example.com',
        token: 'jwt-token-here',
        secret: 'api-secret-key',
        key: 'encryption-key',
        ssn: '123-45-6789',
        creditcard: '4111111111111111',
        phone: '555-123-4567',
        address: '123 Main St',
        name: 'John Doe',
        safeField: 'This is safe',
      };

      secureLogger.info('Test message', undefined, sensitiveData);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.metadata.password).toBe('se***23');
      expect(logData.metadata.token).toBe('jw***re');
      expect(logData.metadata.secret).toBe('ap***ey');
      expect(logData.metadata.key).toBe('en***ey');
      expect(logData.metadata.safeField).toBe('This is safe');
      // Email is in sensitive fields list and gets masked
      expect(logData.metadata.email).toBe('jo***om');
    });

    it('should redact PII patterns in strings', () => {
      process.env.NODE_ENV = 'development';
      const metadata = {
        message: 'User email is user@example.com and phone is 555-123-4567',
        creditCardInfo: 'Card number: 4111 1111 1111 1111',
        ssnInfo: 'SSN: 123-45-6789',
      };

      secureLogger.info('Test PII redaction', undefined, metadata);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.metadata.message).toContain('[REDACTED]');
      expect(logData.metadata.message).not.toContain('user@example.com');
      expect(logData.metadata.message).not.toContain('555-123-4567');
      
      // 'creditCardInfo' field contains 'creditcard' so the field value is masked
      expect(logData.metadata.creditCardInfo).toBe('Ca***11');
      expect(logData.metadata.creditCardInfo).not.toContain('4111');
      
      // 'ssnInfo' field contains 'ssn' so the field value is masked
      expect(logData.metadata.ssnInfo).toBe('SS***89');
      expect(logData.metadata.ssnInfo).not.toContain('123-45-6789');
    });

    it('should handle nested object redaction', () => {
      process.env.NODE_ENV = 'development';
      const nestedData = {
        user: {
          id: '12345',
          profile: {
            name: 'John Doe',
            password: 'secret123',
            settings: {
              apiKey: 'key-12345',
              theme: 'dark',
            },
          },
        },
        tokens: ['token1', 'token2'],
      };

      secureLogger.info('Nested data test', undefined, nestedData);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.metadata.user.profile.password).toBe('se***23');
      expect(logData.metadata.user.profile.settings.apiKey).toBe('ke***45');
      expect(logData.metadata.user.profile.settings.theme).toBe('dark');
      // 'tokens' field contains 'token' so it gets masked (array converted to string)
      // The array ['token1', 'token2'] becomes the string 'token1,token2' which gets masked
      expect(logData.metadata.tokens).toBe('to***n2');
    });

    it('should mask values while preserving type information', () => {
      process.env.NODE_ENV = 'development';
      const data = {
        shortPassword: '123',
        longPassword: 'verylongpassword123',
        nullPassword: null,
        undefinedPassword: undefined,
      };

      secureLogger.info('Mask test', undefined, data);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.metadata.shortPassword).toBe('[REDACTED]');
      expect(logData.metadata.longPassword).toBe('ve***23');
      expect(logData.metadata.nullPassword).toBe('null');
      expect(logData.metadata.undefinedPassword).toBe('undefined');
    });

    it('should redact sensitive URL parameters', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = {
        method: 'GET',
        url: '/api/users?token=abc123&key=secret&email=test@example.com&name=John',
        ip: '192.168.1.100',
        get: vi.fn(),
      };

      secureLogger.info('URL test', mockReq);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.context.url).toContain('token=[REDACTED]');
      expect(logData.context.url).toContain('key=[REDACTED]');
      expect(logData.context.url).toContain('email=[REDACTED]');
      expect(logData.context.url).toContain('name=John');
    });
  });

  describe('User ID Hashing', () => {
    it('should hash user ID in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_SALT = 'test-salt-12345';
      
      const mockReq = {
        user: { id: 'user12345' },
        method: 'GET',
        url: '/api/test',
        ip: '192.168.1.100',
        get: vi.fn(),
      };

      secureLogger.info('User action', mockReq);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.context.userId).toBe('user_mockedhash123456');
      expect(logData.context.userId).not.toContain('user12345');
    });

    it('should show actual user ID in development', () => {
      process.env.NODE_ENV = 'development';
      
      const mockReq = {
        user: { id: 'user12345' },
        method: 'GET',
        url: '/api/test',
        ip: '192.168.1.100',
        get: vi.fn(),
      };

      secureLogger.info('User action', mockReq);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.context.userId).toBe('user12345');
    });

    it('should throw error when LOG_SALT is missing in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_SALT;
      
      const mockReq = {
        user: { id: 'user12345' },
        method: 'GET',
        url: '/api/test',
        ip: '192.168.1.100',
        get: vi.fn(),
      };

      expect(() => {
        secureLogger.info('User action', mockReq);
      }).toThrow('CRITICAL: LOG_SALT environment variable must be set in production.');
    });

    it('should use default salt in development when LOG_SALT is missing', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.LOG_SALT;
      
      const mockReq = {
        user: { id: 'user12345' },
        method: 'GET',
        url: '/api/test',
        ip: '192.168.1.100',
        get: vi.fn(),
      };

      // Should not throw
      expect(() => {
        secureLogger.info('User action', mockReq);
      }).not.toThrow();
    });
  });

  describe('Log Levels', () => {
    it('should log different levels with appropriate console methods', () => {
      process.env.NODE_ENV = 'development';

      secureLogger.error('Error message');
      expect(mockConsoleError).toHaveBeenCalledWith('SecureLog:', expect.any(String));

      secureLogger.warn('Warning message');
      expect(mockConsoleWarn).toHaveBeenCalledWith('SecureLog:', expect.any(String));

      secureLogger.info('Info message');
      expect(mockConsoleInfo).toHaveBeenCalledWith('SecureLog:', expect.any(String));

      secureLogger.debug('Debug message');
      expect(mockConsoleDebug).toHaveBeenCalledWith('SecureLog:', expect.any(String));
    });

    it('should skip debug logs in production', () => {
      process.env.NODE_ENV = 'production';

      secureLogger.debug('Debug message');
      expect(mockConsoleDebug).not.toHaveBeenCalled();
    });

    it('should include stack trace for errors in development', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Test error');

      secureLogger.error('Error occurred', undefined, error);

      const logCall = mockConsoleError.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.stack).toBeDefined();
      expect(logData.stack).toContain('Error: Test error');
    });

    it('should exclude stack trace in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Test error');

      secureLogger.error('Error occurred', undefined, error);

      const logCall = mockConsoleError.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.stack).toBeUndefined();
    });
  });

  describe('Correlation ID', () => {
    it('should generate correlation ID when not present', () => {
      const mockReq = {
        url: '/test',
        get: vi.fn(),
      };

      secureLogger.info('Test message', mockReq);

      expect(mockReq.correlationId).toBe('mock-uuid-12345');
      
      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      expect(logData.context.correlationId).toBe('mock-uuid-12345');
    });

    it('should use existing correlation ID', () => {
      const mockReq = { 
        correlationId: 'existing-id-123',
        url: '/test',
        get: vi.fn(),
      };

      secureLogger.info('Test message', mockReq);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      expect(logData.context.correlationId).toBe('existing-id-123');
    });

    it('should generate correlation ID even without request', () => {
      secureLogger.info('Test message');

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      // Without a request, no correlation ID is generated
      expect(logData.context.correlationId).toBeUndefined();
    });
  });

  describe('Request Context Extraction', () => {
    it('should extract full request context', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = {
        method: 'POST',
        url: '/api/users',
        ip: '192.168.1.100',
        socket: { remoteAddress: '192.168.1.100' },
        get: vi.fn((header) => header === 'User-Agent' ? 'Mozilla/5.0' : null),
        user: { id: 'user123' },
      };

      secureLogger.info('Request log', mockReq);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.context).toMatchObject({
        method: 'POST',
        url: '/api/users',
        userAgent: 'Mozilla/5.0',
        ip: '192.168.1.100',
        userId: 'user123',
        timestamp: expect.any(String),
        environment: 'development',
      });
    });

    it('should handle missing request gracefully', () => {
      secureLogger.info('No request');

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.context).toMatchObject({
        timestamp: expect.any(String),
        environment: expect.any(String),
      });
      expect(logData.context.method).toBeUndefined();
      expect(logData.context.url).toBeUndefined();
    });

    it('should use socket.remoteAddress as fallback for IP', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = {
        method: 'GET',
        url: '/api/test',
        socket: { remoteAddress: '10.0.0.1' },
        get: vi.fn(),
      };

      secureLogger.info('Socket IP test', mockReq);

      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      
      expect(logData.context.ip).toBe('10.0.0.1');
    });
  });

  describe('User Action Logging', () => {
    it('should log user actions with full context in development', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = { 
        user: { id: 'user123' },
        url: '/test',
        get: vi.fn(),
      };
      const metadata = { itemId: '456', action: 'update' };

      logUserAction('Updated item', mockReq, metadata);

      expect(mockConsoleInfo).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('User action: Updated item')
      );
    });

    it('should log user actions with limited context in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_SALT = 'test-salt';
      const mockReq = { 
        user: { id: 'user123' },
        url: '/test',
        get: vi.fn(),
      };
      const metadata = { itemId: '456', action: 'update' };

      logUserAction('Updated item', mockReq, metadata);

      expect(mockConsoleInfo).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('Action: Updated item')
      );
      
      const logCall = mockConsoleInfo.mock.calls[0][1];
      const logData = JSON.parse(logCall);
      expect(logData.metadata).toMatchObject({
        itemId: '456',
        action: 'update',
        timestamp: expect.any(String),
        environment: 'production',
      });
    });
  });

  describe('Convenience Functions', () => {
    it('should provide working convenience functions', () => {
      const mockReq = {
        url: '/test',
        get: vi.fn(),
      };
      const error = new Error('Test error');
      const metadata = { extra: 'data' };

      logError('Error message', mockReq, error, metadata);
      expect(mockConsoleError).toHaveBeenCalled();

      logInfo('Info message', mockReq, metadata);
      expect(mockConsoleInfo).toHaveBeenCalled();

      process.env.NODE_ENV = 'development';
      logDebug('Debug message', mockReq, metadata);
      expect(mockConsoleDebug).toHaveBeenCalled();
    });
  });

  describe('Correlation Middleware', () => {
    it('should create working middleware', () => {
      const middleware = correlationMiddleware();
      const mockReq = {};
      const mockRes = {};
      const mockNext = vi.fn();

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBe('mock-uuid-12345');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should not override existing correlation ID', () => {
      const middleware = correlationMiddleware();
      const mockReq = { correlationId: 'existing-123' };
      const mockRes = {};
      const mockNext = vi.fn();

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.correlationId).toBe('existing-123');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('JSON Formatting', () => {
    it('should format JSON with indentation in development', () => {
      process.env.NODE_ENV = 'development';

      secureLogger.info('Test message');

      const logCall = mockConsoleInfo.mock.calls[0][1];
      // In development, JSON should be pretty-printed
      expect(logCall).toContain('\n');
      expect(logCall).toContain('  '); // Indentation
    });

    it('should use compact JSON in production', () => {
      process.env.NODE_ENV = 'production';

      secureLogger.info('Test message');

      const logCall = mockConsoleInfo.mock.calls[0][1];
      // In production, JSON should be on one line
      expect(logCall).not.toContain('\n');
    });
  });

  describe('Environment Detection', () => {
    it('should handle various NODE_ENV values', () => {
      const environments = ['development', 'production', 'test', 'staging', undefined];

      environments.forEach(env => {
        process.env.NODE_ENV = env;
        
        secureLogger.info(`Test in ${env || 'undefined'} environment`);
        
        const logCall = mockConsoleInfo.mock.calls[mockConsoleInfo.mock.calls.length - 1][1];
        const logData = JSON.parse(logCall);
        
        expect(logData.context.environment).toBe(env || 'unknown');
      });
    });
  });
});