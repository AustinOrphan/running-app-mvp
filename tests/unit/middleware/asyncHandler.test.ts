import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { asyncHandler, asyncAuthHandler } from '../../../server/middleware/asyncHandler';
import { AuthRequest } from '../../../server/middleware/requireAuth';

describe('AsyncHandler Middleware Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  describe('asyncHandler', () => {
    it('should call next with error when async function throws', async () => {
      const errorMessage = 'Test async error';
      const testHandler = asyncHandler(async (_req, _res, _next) => {
        throw new Error(errorMessage);
      });

      await testHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should not call next when async function succeeds', async () => {
      const testHandler = asyncHandler(async (_req, _res, _next) => {
        (_res as any).json({ success: true });
      });

      await testHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('asyncAuthHandler', () => {
    it('should handle authenticated route errors properly', async () => {
      const authError = new Error('Authentication failed');
      const testHandler = asyncAuthHandler(async (_req, _res, _next) => {
        throw authError;
      });

      const mockAuthRequest = {
        ...mockRequest,
        user: { id: 'test-user', email: 'test@example.com' },
      } as AuthRequest;

      await testHandler(mockAuthRequest, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(authError);
    });
  });
});
