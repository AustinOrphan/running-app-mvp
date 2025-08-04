import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';
import { testDataUtils } from '../../utils/testDataIsolationManager.js';
import {
  createMockResponse,
  createMockRequest,
  assertResponseStructure,
  createMockErrorResponse,
  createMockSuccessResponse,
  validateApiResponse,
  mockAsyncRequest,
  mockNetworkError,
} from '../utils/mockHelpers.js';

describe('Enhanced Request/Response Mocking Examples', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    // Database cleanup is handled globally by jestSetup.ts afterEach
    // No manual cleanup needed here - this avoids redundant cleanup operations
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('Response Structure Validation', () => {
    it('validates error response structure', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'test',
        })
        .expect(400);

      // Use enhanced validation
      validateApiResponse(response.body, 'error');

      // Verify specific error structure
      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(typeof response.body.message).toBe('string');
    });

    it('validates success response structure', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Validate list response
      validateApiResponse(response.body, 'list');
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('validates item response structure', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const goalData = {
        title: 'Test Goal',
        type: 'DISTANCE',
        period: 'WEEKLY',
        targetValue: 50,
        targetUnit: 'km',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .send(goalData)
        .expect(201);

      // Validate item response
      validateApiResponse(response.body, 'item');
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title', 'Test Goal');
    });
  });

  describe('Mock Response Utilities', () => {
    it('creates consistent error responses', () => {
      const errorResponse = createMockErrorResponse(400, 'Validation failed', {
        field: 'email',
        code: 'INVALID_FORMAT',
      });

      expect(errorResponse).toEqual({
        error: true,
        message: 'Validation failed',
        status: 400,
        details: {
          field: 'email',
          code: 'INVALID_FORMAT',
        },
        timestamp: expect.any(String),
      });
    });

    it('creates consistent success responses', () => {
      const successResponse = createMockSuccessResponse(
        { id: 1, name: 'Test' },
        'Operation successful'
      );

      expect(successResponse).toEqual({
        message: 'Operation successful',
        id: 1,
        name: 'Test',
      });
    });

    it('handles async request simulation', async () => {
      // Test successful async request
      const successResult = await mockAsyncRequest(true, { data: 'success' });
      expect(successResult).toEqual({ data: 'success' });

      // Test failed async request
      try {
        await mockAsyncRequest(false, null, 'validation');
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.status).toBe(400);
        expect(error.message).toBe('Validation error');
      }
    });

    it('simulates network errors', () => {
      const timeoutError = mockNetworkError('timeout');
      expect(timeoutError.message).toBe('ETIMEDOUT');
      expect(timeoutError.code).toBe('TIMEOUT');

      const connectionError = mockNetworkError('connection');
      expect(connectionError.message).toBe('ECONNREFUSED');
      expect(connectionError.code).toBe('CONNECTION');
    });
  });

  describe('Enhanced Mock Objects', () => {
    it('tracks status codes in mock response', () => {
      const mockRes = createMockResponse();

      // Call status with different codes
      mockRes.status!(400);
      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.statusMessage).toBe('Bad Request');

      mockRes.status!(404);
      expect(mockRes.statusCode).toBe(404);
      expect(mockRes.statusMessage).toBe('Not Found');
    });

    it('validates JSON serialization in mock response', () => {
      const mockRes = createMockResponse();

      // Valid JSON should work
      expect(() => {
        mockRes.json!({ valid: 'data' });
      }).not.toThrow();

      // Circular references should throw
      const circular: any = {};
      circular.self = circular;

      expect(() => {
        mockRes.json!(circular);
      }).toThrow('Response body is not JSON serializable');
    });

    it('creates comprehensive mock request', () => {
      const mockReq = createMockRequest({
        method: 'POST',
        url: '/api/test',
        body: { test: 'data' },
        headers: { 'content-type': 'application/json' },
        params: { id: '123' },
        query: { filter: 'active' },
      });

      expect(mockReq.method).toBe('POST');
      expect(mockReq.url).toBe('/api/test');
      expect(mockReq.body).toEqual({ test: 'data' });
      expect(mockReq.params).toEqual({ id: '123' });
      expect(mockReq.query).toEqual({ filter: 'active' });
    });
  });

  describe('Response Structure Assertions', () => {
    it('uses enhanced response structure assertion', () => {
      const mockRes = createMockResponse();

      // Simulate error response
      mockRes.status!(400);
      mockRes.json!({
        error: true,
        message: 'Validation failed',
        details: { field: 'email' },
      });

      // Use enhanced assertion
      assertResponseStructure(mockRes, 400, {
        hasError: true,
        hasMessage: true,
        customFields: ['details'],
      });
    });

    it('asserts exact response body when needed', () => {
      const mockRes = createMockResponse();
      const exactBody = { id: 1, name: 'Test', active: true };

      mockRes.status!(200);
      mockRes.json!(exactBody);

      assertResponseStructure(mockRes, 200, {
        exactBody,
      });
    });
  });

  describe('Edge Case Response Handling', () => {
    it('handles 401 unauthorized responses consistently', async () => {
      const response = await request(app).get('/api/runs').expect(401);

      validateApiResponse(response.body, 'error');
      expect(response.body.error).toBe(true);
    });

    it('handles 404 not found responses consistently', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .get('/api/goals/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      validateApiResponse(response.body, 'error');
      expect(response.body.error).toBe(true);
      expect(response.body.message).toContain('not found');
    });

    it('handles 409 conflict responses consistently', async () => {
      // Use unique email to avoid conflicts with other tests
      const conflictEmail = testDataUtils.generateUniqueEmail('conflict');

      // Create a user first
      await testDb.createUser({
        email: conflictEmail,
        password: 'TestPassword123!',
      });

      // Try to create same user again
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: conflictEmail,
          password: 'TestPassword123!',
        })
        .expect(409);

      validateApiResponse(response.body, 'error');
      expect(response.body.error).toBe(true);
      expect(response.body.message).toMatch(/already exists/i);
    });

    it('handles empty response bodies consistently', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal to delete
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Goal to Delete',
          type: 'DISTANCE',
          period: 'WEEKLY',
          targetValue: 50,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          isActive: true,
        },
      });

      const response = await request(app)
        .delete(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // 204 should have empty body
      expect(response.body).toEqual({});
    });
  });
});
