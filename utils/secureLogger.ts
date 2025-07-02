import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

/**
 * Secure Logging Utility for Production Compliance
 *
 * Implements secure logging patterns that comply with:
 * - GDPR Article 25 (Data Protection by Design)
 * - CCPA privacy requirements
 * - SOC 2 security controls
 * - Principle of least information disclosure
 */

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

export interface LogContext {
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  ip?: string;
  method?: string;
  url?: string;
  timestamp?: string;
  environment?: string;
}

export interface SecureLogEntry {
  level: LogLevel;
  message: string;
  context: LogContext;
  metadata?: Record<string, unknown>;
  stack?: string;
}

/**
 * Data redaction configuration for sensitive information
 */
const SENSITIVE_FIELDS = [
  'password',
  'email',
  'token',
  'secret',
  'key',
  'authorization',
  'ssn',
  'creditcard',
  'phone',
  'address',
  'name',
];

const PII_PATTERNS = [
  // Email patterns
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Credit card patterns
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  // Phone number patterns
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  // Social security patterns
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

class SecureLogger {
  constructor() {
    // Environment checks are now done dynamically via getters
  }

  private get isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Redacts sensitive data from any object or string
   */
  private redactSensitiveData(data: unknown): unknown {
    if (typeof data === 'string') {
      return this.redactString(data);
    }

    if (Array.isArray(data)) {
      return data.map(item => this.redactSensitiveData(item));
    }

    if (data && typeof data === 'object') {
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (this.isSensitiveField(key)) {
          redacted[key] = this.maskValue(value);
        } else {
          redacted[key] = this.redactSensitiveData(value);
        }
      }
      return redacted;
    }

    return data;
  }

  /**
   * Redacts PII patterns from strings
   */
  private redactString(str: string): string {
    let redacted = str;
    for (const pattern of PII_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }

  /**
   * Checks if a field name indicates sensitive data
   */
  private isSensitiveField(fieldName: string): boolean {
    const lowerField = fieldName.toLowerCase();
    return SENSITIVE_FIELDS.some(sensitive => lowerField.includes(sensitive));
  }

  /**
   * Masks sensitive values while preserving type information
   */
  private maskValue(value: unknown): string {
    if (value === null || value === undefined) {
      return String(value);
    }

    const str = String(value);
    if (str.length <= 4) {
      return '[REDACTED]';
    }

    // Show first 2 and last 2 characters for debugging context
    return `${str.substring(0, 2)}***${str.substring(str.length - 2)}`;
  }

  /**
   * Generates or retrieves correlation ID for request tracking
   */
  private getCorrelationId(req?: Request): string {
    if (req && req.correlationId) {
      return req.correlationId;
    }

    const correlationId = uuidv4();
    if (req) {
      req.correlationId = correlationId;
    }

    return correlationId;
  }

  /**
   * Extracts safe request context without exposing sensitive data
   */
  private extractRequestContext(req?: Request): LogContext {
    if (!req) {
      return {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown',
      };
    }

    const context: LogContext = {
      correlationId: this.getCorrelationId(req),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      method: req.method,
      url: this.redactSensitiveUrlParams(req.url),
      userAgent: req.get('User-Agent'),
      ip: this.isProduction
        ? this.hashIpAddress(req.ip || req.socket?.remoteAddress)
        : req.ip || req.socket?.remoteAddress,
    };

    // Only include user context in development or with explicit consent
    if (req.user?.id) {
      if (this.isDevelopment) {
        context.userId = req.user.id;
      } else {
        // In production, use a hash of the user ID for correlation without exposure
        context.userId = this.hashUserId(req.user.id);
      }
    }

    return context;
  }

  /**
   * Redacts sensitive parameters from URLs
   */
  private redactSensitiveUrlParams(url: string): string {
    // Redact common sensitive query parameters
    return url.replace(/([?&])(token|key|password|secret|email)=[^&]*/gi, '$1$2=[REDACTED]');
  }

  /**
   * Hashes IP address for enhanced privacy compliance (Issue #38)
   * Uses SHA-256 hashing to completely anonymize IPs while maintaining correlation
   *
   * @param ip - IP address to hash (IPv4 or IPv6)
   * @returns SHA-256 hash (truncated to 16 chars) or '[UNKNOWN]' if no IP provided
   *
   * Environment Variables:
   * - IP_SALT: Salt for IP hashing (required in production for security)
   */
  private hashIpAddress(ip?: string): string {
    if (!ip) return '[UNKNOWN]';

    const salt = process.env.IP_SALT || 'default-ip-salt-dev-only';

    if (this.isProduction && !process.env.IP_SALT) {
      // eslint-disable-next-line no-console
      console.warn('WARNING: IP_SALT not set in production. Using default salt.');
    }

    const hash = crypto
      .createHash('sha256')
      .update(ip + salt)
      .digest('hex');

    // Truncate for storage efficiency while maintaining uniqueness
    // 16 characters provides 2^64 possible values, sufficient for correlation
    return `ip_${hash.substring(0, 16)}`;
  }

  /**
   * Legacy method - masks IP address for privacy compliance
   * @deprecated Use hashIpAddress() for enhanced privacy compliance
   */
  private maskIpAddress(ip?: string): string {
    if (!ip) return '[UNKNOWN]';

    // For IPv4, mask last octet
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
      }
    }

    // For IPv6 or other formats, show only prefix
    return `${ip.substring(0, Math.min(ip.length, 8))}...`;
  }

  /**
   * Creates a non-reversible hash of user ID for production correlation
   */
  private hashUserId(userId: string): string {
    const salt = process.env.LOG_SALT;
    if (!salt && process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: LOG_SALT environment variable must be set in production.');
    }
    const finalSalt = salt || 'default-salt-for-dev-only';
    const hash = crypto
      .createHash('sha256')
      .update(userId + finalSalt)
      .digest('hex');
    return `user_${hash.substring(0, 16)}`;
  }

  /**
   * Main logging method with secure defaults
   */
  private log(
    level: LogLevel,
    message: string,
    req?: Request,
    metadata?: Record<string, unknown>,
    error?: Error
  ): void {
    // Skip debug logs in production
    if (this.isProduction && level === LogLevel.DEBUG) {
      return;
    }

    const context = this.extractRequestContext(req);
    const redactedMetadata = metadata ? this.redactSensitiveData(metadata) : undefined;

    const logEntry: SecureLogEntry = {
      level,
      message,
      context,
      metadata: redactedMetadata,
      ...(error && this.isDevelopment && { stack: error.stack }),
    };

    // Use appropriate console method based on level
    switch (level) {
      case LogLevel.ERROR:
        // eslint-disable-next-line no-console
        console.error('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.WARN:
        // eslint-disable-next-line no-console
        console.warn('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.INFO:
        // eslint-disable-next-line no-console
        console.info('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.DEBUG:
        // eslint-disable-next-line no-console
        console.debug('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
    }
  }

  /**
   * Log error with secure context
   */
  error(message: string, req?: Request, error?: Error, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, req, metadata, error);
  }

  /**
   * Log warning with secure context
   */
  warn(message: string, req?: Request, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, req, metadata);
  }

  /**
   * Log info with secure context
   */
  info(message: string, req?: Request, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, req, metadata);
  }

  /**
   * Log debug (development only) with secure context
   */
  debug(message: string, req?: Request, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, req, metadata);
  }

  /**
   * Log user action with privacy-compliant tracking
   */
  userAction(action: string, req?: Request, metadata?: Record<string, unknown>): void {
    if (this.isDevelopment) {
      this.info(`User action: ${action}`, req, metadata);
    } else {
      // In production, log actions without sensitive context
      this.info(`Action: ${action}`, req, {
        ...metadata,
        timestamp: new Date().toISOString(),
        environment: 'production',
      });
    }
  }

  /**
   * Create correlation middleware for request tracking
   */
  correlationMiddleware() {
    return (req: Request, res: unknown, next: unknown) => {
      this.getCorrelationId(req);
      next();
    };
  }
}

// Export singleton instance
export const secureLogger = new SecureLogger();

// Export convenience methods for common patterns
export const logUserAction = (action: string, req?: Request, metadata?: Record<string, unknown>) =>
  secureLogger.userAction(action, req, metadata);

export const logError = (
  message: string,
  req?: Request,
  error?: Error,
  metadata?: Record<string, unknown>
) => secureLogger.error(message, req, error, metadata);

export const logInfo = (message: string, req?: Request, metadata?: Record<string, unknown>) =>
  secureLogger.info(message, req, metadata);

export const logDebug = (message: string, req?: Request, metadata?: Record<string, unknown>) =>
  secureLogger.debug(message, req, metadata);

export const correlationMiddleware = () => secureLogger.correlationMiddleware();
