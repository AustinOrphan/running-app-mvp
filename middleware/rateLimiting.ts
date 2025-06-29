import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logError, logInfo } from '../utils/secureLogger.js';

/**
 * Rate limiting middleware configurations
 * Implements different rate limits for various endpoint types
 */

// Custom error handler for rate limit violations
const rateLimitErrorHandler = (req: Request, res: Response) => {
  logInfo('Rate limit exceeded', req, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    endpoint: req.path,
    method: req.method,
  });

  res.status(429).json({
    message: 'Too many requests from this IP, please try again later',
    status: 429,
    retryAfter: res.get('Retry-After'),
  });
};

// Custom key generator that includes user ID for authenticated requests
const generateKey = (req: Request): string => {
  const baseKey = req.ip || 'unknown';
  const userId = (req as any).user?.id;
  
  // For authenticated requests, include user ID to prevent IP sharing issues
  if (userId) {
    return `${baseKey}:${userId}`;
  }
  
  return baseKey;
};

/**
 * Strict rate limiting for authentication endpoints
 * 5 requests per 15 minutes to prevent brute force attacks
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
    status: 429,
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: generateKey,
  handler: rateLimitErrorHandler,
  skip: (req: Request) => {
    // Skip rate limiting in test environment
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Standard rate limiting for general API endpoints
 * 100 requests per 15 minutes for normal operations
 */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    message: 'Too many requests from this IP, please try again later',
    status: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: rateLimitErrorHandler,
  skip: (req: Request) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Moderate rate limiting for data creation endpoints
 * 50 requests per 15 minutes for create operations
 */
export const createRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: {
    message: 'Too many creation requests from this IP, please try again later',
    status: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: rateLimitErrorHandler,
  skip: (req: Request) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Relaxed rate limiting for read-only endpoints
 * 200 requests per 15 minutes for data retrieval
 */
export const readRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: {
    message: 'Too many requests from this IP, please try again later',
    status: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: rateLimitErrorHandler,
  skip: (req: Request) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Strict rate limiting for password reset and sensitive operations
 * 3 requests per hour to prevent abuse
 */
export const sensitiveRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 requests per hour
  message: {
    message: 'Too many sensitive operation attempts from this IP, please try again after 1 hour',
    status: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: rateLimitErrorHandler,
  skip: (req: Request) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Global rate limiting for all endpoints
 * 1000 requests per hour as a safety net
 */
export const globalRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // limit each IP to 1000 requests per hour
  message: {
    message: 'Global rate limit exceeded, please try again later',
    status: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: rateLimitErrorHandler,
  skip: (req: Request) => {
    return process.env.NODE_ENV === 'test';
  },
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