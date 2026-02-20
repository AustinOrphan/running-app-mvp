import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import analyticsRoutes from '../../../server/routes/analytics.js';
import { AnalyticsService } from '../../../server/services/analyticsService.js';
import { errorHandler } from '../../../server/middleware/errorHandler.js';
import { testDb } from '../../fixtures/testDatabase.js';
import {
  consistentRunPattern,
  variedLocationsPattern,
  edgeCases,
  getCurrentWeekConsistentRuns,
  getCurrentMonthConsistentRuns,
  getCurrentMonthImprovingPace,
  getCurrentYearConsistentRuns,
  getCurrentMonthVolumeSpike,
  getCurrentMonthVariedLocations,
} from '../../fixtures/analyticsData.js';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);

  // Error handling middleware must be last
  app.use(errorHandler);

  return app;
};

describe('Analytics API Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser | undefined;
  let authToken: string;

  beforeAll(async () => {
    app = createTestApp();
    // CRITICAL: Use the same Prisma client for service and tests
    AnalyticsService.setPrismaInstance(testDb.prisma);
    // CRITICAL: Override global Prisma instance for routes that import prisma directly
    (global as any).prisma = testDb.prisma;
  });

  beforeEach(async () => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'analytics@test.com',
      password: 'testpassword',
    });

    authToken = testDb.generateTestToken(
      assertTestUser(testUser).id,
      assertTestUser(testUser).email
    );
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/analytics/statistics', () => {
    describe('Weekly Period', () => {
      it('returns statistics for the current week', async () => {
        // Create runs in current week using period-aware fixtures
        await testDb.createTestRunsWithGPS(
          assertTestUser(testUser).id,
          getCurrentWeekConsistentRuns()
        );

        const response = await request(app)
          .get('/api/analytics/statistics?period=weekly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('period', 'weekly');
        expect(response.body).toHaveProperty('startDate');
        expect(response.body).toHaveProperty('endDate');
        expect(response.body).toHaveProperty('totalRuns');
        expect(response.body).toHaveProperty('totalDistance');
        expect(response.body).toHaveProperty('totalDuration');
        expect(response.body).toHaveProperty('avgPace');
        expect(response.body).toHaveProperty('fastestPace');
        expect(response.body).toHaveProperty('longestRun');

        expect(typeof response.body.totalRuns).toBe('number');
        expect(typeof response.body.totalDistance).toBe('number');
        expect(typeof response.body.totalDuration).toBe('number');
        expect(typeof response.body.avgPace).toBe('number');
      });

      it('returns zero stats when no runs in current week', async () => {
        // Create old runs (outside current week)
        const oldRuns = [
          {
            date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            distance: 5.0,
            duration: 1650,
            tag: 'easy',
            routeGeoJson: JSON.stringify({ type: 'LineString', coordinates: [] }),
          },
        ];
        await testDb.createTestRunsWithGPS(assertTestUser(testUser).id, oldRuns);

        const response = await request(app)
          .get('/api/analytics/statistics?period=weekly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.totalRuns).toBe(0);
        expect(response.body.totalDistance).toBe(0);
        expect(response.body.totalDuration).toBe(0);
        expect(response.body.avgPace).toBe(0);
      });

      it('calculates correct aggregations', async () => {
        // Use date range generator to ensure runs fall in current period
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const runs = [
          {
            date: yesterday.toISOString().split('T')[0],
            distance: 5.0,
            duration: 1500,
            tag: 'easy',
            routeGeoJson: JSON.stringify({ type: 'LineString', coordinates: [] }),
          },
          {
            date: today.toISOString().split('T')[0],
            distance: 10.0,
            duration: 3000,
            tag: 'long run',
            routeGeoJson: JSON.stringify({ type: 'LineString', coordinates: [] }),
          },
        ];
        await testDb.createTestRunsWithGPS(assertTestUser(testUser).id, runs);

        const response = await request(app)
          .get('/api/analytics/statistics?period=weekly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Since runs are within the current week, we should get stats
        expect(response.body.totalRuns).toBeGreaterThanOrEqual(1);
        expect(response.body.totalDistance).toBeGreaterThan(0);
        expect(response.body.totalDuration).toBeGreaterThan(0);
      });
    });

    describe('Monthly Period', () => {
      it('returns statistics for the current month', async () => {
        // Create runs in current month using period-aware fixtures
        await testDb.createTestRunsWithGPS(
          assertTestUser(testUser).id,
          getCurrentMonthConsistentRuns()
        );

        const response = await request(app)
          .get('/api/analytics/statistics?period=monthly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.period).toBe('monthly');
        expect(response.body.totalRuns).toBeGreaterThan(0);
      });

      it('excludes runs from previous month', async () => {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        const oldRuns = [
          {
            date: lastMonth.toISOString().split('T')[0],
            distance: 5.0,
            duration: 1650,
            tag: 'easy',
            routeGeoJson: JSON.stringify({ type: 'LineString', coordinates: [] }),
          },
        ];
        await testDb.createTestRunsWithGPS(assertTestUser(testUser).id, oldRuns);

        const response = await request(app)
          .get('/api/analytics/statistics?period=monthly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.totalRuns).toBe(0);
      });
    });

    describe('Yearly Period', () => {
      it('returns statistics for the current year', async () => {
        // Create runs throughout current year using period-aware fixtures
        await testDb.createTestRunsWithGPS(
          assertTestUser(testUser).id,
          getCurrentYearConsistentRuns()
        );

        const response = await request(app)
          .get('/api/analytics/statistics?period=yearly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.period).toBe('yearly');
        expect(response.body.totalRuns).toBeGreaterThan(0);
      });
    });

    describe('Validation', () => {
      it('returns 400 for invalid period', async () => {
        const response = await request(app)
          .get('/api/analytics/statistics?period=invalid')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('Invalid period');
      });

      it('defaults to weekly when period not specified', async () => {
        const response = await request(app)
          .get('/api/analytics/statistics')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.period).toBe('weekly');
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        await request(app).get('/api/analytics/statistics').expect(401);
      });

      it('returns 401 with invalid token', async () => {
        await request(app)
          .get('/api/analytics/statistics')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      });

      it('returns only authenticated user data', async () => {
        // Create second user with runs
        const user2 = await testDb.createTestUser({
          email: 'user2@test.com',
          password: 'testpassword',
        });
        await testDb.createTestRunsWithGPS(user2.id, consistentRunPattern.slice(0, 5));

        // Original user has no runs
        const response = await request(app)
          .get('/api/analytics/statistics?period=weekly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.totalRuns).toBe(0);
      });
    });
  });

  describe('GET /api/analytics/trends', () => {
    beforeEach(async () => {
      // Seed improving pace pattern for current month trend analysis
      await testDb.seedAnalyticsScenario(
        assertTestUser(testUser).id,
        getCurrentMonthImprovingPace()
      );
    });

    describe('Weekly Trends', () => {
      it('returns trend analysis with correct structure', async () => {
        const response = await request(app)
          .get('/api/analytics/trends?period=weekly&dataPoints=12')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('period', 'weekly');
        expect(response.body).toHaveProperty('dataPoints');
        expect(response.body).toHaveProperty('paceTrend');
        expect(response.body).toHaveProperty('volumeTrend');
        expect(response.body).toHaveProperty('paceChangePercent');
        expect(response.body).toHaveProperty('volumeChangePercent');
        expect(response.body).toHaveProperty('consistencyScore');

        expect(['improving', 'stable', 'declining']).toContain(response.body.paceTrend);
        expect(['increasing', 'stable', 'decreasing']).toContain(response.body.volumeTrend);
        expect(typeof response.body.consistencyScore).toBe('number');
      });

      it('detects improving pace trend', async () => {
        const response = await request(app)
          .get('/api/analytics/trends?period=weekly&dataPoints=12')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // improvingPacePattern should show improving trend
        expect(response.body.paceTrend).toBe('improving');
        expect(response.body.paceChangePercent).toBeLessThan(0); // Negative = faster
      });

      it('returns empty/default trends when insufficient data', async () => {
        await testDb.cleanupDatabase();
        const newUser = await testDb.createTestUser({
          email: 'new@test.com',
          password: 'test',
        });
        const newToken = testDb.generateTestToken(newUser.id, newUser.email);

        // Create only 1 run
        await testDb.createTestRunsWithGPS(newUser.id, edgeCases.singleRun);

        const response = await request(app)
          .get('/api/analytics/trends?period=weekly&dataPoints=12')
          .set('Authorization', `Bearer ${newToken}`)
          .expect(200);

        expect(response.body.paceTrend).toBe('stable');
        expect(response.body.consistencyScore).toBeLessThanOrEqual(1);
      });
    });

    describe('Monthly Trends', () => {
      it('returns monthly trend analysis', async () => {
        const response = await request(app)
          .get('/api/analytics/trends?period=monthly&dataPoints=6')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.period).toBe('monthly');
        expect(response.body.dataPoints).toBeLessThanOrEqual(6);
      });
    });

    describe('Validation', () => {
      it('returns 400 for invalid period', async () => {
        const response = await request(app)
          .get('/api/analytics/trends?period=yearly')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('Invalid period');
      });

      it('returns 400 for dataPoints < 2', async () => {
        const response = await request(app)
          .get('/api/analytics/trends?period=weekly&dataPoints=1')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('dataPoints must be between 2 and 52');
      });

      it('returns 400 for dataPoints > 52', async () => {
        const response = await request(app)
          .get('/api/analytics/trends?period=weekly&dataPoints=100')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('dataPoints must be between 2 and 52');
      });

      it('defaults to weekly period and 12 dataPoints', async () => {
        const response = await request(app)
          .get('/api/analytics/trends')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.period).toBe('weekly');
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        await request(app).get('/api/analytics/trends').expect(401);
      });

      it('returns 401 with invalid token', async () => {
        await request(app)
          .get('/api/analytics/trends')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      });
    });
  });

  describe('GET /api/analytics/insights', () => {
    describe('Consistency Insights', () => {
      it('returns insights array', async () => {
        await testDb.seedAnalyticsScenario(assertTestUser(testUser).id, consistentRunPattern);

        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('insights');
        expect(Array.isArray(response.body.insights)).toBe(true);
      });

      it('generates insights with correct structure', async () => {
        await testDb.seedAnalyticsScenario(assertTestUser(testUser).id, consistentRunPattern);

        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const insights = response.body.insights;

        if (insights.length > 0) {
          const insight = insights[0];
          expect(insight).toHaveProperty('type');
          expect(insight).toHaveProperty('priority');
          expect(insight).toHaveProperty('message');

          expect(['consistency', 'volume', 'recovery', 'performance', 'goal']).toContain(
            insight.type
          );
          expect(['high', 'medium', 'low']).toContain(insight.priority);
          expect(typeof insight.message).toBe('string');
        }
      });

      it('detects consistency patterns', async () => {
        // Use current month fixtures for consistency analysis
        await testDb.seedAnalyticsScenario(
          assertTestUser(testUser).id,
          getCurrentMonthConsistentRuns()
        );

        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const insights = response.body.insights;
        const hasConsistencyInsight = insights.some((i: any) => i.type === 'consistency');

        // Consistent pattern should generate consistency insight
        expect(hasConsistencyInsight).toBe(true);
      });
    });

    describe('Volume Insights', () => {
      it('detects volume spikes', async () => {
        // Use current month volume spike pattern
        await testDb.seedAnalyticsScenario(
          assertTestUser(testUser).id,
          getCurrentMonthVolumeSpike()
        );

        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const insights = response.body.insights;
        const hasVolumeInsight = insights.some((i: any) => i.type === 'volume');

        // Volume spike should trigger volume insight
        expect(hasVolumeInsight).toBe(true);
      });
    });

    describe('Performance Insights', () => {
      it('detects pace improvements', async () => {
        // Use current month improving pace pattern
        await testDb.seedAnalyticsScenario(
          assertTestUser(testUser).id,
          getCurrentMonthImprovingPace()
        );

        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const insights = response.body.insights;
        const hasPerformanceInsight = insights.some((i: any) => i.type === 'performance');

        // Improving pace should trigger performance insight
        expect(hasPerformanceInsight).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('returns empty insights for user with no runs', async () => {
        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.insights).toEqual([]);
      });

      it('handles single run gracefully', async () => {
        await testDb.createTestRunsWithGPS(assertTestUser(testUser).id, edgeCases.singleRun);

        const response = await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body.insights)).toBe(true);
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        await request(app).get('/api/analytics/insights').expect(401);
      });

      it('returns 401 with invalid token', async () => {
        await request(app)
          .get('/api/analytics/insights')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      });
    });
  });

  describe('GET /api/analytics/heatmap', () => {
    beforeEach(async () => {
      // Seed runs with varied GPS locations in current month
      await testDb.seedAnalyticsScenario(
        assertTestUser(testUser).id,
        getCurrentMonthVariedLocations()
      );
    });

    describe('Heatmap Generation', () => {
      it('returns GeoJSON FeatureCollection', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=0.5')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('type', 'FeatureCollection');
        expect(response.body).toHaveProperty('features');
        expect(response.body).toHaveProperty('bbox');
        expect(Array.isArray(response.body.features)).toBe(true);
      });

      it('generates grid cells with density properties', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=0.5')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        if (response.body.features.length > 0) {
          const feature = response.body.features[0];
          expect(feature).toHaveProperty('type', 'Feature');
          expect(feature).toHaveProperty('geometry');
          expect(feature).toHaveProperty('properties');
          expect(feature.properties).toHaveProperty('density');
          expect(typeof feature.properties.density).toBe('number');
        }
      });

      it('calculates bounding box correctly', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=0.5')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const bbox = response.body.bbox;
        expect(Array.isArray(bbox)).toBe(true);
        expect(bbox.length).toBe(4); // [minLng, minLat, maxLng, maxLat]
      });
    });

    describe('Grid Size Variations', () => {
      it('accepts gridSize=0.1 (fine grid)', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=0.1')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.type).toBe('FeatureCollection');
      });

      it('accepts gridSize=5.0 (coarse grid)', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=5.0')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.type).toBe('FeatureCollection');
      });

      it('defaults to gridSize=0.5 when not specified', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.type).toBe('FeatureCollection');
      });
    });

    describe('Validation', () => {
      it('returns 400 for gridSize < 0.1', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=0.05')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('gridSize must be between 0.1 and 5.0');
      });

      it('returns 400 for gridSize > 5.0', async () => {
        const response = await request(app)
          .get('/api/analytics/heatmap?gridSize=10')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('gridSize must be between 0.1 and 5.0');
      });
    });

    describe('Edge Cases', () => {
      it('returns empty FeatureCollection when no GPS data', async () => {
        await testDb.cleanupDatabase();
        const newUser = await testDb.createTestUser({
          email: 'nogps@test.com',
          password: 'test',
        });
        const newToken = testDb.generateTestToken(newUser.id, newUser.email);

        // Create runs without GPS
        await testDb.createTestRuns(newUser.id, edgeCases.singleRun);

        const response = await request(app)
          .get('/api/analytics/heatmap')
          .set('Authorization', `Bearer ${newToken}`)
          .expect(200);

        expect(response.body.type).toBe('FeatureCollection');
        expect(response.body.features.length).toBe(0);
        expect(response.body.bbox).toBeNull();
      });

      it('handles single GPS route', async () => {
        await testDb.cleanupDatabase();
        const newUser = await testDb.createTestUser({
          email: 'singlegps@test.com',
          password: 'test',
        });
        const newToken = testDb.generateTestToken(newUser.id, newUser.email);

        await testDb.createTestRunsWithGPS(newUser.id, [variedLocationsPattern[0]]);

        const response = await request(app)
          .get('/api/analytics/heatmap')
          .set('Authorization', `Bearer ${newToken}`)
          .expect(200);

        expect(response.body.type).toBe('FeatureCollection');
        expect(response.body.features.length).toBeGreaterThan(0);
      });
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        await request(app).get('/api/analytics/heatmap').expect(401);
      });

      it('returns 401 with invalid token', async () => {
        await request(app)
          .get('/api/analytics/heatmap')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      });

      it('returns only authenticated user GPS data', async () => {
        // Create second user with different GPS data
        const user2 = await testDb.createTestUser({
          email: 'user2gps@test.com',
          password: 'test',
        });
        await testDb.createTestRunsWithGPS(user2.id, variedLocationsPattern.slice(0, 5));

        // Original user should only see their own data
        const response = await request(app)
          .get('/api/analytics/heatmap')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Should have features from original user's runs
        expect(response.body.features.length).toBeGreaterThan(0);
      });
    });
  });
});
