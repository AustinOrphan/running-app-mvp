import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';

describe('Auth API Integration Tests', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    // Create a properly configured test app
    app = createTestApp();
  });

  beforeEach(async () => {
    // Ensure clean database state for each test
    await testDb.clean();
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user', async () => {
      const newUser = {
        email: 'newuser@test.com',
        password: 'SecureTest@2024!',
      };

      const response = await request(app).post('/api/auth/register').send(newUser).expect(201);

      // Check response structure
      expect(response.body).toHaveProperty('message', 'User created successfully');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email', newUser.email);
      expect(response.body.user).not.toHaveProperty('password');

      // Verify tokens are valid JWTs
      expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(response.body.refreshToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

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
          password: 'SecureTest@2024!',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toMatch(/email/i);
    });

    it('returns 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toMatch(/password/i);
    });

    it('returns 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'SecureTest@2024!',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('returns 409 for duplicate email', async () => {
      // Create a user first
      await testDb.createUser({
        email: 'existing@test.com',
        password: 'TestSecure@123!',
      });

      // Try to register with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'existing@test.com',
          password: 'NewTestSecure@123!',
        })
        .expect(409);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toMatch(/already exists/i);
    });
  });

  describe('POST /api/auth/login', () => {
    it('successfully logs in with valid credentials', async () => {
      // Create a user
      const user = await testDb.createUser({
        email: 'testuser@example.com',
        password: 'CorrectTestSecure@123!',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testuser@example.com',
          password: 'CorrectTestSecure@123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Login successful');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', user.id);
      expect(response.body.user).toHaveProperty('email', user.email);
    });

    it('returns 401 for invalid password', async () => {
      // Create a user
      await testDb.createUser({
        email: 'testuser@example.com',
        password: 'CorrectTestSecure@123!',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testuser@example.com',
          password: 'WrongTestSecure@123!',
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message', 'Invalid credentials');
    });

    it('returns 401 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomeTestSecure@123!',
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message', 'Invalid credentials');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('successfully refreshes tokens with valid refresh token', async () => {
      // Create a user and generate tokens
      const user = await testDb.createUser();
      const { refreshToken } = testDb.generateTokens(user.id, user.email);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Token refreshed successfully');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(response.body.accessToken).not.toBe(refreshToken);
    });

    it('returns 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.refresh.token' })
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('successfully logs out with valid token', async () => {
      // Create a user and generate token
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Logged out successfully');
    });

    it('returns 401 for missing token', async () => {
      const response = await request(app).post('/api/auth/logout').expect(401);

      expect(response.body).toHaveProperty('error', true);
    });
  });
});
