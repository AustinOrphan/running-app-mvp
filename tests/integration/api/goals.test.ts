import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';

describe('Goals API Integration Tests', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    // Create a properly configured test app
    app = createTestApp();
  });

  beforeEach(async () => {
    // Ensure clean database state for each test
    await testDb.clean();
  });

  describe('GET /api/goals', () => {
    it('returns all active goals for authenticated user', async () => {
      // Create test user and goals
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create test goals (in sequence for predictable order)
      await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Run 100km this month',
          description: 'Monthly distance goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 45,
          isActive: true,
        },
      });

      await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Run 5 times per week',
          type: 'FREQUENCY',
          period: 'WEEKLY',
          targetValue: 5,
          targetUnit: 'runs',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          currentValue: 3,
          isActive: true,
        },
      });

      await Promise.all([
        testDb.prisma.goal.create({
          data: {
            userId: user.id,
            title: 'Inactive goal',
            type: 'TIME',
            period: 'YEARLY',
            targetValue: 500,
            targetUnit: 'minutes',
            startDate: new Date('2023-01-01'),
            endDate: new Date('2023-12-31'),
            currentValue: 0,
            isActive: false,
          },
        }),
      ]);

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Should only return active goals
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('title', 'Run 5 times per week'); // Newest first
      expect(response.body[1]).toHaveProperty('title', 'Run 100km this month');
    });

    it('returns empty array when user has no goals', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns 401 without authentication', async () => {
      const response = await request(app).get('/api/goals').expect(401);

      expect(response.body).toHaveProperty('error', true);
    });

    it('only returns goals for the authenticated user', async () => {
      // Create two users with goals
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token1 = testDb.generateToken(user1.id, user1.email);

      // Create goals for both users
      await testDb.prisma.goal.create({
        data: {
          userId: user1.id,
          title: 'User 1 Goal',
          type: 'DISTANCE',
          period: 'WEEKLY',
          targetValue: 50,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          isActive: true,
        },
      });

      await testDb.prisma.goal.create({
        data: {
          userId: user2.id,
          title: 'User 2 Goal',
          type: 'DISTANCE',
          period: 'WEEKLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          isActive: true,
        },
      });

      const response = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('title', 'User 1 Goal');
    });
  });

  describe('POST /api/goals', () => {
    it('creates a new goal', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const newGoal = {
        title: 'New Running Goal',
        description: 'Achieve this goal',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 150,
        targetUnit: 'km',
        startDate: '2024-02-01',
        endDate: '2024-02-29',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .send(newGoal)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title', 'New Running Goal');
      expect(response.body).toHaveProperty('targetValue', 150);
      expect(response.body).toHaveProperty('currentValue', 0);
      expect(response.body).toHaveProperty('isActive', true);
      expect(response.body).toHaveProperty('userId', user.id);

      // Verify it was saved to database
      const savedGoal = await testDb.prisma.goal.findUnique({
        where: { id: response.body.id },
      });
      expect(savedGoal).toBeTruthy();
      expect(savedGoal?.title).toBe('New Running Goal');
    });

    it('returns 400 for invalid data', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const invalidGoal = {
        // Missing required fields
        title: 'Invalid Goal',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .send(invalidGoal)
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('returns 401 without authentication', async () => {
      const newGoal = {
        title: 'Test Goal',
        type: 'DISTANCE',
        period: 'WEEKLY',
        targetValue: 50,
        targetUnit: 'km',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const response = await request(app).post('/api/goals').send(newGoal).expect(401);

      expect(response.body).toHaveProperty('error', true);
    });
  });

  describe('PUT /api/goals/:id', () => {
    it('updates an existing goal', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal to update
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Original Goal',
          description: 'Original description',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 25,
          isActive: true,
        },
      });

      const updatedData = {
        title: 'Updated Goal',
        description: 'Updated description',
        targetValue: 150,
        currentValue: 75,
      };

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(updatedData)
        .expect(200);

      expect(response.body).toHaveProperty('id', goal.id);
      expect(response.body).toHaveProperty('title', 'Updated Goal');
      expect(response.body).toHaveProperty('targetValue', 150);
      expect(response.body).toHaveProperty('currentValue', 75);

      // Verify it was updated in database
      const updatedGoal = await testDb.prisma.goal.findUnique({
        where: { id: goal.id },
      });
      expect(updatedGoal?.title).toBe('Updated Goal');
      expect(updatedGoal?.targetValue).toBe(150);
    });

    it('marks goal as completed when current value reaches target', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal close to completion
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Almost Complete Goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 95,
          isActive: true,
          isCompleted: false,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentValue: 100 })
        .expect(200);

      expect(response.body).toHaveProperty('currentValue', 100);
      expect(response.body).toHaveProperty('isCompleted', true);
      expect(response.body).toHaveProperty('completedAt');
    });

    it('returns 404 for non-existent goal', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .put('/api/goals/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated' })
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
    });

    it('rejects negative currentValue with validation error', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Test Goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 25,
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentValue: -5 })
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Current value cannot be negative');
    });

    it('updates currentValue alone without modifying other fields', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Test Goal',
          description: 'Original description',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 25,
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentValue: 50 })
        .expect(200);

      expect(response.body).toHaveProperty('currentValue', 50);
      // Verify other fields remain unchanged
      expect(response.body).toHaveProperty('title', 'Test Goal');
      expect(response.body).toHaveProperty('description', 'Original description');
      expect(response.body).toHaveProperty('targetValue', 100);
      expect(response.body).toHaveProperty('isCompleted', false);

      // Verify in database
      const updatedGoal = await testDb.prisma.goal.findUnique({
        where: { id: goal.id },
      });
      expect(updatedGoal?.currentValue).toBe(50);
      expect(updatedGoal?.title).toBe('Test Goal');
    });

    it('updates currentValue along with other fields', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Original Goal',
          description: 'Original description',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 25,
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Updated Goal',
          description: 'Updated description',
          currentValue: 60,
          targetValue: 120,
        })
        .expect(200);

      expect(response.body).toHaveProperty('title', 'Updated Goal');
      expect(response.body).toHaveProperty('description', 'Updated description');
      expect(response.body).toHaveProperty('currentValue', 60);
      expect(response.body).toHaveProperty('targetValue', 120);
      expect(response.body).toHaveProperty('isCompleted', false);
    });

    it('auto-completes goal when currentValue exceeds targetValue', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Test Goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 80,
          isActive: true,
          isCompleted: false,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentValue: 150 }) // Exceeds target
        .expect(200);

      expect(response.body).toHaveProperty('currentValue', 150);
      expect(response.body).toHaveProperty('isCompleted', true);
      expect(response.body).toHaveProperty('completedAt');
      expect(new Date(response.body.completedAt)).toBeInstanceOf(Date);
    });

    it('handles currentValue as string and converts to number', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Test Goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 25,
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentValue: '42.5' }) // String value
        .expect(200);

      expect(response.body).toHaveProperty('currentValue', 42.5);
      expect(typeof response.body.currentValue).toBe('number');
    });

    it('preserves currentValue when not included in update', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal with initial currentValue
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Test Goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 75,
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Title Only' }) // No currentValue in update
        .expect(200);

      expect(response.body).toHaveProperty('title', 'Updated Title Only');
      expect(response.body).toHaveProperty('currentValue', 75); // Unchanged
    });

    it('allows currentValue of 0', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Test Goal',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currentValue: 50,
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentValue: 0 }) // Reset to 0
        .expect(200);

      expect(response.body).toHaveProperty('currentValue', 0);
    });

    it("returns 403 when trying to update another user's goal", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a goal for user1
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user1.id,
          title: 'User 1 Goal',
          type: 'DISTANCE',
          period: 'WEEKLY',
          targetValue: 50,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          isActive: true,
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ title: 'Hacked' })
        .expect(403);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('permission');
    });
  });

  describe('DELETE /api/goals/:id', () => {
    it('deletes an existing goal', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      // Create a goal to delete
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Goal to Delete',
          type: 'DISTANCE',
          period: 'WEEKLY',
          targetValue: 50,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          isActive: true,
        },
      });

      const response = await request(app)
        .delete(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(response.body).toEqual({});

      // Verify it was soft deleted (isActive = false)
      const deletedGoal = await testDb.prisma.goal.findUnique({
        where: { id: goal.id },
      });
      expect(deletedGoal).not.toBeNull();
      expect(deletedGoal!.isActive).toBe(false);
    });

    it('returns 404 for non-existent goal', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await request(app)
        .delete('/api/goals/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
    });

    it("returns 403 when trying to delete another user's goal", async () => {
      const user1 = await testDb.createUser();
      const user2 = await testDb.createUser();
      const token2 = testDb.generateToken(user2.id, user2.email);

      // Create a goal for user1
      const goal = await testDb.prisma.goal.create({
        data: {
          userId: user1.id,
          title: 'User 1 Goal',
          type: 'DISTANCE',
          period: 'WEEKLY',
          targetValue: 50,
          targetUnit: 'km',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          isActive: true,
        },
      });

      const response = await request(app)
        .delete(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('permission');
    });
  });
});
