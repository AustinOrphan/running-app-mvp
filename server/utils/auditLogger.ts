import { Request } from 'express';
import crypto from 'crypto';
import { logInfo, logError } from './logger.js';
import { securityMetrics } from './securityLogger.js';

/**
 * Comprehensive Audit Logging System
 * Tracks all security-sensitive operations for compliance and monitoring
 */

export interface AuditEvent {
  id: string;
  timestamp: string;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  outcome: 'success' | 'failure' | 'blocked';
  details?: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  correlationId?: string;
  geolocation?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

export type AuditAction =
  // Authentication events
  | 'auth.login'
  | 'auth.logout'
  | 'auth.register'
  | 'auth.password_change'
  | 'auth.password_reset'
  | 'auth.token_refresh'
  | 'auth.mfa_enable'
  | 'auth.mfa_disable'
  | 'auth.session_timeout'
  // Authorization events
  | 'authz.access_granted'
  | 'authz.access_denied'
  | 'authz.privilege_escalation'
  | 'authz.role_change'
  // Data operations
  | 'data.create'
  | 'data.read'
  | 'data.update'
  | 'data.delete'
  | 'data.export'
  | 'data.import'
  | 'data.backup'
  | 'data.restore'
  // Security events
  | 'security.attack_detected'
  | 'security.rate_limit_exceeded'
  | 'security.suspicious_activity'
  | 'security.policy_violation'
  | 'security.encryption_failure'
  | 'security.certificate_error'
  // System events
  | 'system.startup'
  | 'system.shutdown'
  | 'system.config_change'
  | 'system.backup'
  | 'system.maintenance'
  // Admin events
  | 'admin.user_create'
  | 'admin.user_delete'
  | 'admin.user_suspend'
  | 'admin.settings_change'
  | 'admin.system_access';

/**
 * Audit event storage interface
 */
interface AuditStorage {
  store(event: AuditEvent): Promise<void>;
  query(filters: AuditQueryFilters): Promise<AuditEvent[]>;
  cleanup(retentionDays: number): Promise<number>;
}

export interface AuditQueryFilters {
  userId?: string;
  action?: AuditAction;
  resource?: string;
  outcome?: AuditEvent['outcome'];
  riskLevel?: AuditEvent['riskLevel'];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * In-memory audit storage for development
 * TODO: Replace with persistent storage (database/file) in production
 */
class MemoryAuditStorage implements AuditStorage {
  private events: AuditEvent[] = [];
  private readonly maxEvents = parseInt(process.env.AUDIT_MAX_MEMORY_EVENTS || '10000', 10);

  async store(event: AuditEvent): Promise<void> {
    this.events.push(event);
    
    // Keep only the most recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  async query(filters: AuditQueryFilters): Promise<AuditEvent[]> {
    let results = [...this.events];

    // Apply filters
    if (filters.userId) {
      results = results.filter(e => e.userId === filters.userId);
    }
    if (filters.action) {
      results = results.filter(e => e.action === filters.action);
    }
    if (filters.resource) {
      results = results.filter(e => e.resource === filters.resource);
    }
    if (filters.outcome) {
      results = results.filter(e => e.outcome === filters.outcome);
    }
    if (filters.riskLevel) {
      results = results.filter(e => e.riskLevel === filters.riskLevel);
    }
    if (filters.startDate) {
      results = results.filter(e => new Date(e.timestamp) >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter(e => new Date(e.timestamp) <= filters.endDate!);
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    return results.slice(offset, offset + limit);
  }

  async cleanup(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const originalLength = this.events.length;
    this.events = this.events.filter(e => new Date(e.timestamp) > cutoffDate);
    
    return originalLength - this.events.length;
  }
}

/**
 * File-based audit storage for production
 */
class FileAuditStorage implements AuditStorage {
  private readonly logPath: string;

  constructor(logPath: string = process.env.AUDIT_LOG_PATH || './logs/audit.log') {
    this.logPath = logPath;
  }

  async store(event: AuditEvent): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      // Ensure log directory exists
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      
      // Append event as JSON line
      const logLine = JSON.stringify(event) + '\n';
      await fs.appendFile(this.logPath, logLine, 'utf8');
    } catch (error) {
      logError('audit', 'file-storage', error instanceof Error ? error : new Error('Failed to write audit log'));
    }
  }

  async query(filters: AuditQueryFilters): Promise<AuditEvent[]> {
    // For production, implement proper log querying
    // This is a simplified implementation
    const fs = await import('fs/promises');
    
    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      const events = lines
        .map(line => {
          try {
            return JSON.parse(line) as AuditEvent;
          } catch {
            return null;
          }
        })
        .filter((event): event is AuditEvent => event !== null);

      // Apply filters (same logic as memory storage)
      // ... (implementation similar to MemoryAuditStorage.query)
      
      return events.slice(0, filters.limit || 100);
    } catch (error) {
      logError('audit', 'file-query', error instanceof Error ? error : new Error('Failed to query audit log'));
      return [];
    }
  }

  async cleanup(retentionDays: number): Promise<number> {
    // Implement log rotation and cleanup
    // This is a placeholder for production implementation
    logInfo('audit', 'cleanup', `Audit log cleanup requested (${retentionDays} days retention)`);
    return 0;
  }
}

/**
 * Main audit logger class
 */
class AuditLogger {
  private storage: AuditStorage;
  private readonly encryptionKey?: string;

  constructor() {
    const storageType = process.env.AUDIT_STORAGE_TYPE || 'memory';
    
    if (storageType === 'file') {
      this.storage = new FileAuditStorage();
    } else {
      this.storage = new MemoryAuditStorage();
    }

    this.encryptionKey = process.env.AUDIT_ENCRYPTION_KEY;
    
    // Setup automatic cleanup
    this.setupCleanup();
  }

  /**
   * Log an audit event
   */
  async logEvent(
    action: AuditAction,
    resource: string,
    outcome: AuditEvent['outcome'],
    options: {
      req?: Request;
      userId?: string;
      resourceId?: string;
      details?: Record<string, unknown>;
      riskLevel?: AuditEvent['riskLevel'];
    } = {}
  ): Promise<void> {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: options.userId || (options.req as any)?.user?.id,
      sessionId: this.extractSessionId(options.req),
      ipAddress: this.extractClientIP(options.req),
      userAgent: options.req?.get('User-Agent'),
      action,
      resource,
      resourceId: options.resourceId,
      outcome,
      details: this.sanitizeDetails(options.details),
      riskLevel: options.riskLevel || this.determineRiskLevel(action, outcome),
      correlationId: (options.req as any)?.correlationId,
    };

    // Encrypt sensitive data if encryption is enabled
    if (this.encryptionKey && this.isSensitiveEvent(action)) {
      event.details = this.encryptDetails(event.details);
    }

    try {
      await this.storage.store(event);
      
      // Update security metrics
      securityMetrics.increment(`audit_${action.replace('.', '_')}`);
      securityMetrics.increment(`audit_outcome_${outcome}`);
      securityMetrics.increment(`audit_risk_${event.riskLevel}`);
      
      // Log high-risk events immediately
      if (event.riskLevel === 'critical' || event.riskLevel === 'high') {
        logInfo('audit', 'high-risk-event', `High-risk audit event: ${action}`, options.req, {
          auditId: event.id,
          riskLevel: event.riskLevel,
          outcome,
        });
      }
    } catch (error) {
      logError('audit', 'logging-failure', error instanceof Error ? error : new Error('Failed to log audit event'), options.req, {
        action,
        resource,
        outcome,
      });
    }
  }

  /**
   * Query audit events
   */
  async queryEvents(filters: AuditQueryFilters): Promise<AuditEvent[]> {
    try {
      const events = await this.storage.query(filters);
      
      // Decrypt sensitive data if needed
      if (this.encryptionKey) {
        return events.map(event => ({
          ...event,
          details: this.isSensitiveEvent(event.action) 
            ? this.decryptDetails(event.details) 
            : event.details,
        }));
      }
      
      return events;
    } catch (error) {
      logError('audit', 'query-failure', error instanceof Error ? error : new Error('Failed to query audit events'));
      return [];
    }
  }

  /**
   * Get audit statistics
   */
  async getStatistics(timeframe: 'hour' | 'day' | 'week' | 'month' = 'day'): Promise<{
    totalEvents: number;
    byAction: Record<string, number>;
    byOutcome: Record<string, number>;
    byRiskLevel: Record<string, number>;
    topUsers: Array<{ userId: string; count: number }>;
    topResources: Array<{ resource: string; count: number }>;
  }> {
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case 'hour':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    const events = await this.storage.query({ startDate, endDate, limit: 10000 });
    
    const stats = {
      totalEvents: events.length,
      byAction: {} as Record<string, number>,
      byOutcome: {} as Record<string, number>,
      byRiskLevel: {} as Record<string, number>,
      topUsers: [] as Array<{ userId: string; count: number }>,
      topResources: [] as Array<{ resource: string; count: number }>,
    };

    // Count by action
    events.forEach(event => {
      stats.byAction[event.action] = (stats.byAction[event.action] || 0) + 1;
      stats.byOutcome[event.outcome] = (stats.byOutcome[event.outcome] || 0) + 1;
      stats.byRiskLevel[event.riskLevel] = (stats.byRiskLevel[event.riskLevel] || 0) + 1;
    });

    // Count by user
    const userCounts = new Map<string, number>();
    events.forEach(event => {
      if (event.userId) {
        userCounts.set(event.userId, (userCounts.get(event.userId) || 0) + 1);
      }
    });
    
    stats.topUsers = Array.from(userCounts.entries())
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Count by resource
    const resourceCounts = new Map<string, number>();
    events.forEach(event => {
      resourceCounts.set(event.resource, (resourceCounts.get(event.resource) || 0) + 1);
    });
    
    stats.topResources = Array.from(resourceCounts.entries())
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return stats;
  }

  private extractSessionId(req?: Request): string | undefined {
    // Extract session ID from request (implementation depends on session management)
    return (req as any)?.sessionID || (req as any)?.session?.id;
  }

  private extractClientIP(req?: Request): string | undefined {
    if (!req) return undefined;
    
    return (
      req.ip ||
      req.headers['x-forwarded-for'] as string ||
      req.headers['x-real-ip'] as string ||
      req.connection?.remoteAddress ||
      'unknown'
    );
  }

  private sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details) return undefined;

    const sanitized = { ...details };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credential'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  private determineRiskLevel(action: AuditAction, outcome: AuditEvent['outcome']): AuditEvent['riskLevel'] {
    // Critical risk actions
    if (action.startsWith('admin.') || action.includes('delete') || action === 'authz.privilege_escalation') {
      return outcome === 'failure' ? 'critical' : 'high';
    }

    // High risk actions
    if (action.startsWith('security.') || action.includes('password') || action === 'data.export') {
      return outcome === 'failure' ? 'high' : 'medium';
    }

    // Medium risk actions
    if (action.startsWith('auth.') || action.startsWith('data.')) {
      return outcome === 'failure' ? 'medium' : 'low';
    }

    // Default to low risk
    return 'low';
  }

  private isSensitiveEvent(action: AuditAction): boolean {
    const sensitiveActions = [
      'auth.login',
      'auth.register',
      'auth.password_change',
      'auth.password_reset',
      'data.export',
      'admin.user_create',
      'admin.settings_change',
    ];
    
    return sensitiveActions.includes(action);
  }

  private encryptDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details || !this.encryptionKey) return details;

    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv) as crypto.CipherGCM;
      
      let encrypted = cipher.update(JSON.stringify(details), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      return { 
        encrypted: true, 
        data: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex')
      };
    } catch (error) {
      logError('audit', 'encryption-failure', error instanceof Error ? error : new Error('Failed to encrypt audit details'));
      return details;
    }
  }

  private decryptDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details || !this.encryptionKey || !details.encrypted) return details;

    try {
      const iv = Buffer.from(details.iv as string, 'hex');
      const tag = Buffer.from(details.tag as string, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv) as crypto.DecipherGCM;
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(details.data as string, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      logError('audit', 'decryption-failure', error instanceof Error ? error : new Error('Failed to decrypt audit details'));
      return details;
    }
  }

  private setupCleanup(): void {
    const retentionDays = parseInt(process.env.AUDIT_RETENTION_DAYS || '365', 10);
    const cleanupInterval = parseInt(process.env.AUDIT_CLEANUP_INTERVAL_HOURS || '24', 10);

    setInterval(async () => {
      try {
        const cleanedCount = await this.storage.cleanup(retentionDays);
        if (cleanedCount > 0) {
          logInfo('audit', 'cleanup', `Cleaned up ${cleanedCount} old audit events`);
        }
      } catch (error) {
        logError('audit', 'cleanup-failure', error instanceof Error ? error : new Error('Failed to cleanup audit events'));
      }
    }, cleanupInterval * 60 * 60 * 1000); // Convert hours to milliseconds
  }
}

// Export singleton instance
export const auditLogger = new AuditLogger();

// Convenience functions for common audit events
export const auditAuth = {
  login: (req: Request, userId: string, outcome: AuditEvent['outcome'], details?: Record<string, unknown>) =>
    auditLogger.logEvent('auth.login', 'user', outcome, { req, userId, details }),
  
  logout: (req: Request, userId: string) =>
    auditLogger.logEvent('auth.logout', 'user', 'success', { req, userId }),
  
  register: (req: Request, userId: string, outcome: AuditEvent['outcome']) =>
    auditLogger.logEvent('auth.register', 'user', outcome, { req, userId }),
  
  refresh: (req: Request, userId: string, outcome: AuditEvent['outcome']) =>
    auditLogger.logEvent('auth.token_refresh', 'user', outcome, { req, userId }),
  
  passwordChange: (req: Request, userId: string, outcome: AuditEvent['outcome']) =>
    auditLogger.logEvent('auth.password_change', 'user', outcome, { req, userId, riskLevel: 'high' }),
};

export const auditData = {
  create: (req: Request, resource: string, resourceId: string, outcome: AuditEvent['outcome']) =>
    auditLogger.logEvent('data.create', resource, outcome, { req, resourceId }),
  
  read: (req: Request, resource: string, resourceId?: string) =>
    auditLogger.logEvent('data.read', resource, 'success', { req, resourceId }),
  
  update: (req: Request, resource: string, resourceId: string, outcome: AuditEvent['outcome']) =>
    auditLogger.logEvent('data.update', resource, outcome, { req, resourceId }),
  
  delete: (req: Request, resource: string, resourceId: string, outcome: AuditEvent['outcome']) =>
    auditLogger.logEvent('data.delete', resource, outcome, { req, resourceId, riskLevel: 'high' }),
};

export const auditSecurity = {
  attackDetected: (req: Request, attackType: string, details?: Record<string, unknown>) =>
    auditLogger.logEvent('security.attack_detected', 'system', 'blocked', { 
      req, 
      details: { attackType, ...details }, 
      riskLevel: 'critical' 
    }),
  
  rateLimitExceeded: (req: Request, endpoint: string) =>
    auditLogger.logEvent('security.rate_limit_exceeded', endpoint, 'blocked', { req, riskLevel: 'medium' }),
  
  suspiciousActivity: (req: Request, activity: string, details?: Record<string, unknown>) =>
    auditLogger.logEvent('security.suspicious_activity', 'system', 'blocked', { 
      req, 
      details: { activity, ...details }, 
      riskLevel: 'high' 
    }),
};