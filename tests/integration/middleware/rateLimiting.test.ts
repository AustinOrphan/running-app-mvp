import express from 'express';
import request from 'supertest';
import {
  authRateLimit,
  apiRateLimit,
  createRateLimit,
  readRateLimit,
  sensitiveRateLimit,
  globalRateLimit,
  getRateLimitMiddleware,
} from '../../../server/middleware/rateLimiting.js';
import * as logger from '../../../server/utils/secureLogger.js';
import type { Request, Response } from 'express';

describe('RateLimiting Middleware - Complete Coverage', () => {
  let app: express.Application;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRateLimitingEnabled = process.env.RATE_LIMITING_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    // Enable rate limiting for tests
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMITING_ENABLED = 'true';

    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.RATE_LIMITING_ENABLED = originalRateLimitingEnabled;
  });

  describe('Auth Rate Limiting', () => {
    beforeEach(() => {
      app.post('/auth/login', authRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should allow requests within limit', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should include rate limit headers', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password' });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should block requests after limit exceeded', async () => {
      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/auth/login')
          .send({ email: 'test@example.com', password: 'password' });
      }

      // This request should be rate limited
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password' })
        .expect(429);

      expect(response.body.error).toBe('Too many authentication attempts, please try again later.');
    });
  });

  describe('API Rate Limiting', () => {
    beforeEach(() => {
      app.get('/api/data', apiRateLimit, (req: Request, res: Response) => {
        res.json({ data: 'test' });
      });
    });

    it('should allow requests within limit', async () => {
      const response = await request(app).get('/api/data').expect(200);

      expect(response.body.data).toBe('test');
    });

    it('should block requests after limit exceeded', async () => {
      // Make requests up to the limit (100 per 15 minutes)
      for (let i = 0; i < 100; i++) {
        await request(app).get('/api/data');
      }

      // This request should be rate limited
      const response = await request(app).get('/api/data').expect(429);

      expect(response.body.error).toBe('Too many API requests, please try again later.');
    });
  });

  describe('Create Rate Limiting', () => {
    beforeEach(() => {
      app.post('/api/runs', createRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should allow create requests within limit', async () => {
      const response = await request(app)
        .post('/api/runs')
        .send({ distance: 5.0, duration: 1800 })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should block create requests after limit exceeded', async () => {
      // Make requests up to the limit (20 per hour)
      for (let i = 0; i < 20; i++) {
        await request(app).post('/api/runs').send({ distance: 5.0, duration: 1800 });
      }

      // This request should be rate limited
      const response = await request(app)
        .post('/api/runs')
        .send({ distance: 5.0, duration: 1800 })
        .expect(429);

      expect(response.body.error).toBe('Too many create requests, please slow down.');
    });
  });

  describe('Read Rate Limiting', () => {
    beforeEach(() => {
      app.get('/api/runs', readRateLimit, (req: Request, res: Response) => {
        res.json({ runs: [] });
      });
    });

    it('should allow read requests within limit', async () => {
      const response = await request(app).get('/api/runs').expect(200);

      expect(response.body.runs).toEqual([]);
    });

    it('should block read requests after limit exceeded', async () => {
      // Make requests up to the limit (200 per 15 minutes)
      for (let i = 0; i < 200; i++) {
        await request(app).get('/api/runs');
      }

      // This request should be rate limited
      const response = await request(app).get('/api/runs').expect(429);

      expect(response.body.error).toBe('Too many read requests, please slow down.');
    });
  });

  describe('Sensitive Rate Limiting', () => {
    beforeEach(() => {
      app.post('/auth/reset-password', sensitiveRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should allow sensitive requests within limit', async () => {
      const response = await request(app)
        .post('/auth/reset-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should block sensitive requests after limit exceeded', async () => {
      // Make requests up to the limit (3 per hour)
      for (let i = 0; i < 3; i++) {
        await request(app).post('/auth/reset-password').send({ email: 'test@example.com' });
      }

      // This request should be rate limited
      const response = await request(app)
        .post('/auth/reset-password')
        .send({ email: 'test@example.com' })
        .expect(429);

      expect(response.body.error).toBe('Too many sensitive requests, please try again later.');
    });
  });

  describe('Global Rate Limiting', () => {
    beforeEach(() => {
      app.get('/any-endpoint', globalRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should allow requests within global limit', async () => {
      const response = await request(app).get('/any-endpoint').expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should block requests after global limit exceeded', async () => {
      // Make requests up to the global limit (1000 per 15 minutes)
      for (let i = 0; i < 1000; i++) {
        await request(app).get('/any-endpoint');
      }

      // This request should be rate limited
      const response = await request(app).get('/any-endpoint').expect(429);

      expect(response.body.error).toBe('Too many requests from this IP, please try again later.');
    });
  });

  describe('getRateLimitMiddleware', () => {
    it('should return correct middleware for auth', () => {
      const middleware = getRateLimitMiddleware('auth');
      expect(middleware).toBe(authRateLimit);
    });

    it('should return correct middleware for api', () => {
      const middleware = getRateLimitMiddleware('api');
      expect(middleware).toBe(apiRateLimit);
    });

    it('should return correct middleware for create', () => {
      const middleware = getRateLimitMiddleware('create');
      expect(middleware).toBe(createRateLimit);
    });

    it('should return correct middleware for read', () => {
      const middleware = getRateLimitMiddleware('read');
      expect(middleware).toBe(readRateLimit);
    });

    it('should return correct middleware for sensitive', () => {
      const middleware = getRateLimitMiddleware('sensitive');
      expect(middleware).toBe(sensitiveRateLimit);
    });

    it('should return global middleware for unknown type', () => {
      const middleware = getRateLimitMiddleware('unknown' as any);
      expect(middleware).toBe(globalRateLimit);
    });
  });

  describe('Rate limiting disabled', () => {
    beforeEach(() => {
      process.env.RATE_LIMITING_ENABLED = 'false';
      app = express();
      app.get('/test', authRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should bypass rate limiting when disabled', async () => {
      // Make many requests that would normally be rate limited
      for (let i = 0; i < 50; i++) {
        const response = await request(app).get('/test').expect(200);
        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('Rate limit headers', () => {
    beforeEach(() => {
      app.get('/test-headers', authRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should include standard rate limit headers', async () => {
      const response = await request(app).get('/test-headers').expect(200);

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should decrement remaining count', async () => {
      const firstResponse = await request(app).get('/test-headers');
      const secondResponse = await request(app).get('/test-headers');

      const firstRemaining = parseInt(firstResponse.headers['x-ratelimit-remaining']);
      const secondRemaining = parseInt(secondResponse.headers['x-ratelimit-remaining']);

      expect(secondRemaining).toBe(firstRemaining - 1);
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      app.get('/test-error', authRateLimit, (req: Request, res: Response) => {
        res.json({ success: true });
      });
    });

    it('should handle rate limit exceeded gracefully', async () => {
      // Exceed the rate limit
      for (let i = 0; i < 10; i++) {
        await request(app).get('/test-error');
      }

      const response = await request(app).get('/test-error').expect(429);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Too many');
    });
  });
});
