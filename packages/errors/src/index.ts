/**
 * @AustinOrphan/errors
 *
 * Standardized error handling for backend services
 * Implements the error contract specification
 */

export {
  StandardError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  createNotFoundError,
  createValidationError,
  createAuthError,
  createForbiddenError,
  createConflictError,
  createDatabaseError,
  errorToHTTPStatus,
  errorToResponse,
  type StandardErrorResponse,
} from "./errors.js";

export {
  createExpressErrorHandler,
  type ExpressErrorHandlerOptions,
} from "./adapters/express.js";

export {
  createFastifyErrorHandler,
  type FastifyErrorHandlerOptions,
} from "./adapters/fastify.js";
