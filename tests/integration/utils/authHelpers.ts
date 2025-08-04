import { testDb } from './testDbSetup.js';
import type { Application } from 'express';
import request from 'supertest';

export interface AuthenticatedUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Helper to create and authenticate a test user
 */
export async function createAuthenticatedUser(
  app: Application,
  userData?: { email?: string; password?: string }
): Promise<AuthenticatedUser> {
  const email = userData?.email || `test-${Date.now()}@example.com`;
  const password = userData?.password || 'TestSecure#2024';

  // Register the user
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password })
    .expect(201);

  return {
    id: response.body.user.id,
    email: response.body.user.email,
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

/**
 * Helper to login an existing user
 */
export async function loginUser(
  app: Application,
  credentials: { email: string; password: string }
): Promise<AuthenticatedUser> {
  const response = await request(app).post('/api/auth/login').send(credentials).expect(200);

  return {
    id: response.body.user.id,
    email: response.body.user.email,
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

/**
 * Helper to create an authenticated request
 */
export function authenticatedRequest(
  app: Application,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  token: string
) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

/**
 * Helper to refresh access token
 */
export async function refreshAccessToken(
  app: Application,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(200);

  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

/**
 * Helper to create a user directly in the database
 */
export async function createTestUserDirectly(userData?: { email?: string; password?: string }) {
  return testDb.createUser(userData);
}

/**
 * Helper to generate test tokens directly
 */
export function generateTestTokensDirectly(userId: string, email?: string) {
  return testDb.generateTokens(userId, email);
}

/**
 * Assert authentication error response
 */
export function assertAuthError(response: request.Response, expectedMessage?: string) {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  expect(response.body).toHaveProperty('error');
  if (expectedMessage) {
    expect(response.body.error).toContain(expectedMessage);
  }
}

/**
 * Assert successful authentication response
 */
export function assertAuthSuccess(response: request.Response) {
  expect(response.body).toHaveProperty('accessToken');
  expect(response.body).toHaveProperty('refreshToken');
  expect(response.body).toHaveProperty('user');
  expect(response.body.user).toHaveProperty('id');
  expect(response.body.user).toHaveProperty('email');
  expect(response.body.user).not.toHaveProperty('password');

  // Verify tokens are valid JWTs
  expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  expect(response.body.refreshToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
}
