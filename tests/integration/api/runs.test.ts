import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';
import {
  expectErrorResponse,
  expectSuccessResponse,
  expectPaginatedResponse,
} from '../utils/responseHelpers.js';

describe('Runs API Integration Tests', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    // Create a properly configured test app
    app = createTestApp();
  });

  beforeEach(async () => {
    // Database cleanup is handled globally by jestSetup.ts afterEach
    // No manual cleanup needed here - this avoids redundant cleanup operations
  });

  describe('GET /api/runs', () => {
    it('returns all runs for authenticated user', async () => {
      // Create test user and runs
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create test runs with dynamic dates for independence
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      await Promise.all([
        testDb.prisma.run.create({
          data: {
            userId: user.id,
            date: twoDaysAgo,
            distance: 5.5,
            duration: 1800,
            notes: 'Morning run',
          },
        }),
        testDb.prisma.run.create({
          data: {
            userId: user.id,
            date: oneDayAgo,
            distance: 10.0,
            duration: 3600,
            notes: 'Long run',
          },
        }),
      ]);

      const response = await request(app).get('/api/runs').set('Authorization', `Bearer ${token}`);

      expectPaginatedResponse(response, ['id', 'distance', 'duration']);
      expect(response.body).toHaveLength(2);

      // Verify that all returned runs belong to the user
      // Don't assume specific ordering - instead verify content
      const runDistances = response.body
        .map((run: any) => run.distance)
        .sort((a: number, b: number) => a - b);
      expect(runDistances).toEqual([5.5, 10.0]);

      response.body.forEach((run: any) => {
        expect(run).toHaveProperty('id');
        expect(run).toHaveProperty('userId', user.id);
        expect([5.5, 10.0]).toContain(run.distance);
      });
    });

    it('returns empty array when user has no runs', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app).get('/api/runs').set('Authorization', `Bearer ${token}`);

      expectPaginatedResponse(response);
      expect(response.body).toEqual([]);
    });

    it('returns 401 without authentication', async () => {
      const response = await request(app).get('/api/runs');

      expectErrorResponse(response, 401);
    });

    it('only returns runs for the authenticated user', async () => {
      // Create two users with runs
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token1 = testDb.generateToken(user1.id, user1.email);

      // Create runs for both users with dynamic dates
      const testDate = new Date(new Date().getTime() - 1 * 24 * 60 * 60 * 1000); // Yesterday

      await testDb.prisma.run.create({
        data: {
          userId: user1.id,
          date: testDate,
          distance: 5.0,
          duration: 1800,
        },
      });

      await testDb.prisma.run.create({
        data: {
          userId: user2.id,
          date: testDate,
          distance: 10.0,
          duration: 3600,
        },
      });

      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('distance', 5.0);
    });
  });

  describe('POST /api/runs', () => {
    it('creates a new run', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const newRun = {
        date: '2024-01-15',
        distance: 7.5,
        duration: 2700,
        notes: 'Evening run in the park',
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .send(newRun);

      expectSuccessResponse(response, 201, ['id', 'distance', 'notes', 'userId']);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('distance', 7.5);
      expect(response.body).toHaveProperty('notes', 'Evening run in the park');
      expect(response.body).toHaveProperty('userId', user.id);

      // Verify it was saved to database
      const savedRun = await testDb.prisma.run.findUnique({
        where: { id: response.body.id },
      });
      expect(savedRun).toBeTruthy();
      expect(savedRun?.distance).toBe(7.5);
    });

    it('returns 400 for invalid data', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const invalidRun = {
        // Missing required fields
        notes: 'Invalid run',
      };

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .send(invalidRun)
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('returns 401 without authentication', async () => {
      const newRun = {
        date: '2024-01-15',
        distance: 5.0,
        duration: 1800,
      };

      const response = await request(app).post('/api/runs').send(newRun).expect(401);

      expect(response.body).toHaveProperty('error', true);
    });
  });

  describe('PUT /api/runs/:id', () => {
    it('updates an existing run', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a run to update
      const run = await testDb.prisma.run.create({
        data: {
          userId: user.id,
          date: new Date('2024-01-01'),
          distance: 5.0,
          duration: 1800,
          notes: 'Original notes',
        },
      });

      const updatedData = {
        distance: 6.0,
        duration: 2000,
        notes: 'Updated notes',
      };

      const response = await request(app)
        .put(`/api/runs/${run.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(updatedData)
        .expect(200);

      expect(response.body).toHaveProperty('id', run.id);
      expect(response.body).toHaveProperty('distance', 6.0);
      expect(response.body).toHaveProperty('notes', 'Updated notes');

      // Verify it was updated in database
      const updatedRun = await testDb.prisma.run.findUnique({
        where: { id: run.id },
      });
      expect(updatedRun?.distance).toBe(6.0);
      expect(updatedRun?.notes).toBe('Updated notes');
    });

    it('returns 404 for non-existent run', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .put('/api/runs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ distance: 10.0 })
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it("returns 403 when trying to update another user's run", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a run for user1
      const run = await testDb.prisma.run.create({
        data: {
          userId: user1.id,
          date: new Date('2024-01-01'),
          distance: 5.0,
          duration: 1800,
        },
      });

      const response = await request(app)
        .put(`/api/runs/${run.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ distance: 10.0 })
        .expect(403);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('permission');
    });
  });

  describe('DELETE /api/runs/:id', () => {
    it('deletes an existing run', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a run to delete
      const run = await testDb.prisma.run.create({
        data: {
          userId: user.id,
          date: new Date('2024-01-01'),
          distance: 5.0,
          duration: 1800,
        },
      });

      const response = await request(app)
        .delete(`/api/runs/${run.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(response.body).toEqual({});

      // Verify it was deleted from database
      const deletedRun = await testDb.prisma.run.findUnique({
        where: { id: run.id },
      });
      expect(deletedRun).toBeNull();
    });

    it('returns 404 for non-existent run', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .delete('/api/runs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
    });

    it("returns 403 when trying to delete another user's run", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a run for user1
      const run = await testDb.prisma.run.create({
        data: {
          userId: user1.id,
          date: new Date('2024-01-01'),
          distance: 5.0,
          duration: 1800,
        },
      });

      const response = await request(app)
        .delete(`/api/runs/${run.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('permission');
    });
  });
});
