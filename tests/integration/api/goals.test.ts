import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import goalsRoutes from '../../../server/routes/goals.js';
import { mockGoals, createMockGoal, mockRuns } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/goals', goalsRoutes);
  return app;
};

describe('Goals API Integration Tests', () => {
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
      email: 'goals@test.com',
      password: 'testpassword',
    });


    authToken = testDb.generateTestToken(assertTestUser(testUser).id);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/goals', () => {
    it('returns all active goals for authenticated user', async () => {
      // Create test goals
      await testDb.createTestGoals(assertTestUser(testUser).id, mockGoals.slice(0, 3));

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3);

      response.body.forEach((goal: any) => {
        expect(goal).toHaveProperty('id');
        expect(goal).toHaveProperty('title');
        expect(goal).toHaveProperty('type');
        expect(goal).toHaveProperty('targetValue');
        expect(goal).toHaveProperty('period');
        expect(goal).toHaveProperty('startDate');
        expect(goal).toHaveProperty('endDate');
        expect(goal).toHaveProperty('userId', assertTestUser(testUser).id);
        expect(goal).toHaveProperty('isActive', true);
      });
    });

    it('returns goals sorted by completion status and creation date', async () => {
      const completedGoal = createMockGoal({
        title: 'Completed Goal',
        isCompleted: true,
        completedAt: new Date(),
      });
      const activeGoal1 = createMockGoal({ title: 'Active Goal 1' });
      const activeGoal2 = createMockGoal({ title: 'Active Goal 2' });

      await testDb.createTestGoals(assertTestUser(testUser).id, [
        completedGoal,
        activeGoal1,
        activeGoal2,
      ]);

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);

      // Active goals should come first
      const activeGoals = response.body.filter((g: any) => !g.isCompleted);
      const completedGoals = response.body.filter((g: any) => g.isCompleted);

      expect(activeGoals).toHaveLength(2);
      expect(completedGoals).toHaveLength(1);

      // Check that active goals appear before completed ones
      const firstActiveIndex = response.body.findIndex((g: any) => !g.isCompleted);
      const firstCompletedIndex = response.body.findIndex((g: any) => g.isCompleted);
      expect(firstActiveIndex).toBeLessThan(firstCompletedIndex);
    });

    it('returns empty array for user with no goals', async () => {
      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns only goals belonging to authenticated user', async () => {
      // Create another user with goals
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      await testDb.createTestGoals(otherUser.id, mockGoals.slice(0, 2));

      // Create goals for test user
      await testDb.createTestGoals(assertTestUser(testUser).id, mockGoals.slice(2, 4));

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      response.body.forEach((goal: any) => {
        expect(goal.userId).toBe(assertTestUser(testUser).id);
      });
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/goals').expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app).get('/api/goals').set('Authorization', 'Bearer invalid-token').expect(401);
    });
  });

  describe('GET /api/goals/:id', () => {
    let testGoal: any;

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(assertTestUser(testUser).id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('returns specific goal for authenticated user', async () => {
      const response = await request(app)
        .get(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', testGoal.id);
      expect(response.body).toHaveProperty('title', testGoal.title);
      expect(response.body).toHaveProperty('type', testGoal.type);
      expect(response.body).toHaveProperty('targetValue', testGoal.targetValue);
      expect(response.body).toHaveProperty('userId', assertTestUser(testUser).id);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .get(`/api/goals/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for goal belonging to different user', async () => {
      // Create another user with a goal
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherGoals = await testDb.createTestGoals(otherUser.id, [mockGoals[1]]);
      const otherGoal = otherGoals[0];

      await request(app)
        .get(`/api/goals/${otherGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request(app).get(`/api/goals/${testGoal.id}`).expect(401);
    });
  });

  describe('POST /api/goals', () => {
    const validGoalData = {
      title: 'Run 20km this week',
      description: 'Weekly distance goal for training',
      type: 'DISTANCE',
      targetValue: 20,
      targetUnit: 'km',
      period: 'WEEKLY',
      startDate: '2024-06-17',
      endDate: '2024-06-23',
      color: '#3b82f6',
      icon: '🏃‍♂️',
    };

    it('creates new goal for authenticated user', async () => {
      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validGoalData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title', validGoalData.title);
      expect(response.body).toHaveProperty('type', validGoalData.type);
      expect(response.body).toHaveProperty('targetValue', validGoalData.targetValue);
      expect(response.body).toHaveProperty('period', validGoalData.period);
      expect(response.body).toHaveProperty('userId', assertTestUser(testUser).id);
      expect(response.body).toHaveProperty('isActive', true);
      expect(response.body).toHaveProperty('isCompleted', false);

      // Verify goal was created in database
      const createdGoal = await testDb.prisma.goal.findUnique({
        where: { id: response.body.id },
      });
      expect(createdGoal).toBeTruthy();
      expect(createdGoal?.userId).toBe(assertTestUser(testUser).id);
    });

    it('creates goal with minimal required data', async () => {
      const minimalData = {
        title: 'Simple Goal',
        type: 'FREQUENCY',
        targetValue: 3,
        targetUnit: 'runs',
        period: 'WEEKLY',
        startDate: '2024-06-17',
        endDate: '2024-06-23',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(minimalData)
        .expect(201);

      expect(response.body).toHaveProperty('title', minimalData.title);
      expect(response.body).toHaveProperty('description', null);
      expect(response.body).toHaveProperty('color', null);
      expect(response.body).toHaveProperty('icon', null);
    });

    it('returns 400 for missing required fields', async () => {
      const testCases = [
        { ...validGoalData, title: undefined }, // missing title
        { ...validGoalData, type: undefined }, // missing type
        { ...validGoalData, targetValue: undefined }, // missing targetValue
        { ...validGoalData, targetUnit: undefined }, // missing targetUnit
        { ...validGoalData, period: undefined }, // missing period
        { ...validGoalData, startDate: undefined }, // missing startDate
        { ...validGoalData, endDate: undefined }, // missing endDate
      ];

      for (const testCase of testCases) {
        await request(app)
          .post('/api/goals')
          .set('Authorization', `Bearer ${authToken}`)
          .send(testCase)
          .expect(400);
      }
    });

    it('returns 400 for invalid goal types', async () => {
      const invalidTypeData = {
        ...validGoalData,
        type: 'INVALID_TYPE',
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidTypeData)
        .expect(400);
    });

    it('returns 400 for invalid goal periods', async () => {
      const invalidPeriodData = {
        ...validGoalData,
        period: 'INVALID_PERIOD',
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidPeriodData)
        .expect(400);
    });

    it('returns 400 for invalid date range', async () => {
      const invalidDateData = {
        ...validGoalData,
        startDate: '2024-06-23',
        endDate: '2024-06-17', // end before start
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidDateData)
        .expect(400);
    });

    it('returns 400 for negative target value', async () => {
      const negativeValueData = {
        ...validGoalData,
        targetValue: -5,
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(negativeValueData)
        .expect(400);
    });

    it('returns 400 for zero target value', async () => {
      const zeroValueData = {
        ...validGoalData,
        targetValue: 0,
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(zeroValueData)
        .expect(400);
    });

    it('returns 401 without authentication', async () => {
      await request(app).post('/api/goals').send(validGoalData).expect(401);
    });
  });

  describe('PUT /api/goals/:id', () => {
    let testGoal: any;
    const updateData = {
      title: 'Updated Goal Title',
      description: 'Updated description',
      targetValue: 25,
      color: '#ef4444',
    };

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(assertTestUser(testUser).id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('updates existing goal for authenticated user', async () => {
      const response = await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('id', testGoal.id);
      expect(response.body).toHaveProperty('title', updateData.title);
      expect(response.body).toHaveProperty('description', updateData.description);
      expect(response.body).toHaveProperty('targetValue', updateData.targetValue);
      expect(response.body).toHaveProperty('color', updateData.color);

      // Verify update in database
      const updatedGoal = await testDb.prisma.goal.findUnique({
        where: { id: testGoal.id },
      });
      expect(updatedGoal?.title).toBe(updateData.title);
      expect(updatedGoal?.targetValue).toBe(updateData.targetValue);
    });

    it('updates partial data', async () => {
      const partialUpdate = {
        title: 'New Title Only',
      };

      const response = await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(partialUpdate)
        .expect(200);

      expect(response.body).toHaveProperty('title', partialUpdate.title);
      expect(response.body).toHaveProperty('targetValue', testGoal.targetValue); // unchanged
      expect(response.body).toHaveProperty('type', testGoal.type); // unchanged
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .put(`/api/goals/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);
    });

    it('returns 403 for goal belonging to different user', async () => {
      // Create another user with a goal
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherGoals = await testDb.createTestGoals(otherUser.id, [mockGoals[1]]);
      const otherGoal = otherGoals[0];

      await request(app)
        .put(`/api/goals/${otherGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(403);
    });

    it('returns 400 for invalid update data', async () => {
      const invalidUpdates = [
        { targetValue: -5 }, // negative value
        { targetValue: 0 }, // zero value
        { type: 'INVALID_TYPE' }, // invalid type
        { period: 'INVALID_PERIOD' }, // invalid period
        { startDate: '2024-06-30', endDate: '2024-06-20' }, // invalid date range
      ];

      for (const invalidUpdate of invalidUpdates) {
        await request(app)
          .put(`/api/goals/${testGoal.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send(invalidUpdate)
          .expect(400);
      }
    });

    it('returns 400 when trying to edit completed goal', async () => {
      // Create a completed goal
      const completedGoal = createMockGoal({
        isCompleted: true,
        completedAt: new Date(),
      });
      const goals = await testDb.createTestGoals(assertTestUser(testUser).id, [completedGoal]);
      const completed = goals[0];

      await request(app)
        .put(`/api/goals/${completed.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(400);
    });

    it('returns 401 without authentication', async () => {
      await request(app).put(`/api/goals/${testGoal.id}`).send(updateData).expect(401);
    });
  });

  describe('DELETE /api/goals/:id', () => {
    let testGoal: any;

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(assertTestUser(testUser).id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('soft deletes existing goal for authenticated user', async () => {
      await request(app)
        .delete(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify goal was soft deleted (isActive set to false)
      const deletedGoal = await testDb.prisma.goal.findUnique({
        where: { id: testGoal.id },
      });
      expect(deletedGoal).toBeTruthy();
      expect(deletedGoal?.isActive).toBe(false);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .delete(`/api/goals/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for goal belonging to different user', async () => {
      // Create another user with a goal
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherGoals = await testDb.createTestGoals(otherUser.id, [mockGoals[1]]);
      const otherGoal = otherGoals[0];

      await request(app)
        .delete(`/api/goals/${otherGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      // Verify goal was not deleted
      const stillExists = await testDb.prisma.goal.findUnique({
        where: { id: otherGoal.id },
      });
      expect(stillExists).toBeTruthy();
      expect(stillExists?.isActive).toBe(true);
    });

    it('returns 401 without authentication', async () => {
      await request(app).delete(`/api/goals/${testGoal.id}`).expect(401);
    });
  });

  describe('POST /api/goals/:id/complete', () => {
    let testGoal: any;

    beforeEach(async () => {
      const activeGoal = createMockGoal({ isCompleted: false, completedAt: undefined });
      const goals = await testDb.createTestGoals(assertTestUser(testUser).id, [activeGoal]);
      testGoal = goals[0];
    });

    it('marks goal as completed for authenticated user', async () => {
      const response = await request(app)
        .post(`/api/goals/${testGoal.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', testGoal.id);
      expect(response.body).toHaveProperty('isCompleted', true);
      expect(response.body).toHaveProperty('completedAt');
      expect(new Date(response.body.completedAt)).toBeInstanceOf(Date);

      // Verify in database
      const completedGoal = await testDb.prisma.goal.findUnique({
        where: { id: testGoal.id },
      });
      expect(completedGoal?.isCompleted).toBe(true);
      expect(completedGoal?.completedAt).toBeTruthy();
    });

    it('returns 400 for already completed goal', async () => {
      // First complete the goal
      await request(app)
        .post(`/api/goals/${testGoal.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Try to complete again
      await request(app)
        .post(`/api/goals/${testGoal.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 'non-existent-id';

      await request(app)
        .post(`/api/goals/${nonExistentId}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for goal belonging to different user', async () => {
      // Create another user with a goal
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherGoals = await testDb.createTestGoals(otherUser.id, [createMockGoal()]);
      const otherGoal = otherGoals[0];

      await request(app)
        .post(`/api/goals/${otherGoal.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('returns 401 without authentication', async () => {
      await request(app).post(`/api/goals/${testGoal.id}/complete`).expect(401);
    });
  });

  describe('GET /api/goals/progress/all', () => {
    beforeEach(async () => {
      // Create test goals
      await testDb.createTestGoals(assertTestUser(testUser).id, mockGoals.slice(0, 3));

      // Create some test runs for progress calculation
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 2));
    });

    it('returns progress for all active goals', async () => {
      const response = await request(app)
        .get('/api/goals/progress/all')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      response.body.forEach((progress: any) => {
        expect(progress).toHaveProperty('goalId');
        expect(progress).toHaveProperty('currentValue');
        expect(progress).toHaveProperty('targetValue');
        expect(progress).toHaveProperty('progressPercentage');
        expect(progress).toHaveProperty('remainingValue');
        expect(progress).toHaveProperty('daysRemaining');
        expect(progress).toHaveProperty('isCompleted');
        expect(progress).toHaveProperty('isOnTrack');
        expect(progress).toHaveProperty('lastUpdated');
      });
    });

    it('calculates progress correctly for distance goals', async () => {
      const response = await request(app)
        .get('/api/goals/progress/all')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const distanceProgress = response.body.find(
        (p: any) => p.goalId && p.targetValue === 50 // Monthly 50km goal
      );

      if (distanceProgress) {
        expect(distanceProgress.currentValue).toBeGreaterThan(0);
        expect(distanceProgress.progressPercentage).toBeGreaterThanOrEqual(0);
        expect(distanceProgress.progressPercentage).toBeLessThanOrEqual(100);
        expect(distanceProgress.remainingValue).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns empty array for user with no goals', async () => {
      // Clean goals for this test
      await testDb.prisma.goal.deleteMany({
        where: { userId: assertTestUser(testUser).id },
      });

      const response = await request(app)
        .get('/api/goals/progress/all')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/goals/progress/all').expect(401);
    });
  });

  describe('Data Validation and Edge Cases', () => {
    it('handles long strings in title and description', async () => {
      const longString = 'a'.repeat(500);
      const longData = {
        title: longString,
        description: longString,
        type: 'DISTANCE',
        targetValue: 10,
        targetUnit: 'km',
        period: 'WEEKLY',
        startDate: '2024-06-17',
        endDate: '2024-06-23',
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(longData)
        .expect(201);
    });

    it('handles special characters in goal data', async () => {
      const specialData = {
        title: 'Run 5K 🏃‍♂️',
        description: 'Goal with émojis and spëcial chäractërs',
        type: 'DISTANCE',
        targetValue: 5,
        targetUnit: 'km',
        period: 'WEEKLY',
        startDate: '2024-06-17',
        endDate: '2024-06-23',
        icon: '🎯',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(specialData)
        .expect(201);

      expect(response.body.title).toBe(specialData.title);
      expect(response.body.description).toBe(specialData.description);
      expect(response.body.icon).toBe(specialData.icon);
    });

    it('handles large target values', async () => {
      const largeValueData = {
        title: 'Marathon Training',
        type: 'DISTANCE',
        targetValue: 1000,
        targetUnit: 'km',
        period: 'YEARLY',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(largeValueData)
        .expect(201);

      expect(response.body.targetValue).toBe(largeValueData.targetValue);
    });

    it('handles decimal target values', async () => {
      const decimalData = {
        title: 'Half Marathon',
        type: 'DISTANCE',
        targetValue: 21.1,
        targetUnit: 'km',
        period: 'CUSTOM',
        startDate: '2024-06-17',
        endDate: '2024-06-23',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(decimalData)
        .expect(201);

      expect(response.body.targetValue).toBe(decimalData.targetValue);
    });
  });

  describe('Error Handling', () => {
    it('handles malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('handles missing content-type header', async () => {
      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send('not json data')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });
});
