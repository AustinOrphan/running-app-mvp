import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Express types not needed for this test
import {
  logSecurityEvent,
  logAuthEvent,
  logAuthzEvent,
  logValidationEvent,
  logRateLimitEvent,
  logSuspiciousActivity,
  securityMetrics,
  trackSecurityMetric,
  securityEventTracker,
} from '../../../server/utils/securityLogger.js';
import { logInfo, logError } from '../../../server/utils/logger.js';

// Mock dependencies
vi.mock('../../../server/utils/logger.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

describe('Security Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    securityMetrics.reset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('logSecurityEvent', () => {
    it('should log low severity events as info', () => {
      const mockReq = {
        ip: '192.168.1.100',
        method: 'GET',
        path: '/api/users',
        get: vi.fn(header => (header === 'User-Agent' ? 'Mozilla/5.0' : null)),
        user: { id: 'user123' },
      };

      logSecurityEvent('authentication', 'low', 'login_success', mockReq, {
        email: 'user@example.com',
      });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'authentication',
        'SECURITY LOW: login_success',
        mockReq,
        expect.objectContaining({
          type: 'authentication',
          severity: 'low',
          event: 'login_success',
          timestamp: expect.any(String),
          ip: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
          endpoint: 'GET /api/users',
          userId: 'user123',
          details: { email: 'user@example.com' },
        })
      );
    });

    it('should log high severity events as error', () => {
      const mockReq = {
        ip: '10.0.0.1',
        method: 'POST',
        path: '/api/admin',
        get: vi.fn(),
      };

      logSecurityEvent('authorization', 'high', 'privilege_escalation_attempt', mockReq);

      expect(logError).toHaveBeenCalledWith(
        'security',
        'authorization',
        expect.any(Error),
        mockReq,
        expect.objectContaining({
          type: 'authorization',
          severity: 'high',
          event: 'privilege_escalation_attempt',
        })
      );
    });

    it('should log critical severity events as error', () => {
      const mockReq = {
        ip: '10.0.0.1',
        method: 'POST',
        path: '/api/data',
        get: vi.fn(),
      };

      logSecurityEvent('input_validation', 'critical', 'sql_injection_attempt', mockReq, {
        payload: 'DROP TABLE users',
      });

      expect(logError).toHaveBeenCalledWith(
        'security',
        'input_validation',
        expect.any(Error),
        mockReq,
        expect.objectContaining({
          type: 'input_validation',
          severity: 'critical',
          event: 'sql_injection_attempt',
          details: { payload: 'DROP TABLE users' },
        })
      );
    });

    it('should handle missing request object', () => {
      logSecurityEvent('suspicious_activity', 'medium', 'automated_attack', undefined, {
        source: 'background_job',
      });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'suspicious_activity',
        'SECURITY MEDIUM: automated_attack',
        undefined,
        expect.objectContaining({
          type: 'suspicious_activity',
          severity: 'medium',
          event: 'automated_attack',
          ip: undefined,
          userAgent: undefined,
          endpoint: undefined,
          userId: undefined,
          details: { source: 'background_job' },
        })
      );
    });
  });

  describe('logAuthEvent', () => {
    const mockReq = {
      ip: '192.168.1.100',
      method: 'POST',
      path: '/api/auth/login',
      get: vi.fn(),
      user: { id: 'user123' },
    };

    it('should log login success with low severity', () => {
      logAuthEvent('login_success', mockReq, { email: 'user@example.com' });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'authentication',
        'SECURITY LOW: login_success',
        mockReq,
        expect.objectContaining({
          type: 'authentication',
          severity: 'low',
          event: 'login_success',
        })
      );
    });

    it('should log login failure with medium severity', () => {
      logAuthEvent('login_failure', mockReq, { email: 'user@example.com' });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'authentication',
        'SECURITY MEDIUM: login_failure',
        mockReq,
        expect.objectContaining({
          type: 'authentication',
          severity: 'medium',
          event: 'login_failure',
        })
      );
    });

    it('should log various auth events', () => {
      const events = ['logout', 'token_refresh', 'registration', 'password_reset'];

      events.forEach(event => {
        logAuthEvent(event, mockReq);

        expect(logInfo).toHaveBeenCalledWith(
          'security',
          'authentication',
          `SECURITY LOW: ${event}`,
          mockReq,
          expect.objectContaining({
            type: 'authentication',
            severity: 'low',
            event,
          })
        );

        vi.clearAllMocks();
      });
    });
  });

  describe('logAuthzEvent', () => {
    const mockReq = {
      ip: '192.168.1.100',
      method: 'GET',
      path: '/api/admin',
      get: vi.fn(),
      user: { id: 'user123' },
    };

    it('should log access granted with low severity', () => {
      logAuthzEvent('access_granted', mockReq, { resource: 'users' });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'authorization',
        'SECURITY LOW: access_granted',
        mockReq,
        expect.objectContaining({
          severity: 'low',
        })
      );
    });

    it('should log access denied with medium severity', () => {
      logAuthzEvent('access_denied', mockReq, { resource: 'admin' });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'authorization',
        'SECURITY MEDIUM: access_denied',
        mockReq,
        expect.objectContaining({
          severity: 'medium',
        })
      );
    });

    it('should log privilege escalation attempt with high severity', () => {
      logAuthzEvent('privilege_escalation_attempt', mockReq, {
        attemptedRole: 'admin',
      });

      expect(logError).toHaveBeenCalledWith(
        'security',
        'authorization',
        expect.any(Error),
        mockReq,
        expect.objectContaining({
          severity: 'high',
        })
      );
    });
  });

  describe('logValidationEvent', () => {
    const mockReq = {
      ip: '10.0.0.1',
      method: 'POST',
      path: '/api/data',
      get: vi.fn(),
    };

    it('should log invalid input with low severity', () => {
      logValidationEvent('invalid_input', mockReq, { field: 'email' });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'input_validation',
        'SECURITY LOW: invalid_input',
        mockReq,
        expect.objectContaining({
          severity: 'low',
        })
      );
    });

    it('should log injection attempts with high severity', () => {
      const injectionTypes = [
        'sql_injection_attempt',
        'xss_attempt',
        'path_traversal_attempt',
        'command_injection_attempt',
      ];

      injectionTypes.forEach(type => {
        logValidationEvent(type, mockReq, { payload: 'malicious' });

        expect(logError).toHaveBeenCalledWith(
          'security',
          'input_validation',
          expect.any(Error),
          mockReq,
          expect.objectContaining({
            severity: 'high',
            event: type,
          })
        );

        vi.clearAllMocks();
      });
    });
  });

  describe('logRateLimitEvent', () => {
    const mockReq = {
      ip: '192.168.1.100',
      method: 'GET',
      path: '/api/users',
      get: vi.fn(),
    };

    it('should log rate limit exceeded with medium severity', () => {
      logRateLimitEvent('rate_limit_exceeded', mockReq, {
        limit: 100,
        window: '1h',
      });

      expect(logInfo).toHaveBeenCalledWith(
        'security',
        'rate_limit',
        'SECURITY MEDIUM: rate_limit_exceeded',
        mockReq,
        expect.objectContaining({
          severity: 'medium',
        })
      );
    });

    it('should log suspicious request pattern with high severity', () => {
      logRateLimitEvent('suspicious_request_pattern', mockReq, {
        pattern: 'rapid sequential requests',
      });

      expect(logError).toHaveBeenCalledWith(
        'security',
        'rate_limit',
        expect.any(Error),
        mockReq,
        expect.objectContaining({
          severity: 'high',
        })
      );
    });
  });

  describe('logSuspiciousActivity', () => {
    const mockReq = {
      ip: '10.0.0.1',
      method: 'GET',
      path: '/api/data',
      get: vi.fn(),
    };

    it('should log all suspicious activities with high severity', () => {
      const activities = [
        'bot_detection',
        'unusual_user_agent',
        'suspicious_ip',
        'automated_attack',
        'data_scraping_attempt',
        'slow_request',
      ];

      activities.forEach(activity => {
        logSuspiciousActivity(activity, mockReq, { reason: 'test' });

        expect(logError).toHaveBeenCalledWith(
          'security',
          'suspicious_activity',
          expect.any(Error),
          mockReq,
          expect.objectContaining({
            type: 'suspicious_activity',
            severity: 'high',
            event: activity,
          })
        );

        vi.clearAllMocks();
      });
    });
  });

  describe('SecurityMetrics', () => {
    it('should be a singleton', () => {
      const instance1 = securityMetrics;
      const instance2 = securityMetrics;

      expect(instance1).toBe(instance2);
    });

    it('should increment metrics', () => {
      securityMetrics.increment('test_metric');
      securityMetrics.increment('test_metric');
      securityMetrics.increment('another_metric');

      const metrics = securityMetrics.getMetrics();

      expect(metrics).toEqual({
        test_metric: 2,
        another_metric: 1,
      });
    });

    it('should reset metrics', () => {
      securityMetrics.increment('test_metric');
      securityMetrics.increment('another_metric');

      securityMetrics.reset();

      const metrics = securityMetrics.getMetrics();
      expect(metrics).toEqual({});
    });

    it('should handle concurrent increments', () => {
      const metricName = 'concurrent_test';
      const promises = [];

      // Simulate concurrent increments
      for (let i = 0; i < 100; i++) {
        promises.push(Promise.resolve(securityMetrics.increment(metricName)));
      }

      Promise.all(promises).then(() => {
        const metrics = securityMetrics.getMetrics();
        expect(metrics[metricName]).toBe(100);
      });
    });
  });

  describe('trackSecurityMetric', () => {
    it('should track metrics through the convenience function', () => {
      trackSecurityMetric('custom_metric');
      trackSecurityMetric('custom_metric');

      const metrics = securityMetrics.getMetrics();
      expect(metrics.custom_metric).toBe(2);
    });
  });

  describe('securityEventTracker middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {
        method: 'GET',
        path: '/api/test',
        get: vi.fn(header => {
          if (header === 'User-Agent') return 'Mozilla/5.0 (compatible; Chrome)';
          if (header === 'Referer') return 'https://example.com';
          return null;
        }),
      };
      mockRes = {
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      mockNext = vi.fn();
    });

    it('should track request metrics', () => {
      securityEventTracker(mockReq, mockRes, mockNext);

      const metrics = securityMetrics.getMetrics();

      expect(metrics.requests_total).toBe(1);
      expect(metrics.requests_get).toBe(1);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should track suspicious user agents', () => {
      mockReq.get = vi.fn(header => {
        if (header === 'User-Agent') return 'bot';
        return null;
      });

      securityEventTracker(mockReq, mockRes, mockNext);

      const metrics = securityMetrics.getMetrics();
      expect(metrics.suspicious_user_agent).toBe(1);
    });

    it('should track missing user agents', () => {
      mockReq.get = vi.fn(() => null);

      securityEventTracker(mockReq, mockRes, mockNext);

      const metrics = securityMetrics.getMetrics();
      expect(metrics.suspicious_user_agent).toBe(1);
    });

    it('should track various HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

      methods.forEach((method, index) => {
        mockReq.method = method;
        securityEventTracker(mockReq, mockRes, mockNext);

        const metrics = securityMetrics.getMetrics();
        expect(metrics[`requests_${method.toLowerCase()}`]).toBe(1);
        expect(metrics.requests_total).toBe(index + 1);
      });
    });

    it('should track response metrics on finish', () => {
      let finishCallback;
      mockRes.on = vi.fn((event, callback) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
      });

      // Mock response status codes
      mockRes.statusCode = 200;

      securityEventTracker(mockReq, mockRes, mockNext);

      // Simulate response finish
      if (finishCallback) {
        finishCallback();
      }

      const metrics = securityMetrics.getMetrics();
      expect(metrics.response_2xx).toBe(1);
    });

    it('should track different response status codes', () => {
      const statusTests = [
        { status: 200, metric: 'response_2xx' },
        { status: 201, metric: 'response_2xx' },
        { status: 301, metric: 'response_3xx' },
        { status: 400, metric: 'response_4xx' },
        { status: 404, metric: 'response_4xx' },
        { status: 500, metric: 'response_5xx' },
        { status: 503, metric: 'response_5xx' },
      ];

      statusTests.forEach(({ status, metric }) => {
        securityMetrics.reset();

        let finishCallback;
        mockRes.on = vi.fn((event, callback) => {
          if (event === 'finish') {
            finishCallback = callback;
          }
        });
        mockRes.statusCode = status;

        securityEventTracker(mockReq, mockRes, mockNext);

        if (finishCallback) {
          finishCallback();
        }

        const metrics = securityMetrics.getMetrics();
        expect(metrics[metric]).toBe(1);
      });
    });

    it.skip('should clean up event listeners on close', () => {
      let closeCallback;
      mockRes.on = vi.fn((event, callback) => {
        if (event === 'close') {
          closeCallback = callback;
        }
      });

      securityEventTracker(mockReq, mockRes, mockNext);

      // Simulate connection close
      if (closeCallback) {
        closeCallback();
      }

      expect(mockRes.removeListener).toHaveBeenCalledWith('finish', expect.any(Function));
    });
  });
});
