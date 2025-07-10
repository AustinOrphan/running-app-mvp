import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import runsRoutes from '../../../server/routes/runs.js';
import { mockRuns } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/runs', runsRoutes);
  return app;
};

describe('Runs API Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser | undefined;
  let authToken: string;

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(async () => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'runs@test.com',
      password: 'testpassword',
    });

    authToken = testDb.generateTestToken(assertTestUser(testUser).id);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/runs', () => {
    it('returns all runs for authenticated user', async () => {
      // Create test runs
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 3));

      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3);

      response.body.forEach((run: any) => {
        expect(run).toHaveProperty('id');
        expect(run).toHaveProperty('date');
        expect(run).toHaveProperty('distance');
        expect(run).toHaveProperty('duration');
        expect(run).toHaveProperty('tag');
        expect(run).toHaveProperty('notes');
        expect(run).toHaveProperty('userId', assertTestUser(testUser).id);
      });
    });

    it('returns runs sorted by date (newest first)', async () => {
      const sortedRuns = [
        { ...mockRuns[0], date: '2024-06-10T06:00:00Z' },
        { ...mockRuns[1], date: '2024-06-08T06:00:00Z' },
        { ...mockRuns[2], date: '2024-06-05T06:00:00Z' },
      ];

      await testDb.createTestRuns(assertTestUser(testUser).id, sortedRuns);

      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);

      // Check dates are in descending order
      const dates = response.body.map((run: any) => new Date(run.date).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('returns empty array for user with no runs', async () => {
      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns only runs belonging to authenticated user', async () => {
      // Create another user with runs
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      await testDb.createTestRuns(otherUser.id, mockRuns.slice(0, 2));

      // Create runs for test user
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(2, 4));

      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      response.body.forEach((run: any) => {
        expect(run.userId).toBe(assertTestUser(testUser).id);
      });
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/runs').expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app).get('/api/runs').set('Authorization', 'Bearer invalid-token').expect(401);
    });
  });

  describe('GET /api/runs/:id', () => {
    let testRun: any;

    beforeEach(async () => {
      const runs = await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      testRun = runs[0];
    });

    it('returns specific run for authenticated user', async () => {
      const response = await request(app)
        .get(`/api/runs/${testRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', testRun.id);
      expect(response.body).toHaveProperty('distance', testRun.distance);
      expect(response.body).toHaveProperty('duration', testRun.duration);
      expect(response.body).toHaveProperty('tag', testRun.tag);
      expect(response.body).toHaveProperty('notes', testRun.notes);
      expect(response.body).toHaveProperty('userId', assertTestUser(testUser).id);
    });

    it('returns 404 for non-existent run', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .get(`/api/runs/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for run belonging to different user', async () => {
      // Create another user with a run
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherRuns = await testDb.createTestRuns(otherUser.id, [mockRuns[1]]);
      const otherRun = otherRuns[0];

      await request(app)
        .get(`/api/runs/${otherRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request(app).get(`/api/runs/${testRun.id}`).expect(401);
    });
  });

  describe('POST /api/runs', () => {
    const validRunData = {
      date: '2024-06-15T06:00:00Z',
      distance: 5.2,
      duration: 1860, // 31 minutes
      tag: 'Easy Run',
      notes: 'Morning run in the park',
    };

    it('creates new run for authenticated user', async () => {
      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validRunData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('date', validRunData.date);
      expect(response.body).toHaveProperty('distance', validRunData.distance);
      expect(response.body).toHaveProperty('duration', validRunData.duration);
      expect(response.body).toHaveProperty('tag', validRunData.tag);
      expect(response.body).toHaveProperty('notes', validRunData.notes);
      expect(response.body).toHaveProperty('userId', assertTestUser(testUser).id);

      // Verify run was created in database
      const createdRun = await testDb.prisma.run.findUnique({
        where: { id: response.body.id },
      });
      expect(createdRun).toBeTruthy();
      expect(createdRun?.userId).toBe(assertTestUser(testUser).id);
    });

    it('creates run with minimal required data', async () => {
      const minimalData = {
        date: '2024-06-15T06:00:00Z',
        distance: 3.0,
        duration: 1200,
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(minimalData)
        .expect(201);

      expect(response.body).toHaveProperty('distance', minimalData.distance);
      expect(response.body).toHaveProperty('duration', minimalData.duration);
      expect(response.body).toHaveProperty('tag', null);
      expect(response.body).toHaveProperty('notes', null);
    });

    it('returns 400 for missing required fields', async () => {
      const testCases = [
        { distance: 5.0, duration: 1800 }, // missing date
        { date: '2024-06-15T06:00:00Z', duration: 1800 }, // missing distance
        { date: '2024-06-15T06:00:00Z', distance: 5.0 }, // missing duration
      ];

      for (const testCase of testCases) {
        await request(app)
          .post('/api/runs')
          .set('Authorization', `Bearer ${authToken}`)
          .send(testCase)
          .expect(400);
      }
    });

    it('returns 400 for invalid data types', async () => {
      const invalidDataCases = [
        { ...validRunData, distance: 'not-a-number' },
        { ...validRunData, duration: 'not-a-number' },
        { ...validRunData, date: 'invalid-date' },
        { ...validRunData, distance: -1 }, // negative distance
        { ...validRunData, duration: -100 }, // negative duration
      ];

      for (const invalidData of invalidDataCases) {
        await request(app)
          .post('/api/runs')
          .set('Authorization', `Bearer ${authToken}`)
          .send(invalidData)
          .expect(400);
      }
    });

    it('handles large distance and duration values', async () => {
      const marathonData = {
        date: '2024-06-15T06:00:00Z',
        distance: 42.195, // marathon distance
        duration: 12600, // 3.5 hours
        tag: 'Marathon',
        notes: 'Boston Marathon',
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(marathonData)
        .expect(201);

      expect(response.body.distance).toBe(marathonData.distance);
      expect(response.body.duration).toBe(marathonData.duration);
    });

    it('returns 401 without authentication', async () => {
      await request(app).post('/api/runs').send(validRunData).expect(401);
    });
  });

  describe('PUT /api/runs/:id', () => {
    let testRun: any;
    const updateData = {
      distance: 8.5,
      duration: 2700,
      tag: 'Long Run',
      notes: 'Updated notes',
    };

    beforeEach(async () => {
      const runs = await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      testRun = runs[0];
    });

    it('updates existing run for authenticated user', async () => {
      const response = await request(app)
        .put(`/api/runs/${testRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('id', testRun.id);
      expect(response.body).toHaveProperty('distance', updateData.distance);
      expect(response.body).toHaveProperty('duration', updateData.duration);
      expect(response.body).toHaveProperty('tag', updateData.tag);
      expect(response.body).toHaveProperty('notes', updateData.notes);

      // Verify update in database
      const updatedRun = await testDb.prisma.run.findUnique({
        where: { id: testRun.id },
      });
      expect(updatedRun?.distance).toBe(updateData.distance);
      expect(updatedRun?.duration).toBe(updateData.duration);
    });

    it('updates partial data', async () => {
      const partialUpdate = {
        tag: 'Speed Work',
      };

      const response = await request(app)
        .put(`/api/runs/${testRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(partialUpdate)
        .expect(200);

      expect(response.body).toHaveProperty('tag', partialUpdate.tag);
      expect(response.body).toHaveProperty('distance', testRun.distance); // unchanged
      expect(response.body).toHaveProperty('duration', testRun.duration); // unchanged
    });

    it('returns 404 for non-existent run', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .put(`/api/runs/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);
    });

    it('returns 403 for run belonging to different user', async () => {
      // Create another user with a run
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherRuns = await testDb.createTestRuns(otherUser.id, [mockRuns[1]]);
      const otherRun = otherRuns[0];

      await request(app)
        .put(`/api/runs/${otherRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(403);
    });

    it('returns 400 for invalid update data', async () => {
      const invalidUpdates = [
        { distance: -5 },
        { duration: -100 },
        { distance: 'not-a-number' },
        { duration: 'not-a-number' },
      ];

      for (const invalidUpdate of invalidUpdates) {
        await request(app)
          .put(`/api/runs/${testRun.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send(invalidUpdate)
          .expect(400);
      }
    });

    it('returns 401 without authentication', async () => {
      await request(app).put(`/api/runs/${testRun.id}`).send(updateData).expect(401);
    });
  });

  describe('DELETE /api/runs/:id', () => {
    let testRun: any;

    beforeEach(async () => {
      const runs = await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      testRun = runs[0];
    });

    it('deletes existing run for authenticated user', async () => {
      await request(app)
        .delete(`/api/runs/${testRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify run was deleted from database
      const deletedRun = await testDb.prisma.run.findUnique({
        where: { id: testRun.id },
      });
      expect(deletedRun).toBeNull();
    });

    it('returns 404 for non-existent run', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .delete(`/api/runs/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for run belonging to different user', async () => {
      // Create another user with a run
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherRuns = await testDb.createTestRuns(otherUser.id, [mockRuns[1]]);
      const otherRun = otherRuns[0];

      await request(app)
        .delete(`/api/runs/${otherRun.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      // Verify run was not deleted
      const stillExists = await testDb.prisma.run.findUnique({
        where: { id: otherRun.id },
      });
      expect(stillExists).toBeTruthy();
    });

    it('returns 401 without authentication', async () => {
      await request(app).delete(`/api/runs/${testRun.id}`).expect(401);
    });
  });

  describe('Data Validation and Edge Cases', () => {
    it('handles very precise decimal values', async () => {
      const preciseData = {
        date: '2024-06-15T06:00:00Z',
        distance: 5.123456789,
        duration: 1234,
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(preciseData)
        .expect(201);

      expect(response.body.distance).toBe(preciseData.distance);
    });

    it('handles zero values correctly', async () => {
      const zeroData = {
        date: '2024-06-15T06:00:00Z',
        distance: 0,
        duration: 0,
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(zeroData)
        .expect(201);

      expect(response.body.distance).toBe(0);
      expect(response.body.duration).toBe(0);
    });

    it('handles maximum length strings for tag and notes', async () => {
      const longString = 'a'.repeat(1000);
      const longData = {
        date: '2024-06-15T06:00:00Z',
        distance: 5.0,
        duration: 1800,
        tag: longString,
        notes: longString,
      };

      await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(longData)
        .expect(201);
    });

    it('handles special characters in tag and notes', async () => {
      const specialData = {
        date: '2024-06-15T06:00:00Z',
        distance: 5.0,
        duration: 1800,
        tag: 'Easy Run 🏃‍♂️',
        notes: 'Great weather! 😊 Temperature: 20°C',
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(specialData)
        .expect(201);

      expect(response.body.tag).toBe(specialData.tag);
      expect(response.body.notes).toBe(specialData.notes);
    });
  });

  describe('Error Handling', () => {
    it('handles database errors gracefully', async () => {
      // Mock database error by disconnecting
      await testDb.prisma.$disconnect();

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          date: '2024-06-15T06:00:00Z',
          distance: 5.0,
          duration: 1800,
        })
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    it('handles malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });
});
