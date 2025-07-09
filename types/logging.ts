/**
 * Enhanced Logging Types for Error Standardization and Observability
 *
 * This module extends the existing secureLogger types with additional
 * structures for improved error categorization and observability.
 */

import { Request } from 'express';

export interface StructuredLogData {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  correlationId: string;
  component: LogComponent; // 'auth', 'runs', 'stats', 'goals', 'races', 'server', 'middleware', 'database'
  operation: string; // 'fetchRuns', 'createGoal', 'login', etc.
  error?: {
    message: string;
    stack?: string;
    code?: string;
    type: ErrorType; // 'ValidationError', 'DatabaseError', 'AuthError', etc.
  };
  context?: Record<string, unknown>; // Additional context (user ID, request params, etc.)
  [key: string]: unknown; // Index signature to allow compatibility with Record<string, unknown>
}

export type ErrorType =
  | 'ValidationError'
  | 'DatabaseError'
  | 'AuthenticationError'
  | 'AuthorizationError'
  | 'NotFoundError'
  | 'ConflictError'
  | 'ExternalServiceError'
  | 'ConfigurationError'
  | 'NetworkError'
  | 'UnknownError';

export type LogComponent =
  | 'auth'
  | 'runs'
  | 'stats'
  | 'goals'
  | 'races'
  | 'server'
  | 'middleware'
  | 'database';

export interface EnhancedLoggerOptions {
  component: LogComponent;
  operation: string;
  req?: Request;
  context?: Record<string, unknown>;
}

declare module 'express' {
  interface Request {
    correlationId?: string;
    user?: {
      id: string;
      email: string;
    };
  }
}
