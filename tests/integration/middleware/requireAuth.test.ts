import { requireAuth } from '../../../server/middleware/requireAuth.js';
import * as errorHandler from '../../../server/middleware/errorHandler.js';
import * as logger from '../../../server/utils/logger.js';
import * as jwtUtils from '../../../server/utils/jwtUtils.js';
import type { Request, Response, NextFunction } from 'express';

describe('requireAuth Middleware - Blacklisted Token Coverage', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  // Get mocked functions from centralized setup
  const mockedLogger = jest.mocked(logger);
  const mockedErrorHandler = jest.mocked(errorHandler);
  const mockedJwtUtils = jest.mocked(jwtUtils);

  beforeEach(() => {
    mockRequest = {
      headers: {},
      user: undefined,
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('Token validation', () => {
    it('should pass through valid non-blacklisted token', async () => {
      const mockToken = 'valid.jwt.token';
      const mockUser = { id: 1, email: 'test@example.com' };

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(mockToken);
      mockedJwtUtils.validateToken.mockResolvedValue(mockUser);
      mockedJwtUtils.isTokenBlacklisted.mockResolvedValue(false);

      mockRequest.headers = { authorization: `Bearer ${mockToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedJwtUtils.extractTokenFromHeader).toHaveBeenCalledWith(mockRequest.headers);
      expect(mockedJwtUtils.validateToken).toHaveBeenCalledWith(mockToken);
      expect(mockedJwtUtils.isTokenBlacklisted).toHaveBeenCalledWith(mockToken);
      expect(mockRequest.user).toEqual(mockUser);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject blacklisted token', async () => {
      const mockToken = 'blacklisted.jwt.token';
      const mockUser = { id: 1, email: 'test@example.com' };

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(mockToken);
      mockedJwtUtils.validateToken.mockResolvedValue(mockUser);
      mockedJwtUtils.isTokenBlacklisted.mockResolvedValue(true);
      mockedErrorHandler.createError.mockReturnValue(new Error('Token has been revoked'));

      mockRequest.headers = { authorization: `Bearer ${mockToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedJwtUtils.isTokenBlacklisted).toHaveBeenCalledWith(mockToken);
      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Token has been revoked', 401);
      expect(mockedLogger.logAuth).toHaveBeenCalledWith(
        'token-validation',
        mockRequest,
        expect.any(Error),
        { reason: 'blacklisted_token' }
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle missing authorization header', async () => {
      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(null);
      mockedErrorHandler.createError.mockReturnValue(new Error('Access token required'));

      mockRequest.headers = {};

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Access token required', 401);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle invalid token format', async () => {
      const invalidToken = 'invalid.token';

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(invalidToken);
      mockedJwtUtils.validateToken.mockRejectedValue(new Error('Invalid token'));
      mockedErrorHandler.createError.mockReturnValue(new Error('Invalid or expired token'));

      mockRequest.headers = { authorization: `Bearer ${invalidToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedJwtUtils.validateToken).toHaveBeenCalledWith(invalidToken);
      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Invalid or expired token', 401);
      expect(mockedLogger.logAuth).toHaveBeenCalledWith(
        'token-validation',
        mockRequest,
        expect.any(Error),
        { token: invalidToken }
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle token blacklist check failure', async () => {
      const mockToken = 'valid.jwt.token';
      const mockUser = { id: 1, email: 'test@example.com' };

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(mockToken);
      mockedJwtUtils.validateToken.mockResolvedValue(mockUser);
      mockedJwtUtils.isTokenBlacklisted.mockRejectedValue(new Error('Database error'));
      mockedErrorHandler.createError.mockReturnValue(new Error('Authentication failed'));

      mockRequest.headers = { authorization: `Bearer ${mockToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedJwtUtils.isTokenBlacklisted).toHaveBeenCalledWith(mockToken);
      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Authentication failed', 401);
      expect(mockedLogger.logAuth).toHaveBeenCalledWith(
        'token-validation',
        mockRequest,
        expect.any(Error),
        { token: mockToken }
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Error scenarios', () => {
    it('should handle expired token', async () => {
      const expiredToken = 'expired.jwt.token';
      const tokenError = new Error('Token expired') as Error & { name: string };
      tokenError.name = 'TokenExpiredError';

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(expiredToken);
      mockedJwtUtils.validateToken.mockRejectedValue(tokenError);
      mockedErrorHandler.createError.mockReturnValue(new Error('Invalid or expired token'));

      mockRequest.headers = { authorization: `Bearer ${expiredToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Invalid or expired token', 401);
      expect(mockedLogger.logAuth).toHaveBeenCalledWith(
        'token-validation',
        mockRequest,
        tokenError,
        { token: expiredToken }
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle malformed token', async () => {
      const malformedToken = 'malformed.token';
      const tokenError = new Error('Invalid token') as Error & { name: string };
      tokenError.name = 'JsonWebTokenError';

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(malformedToken);
      mockedJwtUtils.validateToken.mockRejectedValue(tokenError);
      mockedErrorHandler.createError.mockReturnValue(new Error('Invalid or expired token'));

      mockRequest.headers = { authorization: `Bearer ${malformedToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Invalid or expired token', 401);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle unexpected errors', async () => {
      const mockToken = 'valid.jwt.token';
      const unexpectedError = new Error('Unexpected database failure');

      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(mockToken);
      mockedJwtUtils.validateToken.mockRejectedValue(unexpectedError);
      mockedErrorHandler.createError.mockReturnValue(new Error('Authentication failed'));

      mockRequest.headers = { authorization: `Bearer ${mockToken}` };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Authentication failed', 401);
      expect(mockedLogger.logAuth).toHaveBeenCalledWith(
        'token-validation',
        mockRequest,
        unexpectedError,
        { token: mockToken }
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Token extraction edge cases', () => {
    it('should handle empty authorization header', async () => {
      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(null);
      mockedErrorHandler.createError.mockReturnValue(new Error('Access token required'));

      mockRequest.headers = { authorization: '' };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Access token required', 401);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle malformed authorization header', async () => {
      mockedJwtUtils.extractTokenFromHeader.mockReturnValue(null);
      mockedErrorHandler.createError.mockReturnValue(new Error('Access token required'));

      mockRequest.headers = { authorization: 'InvalidFormat token' };

      await requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockedErrorHandler.createError).toHaveBeenCalledWith('Access token required', 401);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
