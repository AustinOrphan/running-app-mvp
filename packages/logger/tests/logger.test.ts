import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLogger,
  Logger,
  type LogEntry,
  type LoggerBackend,
} from '../src/logger.js';

describe('Logger', () => {
  let mockBackend: LoggerBackend;
  let loggedEntries: LogEntry[];

  beforeEach(() => {
    loggedEntries = [];
    mockBackend = {
      log: vi.fn((entry: LogEntry) => {
        loggedEntries.push(entry);
      }),
    };
  });

  it('should create a logger with createLogger factory', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
    });

    expect(logger).toBeInstanceOf(Logger);
  });

  it('should log info messages', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
    });

    logger.info('Test message', {
      requestId: 'req-123',
      component: 'auth',
      operation: 'login',
    });

    expect(loggedEntries).toHaveLength(1);
    expect(loggedEntries[0]).toMatchObject({
      level: 'info',
      service: 'test-service',
      env: 'test',
      requestId: 'req-123',
      component: 'auth',
      operation: 'login',
      message: 'Test message',
    });
    expect(loggedEntries[0].timestamp).toBeDefined();
  });

  it('should log error messages with error details', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'development',
      backend: mockBackend,
    });

    const error = new Error('Something went wrong');
    logger.error('Operation failed', {
      requestId: 'req-123',
      component: 'database',
      operation: 'create-user',
      context: { error },
    });

    expect(loggedEntries).toHaveLength(1);
    expect(loggedEntries[0]).toMatchObject({
      level: 'error',
      message: 'Operation failed',
      component: 'database',
      operation: 'create-user',
    });
    expect(loggedEntries[0].error).toMatchObject({
      message: 'Something went wrong',
      type: 'Error',
    });
    expect(loggedEntries[0].error?.stack).toBeDefined();
  });

  it('should not include stack trace in production', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'production',
      backend: mockBackend,
    });

    const error = new Error('Something went wrong');
    logger.error('Operation failed', {
      requestId: 'req-123',
      component: 'database',
      operation: 'create-user',
      context: { error },
    });

    expect(loggedEntries[0].error?.stack).toBeUndefined();
  });

  it('should respect log level filtering', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
      level: 'warn',
    });

    logger.debug('Debug message', {
      requestId: 'req-1',
      component: 'test',
      operation: 'test',
    });
    logger.info('Info message', {
      requestId: 'req-2',
      component: 'test',
      operation: 'test',
    });
    logger.warn('Warn message', {
      requestId: 'req-3',
      component: 'test',
      operation: 'test',
    });
    logger.error('Error message', {
      requestId: 'req-4',
      component: 'test',
      operation: 'test',
    });

    expect(loggedEntries).toHaveLength(2);
    expect(loggedEntries[0].level).toBe('warn');
    expect(loggedEntries[1].level).toBe('error');
  });

  it('should create child logger with inherited context', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
    });

    const childLogger = logger.child({
      requestId: 'req-123',
      component: 'auth',
    });

    childLogger.info('Child message', { operation: 'login' });

    expect(loggedEntries).toHaveLength(1);
    expect(loggedEntries[0]).toMatchObject({
      requestId: 'req-123',
      component: 'auth',
      operation: 'login',
    });
  });

  it('should override child context with new context', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
    });

    const childLogger = logger.child({
      requestId: 'req-123',
      component: 'auth',
    });

    childLogger.info('Message', {
      component: 'database',
      operation: 'query',
    });

    expect(loggedEntries[0]).toMatchObject({
      component: 'database',
      operation: 'query',
    });
  });

  it('should use default component if provided', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
      defaultComponent: 'api',
    });

    logger.info('Message', { requestId: 'req-123', operation: 'test' });

    expect(loggedEntries[0].component).toBe('api');
  });

  it('should use "no-request-id" if requestId is not provided', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
    });

    logger.info('Message', { component: 'test', operation: 'test' });

    expect(loggedEntries[0].requestId).toBe('no-request-id');
  });

  it('should include optional fields when provided', () => {
    const logger = createLogger({
      service: 'test-service',
      env: 'test',
      backend: mockBackend,
    });

    logger.info('Message', {
      requestId: 'req-123',
      traceId: 'trace-456',
      userId: 'user-789',
      component: 'auth',
      operation: 'login',
      context: { ip: '192.168.1.1' },
    });

    expect(loggedEntries[0]).toMatchObject({
      traceId: 'trace-456',
      userId: 'user-789',
      context: { ip: '192.168.1.1' },
    });
  });

  it('should flush backend if flush method exists', async () => {
    const flushMock = vi.fn(() => Promise.resolve());
    const backendWithFlush = {
      ...mockBackend,
      flush: flushMock,
    };

    const logger = new Logger({
      service: 'test-service',
      env: 'test',
      backend: backendWithFlush,
    });

    await logger.flush();

    expect(flushMock).toHaveBeenCalled();
  });
});
