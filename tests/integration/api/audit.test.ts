import express from 'express';
import request from 'supertest';
import { testDb } from '../../fixtures/testDatabase.js';
import authRoutes from '../../../server/routes/auth.js';
import auditRoutes from '../../../server/routes/audit.js';
import { authRateLimit } from '../../../server/middleware/rateLimiting.js';
import { errorHandler } from '../../../server/middleware/errorHandler.js';
import type { TestUser } from '../../e2e/types/index.js';
import { assertTestUser } from '../../e2e/types/index.js';
// Define proper types for audit logger
interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure';
  userId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  metadata: Record<string, unknown>;
}

interface AuditStatistics {
  totalEvents: number;
  uniqueUsers: number;
  eventsByAction: Record<string, number>;
  eventsByOutcome: Record<string, number>;
}

interface AuditQueryFilters {
  userId?: string;
  action?: string;
  resource?: string;
  outcome?: 'success' | 'failure';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  startDate?: Date;
  endDate?: Date;
  limit: number;
  offset: number;
}

const createTestApp = (): express.Application => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRateLimit, authRoutes);
  app.use('/api/audit', auditRoutes);
  app.use(errorHandler);
  return app;
};

describe('Audit API Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser | undefined;
  let authToken: string;

  // Create local mock functions
  const mockLogEvent = jest.fn();
  const mockQueryEvents = jest.fn();
  const mockGetStatistics = jest.fn();
  const mockSuspiciousActivity = jest.fn();

  // Mock the audit logger module before importing
  jest.doMock(
    '/Users/austinorphan/Library/Mobile Documents/com~apple~CloudDocs/src/running-app-mvp/server/utils/auditLogger.ts',
    () => ({
      auditLogger: {
        logEvent: mockLogEvent,
        queryEvents: mockQueryEvents,
        getStatistics: mockGetStatistics,
      },
      auditSecurity: {
        suspiciousActivity: mockSuspiciousActivity,
        attackDetected: jest.fn(),
        rateLimitExceeded: jest.fn(),
      },
    })
  );

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await testDb.cleanupDatabase();

    // Create test user and get auth token
    testUser = await testDb.createTestUser({
      email: 'audit-test@example.com',
      password: 'Test123!@#',
    });

    authToken = testDb.generateTestToken(assertTestUser(testUser).id);

    // Clear mock calls
    jest.clearAllMocks();

    // Set up default mock implementations
    mockQueryEvents.mockResolvedValue([
      {
        id: 'event-1',
        timestamp: new Date().toISOString(),
        action: 'auth.login',
        resource: 'user',
        outcome: 'success',
        userId: 'test-user-id',
        riskLevel: 'low',
        metadata: {},
      },
      {
        id: 'event-2',
        timestamp: new Date().toISOString(),
        action: 'data.access',
        resource: 'runs',
        outcome: 'success',
        userId: 'test-user-id',
        riskLevel: 'medium',
        metadata: {},
      },
    ] as AuditEvent[]);

    mockGetStatistics.mockResolvedValue({
      totalEvents: 100,
      uniqueUsers: 10,
      eventsByAction: {
        'auth.login': 50,
        'data.access': 30,
        'admin.access': 20,
      },
      eventsByOutcome: {
        success: 80,
        failure: 20,
      },
    } as AuditStatistics);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('Authentication Requirements', () => {
    it('requires authentication for all audit endpoints', async () => {
      interface Endpoint {
        method: 'get' | 'post';
        path: string;
      }

      const endpoints: Endpoint[] = [
        { method: 'get', path: '/api/audit/events' },
        { method: 'get', path: '/api/audit/statistics' },
        { method: 'get', path: '/api/audit/security-events' },
        { method: 'get', path: '/api/audit/user/test-user-id' },
        { method: 'post', path: '/api/audit/test' },
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)[endpoint.method](endpoint.path);
        expect(response.status).toBe(401);
        expect(response.body.message).toContain('No valid token provided');
      }
    });

    it('rejects requests with invalid tokens', async () => {
      const response = await request(app)
        .get('/api/audit/events')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('rejects requests with malformed authorization headers', async () => {
      const response = await request(app)
        .get('/api/audit/events')
        .set('Authorization', 'NotBearer token')
        .expect(401);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('Admin Role Requirements', () => {
    it('allows access in development mode', async () => {
      process.env.NODE_ENV = 'development';

      const response = await request(app)
        .get('/api/audit/events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('filters');
    });

    it('blocks access in production mode without RBAC', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const response = await request(app)
          .get('/api/audit/events')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(401);

        expect(response.body.message).toContain('Admin access required');
        expect(response.body.message).toContain('RBAC not yet implemented');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('logs admin access attempts', async () => {
      process.env.NODE_ENV = 'development';

      await request(app)
        .get('/api/audit/events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockLogEvent).toHaveBeenCalledWith(
        'admin.system_access',
        'audit_logs',
        'success',
        expect.objectContaining({
          req: expect.objectContaining({
            method: 'GET',
            path: '/api/audit/events',
          }),
          details: expect.objectContaining({
            endpoint: '/events',
          }),
        })
      );
    });
  });

  describe('GET /api/audit/events', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('returns audit events with default query', async () => {
      const response = await request(app)
        .get('/api/audit/events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('filters');
      expect(response.body).toHaveProperty('totalResults');
      expect(response.body).toHaveProperty('timestamp');

      expect(response.body.events).toBeInstanceOf(Array);
      expect(response.body.events.length).toBe(2);
      expect(response.body.filters.limit).toBe(100);
      expect(response.body.filters.offset).toBe(0);
    });

    it('accepts query filters', async () => {
      await request(app)
        .get('/api/audit/events')
        .query({
          userId: 'test-user-id',
          action: 'auth.login',
          resource: 'user',
          outcome: 'success',
          riskLevel: 'high',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          limit: '50',
          offset: '10',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockQueryEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-id',
          action: 'auth.login',
          resource: 'user',
          outcome: 'success',
          riskLevel: 'high',
          startDate: expect.any(Date),
          endDate: expect.any(Date),
          limit: 50,
          offset: 10,
        })
      );
    });

    it('logs audit access for security monitoring', async () => {
      await request(app)
        .get('/api/audit/events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Use the local mock
      expect(mockSuspiciousActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/audit/events',
        }),
        'audit_log_access',
        expect.objectContaining({
          queriedFilters: expect.objectContaining({
            limit: 100,
            offset: 0,
          }),
          resultCount: 2,
        })
      );
    });

    it('handles database errors gracefully', async () => {
      mockQueryEvents.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/api/audit/events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.message).toBe('Failed to query audit events');
    });
  });

  describe('GET /api/audit/statistics', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('returns statistics with default timeframe', async () => {
      const response = await request(app)
        .get('/api/audit/statistics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('statistics');
      expect(response.body).toHaveProperty('timeframe', 'day');
      expect(response.body).toHaveProperty('timestamp');

      expect(response.body.statistics).toMatchObject({
        totalEvents: 100,
        uniqueUsers: 10,
        eventsByAction: expect.any(Object),
        eventsByOutcome: expect.any(Object),
      });
    });

    it('accepts valid timeframe parameters', async () => {
      const validTimeframes = ['hour', 'day', 'week', 'month'];

      for (const timeframe of validTimeframes) {
        const response = await request(app)
          .get('/api/audit/statistics')
          .query({ timeframe })
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.timeframe).toBe(timeframe);
      }
    });

    it('rejects invalid timeframe parameters', async () => {
      const response = await request(app)
        .get('/api/audit/statistics')
        .query({ timeframe: 'invalid' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.message).toContain('Invalid timeframe');
      expect(response.body.message).toContain('Must be one of: hour, day, week, month');
    });

    it('handles statistics calculation errors', async () => {
      mockGetStatistics.mockRejectedValueOnce(new Error('Calculation error'));

      const response = await request(app)
        .get('/api/audit/statistics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.message).toBe('Failed to get audit statistics');
    });
  });

  describe('GET /api/audit/security-events', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';

      mockQueryEvents.mockImplementation(async (filters: AuditQueryFilters) => {
        if (filters.riskLevel === 'high') {
          return Array(5)
            .fill(null)
            .map((_, i) => ({
              id: `high-event-${i}`,
              timestamp: new Date().toISOString(),
              action: 'security.breach_attempt',
              resource: 'system',
              outcome: 'failure' as const,
              userId: 'attacker',
              riskLevel: 'high' as const,
              metadata: {},
            }));
        } else if (filters.riskLevel === 'critical') {
          return Array(3)
            .fill(null)
            .map((_, i) => ({
              id: `critical-event-${i}`,
              timestamp: new Date().toISOString(),
              action: 'security.privilege_escalation',
              resource: 'admin',
              outcome: 'blocked' as const,
              userId: 'attacker',
              riskLevel: 'critical' as const,
              metadata: {},
            }));
        }
        return [];
      });
    });

    it('returns high-risk and critical events', async () => {
      const response = await request(app)
        .get('/api/audit/security-events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('timestamp');

      expect(response.body.summary).toMatchObject({
        timeframe: '24 hours',
        highRiskEvents: 5,
        criticalEvents: 3,
        totalSecurityEvents: 8,
      });

      expect(response.body.events.high).toHaveLength(5);
      expect(response.body.events.critical).toHaveLength(3);
    });

    it('accepts custom hours parameter', async () => {
      const response = await request(app)
        .get('/api/audit/security-events')
        .query({ hours: '48' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.summary.timeframe).toBe('48 hours');
    });

    it('limits results to 50 most recent per risk level', async () => {
      mockQueryEvents.mockImplementation(async (filters: AuditQueryFilters) => {
        if (filters.riskLevel === 'high') {
          return Array(100)
            .fill(null)
            .map((_, i) => ({
              id: `high-event-${i}`,
              timestamp: new Date().toISOString(),
              action: 'security.breach_attempt',
              resource: 'system',
              outcome: 'failure' as const,
              userId: 'attacker',
              riskLevel: 'high' as const,
              metadata: {},
            }));
        }
        return [];
      });

      const response = await request(app)
        .get('/api/audit/security-events')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.events.high).toHaveLength(50);
    });
  });

  describe('GET /api/audit/user/:userId', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('returns audit events for specific user', async () => {
      const response = await request(app)
        .get('/api/audit/user/test-user-123')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('userId', 'test-user-123');
      expect(response.body).toHaveProperty('timeframe', '7 days');
      expect(response.body).toHaveProperty('eventCount', 2);
      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('timestamp');

      expect(mockQueryEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-123',
          startDate: expect.any(Date),
          limit: 1000,
        })
      );
    });

    it('accepts custom days parameter', async () => {
      const response = await request(app)
        .get('/api/audit/user/test-user-123')
        .query({ days: '30' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.timeframe).toBe('30 days');
    });
  });

  describe('POST /api/audit/test (development only)', () => {
    it('logs test audit events in development mode', async () => {
      process.env.NODE_ENV = 'development';

      const response = await request(app)
        .post('/api/audit/test')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          action: 'test.event',
          outcome: 'success',
          resource: 'test_resource',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        message: 'Test audit event logged successfully',
        event: {
          action: 'test.event',
          outcome: 'success',
          resource: 'test_resource',
        },
        timestamp: expect.any(String),
      });

      expect(mockLogEvent).toHaveBeenCalledWith(
        'test.event',
        'test_resource',
        'success',
        expect.objectContaining({
          req: expect.any(Object),
          userId: assertTestUser(testUser).id,
          details: expect.objectContaining({
            test: true,
            timestamp: expect.any(String),
          }),
        })
      );
    });

    it('returns 404 in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const response = await request(app)
          .post('/api/audit/test')
          .set('Authorization', `Bearer ${authToken}`)
          .send({})
          .expect(404);

        expect(response.body.message).toContain('Not Found');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('enforces rate limits on audit endpoints', async () => {
      // Make many requests quickly
      const requests = Array(101)
        .fill(null)
        .map(() =>
          request(app).get('/api/audit/events').set('Authorization', `Bearer ${authToken}`)
        );

      const responses = await Promise.all(requests);

      // Some requests should be rate limited
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);

      // Rate limited responses should have proper headers
      if (rateLimited.length > 0) {
        expect(rateLimited[0].body).toHaveProperty('message');
        expect(rateLimited[0].body.message).toMatch(/too many.*requests/i);
        expect(rateLimited[0].headers).toHaveProperty('retry-after');
      }
    });
  });
});
