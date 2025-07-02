import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { secureLogger } from '../../../utils/secureLogger.js';
import { Request } from 'express';

describe('SecureLogger IP Privacy Enhancements', () => {
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockConsoleWarn: ReturnType<typeof vi.spyOn>;
  let mockConsoleInfo: ReturnType<typeof vi.spyOn>;
  let mockConsoleDebug: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalIpSalt = process.env.IP_SALT;
  const originalLogSalt = process.env.LOG_SALT;

  beforeEach(() => {
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockConsoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    mockConsoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    mockConsoleError.mockRestore();
    mockConsoleWarn.mockRestore();
    mockConsoleInfo.mockRestore();
    mockConsoleDebug.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
    process.env.IP_SALT = originalIpSalt;
    process.env.LOG_SALT = originalLogSalt;
  });

  describe('IP Address Hashing (Issue #38)', () => {
    it('should hash IP addresses in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.IP_SALT = 'test-salt-12345';
      process.env.LOG_SALT = 'test-log-salt-12345';

      const mockRequest = {
        ip: '192.168.1.100',
        socket: { remoteAddress: '192.168.1.100' },
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
        user: { id: 'user123' }
      } as unknown as Request;

      secureLogger.error('Test error message', mockRequest);

      expect(mockConsoleError).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('"ip":"ip_')
      );

      // Verify the hashed IP doesn't contain the original IP
      const logCall = mockConsoleError.mock.calls[0][1];
      expect(logCall).not.toContain('192.168.1.100');
      expect(logCall).toContain('"ip":"ip_');
    });

    it('should use fallback to socket.remoteAddress when req.ip is not available', () => {
      process.env.NODE_ENV = 'production';
      process.env.IP_SALT = 'test-salt-12345';
      process.env.LOG_SALT = 'test-log-salt-12345';

      const mockRequest = {
        ip: undefined,
        socket: { remoteAddress: '10.0.0.50' },
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      secureLogger.error('Test error message', mockRequest);

      expect(mockConsoleError).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('"ip":"ip_')
      );

      // Verify the hashed IP doesn't contain the original fallback IP
      const logCall = mockConsoleError.mock.calls[0][1];
      expect(logCall).not.toContain('10.0.0.50');
      expect(logCall).toContain('"ip":"ip_');
    });

    it('should show raw IP in development mode', () => {
      process.env.NODE_ENV = 'development';

      const mockRequest = {
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      secureLogger.info('Test info message', mockRequest);

      expect(mockConsoleInfo).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('"ip":"127.0.0.1"')
      );
    });

    it('should handle missing IP gracefully', () => {
      process.env.NODE_ENV = 'production';
      process.env.IP_SALT = 'test-salt-12345';
      process.env.LOG_SALT = 'test-log-salt-12345';

      const mockRequest = {
        ip: undefined,
        socket: {},
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      secureLogger.warn('Test warning message', mockRequest);

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('"ip":"[UNKNOWN]"')
      );
    });

    it('should warn when IP_SALT is not set in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_SALT = 'test-log-salt-12345';
      delete process.env.IP_SALT;

      const mockRequest = {
        ip: '192.168.1.100',
        socket: { remoteAddress: '192.168.1.100' },
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      secureLogger.error('Test error message', mockRequest);

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'WARNING: IP_SALT not set in production. Using default salt.'
      );
    });

    it('should produce consistent hashes for the same IP', () => {
      process.env.NODE_ENV = 'production';
      process.env.IP_SALT = 'consistent-test-salt';
      process.env.LOG_SALT = 'test-log-salt-12345';

      const mockRequest1 = {
        ip: '203.0.113.1',
        socket: { remoteAddress: '203.0.113.1' },
        method: 'GET',
        url: '/api/test1',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      const mockRequest2 = {
        ip: '203.0.113.1',
        socket: { remoteAddress: '203.0.113.1' },
        method: 'POST',
        url: '/api/test2',
        get: vi.fn().mockReturnValue('different-user-agent'),
      } as unknown as Request;

      secureLogger.error('First request', mockRequest1);
      secureLogger.error('Second request', mockRequest2);

      const firstLog = mockConsoleError.mock.calls[0][1];
      const secondLog = mockConsoleError.mock.calls[1][1];

      // Extract IP hash from both logs
      const firstIpMatch = firstLog.match(/"ip":"(ip_[a-f0-9]{16})"/);
      const secondIpMatch = secondLog.match(/"ip":"(ip_[a-f0-9]{16})"/);

      expect(firstIpMatch).not.toBeNull();
      expect(secondIpMatch).not.toBeNull();
      expect(firstIpMatch![1]).toBe(secondIpMatch![1]);
    });

    it('should produce different hashes for different IPs', () => {
      process.env.NODE_ENV = 'production';
      process.env.IP_SALT = 'different-test-salt';
      process.env.LOG_SALT = 'test-log-salt-12345';

      const mockRequest1 = {
        ip: '203.0.113.1',
        socket: { remoteAddress: '203.0.113.1' },
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      const mockRequest2 = {
        ip: '203.0.113.2',
        socket: { remoteAddress: '203.0.113.2' },
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      secureLogger.error('First IP', mockRequest1);
      secureLogger.error('Second IP', mockRequest2);

      const firstLog = mockConsoleError.mock.calls[0][1];
      const secondLog = mockConsoleError.mock.calls[1][1];

      // Extract IP hash from both logs
      const firstIpMatch = firstLog.match(/"ip":"(ip_[a-f0-9]{16})"/);
      const secondIpMatch = secondLog.match(/"ip":"(ip_[a-f0-9]{16})"/);

      expect(firstIpMatch).not.toBeNull();
      expect(secondIpMatch).not.toBeNull();
      expect(firstIpMatch![1]).not.toBe(secondIpMatch![1]);
    });
  });

  describe('Modern Node.js API Usage (Issue #40)', () => {
    it('should use req.socket.remoteAddress as fallback (not deprecated req.connection)', () => {
      process.env.NODE_ENV = 'development';

      const mockRequest = {
        ip: undefined,
        socket: { remoteAddress: '172.16.0.10' },
        // Note: Not using deprecated req.connection.remoteAddress
        method: 'GET',
        url: '/api/test',
        get: vi.fn().mockReturnValue('test-user-agent'),
      } as unknown as Request;

      secureLogger.debug('Test debug message', mockRequest);

      expect(mockConsoleDebug).toHaveBeenCalledWith(
        'SecureLog:',
        expect.stringContaining('"ip":"172.16.0.10"')
      );
    });
  });
});