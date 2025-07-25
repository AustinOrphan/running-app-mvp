import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import authRoutes from '../../../server/routes/auth.js';
import { testDb } from '../../fixtures/testDatabase.js';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
};

describe('Auth API Integration Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(async () => {
    // Clean database before each test
    await testDb.cleanupDatabase();
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user', async () => {
      const newUser = {
        email: 'newuser@test.com',
        password: 'securepassword123',
      };

      const response = await request(app).post('/api/auth/register').send(newUser).expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email', newUser.email);
      expect(response.body.user).not.toHaveProperty('password');

      // Verify user was created in database
      const createdUser = await testDb.prisma.user.findUnique({
        where: { email: newUser.email },
      });
      expect(createdUser).toBeTruthy();
      expect(createdUser?.email).toBe(newUser.email);
    });

    it('returns 400 for missing email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          password: 'securepassword123',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('email');
    });

    it('returns 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('password');
    });

    it('returns 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'securepassword123',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('returns 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '123',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('password');
    });

    it('returns 409 for duplicate email', async () => {
      const userEmail = 'duplicate@test.com';

      // Create first user
      await testDb.createTestUser({
        email: userEmail,
        password: 'password123',
      });

      // Try to create second user with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: userEmail,
          password: 'differentpassword123',
        })
        .expect(409);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('already exists');
    });

    it('hashes password before storing in database', async () => {
      const plainPassword = 'mysecretpassword';
      const newUser = {
        email: 'hashtest@test.com',
        password: plainPassword,
      };

      await request(app).post('/api/auth/register').send(newUser).expect(201);

      const createdUser = await testDb.prisma.user.findUnique({
        where: { email: newUser.email },
      });

      expect(createdUser?.password).not.toBe(plainPassword);
      expect(createdUser?.password).toHaveLength(60); // bcrypt hash length
    });
  });

  describe('POST /api/auth/login', () => {
    let testUser: TestUser | undefined;

    beforeEach(async () => {
      // Create test user for login tests
      testUser = await testDb.createTestUser({
        email: 'logintest@test.com',
        password: 'testpassword123',
      });
    });

    it('successfully logs in with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'testpassword123',
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', assertTestUser(testUser).id);
      expect(response.body.user).toHaveProperty('email', assertTestUser(testUser).email);
      expect(response.body.user).not.toHaveProperty('password');
    });

    it('returns 400 for missing email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          password: 'testpassword123',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('returns 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('returns 401 for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'testpassword123',
        })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('returns 401 for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('returns valid JWT tokens', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'testpassword123',
        })
        .expect(200);

      // Check access token
      const accessToken = response.body.accessToken;
      expect(accessToken).toBeTruthy();
      expect(typeof accessToken).toBe('string');
      expect(accessToken.split('.')).toHaveLength(3); // JWT has 3 parts

      // Check refresh token
      const refreshToken = response.body.refreshToken;
      expect(refreshToken).toBeTruthy();
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('handles case-insensitive email login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email.toUpperCase(),
          password: 'testpassword123',
        })
        .expect(200);

      expect(response.body.user.email).toBe(assertTestUser(testUser).email);
    });
  });

  describe('GET /api/auth/verify', () => {
    let testUser: TestUser | undefined;
    let validToken: string;

    beforeEach(async () => {
      testUser = await testDb.createTestUser({
        email: 'verify@test.com',
        password: 'testpassword123',
      });

      validToken = testDb.generateTestToken(assertTestUser(testUser).id);
    });

    it('successfully verifies valid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', assertTestUser(testUser).id);
      expect(response.body.user).toHaveProperty('email', assertTestUser(testUser).email);
      expect(response.body.user).not.toHaveProperty('password');
    });

    it('returns 401 without authorization header', async () => {
      await request(app).get('/api/auth/verify').expect(401);
    });

    it('returns 401 with malformed authorization header', async () => {
      await request(app).get('/api/auth/verify').set('Authorization', 'InvalidFormat').expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app)
        .get('/api/auth/verify')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('returns 401 with expired token', async () => {
      // Create expired token (would need to mock jwt.sign with past expiry)
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';

      await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('returns 401 if user no longer exists', async () => {
      // Delete the user after creating token
      await testDb.prisma.user.delete({
        where: { id: assertTestUser(testUser).id },
      });

      await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(401);
    });
  });

  describe('Rate Limiting', () => {
    let originalRateLimitingEnabled: string | undefined;

    beforeAll(() => {
      // Enable rate limiting for these specific tests while keeping NODE_ENV=test
      // This avoids test flakiness from NODE_ENV modification in parallel execution
      originalRateLimitingEnabled = process.env.RATE_LIMITING_ENABLED;
      process.env.RATE_LIMITING_ENABLED = 'true';
    });

    afterAll(() => {
      // Properly restore environment variable to prevent test contamination
      if (originalRateLimitingEnabled === undefined) {
        delete process.env.RATE_LIMITING_ENABLED;
      } else {
        process.env.RATE_LIMITING_ENABLED = originalRateLimitingEnabled;
      }
    });

    it('handles multiple registration attempts and triggers rate limit', async () => {
      // Verify rate limiting is enabled for this test
      expect(process.env.RATE_LIMITING_ENABLED).toBe('true');

      const responses: request.Response[] = [];

      // Make exactly 5 registration requests (the limit)
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: `ratelimit${i}@test.com`,
            password: 'testpassword123',
          });
        responses.push(response);
      }

      // First 5 requests should succeed (or fail due to business logic, but not rate limiting)
      for (let i = 0; i < 5; i++) {
        expect(responses[i].status).not.toBe(429);
      }

      // 6th request should trigger rate limit
      const rateLimitedResponse = await request(app).post('/api/auth/register').send({
        email: 'ratelimited@test.com',
        password: 'testpassword123',
      });

      // Verify rate limit was triggered
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body).toHaveProperty('message');
      expect(rateLimitedResponse.body.message).toMatch(/too many.*attempts/i);
      expect(rateLimitedResponse.headers).toHaveProperty('retry-after');

      // Verify the rate limit response includes proper headers
      expect(rateLimitedResponse.body).toHaveProperty('status', 429);
      expect(rateLimitedResponse.body).toHaveProperty('retryAfter');
    });

    it('handles multiple login attempts with invalid credentials and triggers rate limit', async () => {
      const testUser = await testDb.createTestUser({
        email: 'bruteforce@test.com',
        password: 'correctpassword',
      });

      const responses: request.Response[] = [];

      // Make exactly 5 failed login attempts (the limit)
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: assertTestUser(testUser).email,
            password: 'wrongpassword',
          });
        responses.push(response);
      }

      // First 5 attempts should fail with 401 (unauthorized), not 429 (rate limited)
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.message).toContain('Invalid credentials');
      }

      // 6th attempt should trigger rate limit
      const rateLimitedResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'wrongpassword',
        });

      // Verify rate limit was triggered
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body).toHaveProperty('message');
      expect(rateLimitedResponse.body.message).toMatch(/too many.*attempts/i);
      expect(rateLimitedResponse.headers).toHaveProperty('retry-after');
      expect(rateLimitedResponse.body).toHaveProperty('status', 429);
      expect(rateLimitedResponse.body).toHaveProperty('retryAfter');

      // Verify that even a correct password is now rate limited
      const correctPasswordResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'correctpassword',
        });

      expect(correctPasswordResponse.status).toBe(429);
      expect(correctPasswordResponse.body).toHaveProperty('message');
      expect(correctPasswordResponse.body.message).toMatch(/too many.*attempts/i);
      expect(correctPasswordResponse.headers).toHaveProperty('retry-after');
      expect(correctPasswordResponse.body).toHaveProperty('status', 429);
      expect(correctPasswordResponse.body).toHaveProperty('retryAfter');
    });

    it('verifies rate limiting environment is properly configured', async () => {
      // This test ensures that our rate limiting setup correctly simulates production
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.RATE_LIMITING_ENABLED).toBe('true');

      // Verify that a single request works before hitting the limit
      const singleResponse = await request(app).post('/api/auth/register').send({
        email: 'single@test.com',
        password: 'testpassword123',
      });

      // Should succeed (201) or fail for business reasons (400), but not be rate limited (429)
      expect(singleResponse.status).not.toBe(429);
    });
  });

  describe('Error Handling', () => {
    it('handles database connection errors gracefully', async () => {
      // Mock database error by disconnecting
      await testDb.prisma.$disconnect();

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'error@test.com',
          password: 'testpassword123',
        })
        .expect(500);

      expect(response.body).toHaveProperty('message');
    });

    it('handles malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('handles missing content-type header', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send('email=test@example.com&password=test123')
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Token Refresh Tests', () => {
    let testUser: TestUser | undefined;
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      testUser = await testDb.createTestUser({
        email: 'refresh@test.com',
        password: 'testpassword123',
      });

      // Login to get initial tokens
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'testpassword123',
        })
        .expect(200);

      accessToken = loginResponse.body.accessToken;
      refreshToken = loginResponse.body.refreshToken;
    });

    it('successfully refreshes tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', assertTestUser(testUser).id);
      expect(response.body.user).toHaveProperty('email', assertTestUser(testUser).email);

      // New tokens should be different from old ones (token rotation)
      expect(response.body.accessToken).not.toBe(accessToken);
      expect(response.body.refreshToken).not.toBe(refreshToken);
    });

    it('returns 400 for missing refresh token', async () => {
      const response = await request(app).post('/api/auth/refresh').send({}).expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Refresh token is required');
    });

    it('returns 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid refresh token');
    });

    it('returns 401 for expired refresh token', async () => {
      // Create an expired refresh token (would need to mock jwt.sign with past expiry)
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: expiredToken })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid refresh token');
    });

    it('returns 401 if user no longer exists', async () => {
      // Delete the user after getting tokens
      await testDb.prisma.user.delete({
        where: { id: assertTestUser(testUser).id },
      });

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid refresh token');
    });

    it('invalidates old refresh token after successful refresh (token rotation)', async () => {
      // First refresh - should succeed
      const firstRefresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      const newRefreshToken = firstRefresh.body.refreshToken;

      // Try to use old refresh token again - should fail
      const secondRefresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(secondRefresh.body).toHaveProperty('message');
      expect(secondRefresh.body.message).toContain('Invalid refresh token');

      // New refresh token should still work
      const thirdRefresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: newRefreshToken })
        .expect(200);

      expect(thirdRefresh.body).toHaveProperty('accessToken');
      expect(thirdRefresh.body).toHaveProperty('refreshToken');
    });

    it('returns both accessToken and refreshToken in response', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Check both tokens are present and valid JWT format
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.refreshToken).toBeTruthy();
      expect(response.body.accessToken.split('.')).toHaveLength(3);
      expect(response.body.refreshToken.split('.')).toHaveLength(3);
    });

    it('new access token works for protected routes', async () => {
      // Refresh tokens
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      const newAccessToken = refreshResponse.body.accessToken;

      // Use new access token to verify auth
      const verifyResponse = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);

      expect(verifyResponse.body.user).toHaveProperty('id', assertTestUser(testUser).id);
    });

    it('handles concurrent refresh requests gracefully', async () => {
      // Make multiple refresh requests concurrently
      const promises = Array.from({ length: 3 }, () =>
        request(app).post('/api/auth/refresh').send({ refreshToken })
      );

      const responses = await Promise.all(promises);

      // At least one should succeed
      const successfulResponses = responses.filter(r => r.status === 200);
      expect(successfulResponses.length).toBeGreaterThanOrEqual(1);

      // Others might fail due to token rotation
      const failedResponses = responses.filter(r => r.status === 401);
      if (failedResponses.length > 0) {
        failedResponses.forEach(response => {
          expect(response.body.message).toContain('Invalid refresh token');
        });
      }
    });
  });

  describe('Security Tests', () => {
    it('does not return password in any response', async () => {
      const userData = {
        email: 'security@test.com',
        password: 'securepassword123',
      };

      // Register
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(JSON.stringify(registerResponse.body)).not.toContain('password');
      expect(JSON.stringify(registerResponse.body)).not.toContain('securepassword123');

      // Login
      const loginResponse = await request(app).post('/api/auth/login').send(userData).expect(200);

      expect(JSON.stringify(loginResponse.body)).not.toContain('password');
      expect(JSON.stringify(loginResponse.body)).not.toContain('securepassword123');

      // Verify
      const accessToken = loginResponse.body.accessToken;
      const verifyResponse = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(JSON.stringify(verifyResponse.body)).not.toContain('password');
      expect(JSON.stringify(verifyResponse.body)).not.toContain('securepassword123');
    });

    it('sanitizes user input to prevent injection attacks', async () => {
      const maliciousData = {
        email: '<script>alert("xss")</script>@test.com',
        password: 'DROP TABLE users; --',
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(maliciousData)
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('validates email format strictly', async () => {
      const invalidEmails = [
        'plainaddress',
        '@missingdomain.com',
        'missing@.com',
        'missing@domain',
        'spaces @domain.com',
        'multiple@@domain.com',
      ];

      for (const email of invalidEmails) {
        await request(app)
          .post('/api/auth/register')
          .send({
            email,
            password: 'validpassword123',
          })
          .expect(400);
      }
    });
  });
});
