import express from 'express';
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js';
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { createUnauthorizedError, createError } from '../middleware/errorHandler.js';
import { auditLogger, type AuditQueryFilters } from '../utils/auditLogger.js';
import { auditSecurity } from '../utils/auditLogger.js';

const router = express.Router();

// TODO: Implement proper role-based access control (RBAC) for production
// This is a critical security requirement before deploying audit functionality
// Example implementation:
// 1. Add 'role' field to User model in Prisma schema
// 2. Update authentication to include role in JWT payload
// 3. Check user role in this middleware
const requireAdmin = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  // IMPORTANT: This is a placeholder implementation
  // In production, implement proper role checking:
  // if (!req.user?.role || req.user.role !== 'admin') {
  //   throw createUnauthorizedError('Admin access required');
  // }

  // Development mode bypass - remove before production deployment
  if (process.env.NODE_ENV === 'production') {
    throw createUnauthorizedError(
      'Admin access required - RBAC not yet implemented. See TODO above.'
    );
  }

  // Log audit access attempt (even in development)
  auditLogger
    .logEvent(
      {
        action: 'admin.system_access',
        resource: 'audit_logs',
        outcome: 'success',
        details: { endpoint: req.path },
      },
      req
    )
    .catch(() => {});

  next();
};

// Apply authentication to all audit routes
router.use(requireAuth);

// GET /api/audit/events - Query audit events with filters
router.get(
  '/events',
  requireAdmin,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    try {
      const {
        userId,
        action,
        resource,
        outcome,
        riskLevel,
        startDate,
        endDate,
        limit = '100',
        offset = '0',
      } = req.query;

      const filters: AuditQueryFilters = {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      };

      if (userId) filters.userId = userId as string;
      if (action) filters.action = action as any;
      if (resource) filters.resource = resource as string;
      if (outcome) filters.outcome = outcome as any;
      if (riskLevel) filters.riskLevel = riskLevel as any;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const events = await auditLogger.queryEvents(filters);

      // Log audit access for security monitoring
      await auditSecurity.suspiciousActivity(req, 'audit_log_access', {
        queriedFilters: filters,
        resultCount: events.length,
      });

      res.json({
        events,
        filters,
        totalResults: events.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw createError('Failed to query audit events', 500);
    }
  })
);

// GET /api/audit/statistics - Get audit statistics for monitoring dashboard
router.get(
  '/statistics',
  requireAdmin,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    try {
      const { timeframe = 'day' } = req.query;

      const validTimeframes = ['hour', 'day', 'week', 'month'];
      if (!validTimeframes.includes(timeframe as string)) {
        throw createError('Invalid timeframe. Must be one of: hour, day, week, month', 400);
      }

      const statistics = await auditLogger.getStatistics(timeframe as any);

      // Log statistics access
      await auditSecurity.suspiciousActivity(req, 'audit_statistics_access', {
        timeframe,
      });

      res.json({
        statistics,
        timeframe,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw createError('Failed to get audit statistics', 500);
    }
  })
);

// GET /api/audit/security-events - Get high-risk security events
router.get(
  '/security-events',
  requireAdmin,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    try {
      const { hours = '24' } = req.query;
      const hoursBack = parseInt(hours as string, 10);

      const startDate = new Date();
      startDate.setHours(startDate.getHours() - hoursBack);

      const securityEvents = await auditLogger.queryEvents({
        riskLevel: 'high',
        startDate,
        limit: 500,
      });

      const criticalEvents = await auditLogger.queryEvents({
        riskLevel: 'critical',
        startDate,
        limit: 500,
      });

      // Log security events access
      await auditSecurity.suspiciousActivity(req, 'security_events_access', {
        hoursBack,
        highRiskCount: securityEvents.length,
        criticalCount: criticalEvents.length,
      });

      res.json({
        summary: {
          timeframe: `${hoursBack} hours`,
          highRiskEvents: securityEvents.length,
          criticalEvents: criticalEvents.length,
          totalSecurityEvents: securityEvents.length + criticalEvents.length,
        },
        events: {
          high: securityEvents.slice(0, 50), // Limit to 50 most recent
          critical: criticalEvents.slice(0, 50),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw createError('Failed to get security events', 500);
    }
  })
);

// GET /api/audit/user/:userId - Get audit events for a specific user
router.get(
  '/user/:userId',
  requireAdmin,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { days = '7' } = req.query;

      const daysBack = parseInt(days as string, 10);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      const userEvents = await auditLogger.queryEvents({
        userId,
        startDate,
        limit: 1000,
      });

      // Log user audit access
      await auditSecurity.suspiciousActivity(req, 'user_audit_access', {
        targetUserId: userId,
        daysBack,
        eventCount: userEvents.length,
      });

      res.json({
        userId,
        timeframe: `${daysBack} days`,
        eventCount: userEvents.length,
        events: userEvents,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw createError('Failed to get user audit events', 500);
    }
  })
);

// POST /api/audit/test - Test audit logging (development only)
if (process.env.NODE_ENV === 'development') {
  router.post(
    '/test',
    requireAdmin,
    asyncAuthHandler(async (req: AuthRequest, res) => {
      try {
        const { action = 'auth.login', outcome = 'success', resource = 'user' } = req.body;

        await auditLogger.logEvent(action, resource, outcome, {
          req,
          userId: req.user?.id,
          details: { test: true, timestamp: new Date().toISOString() },
        });

        res.json({
          message: 'Test audit event logged successfully',
          event: { action, outcome, resource },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        throw createError('Failed to log test audit event', 500);
      }
    })
  );
}

export default router;
