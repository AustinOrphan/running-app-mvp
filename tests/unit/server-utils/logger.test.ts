import { logInfo, logError, logWarn, logDatabase, logAuth } from '../../../server/utils/logger.js';
// Using mocked logger from mockSetup
import type { Request } from 'express';

describe('Logger Utility Functions', () => {
  // Mock request is set up in beforeEach
  let dateNowSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Set up console spies
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockRequest = {
      ip: '127.0.0.1',
      method: 'GET',
      originalUrl: '/test',
      headers: { 'user-agent': 'test-agent' },
    };

    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1704067200000); // 2024-01-01
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('logInfo', () => {
    test('logs info messages with category and operation', () => {
      logInfo('test-category', 'test-operation', 'Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.stringContaining('[2024-01-01T00:00:00.000Z]'),
        expect.stringContaining('[test-category:test-operation]'),
        'Test message'
      );
    });

    test('logs info messages with additional data', () => {
      const data = { key: 'value', number: 123 };
      logInfo('auth', 'login', 'User logged in', data);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.stringContaining('[2024-01-01T00:00:00.000Z]'),
        expect.stringContaining('[auth:login]'),
        'User logged in',
        JSON.stringify(data)
      );
    });

    test('handles null and undefined data', () => {
      logInfo('test', 'op', 'Message', null);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.any(String),
        expect.any(String),
        'Message'
      );

      logInfo('test', 'op', 'Message', undefined);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.any(String),
        expect.any(String),
        'Message'
      );
    });
  });

  describe('logError', () => {
    test('logs error messages', () => {
      const error = new Error('Test error');
      logError('db', 'query', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.stringContaining('[2024-01-01T00:00:00.000Z]'),
        expect.stringContaining('[db:query]'),
        'Test error'
      );
    });

    test('logs error with user ID', () => {
      const error = new Error('Auth error');
      logError('auth', 'verify', error, 'user123');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.stringContaining('[2024-01-01T00:00:00.000Z]'),
        expect.stringContaining('[auth:verify]'),
        expect.stringContaining('[User: user123]'),
        'Auth error'
      );
    });

    test('logs error with additional data', () => {
      const error = new Error('Validation error');
      const data = { field: 'email', value: 'invalid' };
      logError('validation', 'check', error, undefined, data);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.any(String),
        expect.any(String),
        'Validation error',
        JSON.stringify(data)
      );
    });

    test('logs error with stack trace', () => {
      const error = new Error('Stack trace error');
      error.stack = 'Error: Stack trace error\n    at test.js:10:5';
      logError('system', 'crash', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.any(String),
        expect.any(String),
        'Stack trace error',
        expect.stringContaining('Stack:'),
        error.stack
      );
    });

    test('handles non-Error objects', () => {
      const errorString = 'String error';
      logError('api', 'parse', errorString as unknown as Error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.any(String),
        expect.any(String),
        'String error'
      );
    });
  });

  describe('logWarn', () => {
    test('logs warning messages', () => {
      logWarn('security', 'suspicious', 'Suspicious activity detected');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]'),
        expect.stringContaining('[2024-01-01T00:00:00.000Z]'),
        expect.stringContaining('[security:suspicious]'),
        'Suspicious activity detected'
      );
    });

    test('logs warning with data', () => {
      const data = { attempts: 5, ip: '192.168.1.1' };
      logWarn('auth', 'failed-attempts', 'Multiple failed login attempts', data);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]'),
        expect.any(String),
        expect.any(String),
        'Multiple failed login attempts',
        JSON.stringify(data)
      );
    });
  });

  describe('logDatabase', () => {
    test('logs database operations', () => {
      logDatabase('query', undefined, undefined, { table: 'users' });

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('logAuth', () => {
    test('logs auth operations', () => {
      logAuth('login', undefined, undefined, { userId: '123' });

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Error scenarios', () => {
    test('handles logging errors during log operation', () => {
      // Force JSON.stringify to throw
      const circularRef: Record<string, unknown> = {};
      circularRef.self = circularRef;

      // This should not throw, just log without the data
      expect(() => {
        logInfo('test', 'circular', 'Message', circularRef);
      }).not.toThrow();

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('handles Date.now() errors gracefully', () => {
      dateNowSpy.mockImplementation(() => {
        throw new Error('Date error');
      });

      // Should still log, even with broken timestamp
      expect(() => {
        logInfo('test', 'date-error', 'Message');
      }).not.toThrow();
    });
  });
});
