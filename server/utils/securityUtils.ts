import { Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/errorHandler.js';
import { logInfo } from './logger.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

/**
 * Comprehensive security utilities for input validation and sanitization
 */

/**
 * Password hashing and comparison utilities
 */
const SALT_ROUNDS = 12;

export const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

/**
 * Generate cryptographically secure random token
 */
export const generateSecureToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Email validation
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Password strength validation
 */
export const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get password strength score
 */
export const getPasswordStrength = (password: string): { score: number; feedback: string } => {
  let score = 0;
  const feedback: string[] = [];
  
  if (password.length >= 8) score += 1;
  else feedback.push('Use at least 8 characters');
  
  if (password.length >= 12) score += 1;
  else feedback.push('Consider using 12+ characters');
  
  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push('Add uppercase letters');
  
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push('Add lowercase letters');
  
  if (/\d/.test(password)) score += 1;
  else feedback.push('Add numbers');
  
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
  else feedback.push('Add special characters');
  
  const strengthLevels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  return {
    score,
    feedback: `${strengthLevels[score] || 'Very Weak'}${feedback.length ? ': ' + feedback.join(', ') : ''}`
  };
};

/**
 * Input sanitization
 */
export const sanitizeInput = (input: string): string => {
  return sanitizeString(input);
};

/**
 * CSRF token generation and validation
 */
export const generateCSRFToken = (): string => {
  return generateSecureToken(32);
};

export const validateCSRFToken = (token: string, sessionToken: string): boolean => {
  return token === sessionToken && token.length === 64; // 32 bytes = 64 hex chars
};

/**
 * Rate limiting utilities
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export const rateLimitKey = (ip: string, endpoint?: string): string => {
  return endpoint ? `${ip}:${endpoint}` : ip;
};

export const isRateLimited = (key: string, limit: number = 100, windowMs: number = 15 * 60 * 1000): boolean => {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  
  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return false;
  }
  
  if (record.count >= limit) {
    return true;
  }
  
  record.count++;
  return false;
};

export const resetRateLimit = (key: string): void => {
  rateLimitStore.delete(key);
};

/**
 * Data encryption for sensitive information
 */
const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);

export const encryptSensitiveData = (text: string): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
};

export const decryptSensitiveData = (encryptedText: string): string => {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

/**
 * PII masking utility
 */
export const maskPII = (data: string, type: 'email' | 'phone' | 'ssn' | 'creditcard' = 'email'): string => {
  switch (type) {
    case 'email':
      return data.replace(/(.{1,3}).*@(.*)/, '$1***@$2');
    case 'phone':
      return data.replace(/(\d{3})\d{3}(\d{4})/, '$1-***-$2');
    case 'ssn':
      return data.replace(/(\d{3})\d{2}(\d{4})/, '$1-**-$2');
    case 'creditcard':
      return data.replace(/(\d{4})\d{8}(\d{4})/, '$1-****-****-$2');
    default:
      return data.replace(/.(?=.{4})/g, '*');
  }
};

/**
 * URL validation
 */
export const validateURL = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * OTP generation and validation
 */
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

export const generateOTP = (length: number = 6): string => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

export const validateOTP = (identifier: string, providedOTP: string): boolean => {
  const record = otpStore.get(identifier);
  
  if (!record || Date.now() > record.expiresAt) {
    otpStore.delete(identifier);
    return false;
  }
  
  const isValid = record.otp === providedOTP;
  if (isValid) {
    otpStore.delete(identifier);
  }
  
  return isValid;
};

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
