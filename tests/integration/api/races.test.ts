import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import { mockRaces } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';
import racesRoutes from '../../../server/routes/races.js';
import { errorHandler } from '../../../server/middleware/errorHandler.js';

const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/races', racesRoutes);
  app.use(errorHandler);
  return app;
};

describe('Races API Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser | undefined;
  let authToken: string;

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'races@test.com',
      password: 'testpassword',
    });

    authToken = testDb.generateTestToken(assertTestUser(testUser).id);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/races', () => {
    it('returns races for authenticated user', async () => {
      await testDb.createTestRaces(assertTestUser(testUser).id, mockRaces);

      const res = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveLength(mockRaces.length);
      expect(res.body[0]).toHaveProperty('name');
    });

    it('returns empty array when no races', async () => {
      const res = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('requires authentication', async () => {
      await request(app).get('/api/races').expect(401);
    });
  });

  describe('GET /api/races/:id', () => {
    let race: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(assertTestUser(testUser).id, [mockRaces[0]]);
      race = races[0];
    });

    it('returns specific race for authenticated user', async () => {
      const res = await request(app)
        .get(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: race.id,
        name: race.name,
        distance: race.distance,
        userId: assertTestUser(testUser).id,
      });
    });

    it('returns 404 for non-existent race', async () => {
      const res = await request(app)
        .get('/api/races/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body.message).toBe('Race not found');
    });

    it('returns 400 for invalid race ID format', async () => {
      await request(app)
        .get('/api/races/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app)
        .get(`/api/races/${race.id}`)
        .expect(401);
    });

    it('prevents access to other users races', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'testpassword',
      });
      const otherAuthToken = testDb.generateTestToken(otherUser.id);
      
      // Try to access the first user's race with the second user's token
      await request(app)
        .get(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(404); // Should return 404, not 403, because the race "doesn't exist" for this user
    });
  });

  describe('POST /api/races', () => {
    const raceData = {
      name: 'Test Race',
      raceDate: '2024-12-01',
      distance: 10,
      targetTime: 3600,
      notes: 'Excited',
    };

    it('creates a race with all fields', async () => {
      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(raceData)
        .expect(201);

      expect(res.body).toMatchObject({
        name: raceData.name,
        distance: raceData.distance,
        targetTime: raceData.targetTime,
        notes: raceData.notes,
        userId: assertTestUser(testUser).id,
      });
      expect(res.body.id).toBeDefined();
      expect(new Date(res.body.raceDate)).toEqual(new Date(raceData.raceDate));
    });

    it('creates a race with minimal required fields', async () => {
      const minimalData = {
        name: 'Minimal Race',
        raceDate: '2024-12-15',
        distance: 5,
      };

      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(minimalData)
        .expect(201);

      expect(res.body).toMatchObject({
        name: minimalData.name,
        distance: minimalData.distance,
        userId: assertTestUser(testUser).id,
      });
      expect(res.body.targetTime).toBeNull();
      expect(res.body.actualTime).toBeNull();
      expect(res.body.notes).toBeNull();
    });

    it('validates required fields', async () => {
      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Bad Race' })
        .expect(400);

      expect(res.body.message).toContain('Validation failed');
      expect(res.body.message).toContain('raceDate: Required');
      expect(res.body.message).toContain('distance: Required');
    });

    it('validates positive distance', async () => {
      const invalidData = {
        name: 'Invalid Race',
        raceDate: '2024-12-01',
        distance: -5,
      };

      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);

      expect(res.body.message).toContain('Must be a positive number');
    });

    it('validates date format', async () => {
      const invalidData = {
        name: 'Invalid Date Race',
        raceDate: 'not-a-date',
        distance: 10,
      };

      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);

      expect(res.body.message).toContain('Invalid date format');
    });

    it('validates name length', async () => {
      const longName = 'a'.repeat(101); // Exceeds 100 character limit
      const invalidData = {
        name: longName,
        raceDate: '2024-12-01',
        distance: 10,
      };

      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);

      expect(res.body.message).toContain('Name must be 100 characters or less');
    });

    it('trims whitespace from name', async () => {
      const dataWithWhitespace = {
        name: '  Whitespace Race  ',
        raceDate: '2024-12-01',
        distance: 10,
      };

      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dataWithWhitespace)
        .expect(201);

      expect(res.body.name).toBe('Whitespace Race');
    });

    it('requires authentication', async () => {
      await request(app)
        .post('/api/races')
        .send(raceData)
        .expect(401);
    });
  });

  describe('PUT /api/races/:id', () => {
    let race: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(assertTestUser(testUser).id, [mockRaces[0]]);
      race = races[0];
    });

    it('updates an existing race with single field', async () => {
      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Race' })
        .expect(200);

      expect(res.body.name).toBe('Updated Race');
      // Other fields should remain unchanged
      expect(res.body.distance).toBe(race.distance);
      expect(res.body.targetTime).toBe(race.targetTime);
    });

    it('updates race with multiple fields', async () => {
      const updateData = {
        name: 'Completely Updated Race',
        distance: 42.2,
        targetTime: 7200,
        actualTime: 7000,
        notes: 'Great race!',
      };

      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(res.body).toMatchObject({
        id: race.id,
        name: updateData.name,
        distance: updateData.distance,
        targetTime: updateData.targetTime,
        actualTime: updateData.actualTime,
        notes: updateData.notes,
        userId: assertTestUser(testUser).id,
      });
    });

    it('updates race date', async () => {
      const newDate = '2025-01-15';
      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ raceDate: newDate })
        .expect(200);

      expect(new Date(res.body.raceDate)).toEqual(new Date(newDate));
    });

    it('allows partial updates', async () => {
      const originalName = race.name;
      
      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ distance: 15.5 })
        .expect(200);

      expect(res.body.distance).toBe(15.5);
      expect(res.body.name).toBe(originalName); // Should remain unchanged
    });

    it('validates updated fields', async () => {
      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ distance: -10 })
        .expect(400);

      expect(res.body.message).toContain('Must be a positive number');
    });

    it('validates invalid race ID format', async () => {
      await request(app)
        .put('/api/races/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Should Fail' })
        .expect(400);
    });

    it('returns 404 for unknown race', async () => {
      const res = await request(app)
        .put('/api/races/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Nope' })
        .expect(404);

      expect(res.body.message).toBe('Race not found');
    });

    it('prevents updating other users races', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'testpassword',
      });
      const otherAuthToken = testDb.generateTestToken(otherUser.id);
      
      // Try to update the first user's race with the second user's token
      await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .send({ name: 'Unauthorized Update' })
        .expect(404); // Should return 404 because the race "doesn't exist" for this user
    });

    it('requires authentication', async () => {
      await request(app)
        .put(`/api/races/${race.id}`)
        .send({ name: 'Should Fail' })
        .expect(401);
    });

    it('trims whitespace from updated name', async () => {
      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '  Trimmed Name  ' })
        .expect(200);

      expect(res.body.name).toBe('Trimmed Name');
    });
  });

  describe('DELETE /api/races/:id', () => {
    let race: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(assertTestUser(testUser).id, [mockRaces[0]]);
      race = races[0];
    });

    it('deletes race successfully', async () => {
      await request(app)
        .delete(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify race is deleted
      const remaining = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(remaining.body).toHaveLength(0);
    });

    it('returns 404 when trying to delete non-existent race', async () => {
      const res = await request(app)
        .delete('/api/races/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body.message).toBe('Race not found');
    });

    it('validates race ID format', async () => {
      await request(app)
        .delete('/api/races/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('prevents deleting other users races', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'testpassword',
      });
      const otherAuthToken = testDb.generateTestToken(otherUser.id);
      
      // Try to delete the first user's race with the second user's token
      await request(app)
        .delete(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(404); // Should return 404 because the race "doesn't exist" for this user
    });

    it('requires authentication', async () => {
      await request(app)
        .delete(`/api/races/${race.id}`)
        .expect(401);
    });

    it('handles multiple races correctly', async () => {
      // Create additional races
      const additionalRaces = await testDb.createTestRaces(
        assertTestUser(testUser).id, 
        [mockRaces[1]] // Use second mock race
      );
      
      // Delete the first race
      await request(app)
        .delete(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify only the correct race was deleted
      const remaining = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(remaining.body).toHaveLength(1);
      expect(remaining.body[0].id).toBe(additionalRaces[0].id);
    });
  });
});
