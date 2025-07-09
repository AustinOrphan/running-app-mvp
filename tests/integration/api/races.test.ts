import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import { mockRaces } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';
import racesRoutes from '../../../server/routes/races.js';

const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/races', racesRoutes);
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

  describe('POST /api/races', () => {
    const raceData = {
      name: 'Test Race',
      raceDate: '2024-12-01',
      distance: 10,
      targetTime: 3600,
      notes: 'Excited',
    };

    it('creates a race', async () => {
      const res = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(raceData)
        .expect(201);

      expect(res.body).toMatchObject({
        name: raceData.name,
        distance: raceData.distance,
        userId: assertTestUser(testUser).id,
      });
    });

    it('validates required fields', async () => {
      await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Bad Race' })
        .expect(400);
    });
  });

  describe('PUT /api/races/:id', () => {
    let race: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(assertTestUser(testUser).id, [mockRaces[0]]);
      race = races[0];
    });

    it('updates an existing race', async () => {
      const res = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Race' })
        .expect(200);

      expect(res.body.name).toBe('Updated Race');
    });

    it('returns 404 for unknown race', async () => {
      await request(app)
        .put('/api/races/nonexistent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Nope' })
        .expect(404);
    });
  });

  describe('DELETE /api/races/:id', () => {
    let race: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(assertTestUser(testUser).id, [mockRaces[0]]);
      race = races[0];
    });

    it('deletes race', async () => {
      await request(app)
        .delete(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      const remaining = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(remaining.body).toHaveLength(0);
    });
  });
});
