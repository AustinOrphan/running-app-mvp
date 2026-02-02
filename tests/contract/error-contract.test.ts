/**
 * Error Contract Tests
 *
 * Verifies that error responses follow the StandardErrorResponse format
 * as defined in AustinOrphan-backend-contracts/error-contract.md
 */

import { describe, it, expect } from 'vitest';
import {
  createNotFoundError,
  createValidationError,
  createAuthError,
  createForbiddenError,
  createConflictError,
  createDatabaseError,
  errorToResponse,
  ValidationError,
} from '@AustinOrphan/errors';

describe('Error Contract Compliance', () => {
  const mockRequestId = '550e8400-e29b-41d4-a716-446655440000';
  const mockPath = '/api/users/123';
  const mockMethod = 'GET';

  describe('StandardErrorResponse Format', () => {
    it('should include all required fields', () => {
      const error = createNotFoundError('User', '123');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      // Required fields
      expect(response).toHaveProperty('error', true);
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('message');
      expect(response).toHaveProperty('statusCode');
      expect(response).toHaveProperty('requestId', mockRequestId);
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('path', mockPath);
      expect(response).toHaveProperty('method', mockMethod);

      // Verify types
      expect(typeof response.error).toBe('boolean');
      expect(typeof response.code).toBe('string');
      expect(typeof response.message).toBe('string');
      expect(typeof response.statusCode).toBe('number');
      expect(typeof response.requestId).toBe('string');
      expect(typeof response.timestamp).toBe('string');
      expect(typeof response.path).toBe('string');
      expect(typeof response.method).toBe('string');
    });

    it('should have ISO 8601 timestamp format', () => {
      const error = createNotFoundError('User', '123');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(response.timestamp).toMatch(iso8601Regex);

      // Should be parseable as Date
      expect(() => new Date(response.timestamp)).not.toThrow();
    });

    it('should not include stack trace in production', () => {
      const error = createNotFoundError('User', '123');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.stack).toBeUndefined();
    });

    it('should include stack trace in development', () => {
      const error = createNotFoundError('User', '123');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, true, true);

      expect(response.stack).toBeDefined();
      expect(typeof response.stack).toBe('string');
    });

    it('should not include details in production', () => {
      const error = createValidationError('Invalid email', 'email', { format: 'email' });
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.details).toBeUndefined();
    });

    it('should include details in development', () => {
      const error = new ValidationError('Invalid email', 'email', { format: 'email' });
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, true, true);

      expect(response.details).toBeDefined();
      expect(response.details).toEqual({ format: 'email' });
    });
  });

  describe('Error Code Mapping', () => {
    it('should map NotFoundError to 404 with NOT_FOUND code', () => {
      const error = createNotFoundError('User', '123');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.statusCode).toBe(404);
      expect(response.code).toBe('NOT_FOUND');
    });

    it('should map ValidationError to 400 with VALIDATION_ERROR code', () => {
      const error = createValidationError('email', 'Invalid input');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.statusCode).toBe(400);
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('should map AuthenticationError to 401 with AUTHENTICATION_ERROR code', () => {
      const error = createAuthError('Invalid token');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.statusCode).toBe(401);
      expect(response.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should map AuthorizationError to 403 with AUTHORIZATION_ERROR code', () => {
      const error = createForbiddenError('Access denied');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.statusCode).toBe(403);
      expect(response.code).toBe('AUTHORIZATION_ERROR');
    });

    it('should map ConflictError to 409 with CONFLICT code', () => {
      const error = createConflictError('User', 'test@example.com');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.statusCode).toBe(409);
      expect(response.code).toBe('CONFLICT');
    });

    it('should map DatabaseError to 500 with DATABASE_ERROR code', () => {
      const error = createDatabaseError('Connection failed');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.statusCode).toBe(500);
      expect(response.code).toBe('DATABASE_ERROR');
    });
  });

  describe('Error Code Format', () => {
    it('should use SCREAMING_SNAKE_CASE for error codes', () => {
      const errors = [
        createNotFoundError('User', '123'),
        createValidationError('field', 'Invalid input'),
        createAuthError('Invalid token'),
        createForbiddenError('Access denied'),
        createConflictError('User', 'test@example.com'),
        createDatabaseError('Connection failed'),
      ];

      const screamingSnakeCaseRegex = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

      errors.forEach(error => {
        const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);
        expect(response.code).toMatch(screamingSnakeCaseRegex);
      });
    });
  });

  describe('Field-Specific Errors', () => {
    it('should include field name for validation errors', () => {
      const error = createValidationError('email', 'Email is invalid');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.field).toBe('email');
    });
  });

  describe('Message Quality', () => {
    it('should have descriptive error messages', () => {
      const error = createNotFoundError('User', '123');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(10);
      expect(response.message).toContain('User');
      expect(response.message).toContain('123');
    });

    it('should not expose sensitive information in messages', () => {
      const error = createDatabaseError('Connection failed');
      const response = errorToResponse(error, mockRequestId, mockPath, mockMethod, false, false);

      // Should not contain connection strings, passwords, etc.
      expect(response.message).not.toContain('password');
      expect(response.message).not.toContain('secret');
      expect(response.message).not.toContain('token');
    });
  });
});
