import { Request, Response, NextFunction } from 'express';
import { logInfo, logError } from './logger.js';

/**
 * Security event logging utilities for monitoring and auditing
 */

interface SecurityEvent {
  type:
    | 'authentication'
    | 'authorization'
    | 'input_validation'
    | 'rate_limit'
    | 'suspicious_activity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  event: string;
  details?: Record<string, unknown>;
  userId?: string;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Log security events with structured format
 */
export const logSecurityEvent = (
  type: SecurityEvent['type'],
  severity: SecurityEvent['severity'],
  event: string,
  req?: Request,
  details?: Record<string, unknown>
): void => {
  const securityEvent: SecurityEvent = {
    type,
    severity,
    event,
    timestamp: new Date().toISOString(),
    ip: req?.ip,
    userAgent: req?.get('User-Agent'),
    endpoint: req ? `${req.method} ${req.path}` : undefined,
    userId: (req as Request & { user?: { id: string } })?.user?.id,
    details: details || {},
  };

  const logMessage = `SECURITY ${severity.toUpperCase()}: ${event}`;

  if (severity === 'critical' || severity === 'high') {
    logError('security', type, new Error(logMessage), req, securityEvent);
  } else {
    logInfo('security', type, logMessage, req, securityEvent);
  }

  // In production, you might want to send critical security events to external monitoring
  if (severity === 'critical' && process.env.NODE_ENV === 'production') {
    // TODO: Integrate with external security monitoring service
    // await sendToSecurityMonitoring(securityEvent);
  }
};

/**
 * Log authentication events
 */
export const logAuthEvent = (
  event:
    | 'login_success'
    | 'login_failure'
    | 'logout'
    | 'token_refresh'
    | 'registration'
    | 'password_reset',
  req: Request,
  details?: Record<string, unknown>
): void => {
  const severity: SecurityEvent['severity'] = event === 'login_failure' ? 'medium' : 'low';
  logSecurityEvent('authentication', severity, event, req, details);
};

/**
 * Log authorization events
 */
export const logAuthzEvent = (
  event: 'access_granted' | 'access_denied' | 'privilege_escalation_attempt',
  req: Request,
  details?: Record<string, unknown>
): void => {
  const severity: SecurityEvent['severity'] =
    event === 'privilege_escalation_attempt'
      ? 'high'
      : event === 'access_denied'
        ? 'medium'
        : 'low';

  logSecurityEvent('authorization', severity, event, req, details);
};

/**
 * Log input validation events
 */
export const logValidationEvent = (
  event:
    | 'sql_injection_attempt'
    | 'xss_attempt'
    | 'path_traversal_attempt'
    | 'command_injection_attempt'
    | 'invalid_input',
  req: Request,
  details?: Record<string, unknown>
): void => {
  const severity: SecurityEvent['severity'] = event === 'invalid_input' ? 'low' : 'high';
  logSecurityEvent('input_validation', severity, event, req, details);
};

/**
 * Log rate limiting events
 */
export const logRateLimitEvent = (
  event: 'rate_limit_exceeded' | 'suspicious_request_pattern',
  req: Request,
  details?: Record<string, unknown>
): void => {
  const severity: SecurityEvent['severity'] =
    event === 'suspicious_request_pattern' ? 'high' : 'medium';
  logSecurityEvent('rate_limit', severity, event, req, details);
};

/**
 * Log suspicious activity
 */
export const logSuspiciousActivity = (
  event:
    | 'bot_detection'
    | 'unusual_user_agent'
    | 'suspicious_ip'
    | 'automated_attack'
    | 'data_scraping_attempt'
    | 'slow_request',
  req: Request,
  details?: Record<string, unknown>
): void => {
  logSecurityEvent('suspicious_activity', 'high', event, req, details);
};

/**
 * Security metrics collector for monitoring dashboards
 */
class SecurityMetrics {
  private static instance: SecurityMetrics;
  private metrics: Map<string, number> = new Map();

  static getInstance(): SecurityMetrics {
    if (!SecurityMetrics.instance) {
      SecurityMetrics.instance = new SecurityMetrics();
    }
    return SecurityMetrics.instance;
  }

  increment(metric: string): void {
    const current = this.metrics.get(metric) || 0;
    this.metrics.set(metric, current + 1);
  }

  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics.entries());
  }

  reset(): void {
    this.metrics.clear();
  }
}

export const securityMetrics = SecurityMetrics.getInstance();

/**
 * Track security metrics for specific events
 */
export const trackSecurityMetric = (metric: string): void => {
  securityMetrics.increment(metric);
};

/**
 * Comprehensive security event tracker middleware
 */
export const securityEventTracker = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Track request metrics
  trackSecurityMetric('requests_total');
  trackSecurityMetric(`requests_${req.method.toLowerCase()}`);

  // Check for suspicious patterns
  const userAgent = req.get('User-Agent') || '';
  const referer = req.get('Referer') || '';

  // Track suspicious user agents
  if (!userAgent || userAgent.length < 10) {
    trackSecurityMetric('suspicious_user_agent');
    logSuspiciousActivity('unusual_user_agent', req, { userAgent });
  }

  // Track requests without referer (for non-API endpoints)
  if (!req.path.startsWith('/api/') && !referer && req.method !== 'GET') {
    trackSecurityMetric('missing_referer');
  }

  // Track response time and status
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    trackSecurityMetric(`response_${Math.floor(res.statusCode / 100)}xx`);

    // Log slow requests as potential DoS attempts
    if (responseTime > 5000) {
      logSuspiciousActivity('slow_request', req, { responseTime, statusCode: res.statusCode });
    }

    // Log client errors as potential attack attempts
    if (res.statusCode >= 400 && res.statusCode < 500) {
      trackSecurityMetric('client_errors');
      if (res.statusCode === 401 || res.statusCode === 403) {
        trackSecurityMetric('auth_failures');
      }
    }

    // Log server errors
    if (res.statusCode >= 500) {
      trackSecurityMetric('server_errors');
    }
  });

  next();
};

/**
 * Export security metrics endpoint for monitoring
 */
export const getSecurityMetrics = (): Record<string, number> => {
  return securityMetrics.getMetrics();
};

/**
 * Reset metrics (useful for periodic reporting)
 */
export const resetSecurityMetrics = (): void => {
  securityMetrics.reset();
};
