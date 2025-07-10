/**
 * Client-side Logger for Browser Environments
 *
 * Provides secure, production-ready logging for client-side React applications.
 * Implements privacy-conscious logging patterns and development/production modes.
 */

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  stack?: string;
  userAgent?: string;
  url?: string;
}

/**
 * Data redaction for sensitive information
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
  /[\w%+.-]+@[\d.A-Za-z-]+\.[A-Za-z]{2,}/g,
  // Credit card patterns
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
  // Phone number patterns
  /\b(?:\d{3}[.-]?){2}\d{4}\b/g,
  // Social security patterns
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

class ClientLogger {
  private get isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Redacts sensitive data from any object or string
   */
  private redactSensitiveData(data: unknown, visited: WeakSet<object> = new WeakSet()): unknown {
    if (typeof data === 'string') {
      return this.redactString(data);
    }

    if (Array.isArray(data)) {
      if (visited.has(data)) {
        return '[Circular Reference]';
      }
      visited.add(data);
      const result = data.map(item => this.redactSensitiveData(item, visited));
      visited.delete(data);
      return result;
    }

    if (data && typeof data === 'object') {
      if (visited.has(data)) {
        return '[Circular Reference]';
      }
      visited.add(data);
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        redacted[key] = this.isSensitiveField(key)
          ? this.maskValue(value)
          : this.redactSensitiveData(value, visited);
      }
      visited.delete(data);
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
      return '[REDACTED]';
    }

    const str = String(value);
    if (str.length <= 4) {
      return '[REDACTED]';
    }

    // Show first 2 and last 2 characters for debugging context
    return `${str.substring(0, 2)}***${str.substring(str.length - 2)}`;
  }

  /**
   * Main logging method with secure defaults
   */
  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): void {
    // Skip debug logs in production
    if (this.isProduction && level === LogLevel.DEBUG) {
      return;
    }

    const redactedMetadata = metadata
      ? (this.redactSensitiveData(metadata) as Record<string, unknown>)
      : undefined;

    const logEntry: LogEntry = {
      level,
      message: this.redactString(message),
      timestamp: new Date().toISOString(),
      metadata: redactedMetadata,
      userAgent: this.isProduction ? undefined : navigator.userAgent,
      url: this.isProduction ? undefined : window.location.href,
      ...(error && this.isDevelopment && { stack: error.stack }),
    };

    // Use appropriate console method based on level
    switch (level) {
      case LogLevel.ERROR:
        // eslint-disable-next-line no-console -- Required for logger output
        console.error('ClientLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.WARN:
        // eslint-disable-next-line no-console -- Required for logger output
        console.warn('ClientLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.INFO:
        // eslint-disable-next-line no-console -- Required for logger output
        console.info('ClientLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
      case LogLevel.DEBUG:
        // eslint-disable-next-line no-console -- Required for logger output
        console.debug('ClientLog:', JSON.stringify(logEntry, null, this.isDevelopment ? 2 : 0));
        break;
    }

    // In production, you might want to send logs to a logging service
    if (this.isProduction && level === LogLevel.ERROR) {
      this.sendToLoggingService(logEntry);
    }
  }

  /**
   * Send logs to external logging service in production
   */
  private async sendToLoggingService(_logEntry: LogEntry): Promise<void> {
    // Implementation would depend on your logging service
    // Examples: Sentry, LogRocket, Datadog, etc.
    try {
      // Example: await fetch('/api/logs', { method: 'POST', body: JSON.stringify(logEntry) });
    } catch {
      // Fail silently to avoid recursive logging issues
    }
  }

  /**
   * Log error with secure context
   */
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, metadata, error);
  }

  /**
   * Log warning with secure context
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log info with secure context
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log debug (development only) with secure context
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }
}

// Export singleton instance
export const clientLogger = new ClientLogger();

// Export convenience methods for common patterns
export const logError = (message: string, error?: Error, metadata?: Record<string, unknown>) =>
  clientLogger.error(message, error, metadata);

export const logWarn = (message: string, metadata?: Record<string, unknown>) =>
  clientLogger.warn(message, metadata);

export const logInfo = (message: string, metadata?: Record<string, unknown>) =>
  clientLogger.info(message, metadata);

export const logDebug = (message: string, metadata?: Record<string, unknown>) =>
  clientLogger.debug(message, metadata);
