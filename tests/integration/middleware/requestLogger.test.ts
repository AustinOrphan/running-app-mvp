import express from 'express';
import request from 'supertest';
import type { LoggedRequest } from '../../../server/middleware/requestLogger.js';
import type { Request, Response, NextFunction } from 'express';

// Mock uuid module
jest.mock('uuid', () => ({
  v4: () => 'test-request-id',
}));

// Create mock functions that will be used to replace the winston logger
const mockWinstonInfo = jest.fn();
const mockWinstonError = jest.fn();
const mockWinstonWarn = jest.fn();

// Mock the winston logger module completely - use the actual file path
jest.mock(
  '/Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp/server/utils/winstonLogger.ts',
  () => ({
    winstonLogger: {
      info: mockWinstonInfo,
      error: mockWinstonError,
      warn: mockWinstonWarn,
      debug: jest.fn(),
    },
  })
);

// Import middleware after mocking
import { requestLogger, errorLogger } from '../../../server/middleware/requestLogger.js';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);

  // Add test routes
  app.get('/test', (_req: Request, res: Response) => {
    res.json({ message: 'success' });
  });

  app.get('/test-error', (_req: Request, _res: Response) => {
    throw new Error('Test error');
  });

  // Add error logger middleware
  app.use(errorLogger);

  // Add error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
};

describe('Request Logger Middleware', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestLogger', () => {
    it('logs incoming requests', async () => {
      await request(app)
        .get('/test')
        .set('User-Agent', 'test-agent')
        .query({ param: 'value' })
        .expect(200);

      expect(mockWinstonInfo).toHaveBeenCalledWith(
        'Request received',
        expect.objectContaining({
          requestId: 'test-request-id',
          method: 'GET',
          url: '/test?param=value',
          userAgent: 'test-agent',
          component: 'api',
          operation: 'process',
        })
      );
    });

    it('logs response completion', async () => {
      await request(app).get('/test').expect(200);

      expect(mockWinstonInfo).toHaveBeenCalledWith(
        expect.stringContaining('Request completed'),
        expect.objectContaining({
          requestId: 'test-request-id',
          method: 'GET',
          url: '/test',
          statusCode: 200,
          component: 'api',
          operation: 'process',
        })
      );
    });
  });

  describe('errorLogger', () => {
    it('logs request errors', async () => {
      await request(app).get('/test-error').expect(500);

      expect(mockWinstonError).toHaveBeenCalledWith(
        'Request error',
        expect.objectContaining({
          requestId: 'test-request-id',
          method: 'GET',
          url: '/test-error',
          component: 'api',
          operation: 'process',
          error: expect.objectContaining({
            name: 'Error',
            message: 'Test error',
          }),
        })
      );
    });
  });
});
