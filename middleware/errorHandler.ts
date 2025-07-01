import { Request, Response, NextFunction } from 'express';
import { secureLogger } from '../utils/secureLogger.js';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  errorCode?: string;
  details?: Record<string, unknown>;
  field?: string;
}

export interface ErrorResponse {
  error: boolean;
  message: string;
  statusCode: number;
  category: string;
  timestamp: string;
  path: string;
  method: string;
  errorCode?: string;
  field?: string;
  details?: Record<string, unknown>;
  stack?: string;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Determine error category for better client handling
  const errorCategory = getErrorCategory(statusCode);

  // Use secure logging with automatic data redaction and context
  secureLogger.error('Express route error', req, err, {
    statusCode,
    isOperational: err.isOperational || false,
    errorType: err.constructor.name,
    errorCode: err.errorCode,
    category: errorCategory,
    field: err.field,
  });

  // Build comprehensive error response
  const errorResponse: ErrorResponse = {
    error: true,
    message,
    statusCode,
    category: errorCategory,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  };

  // Add optional fields if present
  if (err.errorCode) {
    errorResponse.errorCode = err.errorCode;
  }
  if (err.field) {
    errorResponse.field = err.field;
  }
  if (err.details && process.env.NODE_ENV === 'development') {
    errorResponse.details = err.details;
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Helper function to categorize errors by status code
 */
const getErrorCategory = (statusCode: number): string => {
  if (statusCode >= 400 && statusCode < 500) {
    return 'client_error';
  }
  if (statusCode >= 500) {
    return 'server_error';
  }
  return 'unknown';
};

/**
 * Creates a standard application error
 */
export const createError = (message: string, statusCode: number = 500): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
};

/**
 * Creates a validation error with field information
 */
export const createValidationError = (
  message: string,
  field?: string,
  details?: Record<string, unknown>
): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = 400;
  error.isOperational = true;
  error.errorCode = 'VALIDATION_ERROR';
  error.field = field;
  error.details = details;
  return error;
};

/**
 * Creates a not found error
 */
export const createNotFoundError = (resource: string = 'Resource'): AppError => {
  const error = new Error(`${resource} not found`) as AppError;
  error.statusCode = 404;
  error.isOperational = true;
  error.errorCode = 'NOT_FOUND';
  return error;
};

/**
 * Creates an unauthorized error
 */
export const createUnauthorizedError = (message: string = 'Unauthorized'): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = 401;
  error.isOperational = true;
  error.errorCode = 'UNAUTHORIZED';
  return error;
};

/**
 * Creates a forbidden error
 */
export const createForbiddenError = (message: string = 'Forbidden'): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = 403;
  error.isOperational = true;
  error.errorCode = 'FORBIDDEN';
  return error;
};

/**
 * Creates a conflict error
 */
export const createConflictError = (
  message: string,
  details?: Record<string, unknown>
): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = 409;
  error.isOperational = true;
  error.errorCode = 'CONFLICT';
  error.details = details;
  return error;
};

/**
 * Creates a database error
 */
export const createDatabaseError = (
  message: string = 'Database operation failed',
  details?: Record<string, unknown>
): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = 500;
  error.isOperational = true;
  error.errorCode = 'DATABASE_ERROR';
  error.details = details;
  return error;
};
