/**
 * Winston-based Structured Logger Implementation - Issue #178
 *
 * Now integrated with @AustinOrphan/logger shared package.
 * Maintains backward compatibility with existing interfaces.
 */

import winston from 'winston';
import { createLogger, createWinstonBackend } from '@AustinOrphan/logger';

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  component?: string;
  operation?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

export enum LogCategory {
  API = 'api',
  DATABASE = 'database',
  AUTH = 'auth',
  VALIDATION = 'validation',
  EXTERNAL = 'external',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
}

export enum LogOperation {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  VALIDATE = 'validate',
  PROCESS = 'process',
}

// Environment-specific configuration (kept for backward compatibility)
export const loggerConfig = {
  development: {
    level: 'debug',
    handleExceptions: true,
    json: false,
    colorize: true,
  },
  production: {
    level: 'info',
    handleExceptions: true,
    json: true,
    colorize: false,
  },
  test: {
    level: 'error',
    handleExceptions: false,
    json: false,
    colorize: false,
  },
};

// JSON format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(
    ({ timestamp, level, message, ...meta }: winston.Logform.TransformableInfo) => {
      const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
      return `${timestamp} [${level}]: ${message} ${metaString}`;
    }
  )
);

// Create underlying Winston instance
const winstonInstance = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: {
    service: 'running-app-mvp',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console transport with environment-specific format
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
    }),

    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: logFormat,
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: logFormat,
    }),
  ],
});

// Create shared logger with winston backend
const winstonBackend = createWinstonBackend({
  winston: winston,
  logger: winstonInstance,
});
const sharedLogger = createLogger({
  service: 'running-app-mvp',
  env: process.env.NODE_ENV || 'development',
  backend: winstonBackend,
  level: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
  redactPII: process.env.PII_HASHING_ENABLED === 'true',
});

// Export winston instance wrapped with shared logger interface
export const winstonLogger = winstonInstance;

// Logging helper functions - now using shared logger with backward compatibility
export const logError = (
  message: string,
  error: Error,
  context?: {
    requestId?: string;
    userId?: string;
    component?: string;
    operation?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  // Build error message with details
  const errorMessage = `${message}: ${error.message}`;

  sharedLogger.error(errorMessage, {
    requestId: context?.requestId,
    userId: context?.userId,
    component: context?.component || 'unknown',
    operation: context?.operation || 'unknown',
    context: {
      errorType: error.name,
      errorCode: (error as Error & { code?: string }).code,
      errorStack: error.stack,
      ...context?.metadata,
    },
  });
};

export const logInfo = (
  message: string,
  context?: {
    requestId?: string;
    userId?: string;
    component?: string;
    operation?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  sharedLogger.info(message, {
    requestId: context?.requestId,
    userId: context?.userId,
    component: context?.component || 'unknown',
    operation: context?.operation || 'unknown',
    context: context?.metadata,
  });
};

export const logWarn = (
  message: string,
  context?: {
    requestId?: string;
    userId?: string;
    component?: string;
    operation?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  sharedLogger.warn(message, {
    requestId: context?.requestId,
    userId: context?.userId,
    component: context?.component || 'unknown',
    operation: context?.operation || 'unknown',
    context: context?.metadata,
  });
};

export const logDebug = (
  message: string,
  context?: {
    requestId?: string;
    userId?: string;
    component?: string;
    operation?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  sharedLogger.debug(message, {
    requestId: context?.requestId,
    userId: context?.userId,
    component: context?.component || 'unknown',
    operation: context?.operation || 'unknown',
    context: context?.metadata,
  });
};

// Category-specific logging functions
export const logDatabase = (
  operation: LogOperation,
  message: string,
  context?: {
    requestId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  logInfo(message, {
    ...context,
    component: LogCategory.DATABASE,
    operation,
  });
};

export const logAuth = (
  operation: LogOperation,
  message: string,
  context?: {
    requestId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  logInfo(message, {
    ...context,
    component: LogCategory.AUTH,
    operation,
  });
};

export const logAPI = (
  operation: LogOperation,
  message: string,
  context?: {
    requestId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  logInfo(message, {
    ...context,
    component: LogCategory.API,
    operation,
  });
};

export const logPerformance = (
  operation: string,
  duration: number,
  context?: {
    requestId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  logInfo(`Performance: ${operation} completed in ${duration}ms`, {
    ...context,
    component: LogCategory.PERFORMANCE,
    operation,
    metadata: {
      ...context?.metadata,
      duration,
    },
  });
};

// Export the winston logger instance for direct use (backward compatibility)
export { winstonLogger as logger };
