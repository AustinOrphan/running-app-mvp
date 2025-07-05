import { Prisma } from '@prisma/client';
import {
  createDatabaseError,
  createValidationError,
  createNotFoundError,
  createConflictError,
} from '../middleware/errorHandler.js';

/**
 * Handles Prisma database errors and converts them to appropriate AppErrors
 * @param error - The Prisma error to handle
 * @param operation - Description of the database operation that failed
 * @returns AppError with appropriate status code and message
 */
export const handleDatabaseError = (error: unknown, operation: string = 'Database operation') => {
  // Handle Prisma-specific errors
  let fieldName, target;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        // Unique constraint violation
        target = error.meta?.target as string[] | undefined;
        fieldName = target?.[0] || 'field';
        return createConflictError(`${fieldName} already exists`, {
          fieldName,
          code: error.code,
          operation,
        });

      case 'P2025':
        // Record not found
        return createNotFoundError('Record');

      case 'P2003':
        // Foreign key constraint violation
        return createValidationError('Invalid reference to related data', 'foreign_key', {
          code: error.code,
          operation,
        });

      case 'P2011':
        // Null constraint violation
        fieldName = error.meta?.field_name as string | undefined;
        return createValidationError(`Required field '${fieldName}' cannot be null`, fieldName, {
          code: error.code,
          operation,
        });

      case 'P2012':
        // Missing required value
        fieldName = error.meta?.field_name as string | undefined;
        return createValidationError(`Missing required field '${fieldName}'`, fieldName, {
          code: error.code,
          operation,
        });

      case 'P1008':
        // Connection timeout
        return createDatabaseError('Database connection timeout', {
          code: error.code,
          operation,
          retryable: true,
        });

      case 'P1001':
        // Connection error
        return createDatabaseError('Cannot connect to database', {
          code: error.code,
          operation,
          retryable: true,
        });

      default:
        // Generic Prisma error
        return createDatabaseError(`${operation} failed`, {
          code: error.code,
          message: error.message,
          operation,
        });
    }
  }

  // Handle connection errors
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const errorWithCode = error as { code: string; message?: string; name?: string };

    if (errorWithCode.code === 'ECONNREFUSED' || errorWithCode.code === 'ENOTFOUND') {
      return createDatabaseError('Database connection failed', {
        code: errorWithCode.code,
        operation,
        retryable: true,
      });
    }

    // Handle timeout errors
    if (errorWithCode.code === 'ETIMEDOUT') {
      return createDatabaseError('Database operation timed out', {
        code: errorWithCode.code,
        operation,
        retryable: true,
      });
    }
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return createDatabaseError(`${operation} failed: ${error.message}`, {
      originalError: error.name,
      operation,
    });
  }

  // Fallback for non-Error objects and other primitives
  return createDatabaseError(`${operation} failed: Unknown error`, {
    originalError: 'Unknown',
    operation,
  });
};

/**
 * Wrapper for database operations with automatic error handling
 * @param operation - The database operation to execute
 * @param operationName - Description of the operation for error messages
 * @returns Promise that resolves with the operation result or rejects with an AppError
 */
export const withDatabaseErrorHandling = async <T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw handleDatabaseError(error, operationName);
  }
};
