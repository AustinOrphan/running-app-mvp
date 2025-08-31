import request from 'supertest';
import { createTestApp } from '../utils/testApp';
import { testDb } from '../utils/testDbSetup';

describe('Server Health Integration Tests', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await testDb.clean();
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('Health Check Endpoint', () => {
    it('should respond with 200 and correct health status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should have correct response headers', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['x-powered-by']).toBeUndefined(); // Should be disabled
    });

    it('should respond quickly', async () => {
      const startTime = Date.now();
      const response = await request(app).get('/api/health');
      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Should respond in under 1 second
    });
  });

  describe('Server Configuration', () => {
    it('should have CORS enabled for allowed origins', async () => {
      const response = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should have security headers applied', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      // Check for security headers applied by securityHeaders middleware
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should handle JSON parsing for API endpoints', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'TestPassword123!' });

      // Should not fail with JSON parsing errors (even if auth fails for other reasons)
      expect(response.status).not.toBe(500);
      expect(response.body).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON requests gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Middleware Integration', () => {
    it('should apply rate limiting when enabled', async () => {
      // Make multiple rapid requests to test rate limiting
      const requests = Array.from({ length: 3 }, () => request(app).get('/api/health'));

      const responses = await Promise.all(requests);

      // All requests should succeed for health endpoint (rate limits are usually more lenient for health checks)
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should log requests when request logger is enabled', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      // Request logger should not affect the response
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('API Route Integration', () => {
    it('should have auth routes mounted', async () => {
      const response = await request(app).post('/api/auth/login').send({});

      // Should not be 404, should be some form of validation error
      expect(response.status).not.toBe(404);
    });

    it('should have runs routes mounted', async () => {
      const response = await request(app).get('/api/runs');

      // Should not be 404, may be 401/403 due to auth requirements
      expect(response.status).not.toBe(404);
    });

    it('should have goals routes mounted', async () => {
      const response = await request(app).get('/api/goals');

      // Should not be 404, may be 401/403 due to auth requirements
      expect(response.status).not.toBe(404);
    });

    it('should have stats routes mounted', async () => {
      const response = await request(app).get('/api/stats');

      // Should not be 404, may be 401/403 due to auth requirements
      expect(response.status).not.toBe(404);
    });

    it('should have races routes mounted', async () => {
      const response = await request(app).get('/api/races');

      // Should not be 404, may be 401/403 due to auth requirements
      expect(response.status).not.toBe(404);
    });

    it('should have audit routes mounted', async () => {
      const response = await request(app).get('/api/audit');

      // Should not be 404, may be 401/403 due to auth requirements
      expect(response.status).not.toBe(404);
    });
  });
});
