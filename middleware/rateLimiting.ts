import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logInfo } from '../utils/secureLogger.js';

/**
 * Rate limiting middleware configurations
 * Implements different rate limits for various endpoint types
 */

// Custom error handler for rate limit violations
const rateLimitErrorHandler = (
  req: Request,
  res: Response,
  _next: NextFunction,
  options: { statusCode?: number; message?: string | { message: string } }
) => {
  logInfo('Rate limit exceeded', req, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    endpoint: req.path,
    method: req.method,
  });

  const statusCode = options.statusCode || 429;
  const message = options.message || 'Too many requests from this IP, please try again later';

  res.status(statusCode).json({
    message: typeof message === 'string' ? message : message.message,
    status: statusCode,
    retryAfter: res.get('Retry-After'),
  });
};

// Custom key generator that includes user ID for authenticated requests
const generateKey = (req: Request): string => {
  const baseKey = req.ip || 'unknown';
  const userId = (req as Request & { user?: { id: string } }).user?.id;

  // For authenticated requests, include user ID to prevent IP sharing issues
  if (userId) {
    return `${baseKey}:${userId}`;
  }

  return baseKey;
};

/**
 * Factory function to create rate limit configurations with common options
 */
function createRateLimitConfig(options: { windowMs: number; max: number; message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      message: options.message,
      status: 429,
    },
    statusCode: 429,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: generateKey,
    handler: rateLimitErrorHandler,
    skip: (_req: Request) => {
      const isTestEnvironment = process.env.NODE_ENV === 'test';
      const rateLimitingEnabled = process.env.RATE_LIMITING_ENABLED;

      if (isTestEnvironment) {
        // In test environment: disabled by default, explicitly enable with 'true'
        return rateLimitingEnabled !== 'true';
      } else {
        // In non-test environments: enabled by default, explicitly disable with 'false'
        return rateLimitingEnabled === 'false';
      }
    },
  });
}

/**
 * Strict rate limiting for authentication endpoints
 * 5 requests per 15 minutes to prevent brute force attacks
 */
export const authRateLimit = createRateLimitConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
});

/**
 * Standard rate limiting for general API endpoints
 * 100 requests per 15 minutes for normal operations
 */
export const apiRateLimit = createRateLimitConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later',
});

/**
 * Moderate rate limiting for data creation endpoints
 * 50 requests per 15 minutes for create operations
 */
export const createRateLimit = createRateLimitConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: 'Too many creation requests from this IP, please try again later',
});

/**
 * Relaxed rate limiting for read-only endpoints
 * 200 requests per 15 minutes for data retrieval
 */
export const readRateLimit = createRateLimitConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: 'Too many requests from this IP, please try again later',
});

/**
 * Strict rate limiting for password reset and sensitive operations
 * 3 requests per hour to prevent abuse
 */
export const sensitiveRateLimit = createRateLimitConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many sensitive operation attempts from this IP, please try again after 1 hour',
});

/**
 * Global rate limiting for all endpoints
 * 1000 requests per hour as a safety net
 */
export const globalRateLimit = createRateLimitConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000,
  message: 'Global rate limit exceeded, please try again later',
});

/**
 * Rate limiting configuration for different endpoint patterns
 */
export const rateLimitConfig = {
  // Authentication endpoints
  auth: authRateLimit,

  // Data creation endpoints (POST)
  create: createRateLimit,

  // Data read endpoints (GET)
  read: readRateLimit,

  // General API endpoints
  api: apiRateLimit,

  // Sensitive operations
  sensitive: sensitiveRateLimit,

  // Global rate limit
  global: globalRateLimit,
};

/**
 * Helper function to apply appropriate rate limiting based on endpoint type
 */
export const getRateLimitMiddleware = (type: keyof typeof rateLimitConfig) => {
  return rateLimitConfig[type];
};
