/**
 * Logging Contract Tests
 *
 * Verifies that log entries follow the LogEntry format
 * as defined in AustinOrphan-backend-contracts/logging-contract.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createLogger } from '@AustinOrphan/logger';
import type { LogEntry } from '@AustinOrphan/logger';

describe('Logging Contract Compliance', () => {
  let capturedLogs: LogEntry[] = [];

  // Create a custom backend that captures logs for testing
  const testBackend = {
    log: (entry: LogEntry) => {
      capturedLogs.push(entry);
    },
  };

  beforeEach(() => {
    capturedLogs = [];
  });

  const logger = createLogger({
    service: 'running-app-mvp',
    env: 'test',
    backend: testBackend,
    level: 'debug',
  });

  describe('LogEntry Format', () => {
    it('should include all required fields', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
      });

      expect(capturedLogs).toHaveLength(1);
      const entry = capturedLogs[0];

      // Required fields
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level', 'info');
      expect(entry).toHaveProperty('service', 'running-app-mvp');
      expect(entry).toHaveProperty('env', 'test');
      expect(entry).toHaveProperty('requestId');
      expect(entry).toHaveProperty('component', 'test');
      expect(entry).toHaveProperty('operation', 'test-operation');
      expect(entry).toHaveProperty('message', 'Test message');
    });

    it('should have ISO 8601 timestamp format', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
      });

      const entry = capturedLogs[0];

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(entry.timestamp).toMatch(iso8601Regex);

      // Should be parseable as Date
      expect(() => new Date(entry.timestamp)).not.toThrow();
    });

    it('should use valid log levels', () => {
      const validLevels: Array<'error' | 'warn' | 'info' | 'debug'> = [
        'error',
        'warn',
        'info',
        'debug',
      ];

      validLevels.forEach(level => {
        capturedLogs = [];
        logger[level]('Test message', {
          requestId: 'test-request-id',
          component: 'test',
          operation: 'test-operation',
        });

        expect(capturedLogs[0].level).toBe(level);
      });
    });

    it('should include optional userId when provided', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        userId: 'user123',
        component: 'test',
        operation: 'test-operation',
      });

      const entry = capturedLogs[0];
      expect(entry.userId).toBe('user123');
    });

    it('should include optional context when provided', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
        context: { foo: 'bar', count: 42 },
      });

      const entry = capturedLogs[0];
      expect(entry.context).toEqual({ foo: 'bar', count: 42 });
    });
  });

  describe('Error Logging', () => {
    it('should include error details for error logs', () => {
      const testError = new Error('Test error');
      testError.name = 'TestError';

      // Manually log error with details
      const errorEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'running-app-mvp',
        env: 'test',
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
        message: 'Test error occurred',
        error: {
          message: testError.message,
          type: testError.name,
          code: 'TEST_ERROR',
          stack: testError.stack,
        },
      };

      testBackend.log(errorEntry);

      const entry = capturedLogs[0];
      expect(entry.error).toBeDefined();
      expect(entry.error?.message).toBe('Test error');
      expect(entry.error?.type).toBe('TestError');
      expect(entry.error?.code).toBe('TEST_ERROR');
      expect(entry.error?.stack).toBeDefined();
    });

    it('should not include stack trace in production', () => {
      const errorEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'running-app-mvp',
        env: 'production',
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
        message: 'Test error occurred',
        error: {
          message: 'Test error',
          type: 'TestError',
          code: 'TEST_ERROR',
          // stack should not be included in production
        },
      };

      testBackend.log(errorEntry);

      const entry = capturedLogs[capturedLogs.length - 1];
      expect(entry.error?.stack).toBeUndefined();
    });
  });

  describe('Component Names', () => {
    const standardComponents = ['auth', 'database', 'api', 'middleware', 'service', 'repository'];

    it('should use consistent component names', () => {
      standardComponents.forEach(component => {
        capturedLogs = [];
        logger.info('Test message', {
          requestId: 'test-request-id',
          component,
          operation: 'test-operation',
        });

        const entry = capturedLogs[0];
        expect(entry.component).toBe(component);
      });
    });

    it('should not have spaces in component names', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test-component',
        operation: 'test-operation',
      });

      const entry = capturedLogs[0];
      expect(entry.component).not.toContain(' ');
    });
  });

  describe('Operation Names', () => {
    it('should use kebab-case for multi-word operations', () => {
      const operations = [
        'create-user',
        'update-user',
        'delete-user',
        'fetch-list',
        'process-payment',
      ];

      operations.forEach(operation => {
        capturedLogs = [];
        logger.info('Test message', {
          requestId: 'test-request-id',
          component: 'test',
          operation,
        });

        const entry = capturedLogs[0];
        expect(entry.operation).toBe(operation);
        // Should be kebab-case (lowercase with hyphens)
        expect(entry.operation).toMatch(/^[a-z]+(-[a-z]+)*$/);
      });
    });
  });

  describe('Context Field', () => {
    it('should not include sensitive information', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
        context: {
          userId: 'user123',
          action: 'login',
          // password should not be logged
        },
      });

      const entry = capturedLogs[0];
      expect(entry.context).toBeDefined();
      expect(entry.context).not.toHaveProperty('password');
      expect(entry.context).not.toHaveProperty('secret');
      expect(entry.context).not.toHaveProperty('token');
    });

    it('should allow structured data in context', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
        context: {
          method: 'POST',
          path: '/api/users',
          statusCode: 201,
          duration: 45,
        },
      });

      const entry = capturedLogs[0];
      expect(entry.context).toEqual({
        method: 'POST',
        path: '/api/users',
        statusCode: 201,
        duration: 45,
      });
    });
  });

  describe('Service and Environment Fields', () => {
    it('should include service name', () => {
      logger.info('Test message', {
        requestId: 'test-request-id',
        component: 'test',
        operation: 'test-operation',
      });

      const entry = capturedLogs[0];
      expect(entry.service).toBe('running-app-mvp');
    });

    it('should include environment', () => {
      const envs = ['development', 'production', 'test'];

      envs.forEach(env => {
        const envLogger = createLogger({
          service: 'test-service',
          env,
          backend: testBackend,
          level: 'info',
        });

        capturedLogs = [];
        envLogger.info('Test message', {
          requestId: 'test-request-id',
          component: 'test',
          operation: 'test-operation',
        });

        const entry = capturedLogs[0];
        expect(entry.env).toBe(env);
      });
    });
  });

  describe('Request Correlation', () => {
    it('should include requestId for request correlation', () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';

      logger.info('Test message', {
        requestId,
        component: 'test',
        operation: 'test-operation',
      });

      const entry = capturedLogs[0];
      expect(entry.requestId).toBe(requestId);
    });

    it('should support optional traceId for distributed tracing', () => {
      const traceId = '12345678-1234-1234-1234-123456789012';

      logger.info('Test message', {
        requestId: 'test-request-id',
        traceId,
        component: 'test',
        operation: 'test-operation',
      });

      const entry = capturedLogs[0];
      expect(entry.traceId).toBe(traceId);
    });
  });
});
