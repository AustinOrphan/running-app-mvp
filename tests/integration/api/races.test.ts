import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';

describe('Races API Integration Tests', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    // Create a properly configured test app
    app = createTestApp();
  });

  beforeEach(async () => {
    // Database is already cleaned by jestSetup
    // Add any test-specific setup here
  });

  describe('GET /api/races', () => {
    it('returns races for authenticated user', async () => {
      // Create test user and races
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create test races
      const races = await Promise.all([
        testDb.prisma.race.create({
          data: {
            userId: user.id,
            name: 'Spring Marathon',
            raceDate: new Date('2024-05-01'),
            distance: 42.2,
            targetTime: 10800,
            notes: 'Big goal race',
          },
        }),
        testDb.prisma.race.create({
          data: {
            userId: user.id,
            name: 'Local 5K',
            raceDate: new Date('2024-06-15'),
            distance: 5.0,
            targetTime: 1200,
            actualTime: 1250,
            notes: 'Fun run',
          },
        }),
      ]);

      const response = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('distance');
    });

    it('returns empty array when no races', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('requires authentication', async () => {
      const response = await request(app).get('/api/races').expect(401);

      expect(response.body).toHaveProperty('error', true);
    });

    it('only returns races for the authenticated user', async () => {
      // Create two users with races
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token1 = testDb.generateToken(user1.id, user1.email);

      // Create races for both users
      await testDb.prisma.race.create({
        data: {
          userId: user1.id,
          name: 'User 1 Race',
          raceDate: new Date('2024-05-01'),
          distance: 10.0,
        },
      });

      await testDb.prisma.race.create({
        data: {
          userId: user2.id,
          name: 'User 2 Race',
          raceDate: new Date('2024-05-01'),
          distance: 21.1,
        },
      });

      const response = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('name', 'User 1 Race');
    });
  });

  describe('GET /api/races/:id', () => {
    it('returns specific race for authenticated user', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a race to retrieve
      const race = await testDb.prisma.race.create({
        data: {
          userId: user.id,
          name: 'Test Marathon',
          raceDate: new Date('2024-10-01'),
          distance: 42.2,
          targetTime: 10800,
          notes: 'My first marathon',
        },
      });

      const response = await request(app)
        .get(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: race.id,
        name: race.name,
        distance: race.distance,
        userId: user.id,
      });
    });

    it('returns 404 for non-existent race', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .get('/api/races/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('returns 400 for invalid race ID format', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      await request(app)
        .get('/api/races/invalid-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      const response = await request(app)
        .get('/api/races/00000000-0000-0000-0000-000000000000')
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
    });

    it("returns 404 when trying to access another user's race", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a race for user1
      const race = await testDb.prisma.race.create({
        data: {
          userId: user1.id,
          name: 'User 1 Race',
          raceDate: new Date('2024-05-01'),
          distance: 10.0,
        },
      });

      const response = await request(app)
        .get(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
    });
  });

  describe('POST /api/races', () => {
    it('creates a race with all fields', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const raceData = {
        name: 'Test Race',
        raceDate: '2024-12-01',
        distance: 10,
        targetTime: 3600,
        notes: 'Excited for this race',
      };

      const response = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${token}`)
        .send(raceData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', 'Test Race');
      expect(response.body).toHaveProperty('distance', 10);
      expect(response.body).toHaveProperty('targetTime', 3600);
      expect(response.body).toHaveProperty('notes', 'Excited for this race');
      expect(response.body).toHaveProperty('userId', user.id);

      // Verify it was saved to database
      const savedRace = await testDb.prisma.race.findUnique({
        where: { id: response.body.id },
      });
      expect(savedRace).toBeTruthy();
      expect(savedRace?.name).toBe('Test Race');
    });

    it('creates a race with minimal required fields', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const minimalData = {
        name: 'Minimal Race',
        raceDate: '2024-12-15',
        distance: 5,
      };

      const response = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${token}`)
        .send(minimalData)
        .expect(201);

      expect(response.body).toHaveProperty('name', 'Minimal Race');
      expect(response.body).toHaveProperty('distance', 5);
      expect(response.body).toHaveProperty('userId', user.id);
      expect(response.body.targetTime).toBeNull();
      expect(response.body.actualTime).toBeNull();
      expect(response.body.notes).toBeNull();
    });

    it('returns 400 for invalid data', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const invalidRace = {
        // Missing required fields
        name: 'Bad Race',
      };

      const response = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${token}`)
        .send(invalidRace)
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('validates positive distance', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const invalidData = {
        name: 'Invalid Race',
        raceDate: '2024-12-01',
        distance: -5,
      };

      const response = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${token}`)
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('requires authentication', async () => {
      const raceData = {
        name: 'Test Race',
        raceDate: '2024-12-01',
        distance: 10,
      };

      const response = await request(app).post('/api/races').send(raceData).expect(401);

      expect(response.body).toHaveProperty('error', true);
    });
  });

  describe('PUT /api/races/:id', () => {
    it('updates an existing race', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a race to update
      const race = await testDb.prisma.race.create({
        data: {
          userId: user.id,
          name: 'Original Race',
          raceDate: new Date('2024-01-01'),
          distance: 10.0,
          targetTime: 3600,
          notes: 'Original notes',
        },
      });

      const updatedData = {
        name: 'Updated Race',
        distance: 15.0,
        targetTime: 4000,
        notes: 'Updated notes',
      };

      const response = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(updatedData)
        .expect(200);

      expect(response.body).toHaveProperty('id', race.id);
      expect(response.body).toHaveProperty('name', 'Updated Race');
      expect(response.body).toHaveProperty('distance', 15.0);
      expect(response.body).toHaveProperty('targetTime', 4000);
      expect(response.body).toHaveProperty('notes', 'Updated notes');

      // Verify it was updated in database
      const updatedRace = await testDb.prisma.race.findUnique({
        where: { id: race.id },
      });
      expect(updatedRace?.name).toBe('Updated Race');
      expect(updatedRace?.distance).toBe(15.0);
    });

    it('returns 404 for non-existent race', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .put('/api/races/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated' })
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it("returns 404 when trying to update another user's race", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a race for user1
      const race = await testDb.prisma.race.create({
        data: {
          userId: user1.id,
          name: 'User 1 Race',
          raceDate: new Date('2024-05-01'),
          distance: 10.0,
        },
      });

      const response = await request(app)
        .put(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ name: 'Hacked' })
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
    });

    it('requires authentication', async () => {
      const response = await request(app)
        .put('/api/races/00000000-0000-0000-0000-000000000000')
        .send({ name: 'Should Fail' })
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
    });
  });

  describe('DELETE /api/races/:id', () => {
    it('deletes an existing race', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a race to delete
      const race = await testDb.prisma.race.create({
        data: {
          userId: user.id,
          name: 'Race to Delete',
          raceDate: new Date('2024-05-01'),
          distance: 10.0,
        },
      });

      const response = await request(app)
        .delete(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(response.body).toEqual({});

      // Verify it was deleted from database
      const deletedRace = await testDb.prisma.race.findUnique({
        where: { id: race.id },
      });
      expect(deletedRace).toBeNull();
    });

    it('returns 404 for non-existent race', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .delete('/api/races/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
    });

    it("returns 404 when trying to delete another user's race", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a race for user1
      const race = await testDb.prisma.race.create({
        data: {
          userId: user1.id,
          name: 'User 1 Race',
          raceDate: new Date('2024-05-01'),
          distance: 10.0,
        },
      });

      const response = await request(app)
        .delete(`/api/races/${race.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
    });

    it('requires authentication', async () => {
      const response = await request(app)
        .delete('/api/races/00000000-0000-0000-0000-000000000000')
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
    });
  });
});
