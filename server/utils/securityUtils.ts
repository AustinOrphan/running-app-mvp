import { Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/errorHandler.js';
import { logInfo } from './logger.js';

/**
 * Comprehensive security utilities for input validation and sanitization
 */

/**
 * SQL injection patterns to detect and block
 */
const SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi,
  /(--|\/\*|\*\/|;|\b(or|and)\b\s*\d+\s*=\s*\d+)/gi,
  /('|(\\')|(;)|(\bor\b)|(\band\b)|(\bxor\b))/gi,
  /(\b(char|nchar|varchar|nvarchar|ascii|substring|len|count|sum)\s*\()/gi,
];

/**
 * XSS patterns to detect and block
 */
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
  /<form/gi,
  /expression\s*\(/gi,
  /vbscript:/gi,
  /data:text\/html/gi,
];

/**
 * Path traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.\\/g,
  /%2e%2e%2f/gi,
  /%2e%2e%5c/gi,
  /\.\.%2f/gi,
  /\.\.%5c/gi,
];

/**
 * Command injection patterns
 */
const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$(){}[\]]/,
  /\b(cat|ls|pwd|whoami|id|uname|ps|netstat|ifconfig|ping|wget|curl|nc|telnet|ssh|rm|mv|cp|chmod|chown)\b/gi,
];

/**
 * Check if input contains SQL injection patterns
 */
export const containsSQLInjection = (input: string): boolean => {
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * Check if input contains XSS patterns
 */
export const containsXSS = (input: string): boolean => {
  return XSS_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * Check if input contains path traversal patterns
 */
export const containsPathTraversal = (input: string): boolean => {
  return PATH_TRAVERSAL_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * Check if input contains command injection patterns
 */
export const containsCommandInjection = (input: string): boolean => {
  return COMMAND_INJECTION_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * Comprehensive security validation for string inputs
 */
export const validateSecureInput = (input: string, fieldName: string = 'input'): void => {
  if (containsSQLInjection(input)) {
    throw createError(`Potential SQL injection detected in ${fieldName}`, 400);
  }

  if (containsXSS(input)) {
    throw createError(`Potential XSS attack detected in ${fieldName}`, 400);
  }

  if (containsPathTraversal(input)) {
    throw createError(`Path traversal attempt detected in ${fieldName}`, 400);
  }

  if (containsCommandInjection(input)) {
    throw createError(`Command injection attempt detected in ${fieldName}`, 400);
  }
};

/**
 * Sanitize string input by removing dangerous characters
 */
export const sanitizeString = (input: string): string => {
  if (typeof input !== 'string') return input;

  return (
    input
      .trim()
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove control characters except tabs, newlines, and carriage returns
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize unicode
      .normalize('NFKC')
      // Remove potentially dangerous HTML entities
      .replace(/&[#\w]+;/g, '')
      // Remove script tags and event handlers
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=/gi, '')
      // Remove javascript: and data: protocols
      .replace(/javascript:/gi, '')
      .replace(/data:(?!image\/)/gi, '')
  );
};

/**
 * Deep sanitization of objects
 */
export const sanitizeObject = (obj: unknown): unknown => {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Sanitize both key and value
      const cleanKey = sanitizeString(key);
      sanitized[cleanKey] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Validate and sanitize request data
 */
export const securityValidationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Validate and sanitize body
    if (req.body && typeof req.body === 'object') {
      const sanitizedBody = sanitizeObject(req.body);

      // Perform security validation on string fields
      const validateStringFields = (obj: unknown, path: string = ''): void => {
        if (typeof obj === 'string') {
          validateSecureInput(obj, path || 'body field');
        } else if (Array.isArray(obj)) {
          obj.forEach((item, index) => {
            validateStringFields(item, `${path}[${index}]`);
          });
        } else if (obj && typeof obj === 'object') {
          Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => {
            const fieldPath = path ? `${path}.${key}` : key;
            validateStringFields(value, fieldPath);
          });
        }
      };

      validateStringFields(sanitizedBody);
      req.body = sanitizedBody;
    }

    // Validate query parameters
    if (req.query && typeof req.query === 'object') {
      Object.entries(req.query).forEach(([key, value]) => {
        if (typeof value === 'string') {
          validateSecureInput(value, `query.${key}`);
        }
      });
    }

    // Validate URL parameters
    if (req.params && typeof req.params === 'object') {
      Object.entries(req.params).forEach(([key, value]) => {
        if (typeof value === 'string') {
          validateSecureInput(value, `params.${key}`);
        }
      });
    }

    next();
  } catch (error) {
    logInfo('security', 'validation', 'Security validation failed', req, {
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.path,
      method: req.method,
    });
    next(error);
  }
};

/**
 * Enhanced CSRF protection middleware
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  // Skip CSRF for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for API endpoints with proper authorization
  if (req.headers.authorization && req.path.startsWith('/api/')) {
    return next();
  }

  // For non-API requests, require CSRF token
  const csrfToken = req.headers['x-csrf-token'] as string;
  const sessionToken = (req as Request & { session?: { csrfToken?: string } }).session?.csrfToken;

  if (!csrfToken || csrfToken !== sessionToken) {
    throw createError('Invalid or missing CSRF token', 403);
  }

  next();
};

/**
 * Request size validation middleware
 */
export const requestSizeValidation = (maxSize: number = 1024 * 1024) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxSize) {
      throw createError(
        `Request size ${contentLength} exceeds maximum allowed size ${maxSize}`,
        413
      );
    }

    next();
  };
};

/**
 * IP allowlist/blocklist middleware
 */
export const ipFilterMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

  // Check blocklist
  const blockedIPs = (process.env.BLOCKED_IPS || '').split(',').filter(Boolean);
  if (blockedIPs.includes(clientIP)) {
    logInfo('security', 'ip-filter', 'Blocked IP attempt', req, { blockedIP: clientIP });
    throw createError('Access denied', 403);
  }

  // Check allowlist (if configured)
  const allowedIPs = (process.env.ALLOWED_IPS || '').split(',').filter(Boolean);
  if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
    logInfo('security', 'ip-filter', 'Non-allowlisted IP attempt', req, { rejectedIP: clientIP });
    throw createError('Access denied', 403);
  }

  next();
};

/**
 * Headers security validation
 */
export const validateSecurityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Validate User-Agent to block suspicious requests
  const userAgent = req.get('User-Agent') || '';
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scanner/i,
    /sqlmap/i,
    /nikto/i,
    /nmap/i,
    /curl/i,
    /wget/i,
  ];

  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));

  if (isSuspicious && process.env.BLOCK_SUSPICIOUS_USER_AGENTS === 'true') {
    logInfo('security', 'user-agent', 'Suspicious User-Agent blocked', req, { userAgent });
    throw createError('Access denied', 403);
  }

  // Validate referrer for sensitive operations
  const referer = req.get('Referer') || '';
  const allowedDomains = (process.env.ALLOWED_REFERER_DOMAINS || '').split(',').filter(Boolean);

  if (
    allowedDomains.length > 0 &&
    referer &&
    !allowedDomains.some(domain => referer.includes(domain))
  ) {
    logInfo('security', 'referer', 'Invalid referer detected', req, { referer });
    throw createError('Invalid request source', 403);
  }

  next();
};

/**
 * Export all security middleware as a single middleware stack
 */
export const comprehensiveSecurityMiddleware = [
  ipFilterMiddleware,
  validateSecurityHeaders,
  requestSizeValidation(),
  securityValidationMiddleware,
];
