import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';
import { testDataUtils } from '../../utils/testDataIsolationManager.js';
import {
  expectErrorResponse,
  expectRegistrationResponse,
  expectAuthResponse,
} from '../utils/responseHelpers.js';

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

  afterAll(async () => {
    // Properly disconnect from the database to prevent Jest from hanging
    await testDb.disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user', async () => {
      const newUser = {
        email: testDataUtils.generateUniqueEmail('newuser'),
        password: 'SecureTest@2024!',
      };

      const response = await request(app).post('/api/auth/register').send(newUser);

      // Check response structure
      expectRegistrationResponse(response);
      expect(response.body.user.email).toBe(newUser.email);

      // Verify user was created in database
      const createdUser = await testDb.prisma.user.findUnique({
        where: { email: newUser.email },
      });
      expect(createdUser).toBeTruthy();
      expect(createdUser?.email).toBe(newUser.email);
    });

    it('returns 400 for missing email', async () => {
      const response = await request(app).post('/api/auth/register').send({
        password: 'SecureTest@2024!',
      });

      expectErrorResponse(response, 400, /email/i);
    });

    it('returns 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: testDataUtils.generateUniqueEmail('test'),
        });

      expectErrorResponse(response, 400, /password/i);
    });

    it('returns 400 for invalid email format', async () => {
      const response = await request(app).post('/api/auth/register').send({
        email: 'invalid-email',
        password: 'SecureTest@2024!',
      });

      expectErrorResponse(response, 400);
    });

    it('returns 409 for duplicate email', async () => {
      // Use unique email to avoid conflicts with other tests
      const duplicateEmail = testDataUtils.generateUniqueEmail('existing');

      // Create a user first
      await testDb.createUser({
        email: duplicateEmail,
        password: 'TestSecure@123!',
      });

      // Try to register with same email
      const response = await request(app).post('/api/auth/register').send({
        email: duplicateEmail,
        password: 'NewTestSecure@123!',
      });

      expectErrorResponse(response, 409, /already exists/i);
    });
  });

  describe('POST /api/auth/login', () => {
    it('successfully logs in with valid credentials', async () => {
      // Create a user with a consistent email
      const userEmail = testDataUtils.generateUniqueEmail('testuser');
      const user = await testDb.createUser({
        email: userEmail,
        password: 'CorrectTestSecure@123!',
      });

      const response = await request(app).post('/api/auth/login').send({
        email: userEmail,
        password: 'CorrectTestSecure@123!',
      });

      expectAuthResponse(response);
      expect(response.body).toHaveProperty('message', 'Login successful');
      expect(response.body.user.id).toBe(user.id);
      expect(response.body.user.email).toBe(user.email);
    });

    it('returns 401 for invalid password', async () => {
      // Create a user with a consistent email
      const userEmail = testDataUtils.generateUniqueEmail('testuser');
      await testDb.createUser({
        email: userEmail,
        password: 'CorrectTestSecure@123!',
      });

      const response = await request(app).post('/api/auth/login').send({
        email: userEmail,
        password: 'WrongTestSecure@123!',
      });

      expectErrorResponse(response, 401, 'Invalid credentials');
    });

    it('returns 401 for non-existent user', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'SomeTestSecure@123!',
      });

      expectErrorResponse(response, 401, 'Invalid credentials');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('successfully refreshes tokens with valid refresh token', async () => {
      // Create a user and generate tokens
      const user = await testDb.createUser();
      const { refreshToken } = testDb.generateTokens(user.id, user.email);

      const response = await request(app).post('/api/auth/refresh').send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Token refreshed successfully');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(response.body.accessToken).not.toBe(refreshToken);
    });

    it('returns 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.refresh.token' });

      expectErrorResponse(response, 401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('successfully logs out with valid token', async () => {
      // Create a user and generate token
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Logged out successfully');
    });

    it('returns 401 for missing token', async () => {
      const response = await request(app).post('/api/auth/logout');

      expectErrorResponse(response, 401);
    });
  });
});
