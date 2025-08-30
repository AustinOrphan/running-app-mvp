import { jest } from '@jest/globals';
import {
  createMockRequest,
  createMockResponse,
  // createMockNext,
  assertResponse,
  // assertResponseHeaders,
  // assertResponseSent,
  // assertResponseRedirect,
  assertErrorResponse,
  mockPrismaOperation,
  mockPrismaError,
  createMockPrismaClient,
  // resetMockPrismaClient,
} from './mockHelpers.js';

import {
  createEnhancedMockRequest,
  createEnhancedMockResponse,
  assertEnhancedResponse,
  createApiTestMock,
  handleMockEdgeCases,
} from './enhancedMockHelpers.js';

describe('Mock Helpers', () => {
  describe('createMockRequest', () => {
    it('creates a mock request with default values', () => {
      const req = createMockRequest({});

      expect(req.method).toBe('GET');
      expect(req.url).toBe('/');
      expect(req.params).toEqual({});
      expect(req.query).toEqual({});
      expect(req.body).toEqual({});
      expect(req.headers).toEqual({});
    });

    it('creates a mock request with custom values', () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/test',
        body: { test: 'data' },
        headers: { 'content-type': 'application/json' },
        user: { id: 'user123' },
      });

      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/test');
      expect(req.body).toEqual({ test: 'data' });
      expect(req.headers).toEqual({ 'content-type': 'application/json' });
      expect(req.user).toEqual({ id: 'user123' });
    });

    it('handles header retrieval correctly', () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer token123' },
      });

      expect(req.get!('Authorization')).toBe('Bearer token123');
      expect(req.header!('authorization')).toBe('Bearer token123');
    });
  });

  describe('createMockResponse', () => {
    it('creates a mock response with chaining', () => {
      const res = createMockResponse();

      const result = res.status!(200).json!({ success: true });
      expect(result).toBe(res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('includes all required response methods', () => {
      const res = createMockResponse();

      expect(res.status).toBeDefined();
      expect(res.json).toBeDefined();
      expect(res.send).toBeDefined();
      expect(res.set).toBeDefined();
      expect(res.header).toBeDefined();
      expect(res.cookie).toBeDefined();
      expect(res.clearCookie).toBeDefined();
      expect(res.redirect).toBeDefined();
      expect(res.end).toBeDefined();
      expect(res.setHeader).toBeDefined();
      expect(res.removeHeader).toBeDefined();
      expect(res.getHeader).toBeDefined();
      expect(res.getHeaders).toBeDefined();
    });
  });

  describe('assertResponse', () => {
    it('asserts status and JSON body correctly', () => {
      const res = createMockResponse();
      res.status!(200);
      res.json!({ success: true, data: 'test' });

      assertResponse(res, 200, { success: true });
    });

    it('handles arrays and primitives correctly', () => {
      const res = createMockResponse();
      res.status!(200);
      res.json!(['item1', 'item2']);

      assertResponse(res, 200, ['item1', 'item2']);
    });

    it('handles null values correctly', () => {
      const res = createMockResponse();
      res.status!(200);
      res.json!(null);

      assertResponse(res, 200, null);
    });
  });

  describe('assertErrorResponse', () => {
    it('asserts error structure correctly', () => {
      const res = createMockResponse();
      res.status!(400);
      res.json!({ error: true, message: 'Validation failed' });

      assertErrorResponse(res, 400, 'Validation failed');
    });
  });

  describe('createMockPrismaClient', () => {
    it('creates a mock client with all operations', () => {
      const mockPrisma = createMockPrismaClient();

      // Check user model
      expect(mockPrisma.user.create).toBeDefined();
      expect(mockPrisma.user.createMany).toBeDefined();
      expect(mockPrisma.user.findUnique).toBeDefined();
      expect(mockPrisma.user.findMany).toBeDefined();
      expect(mockPrisma.user.update).toBeDefined();
      expect(mockPrisma.user.updateMany).toBeDefined();
      expect(mockPrisma.user.upsert).toBeDefined();
      expect(mockPrisma.user.delete).toBeDefined();
      expect(mockPrisma.user.deleteMany).toBeDefined();
      expect(mockPrisma.user.count).toBeDefined();
      expect(mockPrisma.user.aggregate).toBeDefined();
      expect(mockPrisma.user.groupBy).toBeDefined();

      // Check client operations
      expect(mockPrisma.$connect).toBeDefined();
      expect(mockPrisma.$disconnect).toBeDefined();
      expect(mockPrisma.$transaction).toBeDefined();
      expect(mockPrisma.$executeRaw).toBeDefined();
      expect(mockPrisma.$executeRawUnsafe).toBeDefined();
      expect(mockPrisma.$queryRaw).toBeDefined();
      expect(mockPrisma.$queryRawUnsafe).toBeDefined();
    });

    it('handles transaction function correctly', async () => {
      const mockPrisma = createMockPrismaClient();

      const result = await mockPrisma.$transaction(async _prisma => {
        return 'transaction result';
      });

      expect(result).toBe('transaction result');
    });
  });

  describe('mockPrismaOperation', () => {
    it('mocks database operations correctly', () => {
      const mockModel = { findUnique: jest.fn() };
      const testData = { id: '1', name: 'test' };

      mockPrismaOperation(mockModel, 'findUnique', testData);

      expect(mockModel.findUnique).toHaveBeenCalled();
    });
  });

  describe('mockPrismaError', () => {
    it('mocks database errors correctly', async () => {
      const mockModel = { create: jest.fn() };
      const testError = new Error('Database connection failed');

      mockPrismaError(mockModel, 'create', testError);

      await expect(mockModel.create()).rejects.toThrow('Database connection failed');
    });
  });
});

describe('Enhanced Mock Helpers', () => {
  describe('createEnhancedMockRequest', () => {
    it('creates enhanced request with additional properties', () => {
      const req = createEnhancedMockRequest({
        method: 'POST',
        url: '/api/test',
        ip: '192.168.1.1',
        protocol: 'https',
        hostname: 'example.com',
      });

      expect(req.method).toBe('POST');
      expect(req.ip).toBe('192.168.1.1');
      expect(req.protocol).toBe('https');
      expect(req.hostname).toBe('example.com');
      expect(req.accepts).toBeDefined();
      expect(req.param).toBeDefined();
    });
  });

  describe('createEnhancedMockResponse', () => {
    it('tracks status code changes', () => {
      const res = createEnhancedMockResponse();

      res.status!(404);
      expect(res.statusCode).toBe(404);

      res.status!(200);
      expect(res.statusCode).toBe(200);
    });

    it('tracks headers correctly', () => {
      const res = createEnhancedMockResponse();

      res.set!('Content-Type', 'application/json');
      res.setHeader!('X-Custom-Header', 'test-value');

      expect(res.getHeader!('content-type')).toBe('application/json');
      expect(res.getHeader!('x-custom-header')).toBe('test-value');
    });

    it('tracks sent state correctly', () => {
      const res = createEnhancedMockResponse();

      expect(res.headersSent).toBe(false);

      res.json!({ success: true });
      expect(res.headersSent).toBe(true);
    });
  });

  describe('assertEnhancedResponse', () => {
    it('asserts enhanced responses with headers', () => {
      const res = createEnhancedMockResponse();
      res.status!(200);
      res.set!('Content-Type', 'application/json');
      res.json!({ success: true });

      assertEnhancedResponse(
        res,
        200,
        { success: true },
        {
          checkHeaders: { 'Content-Type': 'application/json' },
        }
      );
    });
  });

  describe('createApiTestMock', () => {
    it('creates comprehensive API test mock', () => {
      const mock = createApiTestMock('/api/users', 'POST', {
        requestBody: { name: 'John' },
        expectedStatus: 201,
        expectedResponse: { id: '1', name: 'John' },
      });

      expect(mock.req.method).toBe('POST');
      expect(mock.req.body).toEqual({ name: 'John' });
      expect(mock.res).toBeDefined();
      expect(mock.next).toBeDefined();
      expect(mock.assertResponse).toBeDefined();
      expect(mock.assertError).toBeDefined();
    });
  });

  describe('handleMockEdgeCases', () => {
    it('prevents double response sends', () => {
      const res = createEnhancedMockResponse();
      handleMockEdgeCases(res);

      res.json!({ first: true });

      expect(() => {
        res.json!({ second: true });
      }).toThrow('Cannot set headers after they are sent');
    });
  });
});
