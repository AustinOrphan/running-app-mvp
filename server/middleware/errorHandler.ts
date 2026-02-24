/**
 * Error Handler Middleware
 *
 * Now powered by @AustinOrphan/errors for standardized error handling.
 * Maintains backward compatibility with existing error factory functions.
 */

import { Request, Response, NextFunction } from 'express';
import {
  errorToResponse,
  StandardError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  createNotFoundError as sharedCreateNotFoundError,
  createAuthError,
  createForbiddenError as sharedCreateForbiddenError,
  createConflictError as sharedCreateConflictError,
} from '@AustinOrphan/errors';

// Re-export StandardError types for backward compatibility
export type AppError = StandardError;

// Use shared error response formatter
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

  // Handle JSON parsing errors from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    const validationError = createValidationError('Invalid JSON in request body', 'body');
    const errorResponse = errorToResponse(
      validationError,
      requestId,
      req.path,
      req.method,
      isDevelopment,
      isDevelopment
    );
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  const errorResponse = errorToResponse(
    err,
    requestId,
    req.path,
    req.method,
    isDevelopment,
    isDevelopment
  );

  res.status(errorResponse.statusCode).json(errorResponse);
};

// Re-export factory functions for backward compatibility
export const createError = (message: string, statusCode: number = 500): StandardError => {
  return new StandardError(message, `ERROR_${statusCode}`, statusCode);
};

export const createNotFoundError = (resource: string = 'Resource'): NotFoundError => {
  return sharedCreateNotFoundError(resource, '');
};

export const createValidationError = (
  message: string,
  field?: string,
  details?: Record<string, unknown>
): ValidationError => {
  return new ValidationError(message, field, details);
};

export const createUnauthorizedError = (message: string = 'Unauthorized'): AuthenticationError => {
  return createAuthError(message);
};

export const createForbiddenError = (message: string = 'Forbidden'): AuthorizationError => {
  return sharedCreateForbiddenError(message);
};

export const createConflictError = (
  message: string,
  details?: Record<string, unknown>
): ConflictError => {
  // Parse message to extract resource and identifier if needed
  const match = message.match(/^(.+?)\s+'([^']+)'\s+already exists$/);
  if (match) {
    return sharedCreateConflictError(match[1], match[2]);
  }
  return new ConflictError(message, details);
};

export const createDatabaseError = (
  message: string = 'Database operation failed',
  details?: Record<string, unknown>
): DatabaseError => {
  return new DatabaseError(message, details);
};

// Re-export error classes for direct instantiation
export {
  StandardError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
};
