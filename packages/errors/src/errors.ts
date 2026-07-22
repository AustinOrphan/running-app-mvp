/**
 * Standard error response format according to error-contract.md
 */
export type StandardErrorResponse = {
  error: boolean;
  code: string;
  message: string;
  statusCode: number;
  requestId: string;
  timestamp: string;
  path: string;
  method: string;
  details?: Record<string, unknown>;
  field?: string;
  stack?: string;
};

/**
 * Base error class for all standardized errors
 */
export class StandardError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly field?: string;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: Record<string, unknown>,
    field?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.field = field;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * HTTP 404 - Resource not found
 */
export class NotFoundError extends StandardError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "NOT_FOUND", 404, details);
  }
}

/**
 * HTTP 400 - Validation error
 */
export class ValidationError extends StandardError {
  constructor(
    message: string,
    field?: string,
    details?: Record<string, unknown>
  ) {
    super(message, "VALIDATION_ERROR", 400, details, field);
  }
}

/**
 * HTTP 401 - Authentication error
 */
export class AuthenticationError extends StandardError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "AUTHENTICATION_ERROR", 401, details);
  }
}

/**
 * HTTP 403 - Authorization error
 */
export class AuthorizationError extends StandardError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "AUTHORIZATION_ERROR", 403, details);
  }
}

/**
 * HTTP 409 - Conflict error
 */
export class ConflictError extends StandardError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, details);
  }
}

/**
 * HTTP 500 - Database error
 */
export class DatabaseError extends StandardError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "DATABASE_ERROR", 500, details);
  }
}

/**
 * Factory function to create NotFoundError
 * @param resource - The resource type that was not found
 * @param id - The identifier of the resource
 * @returns NotFoundError instance
 */
export function createNotFoundError(
  resource: string,
  id: string
): NotFoundError {
  return new NotFoundError(`${resource} with id '${id}' not found`);
}

/**
 * Factory function to create ValidationError
 * @param field - The field that failed validation
 * @param message - Validation error message
 * @returns ValidationError instance
 */
export function createValidationError(
  field: string,
  message: string
): ValidationError {
  return new ValidationError(message, field);
}

/**
 * Factory function to create AuthenticationError
 * @param message - Authentication error message (default: "Authentication required")
 * @returns AuthenticationError instance
 */
export function createAuthError(
  message: string = "Authentication required"
): AuthenticationError {
  return new AuthenticationError(message);
}

/**
 * Factory function to create AuthorizationError
 * @param message - Authorization error message (default: "Forbidden")
 * @returns AuthorizationError instance
 */
export function createForbiddenError(
  message: string = "Forbidden"
): AuthorizationError {
  return new AuthorizationError(message);
}

/**
 * Factory function to create ConflictError
 * @param resource - The resource type that conflicts
 * @param identifier - The identifier of the conflicting resource
 * @returns ConflictError instance
 */
export function createConflictError(
  resource: string,
  identifier: string
): ConflictError {
  return new ConflictError(`${resource} '${identifier}' already exists`);
}

/**
 * Factory function to create DatabaseError
 * @param operation - The database operation that failed
 * @param details - Additional error details
 * @returns DatabaseError instance
 */
export function createDatabaseError(
  operation: string,
  details?: Record<string, unknown>
): DatabaseError {
  return new DatabaseError(`Database operation failed: ${operation}`, details);
}

/**
 * Maps an error to its HTTP status code
 * @param error - The error to map
 * @returns HTTP status code
 */
export function errorToHTTPStatus(error: Error): number {
  if (error instanceof StandardError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Converts an error to a standard error response
 * @param error - The error to convert
 * @param requestId - Request correlation ID
 * @param path - Request path
 * @param method - HTTP method
 * @param includeStack - Whether to include stack trace (dev only)
 * @param includeDetails - Whether to include details (dev only)
 * @returns StandardErrorResponse object
 */
export function errorToResponse(
  error: Error,
  requestId: string,
  path: string,
  method: string,
  includeStack: boolean = false,
  includeDetails: boolean = false
): StandardErrorResponse {
  const isStandardError = error instanceof StandardError;

  const response: StandardErrorResponse = {
    error: true,
    code: isStandardError ? error.code : "INTERNAL_ERROR",
    message: error.message || "An unexpected error occurred",
    statusCode: isStandardError ? error.statusCode : 500,
    requestId,
    timestamp: new Date().toISOString(),
    path,
    method,
  };

  if (isStandardError && error.field) {
    response.field = error.field;
  }

  if (includeDetails && isStandardError && error.details) {
    response.details = error.details;
  }

  if (includeStack && error.stack) {
    response.stack = error.stack;
  }

  return response;
}
