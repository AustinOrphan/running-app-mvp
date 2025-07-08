/**
 * Enhanced Logger Utility for Error Standardization and Observability
 * 
 * This module provides a standardized logging interface that builds on
 * the existing secureLogger utility while adding structured error
 * categorization and improved observability features.
 */

import { Request } from 'express';
import { secureLogger } from './secureLogger.js';
import { 
  StructuredLogData, 
  ErrorType, 
  LogComponent, 
  ErrorContext, 
  EnhancedLoggerOptions 
} from '../types/logging.js';
import { v4 as uuidv4 } from 'uuid';

class EnhancedLogger {
  /**
   * Determines error type based on error object and context
   */
  private categorizeError(error: Error, context?: Record<string, unknown>): ErrorType {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.constructor.name.toLowerCase();

    // Database errors
    if (errorName.includes('prisma') || 
        errorMessage.includes('database') || 
        errorMessage.includes('connection') ||
        errorMessage.includes('query')) {
      return 'DatabaseError';
    }

    // Authentication errors
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid credentials') ||
        errorMessage.includes('token') ||
        errorMessage.includes('jwt')) {
      return 'AuthenticationError';
    }

    // Authorization errors
    if (errorMessage.includes('forbidden') || 
        errorMessage.includes('access denied') ||
        errorMessage.includes('permission')) {
      return 'AuthorizationError';
    }

    // Validation errors
    if (errorName.includes('validation') || 
        errorMessage.includes('required') ||
        errorMessage.includes('invalid') ||
        context?.statusCode === 400) {
      return 'ValidationError';
    }

    // Not found errors
    if (errorMessage.includes('not found') || 
        context?.statusCode === 404) {
      return 'NotFoundError';
    }

    // Conflict errors
    if (errorMessage.includes('already exists') || 
        errorMessage.includes('conflict') ||
        context?.statusCode === 409) {
      return 'ConflictError';
    }

    // External service errors
    if (errorMessage.includes('fetch') || 
        errorMessage.includes('request') ||
        errorMessage.includes('network') ||
        errorMessage.includes('timeout')) {
      return 'ExternalServiceError';
    }

    // Configuration errors
    if (errorMessage.includes('environment') || 
        errorMessage.includes('config') ||
        errorMessage.includes('secret')) {
      return 'ConfigurationError';
    }

    return 'UnknownError';
  }

  /**
   * Extracts correlation ID from request or generates one
   */
  private getCorrelationId(req?: Request): string {
    if (req?.correlationId) {
      return req.correlationId;
    }
    
    const correlationId = uuidv4();
    if (req) {
      req.correlationId = correlationId;
    }
    
    return correlationId;
  }

  /**
   * Creates structured log data from components
   */
  private createStructuredLogData(
    level: 'error' | 'warn' | 'info' | 'debug',
    options: EnhancedLoggerOptions,
    error?: Error
  ): StructuredLogData {
    const correlationId = this.getCorrelationId(options.req);
    
    const logData: StructuredLogData = {
      timestamp: new Date().toISOString(),
      level,
      correlationId,
      component: options.component,
      operation: options.operation,
      context: options.context
    };

    if (error) {
      const errorType = this.categorizeError(error, options.context);
      logData.error = {
        message: error.message,
        type: errorType,
        code: (error as any).code || undefined,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }

    return logData;
  }

  /**
   * Log error with enhanced categorization and context
   */
  error(
    options: EnhancedLoggerOptions,
    error: Error,
    message?: string
  ): void {
    const logMessage = message || `${options.component}:${options.operation} error`;
    const structuredData = this.createStructuredLogData('error', options, error);
    
    // Use existing secureLogger for actual logging with redaction
    secureLogger.error(logMessage, options.req, error, {
      ...structuredData,
      errorType: structuredData.error?.type,
      component: options.component,
      operation: options.operation
    });
  }

  /**
   * Log warning with structured context
   */
  warn(
    options: EnhancedLoggerOptions,
    message: string
  ): void {
    const structuredData = this.createStructuredLogData('warn', options);
    const logMessage = `${options.component}:${options.operation} - ${message}`;
    
    secureLogger.warn(logMessage, options.req, {
      ...structuredData,
      component: options.component,
      operation: options.operation
    });
  }

  /**
   * Log info with structured context
   */
  info(
    options: EnhancedLoggerOptions,
    message: string
  ): void {
    const structuredData = this.createStructuredLogData('info', options);
    const logMessage = `${options.component}:${options.operation} - ${message}`;
    
    secureLogger.info(logMessage, options.req, {
      ...structuredData,
      component: options.component,
      operation: options.operation
    });
  }

  /**
   * Log debug with structured context (development only)
   */
  debug(
    options: EnhancedLoggerOptions,
    message: string
  ): void {
    if (process.env.NODE_ENV !== 'development') {
      return;
    }
    
    const structuredData = this.createStructuredLogData('debug', options);
    const logMessage = `${options.component}:${options.operation} - ${message}`;
    
    secureLogger.debug(logMessage, options.req, {
      ...structuredData,
      component: options.component,
      operation: options.operation
    });
  }

  /**
   * Log database operation with context
   */
  database(
    operation: string,
    req?: Request,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    const options: EnhancedLoggerOptions = {
      component: 'database',
      operation,
      req,
      context
    };

    if (error) {
      this.error(options, error, `Database operation failed: ${operation}`);
    } else {
      this.info(options, `Database operation completed: ${operation}`);
    }
  }

  /**
   * Log authentication events with enhanced security context
   */
  auth(
    operation: string,
    req?: Request,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    const options: EnhancedLoggerOptions = {
      component: 'auth',
      operation,
      req,
      context
    };

    if (error) {
      this.error(options, error, `Authentication ${operation} failed`);
    } else {
      this.info(options, `Authentication ${operation} successful`);
    }
  }

  /**
   * Create correlation middleware for request tracking
   */
  correlationMiddleware() {
    return (req: Request, res: any, next: any) => {
      req.correlationId = this.getCorrelationId(req);
      next();
    };
  }
}

// Export singleton instance
export const logger = new EnhancedLogger();

// Export convenience functions that match the issue requirements
export const logError = (
  component: LogComponent,
  operation: string,
  error: Error,
  req?: Request,
  context?: Record<string, unknown>
) => {
  logger.error({ component, operation, req, context }, error);
};

export const logWarn = (
  component: LogComponent,
  operation: string,
  message: string,
  req?: Request,
  context?: Record<string, unknown>
) => {
  logger.warn({ component, operation, req, context }, message);
};

export const logInfo = (
  component: LogComponent,
  operation: string,
  message: string,
  req?: Request,
  context?: Record<string, unknown>
) => {
  logger.info({ component, operation, req, context }, message);
};

export const logDatabase = (
  operation: string,
  req?: Request,
  error?: Error,
  context?: Record<string, unknown>
) => {
  logger.database(operation, req, error, context);
};

export const logAuth = (
  operation: string,
  req?: Request,
  error?: Error,
  context?: Record<string, unknown>
) => {
  logger.auth(operation, req, error, context);
};

export const correlationMiddleware = () => logger.correlationMiddleware();

// Re-export existing secureLogger for backward compatibility
export { secureLogger } from './secureLogger.js';