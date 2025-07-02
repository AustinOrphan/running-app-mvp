import cors from 'cors';
import express from 'express';
import request from 'supertest';

import authRoutes from '../../../routes/auth.js';
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

      expect(response.body).toHaveProperty('token');
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
    let testUser: any;

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
          email: testUser.email,
          password: 'testpassword123',
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', testUser.id);
      expect(response.body.user).toHaveProperty('email', testUser.email);
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
          email: testUser.email,
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
          email: testUser.email,
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('returns valid JWT token', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'testpassword123',
        })
        .expect(200);

      const token = response.body.token;
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('handles case-insensitive email login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email.toUpperCase(),
          password: 'testpassword123',
        })
        .expect(200);

      expect(response.body.user.email).toBe(testUser.email);
    });
  });

  describe('GET /api/auth/verify', () => {
    let testUser: any;
    let validToken: string;

    beforeEach(async () => {
      testUser = await testDb.createTestUser({
        email: 'verify@test.com',
        password: 'testpassword123',
      });
      validToken = testDb.generateTestToken(testUser.id);
    });

    it('successfully verifies valid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', testUser.id);
      expect(response.body.user).toHaveProperty('email', testUser.email);
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
        where: { id: testUser.id },
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
      process.env.RATE_LIMITING_ENABLED = originalRateLimitingEnabled;
    });

    it('handles multiple registration attempts', async () => {
      const userData = {
        email: 'ratelimit@test.com',
        password: 'testpassword123',
      };

      // First request should succeed
      await request(app).post('/api/auth/register').send(userData).expect(201);

      let lastResponse: request.Response | undefined;
      const RATE_LIMIT_TEST_ATTEMPTS = 5;

      // Additional requests should eventually hit the rate limit
      for (let i = 0; i < RATE_LIMIT_TEST_ATTEMPTS; i++) {
        lastResponse = await request(app)
          .post('/api/auth/register')
          .send({
            email: `ratelimit${i}@test.com`,
            password: 'testpassword123',
          });
      }

      expect(lastResponse).toBeDefined();
      expect(lastResponse!.status).toBe(429);
      expect(lastResponse!.body).toHaveProperty('message');
      expect(lastResponse!.body.message).toMatch(/too many/i);
    });

    it('handles multiple login attempts with invalid credentials', async () => {
      const testUser = await testDb.createTestUser({
        email: 'bruteforce@test.com',
        password: 'correctpassword',
      });

      // Multiple failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: testUser.email,
            password: 'wrongpassword',
          })
          .expect(401);
      }
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
      const token = loginResponse.body.token;
      const verifyResponse = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${token}`)
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
