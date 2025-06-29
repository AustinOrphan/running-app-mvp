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
  DEBUG = 'DEBUG'
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
  metadata?: Record<string, any>;
  stack?: string;
}

/**
 * Data redaction configuration for sensitive information
 */
const SENSITIVE_FIELDS = [
  'password', 'email', 'token', 'secret', 'key', 'authorization',
  'ssn', 'creditcard', 'phone', 'address', 'name'
];

const PII_PATTERNS = [
  // Email patterns
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Credit card patterns
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  // Phone number patterns
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  // Social security patterns
  /\b\d{3}-\d{2}-\d{4}\b/g
];

class SecureLogger {
  private isDevelopment: boolean;
  private isProduction: boolean;
  
  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  /**
   * Redacts sensitive data from any object or string
   */
  private redactSensitiveData(data: any): any {
    if (typeof data === 'string') {
      return this.redactString(data);
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.redactSensitiveData(item));
    }
    
    if (data && typeof data === 'object') {
      const redacted: any = {};
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
    return SENSITIVE_FIELDS.some(sensitive => 
      lowerField.includes(sensitive)
    );
  }

  /**
   * Masks sensitive values while preserving type information
   */
  private maskValue(value: any): string {
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
    if (req && (req as any).correlationId) {
      return (req as any).correlationId;
    }
    
    const correlationId = uuidv4();
    if (req) {
      (req as any).correlationId = correlationId;
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
        environment: process.env.NODE_ENV || 'unknown'
      };
    }

    const context: LogContext = {
      correlationId: this.getCorrelationId(req),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      method: req.method,
      url: this.redactSensitiveUrlParams(req.url),
      userAgent: req.get('User-Agent'),
      ip: this.isProduction ? this.maskIpAddress(req.ip) : req.ip
    };

    // Only include user context in development or with explicit consent
    if ((req as any).user?.id) {
      if (this.isDevelopment) {
        context.userId = (req as any).user.id;
      } else {
        // In production, use a hash of the user ID for correlation without exposure
        context.userId = this.hashUserId((req as any).user.id);
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
   * Masks IP address for privacy compliance
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
    const salt = process.env.LOG_SALT || 'default-salt-for-dev-only';
    const hash = crypto.createHash('sha256').update(userId + salt).digest('hex');
    return `user_${hash.substring(0, 16)}`;
  }

  /**
   * Main logging method with secure defaults
   */
  private log(level: LogLevel, message: string, req?: Request, metadata?: Record<string, any>, error?: Error): void {
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
      ...(error && this.isDevelopment && { stack: error.stack })
    };

    // Use appropriate console method based on level
    switch (level) {
      case LogLevel.ERROR:
        console.error('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.WARN:
        console.warn('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.INFO:
        console.info('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.DEBUG:
        console.debug('SecureLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
    }
  }

  /**
   * Log error with secure context
   */
  error(message: string, req?: Request, error?: Error, metadata?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, req, metadata, error);
  }

  /**
   * Log warning with secure context
   */
  warn(message: string, req?: Request, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, req, metadata);
  }

  /**
   * Log info with secure context
   */
  info(message: string, req?: Request, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, req, metadata);
  }

  /**
   * Log debug (development only) with secure context
   */
  debug(message: string, req?: Request, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, req, metadata);
  }

  /**
   * Log user action with privacy-compliant tracking
   */
  userAction(action: string, req?: Request, metadata?: Record<string, any>): void {
    if (this.isDevelopment) {
      this.info(`User action: ${action}`, req, metadata);
    } else {
      // In production, log actions without sensitive context
      this.info(`Action: ${action}`, req, { 
        ...metadata, 
        timestamp: new Date().toISOString(),
        environment: 'production'
      });
    }
  }

  /**
   * Create correlation middleware for request tracking
   */
  correlationMiddleware() {
    return (req: Request, res: any, next: any) => {
      this.getCorrelationId(req);
      next();
    };
  }
}

// Export singleton instance
export const secureLogger = new SecureLogger();

// Export convenience methods for common patterns
export const logUserAction = (action: string, req?: Request, metadata?: Record<string, any>) =>
  secureLogger.userAction(action, req, metadata);

export const logError = (message: string, req?: Request, error?: Error, metadata?: Record<string, any>) =>
  secureLogger.error(message, req, error, metadata);

export const logInfo = (message: string, req?: Request, metadata?: Record<string, any>) =>
  secureLogger.info(message, req, metadata);

export const logDebug = (message: string, req?: Request, metadata?: Record<string, any>) =>
  secureLogger.debug(message, req, metadata);

export const correlationMiddleware = () => secureLogger.correlationMiddleware();