import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clientLogger,
  logError,
  logWarn,
  logInfo,
  logDebug,
  LogLevel,
} from '../../../src/utils/clientLogger';

// Mock console methods
const originalConsole = {
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

const mockConsole = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

// Mock process.env
const originalNodeEnv = process.env.NODE_ENV;

// Mock fetch for production logging service
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator and window
Object.defineProperty(global, 'navigator', {
  value: {
    userAgent: 'Test Browser/1.0',
  },
  writable: true,
});

Object.defineProperty(global, 'window', {
  value: {
    location: {
      href: 'https://test.example.com/path',
    },
  },
  writable: true,
});

describe('ClientLogger', () => {
  beforeEach(() => {
    // Replace console methods with mocks
    console.error = mockConsole.error;
    console.warn = mockConsole.warn;
    console.info = mockConsole.info;
    console.debug = mockConsole.debug;

    // Clear all mocks
    vi.clearAllMocks();
    mockFetch.mockClear();

    // Reset NODE_ENV
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    // Restore console methods
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;

    // Restore NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('environment detection', () => {
    it('should detect development environment', () => {
      process.env.NODE_ENV = 'development';

      clientLogger.debug('Test debug message');

      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should detect production environment', () => {
      process.env.NODE_ENV = 'production';

      clientLogger.debug('Test debug message');

      // Debug logs should be skipped in production
      expect(mockConsole.debug).not.toHaveBeenCalled();
    });
  });

  describe('data redaction', () => {
    it('should redact sensitive field names', () => {
      const sensitiveData = {
        password: 'secret123',
        email: 'user@example.com',
        token: 'abc123def456',
        secret: 'topsecret',
        normalField: 'safe data',
      };

      clientLogger.info('Test with sensitive data', sensitiveData);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata.password).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.email).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.token).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.secret).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.normalField).toBe('safe data');
    });

    it('should redact PII patterns in strings', () => {
      const messageWithPII = 'Contact user@example.com or call 555-123-4567';

      clientLogger.info(messageWithPII);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.message).toContain('[REDACTED]');
      expect(logEntry.message).not.toContain('user@example.com');
      expect(logEntry.message).not.toContain('555-123-4567');
    });

    it('should redact credit card patterns', () => {
      const ccData = {
        description: 'Payment with card 4532-1234-5678-9012',
        alternateFormat: '4532 1234 5678 9012',
        noSpaces: '4532123456789012',
      };

      clientLogger.info('Payment info', ccData);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata.description).toContain('[REDACTED]');
      expect(logEntry.metadata.alternateFormat).toContain('[REDACTED]');
      expect(logEntry.metadata.noSpaces).toContain('[REDACTED]');
    });

    it('should redact SSN patterns', () => {
      const ssnData = 'SSN: 123-45-6789';

      clientLogger.warn(ssnData);

      const logCall = mockConsole.warn.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.message).toContain('[REDACTED]');
      expect(logEntry.message).not.toContain('123-45-6789');
    });

    it('should handle nested objects with sensitive data', () => {
      const nestedData = {
        user: {
          profile: {
            email: 'nested@example.com',
            password: 'nested-secret',
          },
          settings: {
            theme: 'dark',
          },
        },
      };

      clientLogger.info('Nested data', nestedData);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata.user.profile.email).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.user.profile.password).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.user.settings.theme).toBe('dark');
    });

    it('should handle arrays with sensitive data', () => {
      const arrayData = {
        users: [
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' },
        ],
      };

      clientLogger.info('Array data', arrayData);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata.users[0].email).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.users[1].email).toMatch(/[^*]*\*\*\*[^*]*/);
      expect(logEntry.metadata.users[0].name).toBe('John');
      expect(logEntry.metadata.users[1].name).toBe('Jane');
    });

    it('should handle circular references', () => {
      const circularData: any = { name: 'test' };
      circularData.self = circularData;

      expect(() => {
        clientLogger.info('Circular data', circularData);
      }).not.toThrow();

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata.self).toBe('[Circular Reference]');
    });

    it('should handle null and undefined values correctly', () => {
      const data = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        password: null,
        email: undefined,
      };

      clientLogger.info('Null/undefined data', data);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata.nullValue).toBe(null);
      expect(logEntry.metadata.undefinedValue).toBeUndefined();
      expect(logEntry.metadata.emptyString).toBe('');
      expect(logEntry.metadata.password).toBe('null');
      expect(logEntry.metadata.email).toBe('undefined');
    });

    it('should preserve partial context for debugging', () => {
      const longPassword = 'verylongpassword123';
      const shortPassword = 'pwd';

      const data = {
        longPassword,
        shortPassword,
      };

      clientLogger.info('Password masking', data);

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      // Long passwords should show first 2 and last 2 characters
      expect(logEntry.metadata.longPassword).toBe('ve***23');
      // Short passwords should be fully redacted
      expect(logEntry.metadata.shortPassword).toBe('[REDACTED]');
    });
  });

  describe('log levels', () => {
    it('should log error messages', () => {
      const error = new Error('Test error');
      clientLogger.error('Error occurred', error, { context: 'test' });

      expect(mockConsole.error).toHaveBeenCalledWith(
        'ClientLog:',
        expect.stringContaining('"level":"ERROR"')
      );

      const logCall = mockConsole.error.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe('ERROR');
      expect(logEntry.message).toBe('Error occurred');
      expect(logEntry.metadata.context).toBe('test');
      expect(logEntry.stack).toBe(error.stack);
    });

    it('should log warning messages', () => {
      clientLogger.warn('Warning message', { data: 'test' });

      expect(mockConsole.warn).toHaveBeenCalledWith(
        'ClientLog:',
        expect.stringContaining('"level":"WARN"')
      );

      const logCall = mockConsole.warn.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe('WARN');
      expect(logEntry.message).toBe('Warning message');
      expect(logEntry.metadata.data).toBe('test');
    });

    it('should log info messages', () => {
      clientLogger.info('Info message');

      expect(mockConsole.info).toHaveBeenCalledWith(
        'ClientLog:',
        expect.stringContaining('"level":"INFO"')
      );

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe('INFO');
      expect(logEntry.message).toBe('Info message');
    });

    it('should log debug messages in development', () => {
      process.env.NODE_ENV = 'development';
      clientLogger.debug('Debug message');

      expect(mockConsole.debug).toHaveBeenCalledWith(
        'ClientLog:',
        expect.stringContaining('"level":"DEBUG"')
      );

      const logCall = mockConsole.debug.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.level).toBe('DEBUG');
      expect(logEntry.message).toBe('Debug message');
    });

    it('should skip debug messages in production', () => {
      process.env.NODE_ENV = 'production';
      clientLogger.debug('Debug message');

      expect(mockConsole.debug).not.toHaveBeenCalled();
    });
  });

  describe('log entry structure', () => {
    it('should include timestamp in ISO format', () => {
      clientLogger.info('Test message');

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include userAgent in development only', () => {
      process.env.NODE_ENV = 'development';
      clientLogger.info('Test message');

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.userAgent).toBe('Test Browser/1.0');
    });

    it('should exclude userAgent in production', () => {
      process.env.NODE_ENV = 'production';
      clientLogger.info('Test message');

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.userAgent).toBeUndefined();
    });

    it('should include URL in development only', () => {
      process.env.NODE_ENV = 'development';
      clientLogger.info('Test message');

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.url).toBe('https://test.example.com/path');
    });

    it('should exclude URL in production', () => {
      process.env.NODE_ENV = 'production';
      clientLogger.info('Test message');

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.url).toBeUndefined();
    });

    it('should include stack trace for errors in development', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Test error');
      clientLogger.error('Error message', error);

      const logCall = mockConsole.error.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.stack).toBe(error.stack);
    });

    it('should exclude stack trace in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Test error');
      clientLogger.error('Error message', error);

      const logCall = mockConsole.error.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.stack).toBeUndefined();
    });

    it('should format JSON differently for development vs production', () => {
      // Development - pretty printed
      process.env.NODE_ENV = 'development';
      clientLogger.info('Dev message');

      const devLogCall = mockConsole.info.mock.calls[0][1];
      expect(devLogCall).toContain('\n'); // Pretty printed with newlines

      mockConsole.info.mockClear();

      // Production - minified
      process.env.NODE_ENV = 'production';
      clientLogger.info('Prod message');

      const prodLogCall = mockConsole.info.mock.calls[0][1];
      expect(prodLogCall).not.toContain('\n'); // Minified without newlines
    });
  });

  describe('production logging service', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('should send error logs to logging service in production', async () => {
      clientLogger.error('Production error');

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"level":"ERROR"'),
        })
      );
    });

    it('should not send non-error logs to logging service', async () => {
      clientLogger.warn('Production warning');
      clientLogger.info('Production info');

      // Wait for any potential async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fail silently when logging service is unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('Service unavailable'));

      expect(() => {
        clientLogger.error('Error when service down');
      }).not.toThrow();

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('convenience functions', () => {
    it('logError should call clientLogger.error', () => {
      const spy = vi.spyOn(clientLogger, 'error');
      const error = new Error('Test error');
      const metadata = { context: 'test' };

      logError('Error message', error, metadata);

      expect(spy).toHaveBeenCalledWith('Error message', error, metadata);
      spy.mockRestore();
    });

    it('logWarn should call clientLogger.warn', () => {
      const spy = vi.spyOn(clientLogger, 'warn');
      const metadata = { context: 'test' };

      logWarn('Warning message', metadata);

      expect(spy).toHaveBeenCalledWith('Warning message', metadata);
      spy.mockRestore();
    });

    it('logInfo should call clientLogger.info', () => {
      const spy = vi.spyOn(clientLogger, 'info');
      const metadata = { context: 'test' };

      logInfo('Info message', metadata);

      expect(spy).toHaveBeenCalledWith('Info message', metadata);
      spy.mockRestore();
    });

    it('logDebug should call clientLogger.debug', () => {
      const spy = vi.spyOn(clientLogger, 'debug');
      const metadata = { context: 'test' };

      logDebug('Debug message', metadata);

      expect(spy).toHaveBeenCalledWith('Debug message', metadata);
      spy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle logging without metadata', () => {
      expect(() => {
        clientLogger.info('Message without metadata');
      }).not.toThrow();

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata).toBeUndefined();
    });

    it('should handle empty metadata object', () => {
      clientLogger.info('Message with empty metadata', {});

      const logCall = mockConsole.info.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.metadata).toEqual({});
    });

    it('should handle logging without error object', () => {
      expect(() => {
        clientLogger.error('Error without error object');
      }).not.toThrow();

      const logCall = mockConsole.error.mock.calls[0][1];
      const logEntry = JSON.parse(logCall);

      expect(logEntry.stack).toBeUndefined();
    });

    it('should handle non-Error objects passed as error', () => {
      const notAnError = { message: 'Not an error', stack: 'fake stack' };

      expect(() => {
        clientLogger.error('Error with non-Error object', notAnError as Error);
      }).not.toThrow();
    });

    it('should handle very large objects gracefully', () => {
      const largeObject = {
        data: 'x'.repeat(10000),
        nested: {
          moreData: 'y'.repeat(5000),
        },
      };

      expect(() => {
        clientLogger.info('Large object', largeObject);
      }).not.toThrow();
    });
  });

  describe('LogLevel enum', () => {
    it('should export LogLevel enum with correct values', () => {
      expect(LogLevel.ERROR).toBe('ERROR');
      expect(LogLevel.WARN).toBe('WARN');
      expect(LogLevel.INFO).toBe('INFO');
      expect(LogLevel.DEBUG).toBe('DEBUG');
    });
  });
});
