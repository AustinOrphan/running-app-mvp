/**
 * Winston-based Structured Logger Implementation - Issue #178
 *
 * Implements comprehensive structured logging using Winston as specified in Issue #178.
 * This complements the existing secureLogger while providing Winston-specific features.
 */

import winston from 'winston';

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

// Environment-specific configuration
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

// Create Winston logger instance
export const winstonLogger = winston.createLogger({
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

// Logging helper functions as specified in Issue #178
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
  winstonLogger.error(message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
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
  winstonLogger.info(message, context);
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
  winstonLogger.warn(message, context);
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
  winstonLogger.debug(message, context);
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

// Export the winston logger instance for direct use
export { winstonLogger as logger };
