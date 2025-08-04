/**
 * Example: Using Test Fixtures System
 *
 * This file demonstrates how to use the Test Fixtures system
 * for consistent, predictable test data in integration tests.
 */

import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';

describe('Integration Tests with Fixtures (Example)', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    // Database cleanup is handled globally by jestSetup.ts afterEach
    // No manual cleanup needed here - this avoids redundant cleanup operations
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('Using Pre-built Fixture Collections', () => {
    it('loads minimal fixtures for simple tests', async () => {
      // Load minimal fixtures (1 user, 1 run, 1 goal)
      const fixtures = await testDb.fixtures.load.minimal();

      expect(fixtures.users).toHaveLength(1);
      expect(fixtures.runs).toHaveLength(1);
      expect(fixtures.goals).toHaveLength(1);
      expect(fixtures.races).toHaveLength(0);

      const user = fixtures.users[0];
      const token = testDb.generateToken(user.id, user.email);

      // Test API with fixture data
      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.runs).toHaveLength(1);
      expect(response.body.runs[0].id).toBe(fixtures.runs[0].id);
    });

    it('loads auth fixtures for authentication tests', async () => {
      // Load auth-specific fixtures
      const fixtures = await testDb.fixtures.load.auth();

      expect(fixtures.users).toHaveLength(3); // validUser, adminUser, duplicateEmailUser

      const validUser = fixtures.users.find(u => u.email.includes('auth-valid'));
      expect(validUser).toBeTruthy();
      expect(validUser.plainPassword).toBe('ValidAuth@2024!');

      // Test login with fixture data
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: validUser.email,
          password: validUser.plainPassword,
        })
        .expect(200);

      expect(response.body.user.id).toBe(validUser.id);
    });

    it('loads API test environment for comprehensive testing', async () => {
      // Load comprehensive test environment
      const fixtures = await testDb.fixtures.load.api();

      expect(fixtures.users.length).toBeGreaterThan(1);
      expect(fixtures.runs.length).toBeGreaterThan(5); // Multiple runs per user
      expect(fixtures.goals.length).toBeGreaterThan(2);
      expect(fixtures.races.length).toBeGreaterThan(1);

      // Test with first user's data
      const user = fixtures.users[0];
      const token = testDb.generateToken(user.id, user.email);

      const userRuns = fixtures.runs.filter(run => run.userId === user.id);
      const userGoals = fixtures.goals.filter(goal => goal.userId === user.id);

      // Test runs endpoint
      const runsResponse = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(runsResponse.body.runs).toHaveLength(userRuns.length);

      // Test goals endpoint
      const goalsResponse = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(goalsResponse.body.goals).toHaveLength(userGoals.length);
    });

    it('loads edge case fixtures for boundary testing', async () => {
      // Load edge case data
      const fixtures = await testDb.fixtures.load.edgeCases();

      expect(fixtures.users).toHaveLength(1);
      expect(fixtures.runs.length).toBe(3); // Very short, very long, exact marathon
      expect(fixtures.goals.length).toBe(2); // Daily running, elite pace
      expect(fixtures.races.length).toBe(2); // Ultra trail, parkrun

      const user = fixtures.users[0];
      const token = testDb.generateToken(user.id, user.email);

      // Test with edge case data
      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const runs = response.body.runs;
      expect(runs).toHaveLength(3);

      // Verify edge cases are present
      const shortRun = runs.find((r: any) => r.distance < 1);
      const longRun = runs.find((r: any) => r.distance > 50);
      const marathonRun = runs.find((r: any) => Math.abs(r.distance - 42.195) < 0.1);

      expect(shortRun).toBeTruthy();
      expect(longRun).toBeTruthy();
      expect(marathonRun).toBeTruthy();
    });
  });

  describe('Using Custom Fixture Generation', () => {
    it('creates custom test scenarios', async () => {
      // Create custom scenario
      const fixtures = await testDb.fixtures.load.custom({
        userCount: 2,
        runsPerUser: 4,
        goalsPerUser: 1,
        racesPerUser: 0,
      });

      expect(fixtures.users).toHaveLength(2);
      expect(fixtures.runs).toHaveLength(8); // 2 users * 4 runs
      expect(fixtures.goals).toHaveLength(2); // 2 users * 1 goal
      expect(fixtures.races).toHaveLength(0);

      // Test with both users
      for (const user of fixtures.users) {
        const token = testDb.generateToken(user.id, user.email);
        const userRuns = fixtures.runs.filter(run => run.userId === user.id);

        const response = await request(app)
          .get('/api/runs')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(response.body.runs).toHaveLength(userRuns.length);
        expect(response.body.runs).toHaveLength(4);
      }
    });

    it('uses fixture factory for custom data', async () => {
      // Create custom fixtures using the factory
      const user = testDb.fixtures.factory.createUser({
        email: 'custom@test.com',
        name: 'Custom Test User',
      });

      const run = testDb.fixtures.factory.createRun(user.id!, {
        distance: 10.5,
        duration: 3000,
        notes: 'Custom test run',
      });

      const goal = testDb.fixtures.factory.createGoal(user.id!, {
        type: 'DISTANCE',
        targetValue: 100,
        title: 'Custom distance goal',
      });

      // Load fixtures into database
      const loader = testDb.fixtures.loader();
      const loadedUser = await loader.loadUser(user);
      const loadedRun = await loader.loadRun(run);
      const loadedGoal = await loader.loadGoal(goal);

      expect(loadedUser.email).toBe('custom@test.com');
      expect(loadedRun.distance).toBe(10.5);
      expect(loadedGoal.targetValue).toBe(100);

      // Test API with custom data
      const token = testDb.generateToken(loadedUser.id, loadedUser.email);

      const response = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.runs).toHaveLength(1);
      expect(response.body.runs[0].notes).toBe('Custom test run');
    });
  });

  describe('Fixture Validation and Statistics', () => {
    it('validates loaded fixtures', async () => {
      const fixtures = await testDb.fixtures.load.api();
      const loader = testDb.fixtures.loader();

      // Validate fixtures were loaded correctly
      const validation = await loader.validateLoadedFixtures({
        users: fixtures.users.length,
        runs: fixtures.runs.length,
        goals: fixtures.goals.length,
        races: fixtures.races.length,
      });

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
      expect(validation.stats.total).toBeGreaterThan(0);

      if (process.env.DEBUG_TESTS) {
        console.log('📊 Fixture Stats:', validation.stats);
      }
    });

    it('handles fixture loading errors gracefully', async () => {
      const loader = testDb.fixtures.loader();

      // Try to load invalid fixture
      const invalidUser = {
        // Missing required email field
        password: 'test',
      } as any;

      await expect(loader.loadUser(invalidUser)).rejects.toThrow('Invalid user fixture');
    });

    it('supports batch loading with error handling', async () => {
      const loader = testDb.fixtures.loader();

      // Create mix of valid and potentially conflicting users
      const users = [
        testDb.fixtures.factory.createUser({ email: 'user1@test.com' }),
        testDb.fixtures.factory.createUser({ email: 'user2@test.com' }),
        testDb.fixtures.factory.createUser({ email: 'user1@test.com' }), // Duplicate
      ];

      // Load with skipDuplicates option
      const loadedUsers = await loader.loadUsers(users, {
        skipDuplicates: true,
        batchSize: 2,
      });

      // Should load 2 users (skip duplicate)
      expect(loadedUsers).toHaveLength(2);

      const emails = loadedUsers.map(u => u.email);
      expect(emails).toContain('user1@test.com');
      expect(emails).toContain('user2@test.com');
    });
  });

  describe('Performance and Consistency', () => {
    it('loads large fixture sets efficiently', async () => {
      const startTime = Date.now();

      // Load a medium-sized test environment
      const fixtures = await testDb.fixtures.load.custom({
        userCount: 10,
        runsPerUser: 20,
        goalsPerUser: 5,
        racesPerUser: 2,
      });

      const loadTime = Date.now() - startTime;

      expect(fixtures.users).toHaveLength(10);
      expect(fixtures.runs).toHaveLength(200); // 10 * 20
      expect(fixtures.goals).toHaveLength(50); // 10 * 5
      expect(fixtures.races).toHaveLength(20); // 10 * 2

      // Should load reasonably quickly (adjust threshold as needed)
      expect(loadTime).toBeLessThan(5000); // 5 seconds

      if (process.env.DEBUG_TESTS) {
        console.log(
          `📈 Loaded ${fixtures.users.length + fixtures.runs.length + fixtures.goals.length + fixtures.races.length} fixtures in ${loadTime}ms`
        );
      }
    });

    it('provides consistent fixture data across test runs', async () => {
      // Reset fixture counter for predictable results
      testDb.fixtures.factory.resetCounter();

      const user1 = testDb.fixtures.factory.createUser();
      const user2 = testDb.fixtures.factory.createUser();

      // IDs should be different but predictable
      expect(user1.id).not.toBe(user2.id);
      expect(user1.email).not.toBe(user2.email);

      // Names should be consistent (faker is seeded)
      expect(user1.name).toBeTruthy();
      expect(user2.name).toBeTruthy();
      expect(typeof user1.name).toBe('string');
      expect(typeof user2.name).toBe('string');
    });
  });
});
