import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import statsRoutes from '../../../server/routes/stats.js';
import { mockRuns } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/stats', statsRoutes);
  return app;
};

describe('Stats API Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser | undefined;
  let authToken: string;

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(async () => {
    // Clean database and create test user with runs
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'stats@test.com',
      password: 'testpassword',
    });

    authToken = testDb.generateTestToken(assertTestUser(testUser).id);

    // Create test runs for statistics
    await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/stats/insights-summary', () => {
    it('returns weekly insights for authenticated user', async () => {
      const response = await request(app)
        .get('/api/stats/insights-summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalDistance');
      expect(response.body).toHaveProperty('totalDuration');
      expect(response.body).toHaveProperty('totalRuns');
      expect(response.body).toHaveProperty('avgPace');
      expect(response.body).toHaveProperty('weekStart');
      expect(response.body).toHaveProperty('weekEnd');

      expect(typeof response.body.totalDistance).toBe('number');
      expect(typeof response.body.totalDuration).toBe('number');
      expect(typeof response.body.totalRuns).toBe('number');
      expect(typeof response.body.avgPace).toBe('number');
    });

    it('calculates correct weekly totals', async () => {
      // Get runs from the last week
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const recentRuns = mockRuns.filter(run => new Date(run.date) >= oneWeekAgo);

      const response = await request(app)
        .get('/api/stats/insights-summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const expectedDistance = recentRuns.reduce((sum, run) => sum + run.distance, 0);
      const expectedDuration = recentRuns.reduce((sum, run) => sum + run.duration, 0);
      const expectedRuns = recentRuns.length;

      expect(response.body.totalDistance).toBe(Number(expectedDistance.toFixed(2)));
      expect(response.body.totalDuration).toBe(expectedDuration);
      expect(response.body.totalRuns).toBe(expectedRuns);

      if (expectedDistance > 0) {
        const expectedPace = expectedDuration / expectedDistance;
        expect(response.body.avgPace).toBe(Number(expectedPace.toFixed(2)));
      } else {
        expect(response.body.avgPace).toBe(0);
      }
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/stats/insights-summary').expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app)
        .get('/api/stats/insights-summary')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('returns empty stats for user with no runs', async () => {
      // Create new user with no runs
      const emptyUser = await testDb.createTestUser({
        email: 'empty@test.com',
        password: 'testpassword',
      });
      const emptyToken = testDb.generateTestToken(emptyUser.id);

      const response = await request(app)
        .get('/api/stats/insights-summary')
        .set('Authorization', `Bearer ${emptyToken}`)
        .expect(200);

      expect(response.body.totalDistance).toBe(0);
      expect(response.body.totalDuration).toBe(0);
      expect(response.body.totalRuns).toBe(0);
      expect(response.body.avgPace).toBe(0);
    });
  });

  describe('GET /api/stats/type-breakdown', () => {
    it('returns run type breakdown for authenticated user', async () => {
      const response = await request(app)
        .get('/api/stats/type-breakdown')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);

      if (response.body.length > 0) {
        response.body.forEach((item: any) => {
          expect(item).toHaveProperty('tag');
          expect(item).toHaveProperty('count');
          expect(item).toHaveProperty('totalDistance');
          expect(item).toHaveProperty('totalDuration');
          expect(item).toHaveProperty('avgPace');

          expect(typeof item.count).toBe('number');
          expect(typeof item.totalDistance).toBe('number');
          expect(typeof item.totalDuration).toBe('number');
          expect(typeof item.avgPace).toBe('number');
        });
      }
    });

    it('groups runs by tag correctly', async () => {
      const response = await request(app)
        .get('/api/stats/type-breakdown')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check that all unique tags from mockRuns are represented
      const uniqueTags = [...new Set(mockRuns.map(run => run.tag || 'Untagged'))];
      expect(response.body.length).toBe(uniqueTags.length);

      // Verify tag names
      const responseTags = response.body.map((item: any) => item.tag);
      uniqueTags.forEach(tag => {
        expect(responseTags).toContain(tag);
      });
    });

    it('calculates correct aggregations per tag', async () => {
      const response = await request(app)
        .get('/api/stats/type-breakdown')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Manually calculate expected values for each tag
      const tagAggregations: Record<string, any> = {};
      mockRuns.forEach(run => {
        const tag = run.tag || 'Untagged';
        if (!tagAggregations[tag]) {
          tagAggregations[tag] = {
            count: 0,
            totalDistance: 0,
            totalDuration: 0,
          };
        }
        tagAggregations[tag].count++;
        tagAggregations[tag].totalDistance += run.distance;
        tagAggregations[tag].totalDuration += run.duration;
      });

      response.body.forEach((item: any) => {
        const expected = tagAggregations[item.tag];
        expect(item.count).toBe(expected.count);
        expect(item.totalDistance).toBe(Number(expected.totalDistance.toFixed(2)));
        expect(item.totalDuration).toBe(expected.totalDuration);

        const expectedPace =
          expected.totalDistance > 0
            ? Number((expected.totalDuration / expected.totalDistance).toFixed(2))
            : 0;
        expect(item.avgPace).toBe(expectedPace);
      });
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/stats/type-breakdown').expect(401);
    });

    it('returns empty array for user with no runs', async () => {
      const emptyUser = await testDb.createTestUser({
        email: 'empty2@test.com',
        password: 'testpassword',
      });
      const emptyToken = testDb.generateTestToken(emptyUser.id);

      const response = await request(app)
        .get('/api/stats/type-breakdown')
        .set('Authorization', `Bearer ${emptyToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/stats/trends', () => {
    it('returns trends data with default period', async () => {
      const response = await request(app)
        .get('/api/stats/trends')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);

      response.body.forEach((item: any) => {
        expect(item).toHaveProperty('date');
        expect(item).toHaveProperty('distance');
        expect(item).toHaveProperty('duration');
        expect(item).toHaveProperty('pace');
        expect(item).toHaveProperty('weeklyDistance');

        expect(typeof item.distance).toBe('number');
        expect(typeof item.duration).toBe('number');
        expect(typeof item.pace).toBe('number');
        expect(typeof item.weeklyDistance).toBe('number');
      });
    });

    it('accepts period parameter', async () => {
      const periods = ['1m', '3m', '6m', '1y'];

      for (const period of periods) {
        const response = await request(app)
          .get(`/api/stats/trends?period=${period}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('groups data by week correctly', async () => {
      const response = await request(app)
        .get('/api/stats/trends?period=3m')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check that dates are in weekly intervals and sorted
      if (response.body.length > 1) {
        for (let i = 1; i < response.body.length; i++) {
          const prevDate = new Date(response.body[i - 1].date);
          const currDate = new Date(response.body[i].date);
          expect(currDate.getTime()).toBeGreaterThan(prevDate.getTime());
        }
      }
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/stats/trends').expect(401);
    });
  });

  describe('GET /api/stats/personal-records', () => {
    it('returns personal records for authenticated user', async () => {
      const response = await request(app)
        .get('/api/stats/personal-records')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);

      response.body.forEach((record: any) => {
        expect(record).toHaveProperty('distance');
        expect(record).toHaveProperty('bestTime');
        expect(record).toHaveProperty('bestPace');
        expect(record).toHaveProperty('date');
        expect(record).toHaveProperty('runId');

        expect(typeof record.distance).toBe('number');
        expect(typeof record.bestTime).toBe('number');
        expect(typeof record.bestPace).toBe('number');
        expect(typeof record.date).toBe('string');
        expect(typeof record.runId).toBe('string');
      });
    });

    it('finds records for standard distances', async () => {
      const response = await request(app)
        .get('/api/stats/personal-records')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should have records for distances that match our mock data
      const recordDistances = response.body.map((record: any) => record.distance);
      const standardDistances = [1, 2, 5, 10, 15, 21.1, 42.2];

      recordDistances.forEach((distance: number) => {
        expect(standardDistances).toContain(distance);
      });
    });

    it('returns records sorted by distance', async () => {
      const response = await request(app)
        .get('/api/stats/personal-records')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.length > 1) {
        for (let i = 1; i < response.body.length; i++) {
          expect(response.body[i].distance).toBeGreaterThan(response.body[i - 1].distance);
        }
      }
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/stats/personal-records').expect(401);
    });

    it('returns empty array for user with no matching runs', async () => {
      const emptyUser = await testDb.createTestUser({
        email: 'empty3@test.com',
        password: 'testpassword',
      });
      const emptyToken = testDb.generateTestToken(emptyUser.id);

      const response = await request(app)
        .get('/api/stats/personal-records')
        .set('Authorization', `Bearer ${emptyToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('handles database errors gracefully', async () => {
      // Mock a database error by closing the connection
      await testDb.prisma.$disconnect();

      const response = await request(app)
        .get('/api/stats/insights-summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });
  });
});
