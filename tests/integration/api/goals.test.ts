import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { testDb } from '../../fixtures/testDatabase';
import { mockGoals } from '../../fixtures/mockData';
import goalRoutes from '../../../routes/goals';

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/goals', goalRoutes);
  return app;
};

describe('Goals API Integration Tests', () => {
  let testUser: any;
  let authToken: string;
  let app: express.Application;

  beforeEach(async () => {
    // Create test app
    app = createTestApp();
    
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'goals@test.com',
      password: 'testpassword123'
    });
    authToken = testDb.generateTestToken(testUser.id);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/goals', () => {
    it('returns empty goals list for new user', async () => {
      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns user goals when they exist', async () => {
      // Create test goals
      await testDb.createTestGoals(testUser.id, mockGoals.slice(0, 3));

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toMatchObject({
        id: expect.any(Number),
        title: expect.any(String),
        description: expect.any(String),
        targetValue: expect.any(Number),
        targetUnit: expect.any(String),
        currentValue: expect.any(Number),
        targetDate: expect.any(String),
        isCompleted: expect.any(Boolean),
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      });
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app)
        .get('/api/goals')
        .expect(401);
    });

    it('returns 401 for invalid token', async () => {
      await request(app)
        .get('/api/goals')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('filters goals by completion status', async () => {
      // Create mix of completed and incomplete goals
      const goals = mockGoals.slice(0, 4);
      goals[0].isCompleted = true;
      goals[1].isCompleted = false;
      goals[2].isCompleted = true;
      goals[3].isCompleted = false;

      await testDb.createTestGoals(testUser.id, goals);

      // Get only completed goals
      const completedResponse = await request(app)
        .get('/api/goals?status=completed')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(completedResponse.body).toHaveLength(2);
      expect(completedResponse.body.every((goal: any) => goal.isCompleted)).toBe(true);

      // Get only incomplete goals
      const incompleteResponse = await request(app)
        .get('/api/goals?status=active')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(incompleteResponse.body).toHaveLength(2);
      expect(incompleteResponse.body.every((goal: any) => !goal.isCompleted)).toBe(true);
    });
  });

  describe('POST /api/goals', () => {
    it('creates a new goal successfully', async () => {
      const newGoal = {
        title: 'Run 100 Miles',
        description: 'Complete 100 miles of running this month',
        targetValue: 100,
        targetUnit: 'miles',
        targetDate: '2024-07-31'
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newGoal)
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(Number),
        title: newGoal.title,
        description: newGoal.description,
        targetValue: newGoal.targetValue,
        targetUnit: newGoal.targetUnit,
        currentValue: 0,
        targetDate: expect.stringContaining('2024-07-31'),
        isCompleted: false,
        userId: testUser.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      });
    });

    it('returns 400 for missing required fields', async () => {
      const incompleteGoal = {
        title: 'Incomplete Goal'
        // Missing required fields
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(incompleteGoal)
        .expect(400);
    });

    it('returns 400 for invalid target value', async () => {
      const invalidGoal = {
        title: 'Invalid Goal',
        description: 'Goal with invalid target',
        targetValue: -10, // Invalid negative value
        targetUnit: 'miles',
        targetDate: '2024-07-31'
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidGoal)
        .expect(400);
    });

    it('returns 400 for invalid target date', async () => {
      const invalidGoal = {
        title: 'Invalid Date Goal',
        description: 'Goal with invalid date',
        targetValue: 100,
        targetUnit: 'miles',
        targetDate: 'invalid-date'
      };

      await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidGoal)
        .expect(400);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const newGoal = {
        title: 'Test Goal',
        description: 'Test description',
        targetValue: 50,
        targetUnit: 'miles',
        targetDate: '2024-07-31'
      };

      await request(app)
        .post('/api/goals')
        .send(newGoal)
        .expect(401);
    });
  });

  describe('PUT /api/goals/:id', () => {
    let testGoal: any;

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(testUser.id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('updates a goal successfully', async () => {
      const updatedData = {
        title: 'Updated Goal Title',
        description: 'Updated description',
        targetValue: 150,
        currentValue: 25
      };

      const response = await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updatedData)
        .expect(200);

      expect(response.body).toMatchObject({
        id: testGoal.id,
        title: updatedData.title,
        description: updatedData.description,
        targetValue: updatedData.targetValue,
        currentValue: updatedData.currentValue,
        updatedAt: expect.any(String)
      });
    });

    it('marks goal as completed when currentValue reaches targetValue', async () => {
      const completionData = {
        currentValue: testGoal.targetValue
      };

      const response = await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(completionData)
        .expect(200);

      expect(response.body.isCompleted).toBe(true);
      expect(response.body.currentValue).toBe(testGoal.targetValue);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 99999;

      await request(app)
        .put(`/api/goals/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Updated Title' })
        .expect(404);
    });

    it('returns 403 for goal owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123'
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ title: 'Unauthorized Update' })
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .send({ title: 'Updated Title' })
        .expect(401);
    });

    it('returns 400 for invalid update data', async () => {
      const invalidData = {
        targetValue: -50 // Invalid negative value
      };

      await request(app)
        .put(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });
  });

  describe('DELETE /api/goals/:id', () => {
    let testGoal: any;

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(testUser.id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('deletes a goal successfully', async () => {
      await request(app)
        .delete(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify goal is deleted
      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 99999;

      await request(app)
        .delete(`/api/goals/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for goal owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123'
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .delete(`/api/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app)
        .delete(`/api/goals/${testGoal.id}`)
        .expect(401);
    });
  });

  describe('GET /api/goals/:id/progress', () => {
    let testGoal: any;

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(testUser.id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('returns goal progress successfully', async () => {
      const response = await request(app)
        .get(`/api/goals/${testGoal.id}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        goalId: testGoal.id,
        currentValue: testGoal.currentValue,
        targetValue: testGoal.targetValue,
        progressPercentage: expect.any(Number),
        remainingValue: expect.any(Number),
        isCompleted: testGoal.isCompleted,
        daysRemaining: expect.any(Number)
      });
    });

    it('calculates progress percentage correctly', async () => {
      // Update goal with specific values for testing
      await testDb.prisma.goal.update({
        where: { id: testGoal.id },
        data: { currentValue: 25, targetValue: 100 }
      });

      const response = await request(app)
        .get(`/api/goals/${testGoal.id}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.progressPercentage).toBe(25);
      expect(response.body.remainingValue).toBe(75);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 99999;

      await request(app)
        .get(`/api/goals/${nonExistentId}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 403 for goal owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123'
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .get(`/api/goals/${testGoal.id}/progress`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app)
        .get(`/api/goals/${testGoal.id}/progress`)
        .expect(401);
    });
  });

  describe('POST /api/goals/:id/update-progress', () => {
    let testGoal: any;

    beforeEach(async () => {
      const goals = await testDb.createTestGoals(testUser.id, [mockGoals[0]]);
      testGoal = goals[0];
    });

    it('updates goal progress successfully', async () => {
      const progressUpdate = {
        value: 15,
        operation: 'add' // or 'set'
      };

      const response = await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(progressUpdate)
        .expect(200);

      expect(response.body.currentValue).toBe(testGoal.currentValue + 15);
    });

    it('sets absolute progress value', async () => {
      const progressUpdate = {
        value: 50,
        operation: 'set'
      };

      const response = await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(progressUpdate)
        .expect(200);

      expect(response.body.currentValue).toBe(50);
    });

    it('marks goal as completed when target is reached', async () => {
      const progressUpdate = {
        value: testGoal.targetValue,
        operation: 'set'
      };

      const response = await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(progressUpdate)
        .expect(200);

      expect(response.body.isCompleted).toBe(true);
      expect(response.body.currentValue).toBe(testGoal.targetValue);
    });

    it('returns 400 for invalid progress value', async () => {
      const invalidUpdate = {
        value: -10,
        operation: 'add'
      };

      await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidUpdate)
        .expect(400);
    });

    it('returns 400 for invalid operation', async () => {
      const invalidUpdate = {
        value: 10,
        operation: 'invalid'
      };

      await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidUpdate)
        .expect(400);
    });

    it('returns 404 for non-existent goal', async () => {
      const nonExistentId = 99999;

      await request(app)
        .post(`/api/goals/${nonExistentId}/update-progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 10, operation: 'add' })
        .expect(404);
    });

    it('returns 403 for goal owned by different user', async () => {
      // Create another user
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'otherpassword123'
      });
      const otherToken = testDb.generateTestToken(otherUser.id);

      await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ value: 10, operation: 'add' })
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app)
        .post(`/api/goals/${testGoal.id}/update-progress`)
        .send({ value: 10, operation: 'add' })
        .expect(401);
    });
  });
});