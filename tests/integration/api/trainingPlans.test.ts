import cors from 'cors';
import express from 'express';
import request from 'supertest';
import type { TestUser } from '../../e2e/types';
import { assertTestUser } from '../../e2e/types/index.js';

import trainingPlansRoutes from '../../../server/routes/training-plans.js';
import { mockTrainingPlans, mockWorkoutTemplates } from '../../fixtures/mockData.js';
import { testDb } from '../../fixtures/testDatabase.js';

const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/training-plans', trainingPlansRoutes);
  return app;
};

describe('Training Plans API Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser | undefined;
  let authToken: string;
  let testRaceId: string;

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: `trainingplans-${Date.now()}@test.com`,
      password: 'testpassword123',
    });

    authToken = testDb.generateTestToken(assertTestUser(testUser).id);

    const races = await testDb.createTestRaces(assertTestUser(testUser).id, [
      {
        id: `race-${Date.now()}`,
        userId: assertTestUser(testUser).id,
        name: 'Test Half Marathon',
        raceDate: new Date('2024-09-15'),
        distance: 21.1,
        targetTime: 6300,
        actualTime: undefined,
        notes: 'Test race for training plans',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    testRaceId = races[0].id;
  });

  afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  describe('GET /api/training-plans', () => {
    it('returns empty array for user with no training plans', async () => {
      const response = await request(app)
        .get('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('trainingPlans');
      expect(Array.isArray(response.body.trainingPlans)).toBe(true);
      expect(response.body.trainingPlans).toHaveLength(0);
    });

    it('returns all training plans for authenticated user', async () => {
      void (await testDb.createTestTrainingPlans(
        assertTestUser(testUser).id,
        mockTrainingPlans.slice(0, 2)
      ));

      const response = await request(app)
        .get('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('trainingPlans');
      expect(Array.isArray(response.body.trainingPlans)).toBe(true);
      expect(response.body.trainingPlans).toHaveLength(2);

      response.body.trainingPlans.forEach((plan: any) => {
        expect(plan).toHaveProperty('id');
        expect(plan).toHaveProperty('name');
        expect(plan).toHaveProperty('goal');
        expect(plan).toHaveProperty('startDate');
        expect(plan).toHaveProperty('endDate');
        expect(plan).toHaveProperty('difficulty');
        expect(plan).toHaveProperty('isActive');
        expect(plan).toHaveProperty('progress');
        expect(plan).toHaveProperty('completedWorkouts');
        expect(plan).toHaveProperty('totalWorkouts');
      });
    });

    it('returns only active plans when active=true query param is set', async () => {
      await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        {
          ...mockTrainingPlans[0],
          isActive: true,
        },
        {
          ...mockTrainingPlans[1],
          isActive: false,
        },
      ]);

      const response = await request(app)
        .get('/api/training-plans?active=true')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trainingPlans).toHaveLength(1);
      expect(response.body.trainingPlans[0].isActive).toBe(true);
    });

    it('returns plans sorted by creation date descending', async () => {
      const plan1 = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      await new Promise(resolve => setTimeout(resolve, 100));
      const plan2 = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[1],
      ]);

      const response = await request(app)
        .get('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trainingPlans).toHaveLength(2);
      expect(response.body.trainingPlans[0].id).toBe(plan2[0].id);
      expect(response.body.trainingPlans[1].id).toBe(plan1[0].id);
    });

    it('returns plans with included workouts', async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      const planId = plans[0].id;

      const modifiedWorkouts = mockWorkoutTemplates.map(w => ({
        ...w,
        trainingPlanId: planId,
      }));
      await testDb.createTestWorkouts(planId, modifiedWorkouts);

      const response = await request(app)
        .get('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trainingPlans[0]).toHaveProperty('workouts');
      expect(Array.isArray(response.body.trainingPlans[0].workouts)).toBe(true);
      expect(response.body.trainingPlans[0].totalWorkouts).toBeGreaterThan(0);
    });

    it('returns plans only belonging to authenticated user', async () => {
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });

      await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [mockTrainingPlans[0]]);
      await testDb.createTestTrainingPlans(otherUser.id, [mockTrainingPlans[1]]);

      const response = await request(app)
        .get('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trainingPlans).toHaveLength(1);
      expect(response.body.trainingPlans[0].userId).toBeUndefined();
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/training-plans').expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app)
        .get('/api/training-plans')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('GET /api/training-plans/:id', () => {
    let testPlan: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];

      const modifiedWorkouts = mockWorkoutTemplates.slice(0, 3).map(w => ({
        ...w,
        trainingPlanId: testPlan.id,
      }));
      await testDb.createTestWorkouts(testPlan.id, modifiedWorkouts);
    });

    it('returns specific training plan for authenticated user', async () => {
      const response = await request(app)
        .get(`/api/training-plans/${testPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('trainingPlan');
      const plan = response.body.trainingPlan;

      expect(plan).toHaveProperty('id', testPlan.id);
      expect(plan).toHaveProperty('name', testPlan.name);
      expect(plan).toHaveProperty('goal');
      expect(plan).toHaveProperty('startDate');
      expect(plan).toHaveProperty('endDate');
      expect(plan).toHaveProperty('isActive');
      expect(plan).toHaveProperty('workouts');
      expect(plan).toHaveProperty('weeklyProgress');
    });

    it('includes weekly progress calculation', async () => {
      const response = await request(app)
        .get(`/api/training-plans/${testPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const plan = response.body.trainingPlan;
      expect(Array.isArray(plan.weeklyProgress)).toBe(true);

      plan.weeklyProgress.forEach((week: any) => {
        expect(week).toHaveProperty('weekNumber');
        expect(week).toHaveProperty('totalWorkouts');
        expect(week).toHaveProperty('completedWorkouts');
        expect(week).toHaveProperty('totalDistance');
        expect(week).toHaveProperty('completedDistance');
      });
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .get(`/api/training-plans/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 404 for training plan belonging to different user', async () => {
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherPlans = await testDb.createTestTrainingPlans(otherUser.id, [mockTrainingPlans[1]]);
      const otherPlan = otherPlans[0];

      await request(app)
        .get(`/api/training-plans/${otherPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 401 without authentication', async () => {
      await request(app).get(`/api/training-plans/${testPlan.id}`).expect(401);
    });
  });

  describe('POST /api/training-plans', () => {
    const validPlanData = {
      name: 'Marathon Training Program',
      description: 'Complete marathon preparation',
      goal: 'MARATHON',
      startDate: new Date('2024-08-01').toISOString(),
      difficulty: 'intermediate',
      currentWeeklyMileage: 30,
    };

    it('creates new training plan for authenticated user', async () => {
      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validPlanData)
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('trainingPlan');
      expect(response.body).toHaveProperty('advanced');

      const plan = response.body.trainingPlan;
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('name', validPlanData.name);
      expect(plan).toHaveProperty('goal', validPlanData.goal);
      expect(plan).toHaveProperty('difficulty', validPlanData.difficulty);
      expect(plan).toHaveProperty('isActive', true);
      expect(plan).toHaveProperty('workouts');
      expect(Array.isArray(plan.workouts)).toBe(true);

      expect(plan.workouts.length).toBeGreaterThan(0);
    });

    it('creates training plan with target race', async () => {
      const planWithRace = {
        ...validPlanData,
        targetRaceId: testRaceId,
      };

      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(planWithRace)
        .expect(201);

      const plan = response.body.trainingPlan;
      expect(plan.targetRaceId).toBe(testRaceId);
      expect(plan).toHaveProperty('targetRace');
    });

    it('creates plan with minimal required data', async () => {
      const minimalData = {
        name: 'Basic Training',
        goal: 'FIRST_5K',
        startDate: new Date('2024-08-01').toISOString(),
        difficulty: 'beginner',
      };

      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(minimalData)
        .expect(201);

      const plan = response.body.trainingPlan;
      expect(plan.name).toBe(minimalData.name);
      expect(plan.goal).toBe(minimalData.goal);
      expect(plan.description).toBeNull();
    });

    it('returns 400 for missing required fields', async () => {
      const testCases = [
        { ...validPlanData, name: undefined },
        { ...validPlanData, goal: undefined },
        { ...validPlanData, startDate: undefined },
        { ...validPlanData, difficulty: undefined },
      ];

      for (const testCase of testCases) {
        await request(app)
          .post('/api/training-plans')
          .set('Authorization', `Bearer ${authToken}`)
          .send(testCase)
          .expect(400);
      }
    });

    it('returns 400 for invalid goal type', async () => {
      const invalidData = {
        ...validPlanData,
        goal: 'INVALID_GOAL',
      };

      await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('returns 400 for invalid difficulty level', async () => {
      const invalidData = {
        ...validPlanData,
        difficulty: 'expert',
      };

      await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('returns 400 for invalid date format', async () => {
      const invalidData = {
        ...validPlanData,
        startDate: 'not-a-date',
      };

      await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('returns 400 for negative weekly mileage', async () => {
      const invalidData = {
        ...validPlanData,
        currentWeeklyMileage: -10,
      };

      await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('returns 400 for excessive weekly mileage', async () => {
      const invalidData = {
        ...validPlanData,
        currentWeeklyMileage: 250,
      };

      await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('returns 400 for invalid UUID in targetRaceId', async () => {
      const invalidData = {
        ...validPlanData,
        targetRaceId: 'not-a-uuid',
      };

      await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('returns 401 without authentication', async () => {
      await request(app).post('/api/training-plans').send(validPlanData).expect(401);
    });

    it('generates advanced plan when user has sufficient run history', async () => {
      for (let i = 0; i < 12; i++) {
        await testDb.createTestRuns(assertTestUser(testUser).id, [
          {
            id: `run-hist-${i}`,
            date: new Date(Date.now() - (85 - i * 5) * 24 * 60 * 60 * 1000),
            distance: 5 + Math.random() * 15,
            duration: 1800 + Math.random() * 900,
            tag: 'Training',
            notes: '',
            userId: assertTestUser(testUser).id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
      }

      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validPlanData)
        .expect(201);

      expect(response.body.advanced).toBe(true);
    });
  });

  describe('PUT /api/training-plans/:id', () => {
    let testPlan: any;
    const updateData = {
      name: 'Updated Plan Name',
      description: 'Updated description',
      isActive: false,
    };

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];
    });

    it('updates existing training plan for authenticated user', async () => {
      const response = await request(app)
        .put(`/api/training-plans/${testPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('trainingPlan');

      const plan = response.body.trainingPlan;
      expect(plan.id).toBe(testPlan.id);
      expect(plan.name).toBe(updateData.name);
      expect(plan.description).toBe(updateData.description);
      expect(plan.isActive).toBe(updateData.isActive);
    });

    it('updates partial data', async () => {
      const partialUpdate = {
        name: 'New Name Only',
      };

      const response = await request(app)
        .put(`/api/training-plans/${testPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(partialUpdate)
        .expect(200);

      const plan = response.body.trainingPlan;
      expect(plan.name).toBe(partialUpdate.name);
      expect(plan.description).toBe(testPlan.description);
      expect(plan.isActive).toBe(testPlan.isActive);
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .put(`/api/training-plans/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);
    });

    it('returns 404 for plan belonging to different user', async () => {
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherPlans = await testDb.createTestTrainingPlans(otherUser.id, [mockTrainingPlans[1]]);
      const otherPlan = otherPlans[0];

      await request(app)
        .put(`/api/training-plans/${otherPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);
    });

    it('returns 400 for invalid update data', async () => {
      const invalidUpdates = [
        { name: '' }, // empty name
        { name: 'a'.repeat(101) }, // name too long
        { description: 'a'.repeat(501) }, // description too long
        { isActive: 'not-a-boolean' },
      ];

      for (const invalidUpdate of invalidUpdates) {
        await request(app)
          .put(`/api/training-plans/${testPlan.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send(invalidUpdate)
          .expect(400);
      }
    });

    it('returns 401 without authentication', async () => {
      await request(app).put(`/api/training-plans/${testPlan.id}`).send(updateData).expect(401);
    });
  });

  describe('DELETE /api/training-plans/:id', () => {
    let testPlan: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];
    });

    it('deletes existing training plan for authenticated user', async () => {
      await request(app)
        .delete(`/api/training-plans/${testPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const deleted = await testDb.prisma.trainingPlan.findUnique({
        where: { id: testPlan.id },
      });
      expect(deleted).toBeNull();
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .delete(`/api/training-plans/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 404 for plan belonging to different user', async () => {
      const otherUser = await testDb.createTestUser({
        email: 'other@test.com',
        password: 'password',
      });
      const otherPlans = await testDb.createTestTrainingPlans(otherUser.id, [mockTrainingPlans[1]]);
      const otherPlan = otherPlans[0];

      await request(app)
        .delete(`/api/training-plans/${otherPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      const stillExists = await testDb.prisma.trainingPlan.findUnique({
        where: { id: otherPlan.id },
      });
      expect(stillExists).toBeTruthy();
    });

    it('cascades delete to associated workouts', async () => {
      const modifiedWorkouts = mockWorkoutTemplates.slice(0, 2).map(w => ({
        ...w,
        trainingPlanId: testPlan.id,
      }));
      const workouts = await testDb.createTestWorkouts(testPlan.id, modifiedWorkouts);

      await request(app)
        .delete(`/api/training-plans/${testPlan.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      for (const workout of workouts) {
        const deleted = await testDb.prisma.workoutTemplate.findUnique({
          where: { id: workout.id },
        });
        expect(deleted).toBeNull();
      }
    });

    it('returns 401 without authentication', async () => {
      await request(app).delete(`/api/training-plans/${testPlan.id}`).expect(401);
    });
  });

  describe('GET /api/training-plans/:id/workouts', () => {
    let testPlan: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];

      const modifiedWorkouts = mockWorkoutTemplates.slice(0, 4).map(w => ({
        ...w,
        trainingPlanId: testPlan.id,
      }));
      await testDb.createTestWorkouts(testPlan.id, modifiedWorkouts);
    });

    it('returns all workouts for a training plan', async () => {
      const response = await request(app)
        .get(`/api/training-plans/${testPlan.id}/workouts`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('workouts');
      expect(Array.isArray(response.body.workouts)).toBe(true);
      expect(response.body.workouts.length).toBeGreaterThan(0);

      response.body.workouts.forEach((workout: any) => {
        expect(workout).toHaveProperty('id');
        expect(workout).toHaveProperty('weekNumber');
        expect(workout).toHaveProperty('dayOfWeek');
        expect(workout).toHaveProperty('type');
        expect(workout).toHaveProperty('name');
      });
    });

    it('filters workouts by week number', async () => {
      const response = await request(app)
        .get(`/api/training-plans/${testPlan.id}/workouts?week=1`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body.workouts)).toBe(true);
      response.body.workouts.forEach((workout: any) => {
        expect(workout.weekNumber).toBe(1);
      });
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .get(`/api/training-plans/${nonExistentId}/workouts`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 401 without authentication', async () => {
      await request(app).get(`/api/training-plans/${testPlan.id}/workouts`).expect(401);
    });
  });

  describe('POST /api/training-plans/:id/workouts/:workoutId/complete', () => {
    let testPlan: any;
    let testWorkout: any;
    let testRun: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];

      const modifiedWorkouts = mockWorkoutTemplates.slice(0, 1).map(w => ({
        ...w,
        trainingPlanId: testPlan.id,
      }));
      const workouts = await testDb.createTestWorkouts(testPlan.id, modifiedWorkouts);
      testWorkout = workouts[0];

      const runs = await testDb.createTestRuns(assertTestUser(testUser).id, [
        {
          id: `test-run-${Date.now()}`,
          date: new Date(),
          distance: 5,
          duration: 1800,
          tag: 'Training',
          notes: 'Test run',
          userId: assertTestUser(testUser).id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      testRun = runs[0];
    });

    it('marks workout as completed', async () => {
      const completionData = {
        runId: testRun.id,
        notes: 'Great workout!',
        effortLevel: 8,
      };

      const response = await request(app)
        .post(`/api/training-plans/${testPlan.id}/workouts/${testWorkout.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(completionData)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('workout');

      const workout = response.body.workout;
      expect(workout.id).toBe(testWorkout.id);
      expect(workout.isCompleted).toBe(true);
      expect(workout.completedRunId).toBe(testRun.id);
    });

    it('returns 404 for non-existent workout', async () => {
      const nonExistentWorkoutId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .post(`/api/training-plans/${testPlan.id}/workouts/${nonExistentWorkoutId}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ runId: testRun.id })
        .expect(404);
    });

    it('returns 404 for non-existent run', async () => {
      const nonExistentRunId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .post(`/api/training-plans/${testPlan.id}/workouts/${testWorkout.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ runId: nonExistentRunId })
        .expect(404);
    });

    it('returns 400 for missing runId', async () => {
      await request(app)
        .post(`/api/training-plans/${testPlan.id}/workouts/${testWorkout.id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ notes: 'Test' })
        .expect(400);
    });

    it('returns 401 without authentication', async () => {
      await request(app)
        .post(`/api/training-plans/${testPlan.id}/workouts/${testWorkout.id}/complete`)
        .send({ runId: testRun.id })
        .expect(401);
    });
  });

  describe('POST /api/training-plans/:id/adjust', () => {
    let testPlan: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];
    });

    it('adjusts training plan for ahead performance', async () => {
      const response = await request(app)
        .post(`/api/training-plans/${testPlan.id}/adjust`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ performance: 'ahead' })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('ahead');
    });

    it('adjusts training plan for on_track performance', async () => {
      const response = await request(app)
        .post(`/api/training-plans/${testPlan.id}/adjust`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ performance: 'on_track' })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('on_track');
    });

    it('adjusts training plan for behind performance', async () => {
      const response = await request(app)
        .post(`/api/training-plans/${testPlan.id}/adjust`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ performance: 'behind' })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('behind');
    });

    it('returns 400 for invalid performance value', async () => {
      await request(app)
        .post(`/api/training-plans/${testPlan.id}/adjust`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ performance: 'invalid' })
        .expect(400);
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .post(`/api/training-plans/${nonExistentId}/adjust`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ performance: 'ahead' })
        .expect(404);
    });

    it('returns 401 without authentication', async () => {
      await request(app)
        .post(`/api/training-plans/${testPlan.id}/adjust`)
        .send({ performance: 'ahead' })
        .expect(401);
    });
  });

  describe('GET /api/training-plans/:id/insights', () => {
    let testPlan: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];

      const modifiedWorkouts = mockWorkoutTemplates.slice(0, 3).map(w => ({
        ...w,
        trainingPlanId: testPlan.id,
      }));
      await testDb.createTestWorkouts(testPlan.id, modifiedWorkouts);
    });

    it('returns insights for training plan', async () => {
      const response = await request(app)
        .get(`/api/training-plans/${testPlan.id}/insights`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('insights');
      expect(typeof response.body.insights).toBe('object');
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .get(`/api/training-plans/${nonExistentId}/insights`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 401 without authentication', async () => {
      await request(app).get(`/api/training-plans/${testPlan.id}/insights`).expect(401);
    });
  });

  describe('POST /api/training-plans/:id/optimize', () => {
    let testPlan: any;

    beforeEach(async () => {
      const plans = await testDb.createTestTrainingPlans(assertTestUser(testUser).id, [
        mockTrainingPlans[0],
      ]);
      testPlan = plans[0];
    });

    it('optimizes training plan', async () => {
      const response = await request(app)
        .post(`/api/training-plans/${testPlan.id}/optimize`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('trainingPlan');
    });

    it('returns 404 for non-existent training plan', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .post(`/api/training-plans/${nonExistentId}/optimize`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('returns 401 without authentication', async () => {
      await request(app).post(`/api/training-plans/${testPlan.id}/optimize`).expect(401);
    });
  });

  describe('Data Validation and Edge Cases', () => {
    it('handles long plan name gracefully', async () => {
      const longName = 'a'.repeat(100);
      const data = {
        name: longName,
        goal: 'MARATHON',
        startDate: new Date('2024-08-01').toISOString(),
        difficulty: 'beginner',
      };

      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(data)
        .expect(201);

      expect(response.body.trainingPlan.name).toBe(longName);
    });

    it('handles special characters in description', async () => {
      const specialData = {
        name: 'Marathon Plan',
        description: 'Training for race 🏃‍♂️ with spëcial chärs',
        goal: 'MARATHON',
        startDate: new Date('2024-08-01').toISOString(),
        difficulty: 'intermediate',
      };

      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(specialData)
        .expect(201);

      expect(response.body.trainingPlan.description).toBe(specialData.description);
    });

    it('handles future start dates', async () => {
      const futureData = {
        name: 'Future Plan',
        goal: 'FIRST_10K',
        startDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        difficulty: 'beginner',
      };

      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(futureData)
        .expect(201);

      expect(response.body.trainingPlan).toHaveProperty('id');
    });
  });

  describe('Error Handling', () => {
    it('handles malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('handles missing Content-Type header', async () => {
      const response = await request(app)
        .post('/api/training-plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send('not json data')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('handles invalid UUID format in path parameters', async () => {
      await request(app)
        .get('/api/training-plans/invalid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/training-plans/templates', () => {
    it('returns available training plan templates', async () => {
      const response = await request(app)
        .get('/api/training-plans/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('templates');
      expect(Array.isArray(response.body.templates)).toBe(true);
      expect(response.body.templates.length).toBeGreaterThan(0);

      response.body.templates.forEach((template: any) => {
        expect(template).toHaveProperty('goal');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('duration');
        expect(template).toHaveProperty('difficulty');
      });
    });

    it('returns 401 without authentication', async () => {
      await request(app).get('/api/training-plans/templates').expect(401);
    });
  });
});
