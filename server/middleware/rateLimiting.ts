import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logInfo } from '../utils/secureLogger.js';
import { createError } from './errorHandler.js';

/**
 * Rate limiting middleware configurations
 * Implements different rate limits for various endpoint types
 */

// Custom error handler for rate limit violations
const rateLimitErrorHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
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
  const errorMessage = typeof message === 'string' ? message : message.message;

  // Use standardized error handler instead of manual JSON response
  const error = createError(errorMessage, statusCode);
  next(error);
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
      const rateLimitingEnabled = process.env.RATE_LIMITING_ENABLED?.toLowerCase();

      // In the test environment, rate limiting is opt-in (disabled by default).
      if (isTestEnvironment) {
        return rateLimitingEnabled !== 'true';
      }

      // In other environments, rate limiting is opt-out (enabled by default).
      return rateLimitingEnabled === 'false';
    },
  });
}

/**
 * Strict rate limiting for authentication endpoints
 * Configurable via environment variables with secure defaults
 */
export const authRateLimit = createRateLimitConfig({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
  message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
});

/**
 * Standard rate limiting for general API endpoints
 * Configurable via environment variables with secure defaults
 */
export const apiRateLimit = createRateLimitConfig({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10),
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
