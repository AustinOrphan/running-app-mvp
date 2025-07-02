import request from 'supertest';

import { app } from '../../../server.js';
import { mockRaces } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';

describe('Races API Integration Tests', () => {
  let testUser: any;
  let authToken: string;

  beforeEach(async () => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'races@test.com',
      password: 'testpassword123',
    });
    authToken = testDb.generateTestToken(testUser.id);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/races', () => {
    it('returns empty races list for new user', async () => {
      const response = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns user races when they exist', async () => {
      // Create test races
      await testDb.createTestRaces(testUser.id, mockRaces.slice(0, 3));

      const response = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        date: expect.any(String),
        distance: expect.any(Number),
        location: expect.any(String),
        registrationUrl: expect.stringMatching(/^https?:\/\//),
        isRegistered: expect.any(Boolean),
        goalTime: expect.any(Number),
        actualTime: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app).get('/api/races').expect(401);
    });

    it('returns 401 for invalid token', async () => {
      await request(app).get('/api/races').set('Authorization', 'Bearer invalid-token').expect(401);
    });

    it('filters races by registration status', async () => {
      // Create mix of registered and unregistered races
      const races = mockRaces.slice(0, 4);
      races[0].isRegistered = true;
      races[1].isRegistered = false;
      races[2].isRegistered = true;
      races[3].isRegistered = false;

      await testDb.createTestRaces(testUser.id, races);

      // Get only registered races
      const registeredResponse = await request(app)
        .get('/api/races?status=registered')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(registeredResponse.body).toHaveLength(2);
      expect(registeredResponse.body.every((race: any) => race.isRegistered)).toBe(true);

      // Get only unregistered races
      const unregisteredResponse = await request(app)
        .get('/api/races?status=unregistered')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(unregisteredResponse.body).toHaveLength(2);
      expect(unregisteredResponse.body.every((race: any) => !race.isRegistered)).toBe(true);
    });

    it('filters races by upcoming/past dates', async () => {
      // Create races with different dates
      const pastRace = { ...mockRaces[0], date: '2023-06-01' };
      const futureRace = { ...mockRaces[1], date: '2025-06-01' };

      await testDb.createTestRaces(testUser.id, [pastRace, futureRace]);

      // Get only upcoming races
      const upcomingResponse = await request(app)
        .get('/api/races?timeframe=upcoming')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(upcomingResponse.body).toHaveLength(1);
      expect(new Date(upcomingResponse.body[0].date).getTime()).toBeGreaterThan(Date.now());

      // Get only past races
      const pastResponse = await request(app)
        .get('/api/races?timeframe=past')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(pastResponse.body).toHaveLength(1);
      expect(new Date(pastResponse.body[0].date).getTime()).toBeLessThan(Date.now());
    });
  });

  describe('POST /api/races', () => {
    it('creates a new race successfully', async () => {
      const newRace = {
        name: '10K Spring Race',
        date: '2024-08-15',
        distance: 10,
        location: 'Central Park, NY',
        registrationUrl: 'https://example.com/register',
        goalTime: 2700, // 45 minutes
      };

      const response = await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newRace)
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(Number),
        name: newRace.name,
        date: expect.stringContaining('2024-08-15'),
        distance: newRace.distance,
        location: newRace.location,
        registrationUrl: newRace.registrationUrl,
        goalTime: newRace.goalTime,
        isRegistered: false,
        actualTime: null,
        userId: testUser.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('returns 400 for missing required fields', async () => {
      const incompleteRace = {
        name: 'Incomplete Race',
        // Missing required fields
      };

      await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(incompleteRace)
        .expect(400);
    });

    it('returns 400 for invalid distance', async () => {
      const invalidRace = {
        name: 'Invalid Race',
        date: '2024-08-15',
        distance: -5, // Invalid negative distance
        location: 'Test Location',
        registrationUrl: 'https://example.com/register',
      };

      await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRace)
        .expect(400);
    });

    it('returns 400 for invalid date format', async () => {
      const invalidRace = {
        name: 'Invalid Date Race',
        date: 'invalid-date',
        distance: 10,
        location: 'Test Location',
        registrationUrl: 'https://example.com/register',
      };

      await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRace)
        .expect(400);
    });

    it('returns 400 for invalid registration URL', async () => {
      const invalidRace = {
        name: 'Invalid URL Race',
        date: '2024-08-15',
        distance: 10,
        location: 'Test Location',
        registrationUrl: 'not-a-valid-url',
      };

      await request(app)
        .post('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRace)
        .expect(400);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const newRace = {
        name: 'Test Race',
        date: '2024-08-15',
        distance: 10,
        location: 'Test Location',
        registrationUrl: 'https://example.com/register',
      };

      await request(app).post('/api/races').send(newRace).expect(401);
    });
  });

  describe('PUT /api/races/:id', () => {
    let testRace: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(testUser.id, [mockRaces[0]]);
      testRace = races[0];
    });

    it('updates a race successfully', async () => {
      const updatedData = {
        name: 'Updated Race Name',
        location: 'Updated Location',
        goalTime: 3000,
        isRegistered: true,
      };

      const response = await request(app)
        .put(`/api/races/${testRace.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updatedData)
        .expect(200);

      expect(response.body).toMatchObject({
        id: testRace.id,
        name: updatedData.name,
        location: updatedData.location,
        goalTime: updatedData.goalTime,
        isRegistered: updatedData.isRegistered,
        updatedAt: expect.any(String),
      });
    });

    it('updates race with actual time after completion', async () => {
      const actualTimeData = {
        actualTime: 2850, // 47.5 minutes
        isRegistered: true,
      };

      const response = await request(app)
        .put(`/api/races/${testRace.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(actualTimeData)
        .expect(200);

      expect(response.body.actualTime).toBe(actualTimeData.actualTime);
      expect(response.body.isRegistered).toBe(true);
    });

    it('returns 404 for non-existent race', async () => {
      const nonExistentId = 99999;

      await request(app)
        .put(`/api/races/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Name' })
        .expect(404);
    });

    it('returns 403 for race owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123',
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .put(`/api/races/${testRace.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Unauthorized Update' })
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app)
        .put(`/api/races/${testRace.id}`)
        .send({ name: 'Updated Name' })
        .expect(401);
    });

    it('returns 400 for invalid update data', async () => {
      const invalidData = {
        distance: -10, // Invalid negative distance
      };

      await request(app)
        .put(`/api/races/${testRace.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });
  });

  describe('DELETE /api/races/:id', () => {
    let testRace: any;

    beforeEach(async () => {
      const races = await testDb.createTestRaces(testUser.id, [mockRaces[0]]);
      testRace = races[0];
    });

    it('deletes a race successfully', async () => {
      await request(app)
        .delete(`/api/races/${testRace.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify race is deleted
      const response = await request(app)
        .get('/api/races')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('returns 404 for non-existent race', async () => {
      const nonExistentId = 99999;

      await request(app)
        .delete(`/api/races/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for race owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123',
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .delete(`/api/races/${testRace.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app).delete(`/api/races/${testRace.id}`).expect(401);
    });
  });

  describe('GET /api/races/:id/analytics', () => {
    let testRace: any;

    beforeEach(async () => {
      const raceWithTime = { ...mockRaces[0], actualTime: 2850, goalTime: 3000 };
      const races = await testDb.createTestRaces(testUser.id, [raceWithTime]);
      testRace = races[0];
    });

    it('returns race analytics successfully', async () => {
      const response = await request(app)
        .get(`/api/races/${testRace.id}/analytics`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        raceId: testRace.id,
        goalTime: testRace.goalTime,
        actualTime: testRace.actualTime,
        timeDifference: expect.any(Number),
        goalAchieved: expect.any(Boolean),
        paceAnalysis: expect.objectContaining({
          averagePace: expect.any(Number),
          goalPace: expect.any(Number),
          paceComparison: expect.any(String),
        }),
      });
    });

    it('calculates time difference correctly', async () => {
      const response = await request(app)
        .get(`/api/races/${testRace.id}/analytics`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const expectedDifference = testRace.actualTime - testRace.goalTime;
      expect(response.body.timeDifference).toBe(expectedDifference);
      expect(response.body.goalAchieved).toBe(expectedDifference <= 0);
    });

    it('returns 404 for race without actual time', async () => {
      const raceWithoutTime = { ...mockRaces[1], actualTime: undefined };
      const races = await testDb.createTestRaces(testUser.id, [raceWithoutTime]);
      const incompleteRace = races[0];

      await request(app)
        .get(`/api/races/${incompleteRace.id}/analytics`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('returns 404 for non-existent race', async () => {
      const nonExistentId = 99999;

      await request(app)
        .get(`/api/races/${nonExistentId}/analytics`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for race owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123',
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .get(`/api/races/${testRace.id}/analytics`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app).get(`/api/races/${testRace.id}/analytics`).expect(401);
    });
  });

  describe('POST /api/races/:id/register', () => {
    let testRace: any;

    beforeEach(async () => {
      const unregisteredRace = { ...mockRaces[0], isRegistered: false };
      const races = await testDb.createTestRaces(testUser.id, [unregisteredRace]);
      testRace = races[0];
    });

    it('registers for race successfully', async () => {
      const response = await request(app)
        .post(`/api/races/${testRace.id}/register`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.isRegistered).toBe(true);
      expect(response.body.updatedAt).not.toBe(testRace.updatedAt);
    });

    it('returns 400 if already registered', async () => {
      // First registration
      await request(app)
        .post(`/api/races/${testRace.id}/register`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Second registration attempt
      await request(app)
        .post(`/api/races/${testRace.id}/register`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('returns 404 for non-existent race', async () => {
      const nonExistentId = 99999;

      await request(app)
        .post(`/api/races/${nonExistentId}/register`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for race owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123',
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .post(`/api/races/${testRace.id}/register`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app).post(`/api/races/${testRace.id}/register`).expect(401);
    });
  });

  describe('POST /api/races/:id/unregister', () => {
    let testRace: any;

    beforeEach(async () => {
      const registeredRace = { ...mockRaces[0], isRegistered: true };
      const races = await testDb.createTestRaces(testUser.id, [registeredRace]);
      testRace = races[0];
    });

    it('unregisters from race successfully', async () => {
      const response = await request(app)
        .post(`/api/races/${testRace.id}/unregister`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.isRegistered).toBe(false);
      expect(response.body.updatedAt).not.toBe(testRace.updatedAt);
    });

    it('returns 400 if not registered', async () => {
      // First unregistration
      await request(app)
        .post(`/api/races/${testRace.id}/unregister`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Second unregistration attempt
      await request(app)
        .post(`/api/races/${testRace.id}/unregister`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('returns 404 for non-existent race', async () => {
      const nonExistentId = 99999;

      await request(app)
        .post(`/api/races/${nonExistentId}/unregister`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for race owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123',
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .post(`/api/races/${testRace.id}/unregister`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app).post(`/api/races/${testRace.id}/unregister`).expect(401);
    });
  });
});
