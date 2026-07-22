import { describe, it, expect, vi } from 'vitest';
import {
  ConsoleBackend,
  createConsoleBackend,
} from '../src/backends/console.js';
import {
  WinstonBackend,
  createWinstonBackend,
} from '../src/backends/winston.js';
import { PinoBackend, createPinoBackend } from '../src/backends/pino.js';
import type { LogEntry } from '../src/logger.js';

describe('ConsoleBackend', () => {
  it('should create console backend with factory', () => {
    const backend = createConsoleBackend();
    expect(backend).toBeInstanceOf(ConsoleBackend);
  });

  it('should log JSON by default', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new ConsoleBackend();

    const entry: LogEntry = {
      timestamp: '2026-01-31T12:00:00.000Z',
      level: 'info',
      service: 'test',
      env: 'test',
      requestId: 'req-123',
      component: 'test',
      operation: 'test',
      message: 'Test message',
    };

    backend.log(entry);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(entry));
    consoleSpy.mockRestore();
  });

  it('should log pretty format when enabled', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new ConsoleBackend({ pretty: true });

    const entry: LogEntry = {
      timestamp: '2026-01-31T12:00:00.000Z',
      level: 'info',
      service: 'test',
      env: 'test',
      requestId: 'req-123',
      component: 'test',
      operation: 'test',
      message: 'Test message',
    };

    backend.log(entry);

    const loggedMessage = consoleSpy.mock.calls[0][0];
    expect(loggedMessage).toContain('Test message');
    expect(loggedMessage).toContain('requestId=req-123');
    consoleSpy.mockRestore();
  });

  it('should include error details in pretty format', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new ConsoleBackend({ pretty: true });

    const entry: LogEntry = {
      timestamp: '2026-01-31T12:00:00.000Z',
      level: 'error',
      service: 'test',
      env: 'test',
      requestId: 'req-123',
      component: 'test',
      operation: 'test',
      message: 'Error occurred',
      error: {
        message: 'Something went wrong',
        type: 'Error',
        stack: 'Error: Something went wrong\n  at test.js:1:1',
      },
    };

    backend.log(entry);

    expect(consoleSpy).toHaveBeenCalledTimes(3);
    expect(consoleSpy.mock.calls[1][0]).toContain('Error: Something went wrong');
    expect(consoleSpy.mock.calls[2][0]).toContain('Stack:');
    consoleSpy.mockRestore();
  });
});

describe('WinstonBackend', () => {
  it('should create winston backend with factory', () => {
    const mockWinston = {
      createLogger: vi.fn(() => ({
        log: vi.fn(),
      })),
      format: { json: vi.fn(() => ({})) },
      transports: { Console: vi.fn() },
    };

    const backend = createWinstonBackend({ winston: mockWinston });
    expect(backend).toBeInstanceOf(WinstonBackend);
  });

  it('should log to winston logger', () => {
    const mockLog = vi.fn();
    const mockLogger = { log: mockLog };

    const backend = new WinstonBackend({ winston: null, logger: mockLogger });

    const entry: LogEntry = {
      timestamp: '2026-01-31T12:00:00.000Z',
      level: 'info',
      service: 'test',
      env: 'test',
      requestId: 'req-123',
      component: 'test',
      operation: 'test',
      message: 'Test message',
    };

    backend.log(entry);

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: 'Test message',
      })
    );
  });

  it('should flush winston logger if close method exists', async () => {
    const mockClose = vi.fn((cb) => cb());
    const mockLogger = { log: vi.fn(), close: mockClose };

    const backend = new WinstonBackend({ winston: null, logger: mockLogger });

    await backend.flush();

    expect(mockClose).toHaveBeenCalled();
  });
});

describe('PinoBackend', () => {
  it('should create pino backend with factory', () => {
    const mockPino = vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }));

    const backend = createPinoBackend({ pino: mockPino });
    expect(backend).toBeInstanceOf(PinoBackend);
  });

  it('should log to pino logger', () => {
    const mockInfo = vi.fn();
    const mockLogger = {
      info: mockInfo,
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const backend = new PinoBackend({ pino: null, logger: mockLogger });

    const entry: LogEntry = {
      timestamp: '2026-01-31T12:00:00.000Z',
      level: 'info',
      service: 'test',
      env: 'test',
      requestId: 'req-123',
      component: 'test',
      operation: 'test',
      message: 'Test message',
    };

    backend.log(entry);

    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: '2026-01-31T12:00:00.000Z',
        service: 'test',
        env: 'test',
        requestId: 'req-123',
        component: 'test',
        operation: 'test',
      }),
      'Test message'
    );
  });

  it('should flush pino logger if flush method exists', async () => {
    const mockFlush = vi.fn((cb) => cb());
    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      flush: mockFlush,
    };

    const backend = new PinoBackend({ pino: null, logger: mockLogger });

    await backend.flush();

    expect(mockFlush).toHaveBeenCalled();
  });
});
