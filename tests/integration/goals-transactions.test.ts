import request from 'supertest';
import { createTestApp } from './utils/testApp.js';
import { testDb } from './utils/testDbSetup.js';
import { prisma } from '../../lib/prisma.js';
import { MOCK_DATE } from '../setup/jestDateMock.js';
import { testDataUtils } from '../utils/testDataIsolationManager.js';
import { expectErrorResponse, expectSuccessResponse } from './utils/responseHelpers.js';

describe('Goals API - Transaction Rollback Scenarios', () => {
  let app: ReturnType<typeof createTestApp>;
  let authToken: string;
  let userId: string;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    // Database cleanup is handled globally by jestSetup.ts afterEach
    // No manual cleanup needed here - this avoids redundant cleanup operations
    const user = await testDb.createUser({
      email: testDataUtils.generateUniqueEmail('test'),
      password: 'password123',
    });
    userId = user.id;
    authToken = testDb.generateToken(user.id, user.email);
  });

  afterEach(async () => {
    // Database cleanup is handled globally by jestSetup.ts afterEach
    // Only restore mocks here
    jest.restoreAllMocks();
  });

  describe('POST /api/goals - Create Goal Transaction Rollback', () => {
    it('should rollback transaction when database error occurs during creation', async () => {
      // Mock the goal.create to throw an error
      jest
        .spyOn(prisma.goal, 'create')
        .mockRejectedValueOnce(new Error('Database connection failed'));

      const goalData = {
        title: 'Test Goal',
        type: 'distance',
        period: 'weekly',
        targetValue: 50,
        targetUnit: 'miles',
        startDate: MOCK_DATE.toISOString(),
        endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData);

      expectErrorResponse(response, 500);

      // Verify no goal was created
      const goals = await prisma.goal.findMany({ where: { userId } });
      expect(goals).toHaveLength(0);
    });

    it('should handle validation errors without creating partial data', async () => {
      const invalidGoalData = {
        title: 'Test Goal',
        type: 'invalid_type', // Invalid type
        period: 'weekly',
        targetValue: 50,
        targetUnit: 'miles',
        startDate: MOCK_DATE.toISOString(),
        endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidGoalData);

      expectErrorResponse(response, 400, /Invalid goal type/i);

      // Verify no goal was created
      const goals = await prisma.goal.findMany({ where: { userId } });
      expect(goals).toHaveLength(0);
    });
  });

  describe('PUT /api/goals/:id - Update Goal Transaction Rollback', () => {
    it('should rollback transaction when database error occurs during update', async () => {
      // Create a goal first
      const goal = await prisma.goal.create({
        data: {
          userId,
          title: 'Original Goal',
          type: 'distance',
          period: 'weekly',
          targetValue: 50,
          targetUnit: 'miles',
          startDate: MOCK_DATE,
          endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentValue: 0,
          isActive: true,
          isCompleted: false,
        },
      });

      // Mock the goal.update to throw an error
      jest.spyOn(prisma.goal, 'update').mockRejectedValueOnce(new Error('Database update failed'));

      const updateData = {
        title: 'Updated Goal',
        targetValue: 100,
      };

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expectErrorResponse(response, 500);

      // Verify goal was not updated
      const unchangedGoal = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect(unchangedGoal?.title).toBe('Original Goal');
      expect(unchangedGoal?.targetValue).toBe(50);
    });

    it('should rollback when trying to update non-existent goal', async () => {
      const response = await request(app)
        .put('/api/goals/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Updated Title' });

      expectErrorResponse(response, 404, /Goal not found/i);
    });

    it('should rollback when validation fails during update', async () => {
      const goal = await prisma.goal.create({
        data: {
          userId,
          title: 'Test Goal',
          type: 'distance',
          period: 'weekly',
          targetValue: 50,
          targetUnit: 'miles',
          startDate: MOCK_DATE,
          endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentValue: 0,
          isActive: true,
          isCompleted: false,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ targetValue: -10 }); // Invalid negative value

      expectErrorResponse(response, 400, /Target value must be positive/i);

      // Verify goal was not updated
      const unchangedGoal = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect(unchangedGoal?.targetValue).toBe(50);
    });
  });

  describe('DELETE /api/goals/:id - Delete Goal Transaction Rollback', () => {
    it('should rollback transaction when database error occurs during soft delete', async () => {
      const goal = await prisma.goal.create({
        data: {
          userId,
          title: 'Goal to Delete',
          type: 'distance',
          period: 'weekly',
          targetValue: 50,
          targetUnit: 'miles',
          startDate: MOCK_DATE,
          endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentValue: 0,
          isActive: true,
          isCompleted: false,
        },
      });

      // Mock the goal.update to throw an error during soft delete
      jest.spyOn(prisma.goal, 'update').mockRejectedValueOnce(new Error('Database update failed'));

      const response = await request(app)
        .delete(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);

      // Verify goal is still active
      const unchangedGoal = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect(unchangedGoal?.isActive).toBe(true);
    });
  });

  describe('POST /api/goals/:id/complete - Complete Goal Transaction Rollback', () => {
    it('should rollback transaction when database error occurs during completion', async () => {
      const goal = await prisma.goal.create({
        data: {
          userId,
          title: 'Goal to Complete',
          type: 'distance',
          period: 'weekly',
          targetValue: 50,
          targetUnit: 'miles',
          startDate: MOCK_DATE,
          endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentValue: 25,
          isActive: true,
          isCompleted: false,
        },
      });

      // Mock the goal.update to throw an error
      jest.spyOn(prisma.goal, 'update').mockRejectedValueOnce(new Error('Database update failed'));

      const response = await request(app)
        .post(`/api/goals/${goal.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);

      // Verify goal is still not completed
      const unchangedGoal = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect(unchangedGoal?.isCompleted).toBe(false);
      expect(unchangedGoal?.completedAt).toBeNull();
      expect(unchangedGoal?.currentValue).toBe(25);
    });

    it('should handle validation error when goal is already completed', async () => {
      const goal = await prisma.goal.create({
        data: {
          userId,
          title: 'Already Completed Goal',
          type: 'distance',
          period: 'weekly',
          targetValue: 50,
          targetUnit: 'miles',
          startDate: MOCK_DATE,
          endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentValue: 50,
          isActive: true,
          isCompleted: true,
          completedAt: MOCK_DATE,
        },
      });

      const response = await request(app)
        .post(`/api/goals/${goal.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`);

      expectErrorResponse(response, 400, /Goal is already completed/i);
    });
  });

  describe('Transaction Isolation', () => {
    it('should ensure transaction isolation for concurrent updates', async () => {
      const goal = await prisma.goal.create({
        data: {
          userId,
          title: 'Concurrent Update Test',
          type: 'distance',
          period: 'weekly',
          targetValue: 50,
          targetUnit: 'miles',
          startDate: MOCK_DATE,
          endDate: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentValue: 0,
          isActive: true,
          isCompleted: false,
        },
      });

      // Simulate concurrent updates
      const update1 = request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ currentValue: 25 });

      const update2 = request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ currentValue: 30 });

      const [response1, response2] = await Promise.all([update1, update2]);

      // Both should succeed (Prisma handles the serialization)
      expectSuccessResponse(response1, 200);
      expectSuccessResponse(response2, 200);

      // The final value should be from one of the updates
      const finalGoal = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect([25, 30]).toContain(finalGoal?.currentValue);
    });
  });
});
