// Enhanced error reporting and categorization system
import { clientLogger } from './clientLogger';

// Error categories for better organization
export enum ErrorCategory {
  API = 'API',
  UI = 'UI', 
  NETWORK = 'NETWORK',
  AUTH = 'AUTH',
  VALIDATION = 'VALIDATION',
  UNKNOWN = 'UNKNOWN',
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// Enhanced error context
export interface ErrorContext {
  category: ErrorCategory;
  severity: ErrorSeverity;
  page?: string;
  action?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  userAgent: string;
  url: string;
}

// Error aggregation to prevent spam
interface ErrorAggregation {
  key: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

class ErrorReporter {
  private errorAggregation = new Map<string, ErrorAggregation>();
  private aggregationWindow = 5 * 60 * 1000; // 5 minutes
  private maxAggregatedErrors = 10; // Max errors of same type in window

  constructor() {
    // Set up global error handlers
    this.setupGlobalHandlers();
    
    // Clean up old aggregations periodically
    setInterval(() => this.cleanupAggregations(), this.aggregationWindow);
  }

  private setupGlobalHandlers(): void {
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.reportError(
        new Error(`Unhandled Promise Rejection: ${event.reason}`),
        {
          category: ErrorCategory.UNKNOWN,
          severity: ErrorSeverity.HIGH,
          action: 'unhandledrejection',
        }
      );
    });

    // Handle global errors
    window.addEventListener('error', (event) => {
      this.reportError(
        event.error || new Error(event.message),
        {
          category: ErrorCategory.UI,
          severity: ErrorSeverity.HIGH,
          action: 'window.error',
          metadata: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        }
      );
    });
  }

  private categorizeError(error: Error, providedCategory?: ErrorCategory): ErrorCategory {
    if (providedCategory) return providedCategory;

    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('fetch')) {
      return ErrorCategory.NETWORK;
    } else if (message.includes('auth') || message.includes('token') || message.includes('401')) {
      return ErrorCategory.AUTH;
    } else if (message.includes('api') || message.includes('http')) {
      return ErrorCategory.API;
    } else if (message.includes('validation') || message.includes('invalid')) {
      return ErrorCategory.VALIDATION;
    } else if (message.includes('component') || message.includes('render')) {
      return ErrorCategory.UI;
    }
    
    return ErrorCategory.UNKNOWN;
  }

  private determineSeverity(error: Error, category: ErrorCategory): ErrorSeverity {
    // Auth errors are always high severity
    if (category === ErrorCategory.AUTH) {
      return ErrorSeverity.HIGH;
    }
    
    // Network errors during critical operations
    if (category === ErrorCategory.NETWORK && error.message.includes('save')) {
      return ErrorSeverity.HIGH;
    }
    
    // Validation errors are usually low severity
    if (category === ErrorCategory.VALIDATION) {
      return ErrorSeverity.LOW;
    }
    
    // Default to medium
    return ErrorSeverity.MEDIUM;
  }

  private generateErrorKey(error: Error, context: Partial<ErrorContext>): string {
    return `${context.category}-${error.message}-${context.page || 'unknown'}`;
  }

  private shouldAggregateError(key: string): boolean {
    const aggregation = this.errorAggregation.get(key);
    
    if (!aggregation) {
      return false;
    }
    
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.aggregationWindow);
    
    // Reset aggregation if outside window
    if (aggregation.firstSeen < windowStart) {
      this.errorAggregation.delete(key);
      return false;
    }
    
    // Check if we've hit the limit
    return aggregation.count >= this.maxAggregatedErrors;
  }

  private updateAggregation(key: string): void {
    const existing = this.errorAggregation.get(key);
    const now = new Date();
    
    if (existing) {
      existing.count++;
      existing.lastSeen = now;
    } else {
      this.errorAggregation.set(key, {
        key,
        count: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }

  private cleanupAggregations(): void {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.aggregationWindow);
    
    for (const [key, aggregation] of this.errorAggregation) {
      if (aggregation.lastSeen < windowStart) {
        this.errorAggregation.delete(key);
      }
    }
  }

  private getSessionId(): string {
    // Get or create session ID
    let sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
  }

  private getCurrentPage(): string {
    // Extract current page from URL or route
    const pathname = window.location.pathname;
    return pathname === '/' ? 'home' : pathname.replace(/^\//, '');
  }

  private getUserId(): string | undefined {
    // Try to get user ID from auth token
    const token = localStorage.getItem('authToken');
    if (token) {
      try {
        // Simple JWT decode (not verification)
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.id || payload.userId;
      } catch {
        // Invalid token format
      }
    }
    return undefined;
  }

  public reportError(
    error: Error,
    partialContext?: Partial<ErrorContext>
  ): void {
    const category = this.categorizeError(error, partialContext?.category);
    const severity = partialContext?.severity || this.determineSeverity(error, category);
    
    const context: ErrorContext = {
      category,
      severity,
      page: partialContext?.page || this.getCurrentPage(),
      action: partialContext?.action,
      userId: partialContext?.userId || this.getUserId(),
      sessionId: partialContext?.sessionId || this.getSessionId(),
      metadata: partialContext?.metadata,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    const errorKey = this.generateErrorKey(error, context);
    
    // Check if we should aggregate this error
    if (this.shouldAggregateError(errorKey)) {
      // Update aggregation but don't log
      this.updateAggregation(errorKey);
      return;
    }
    
    // Update aggregation
    this.updateAggregation(errorKey);
    
    // Log the error with context
    clientLogger.error(
      `[${category}] ${error.message}`,
      error,
      {
        ...context,
        errorKey,
        aggregation: this.errorAggregation.get(errorKey),
      }
    );
    
    // Provide recovery suggestions
    this.suggestRecovery(error, context);
  }

  private suggestRecovery(error: Error, context: ErrorContext): void {
    let suggestion = '';
    
    switch (context.category) {
      case ErrorCategory.AUTH:
        suggestion = 'Please log in again to continue.';
        break;
      case ErrorCategory.NETWORK:
        suggestion = 'Check your internet connection and try again.';
        break;
      case ErrorCategory.API:
        if (error.message.includes('500') || error.message.includes('server')) {
          suggestion = 'The server is experiencing issues. Please try again later.';
        } else {
          suggestion = 'Please refresh the page and try again.';
        }
        break;
      case ErrorCategory.VALIDATION:
        suggestion = 'Please check your input and try again.';
        break;
      case ErrorCategory.UI:
        suggestion = 'Try refreshing the page. If the problem persists, clear your browser cache.';
        break;
      default:
        suggestion = 'An unexpected error occurred. Please refresh and try again.';
    }
    
    // Log recovery suggestion separately for UI consumption
    if (suggestion) {
      clientLogger.info(`Recovery suggestion: ${suggestion}`, {
        errorKey: context.metadata?.errorKey,
        category: context.category,
      });
    }
  }

  // Public API for reporting specific error types
  public reportApiError(
    error: Error,
    endpoint: string,
    method: string,
    status?: number
  ): void {
    this.reportError(error, {
      category: ErrorCategory.API,
      action: `${method} ${endpoint}`,
      metadata: {
        endpoint,
        method,
        status,
      },
    });
  }

  public reportUIError(
    error: Error,
    componentName: string,
    action?: string
  ): void {
    this.reportError(error, {
      category: ErrorCategory.UI,
      action: action || 'component-error',
      metadata: {
        componentName,
      },
    });
  }

  public reportNetworkError(
    error: Error,
    url: string,
    retryCount?: number
  ): void {
    this.reportError(error, {
      category: ErrorCategory.NETWORK,
      severity: retryCount && retryCount > 2 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
      metadata: {
        url,
        retryCount,
      },
    });
  }

  public reportAuthError(
    error: Error,
    action: string
  ): void {
    this.reportError(error, {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.HIGH,
      action,
    });
  }

  public reportValidationError(
    error: Error,
    field: string,
    value?: unknown
  ): void {
    this.reportError(error, {
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.LOW,
      metadata: {
        field,
        // Don't log actual values for security
        valueType: typeof value,
      },
    });
  }
}

// Export singleton instance
export const errorReporter = new ErrorReporter();

// Export convenience functions
export const reportError = errorReporter.reportError.bind(errorReporter);
export const reportApiError = errorReporter.reportApiError.bind(errorReporter);
export const reportUIError = errorReporter.reportUIError.bind(errorReporter);
export const reportNetworkError = errorReporter.reportNetworkError.bind(errorReporter);
export const reportAuthError = errorReporter.reportAuthError.bind(errorReporter);
export const reportValidationError = errorReporter.reportValidationError.bind(errorReporter);