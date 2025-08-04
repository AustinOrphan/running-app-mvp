/**
 * Example: Using Test Data Isolation Manager
 *
 * This file demonstrates how to use the Test Data Isolation Manager
 * to prevent test data conflicts in integration tests.
 */

import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb, TestDataIsolationManager } from '../utils/testDbSetup.js';

describe('Auth API Integration Tests (Isolated Data)', () => {
  let app: ReturnType<typeof createTestApp>;
  let isolationManager: TestDataIsolationManager;

  beforeAll(() => {
    app = createTestApp();
    // Create isolation manager for this test suite
    isolationManager = testDb.createIsolationManager('auth-api-tests');
  });

  beforeEach(async () => {
    // Clean database and validate integrity
    await testDb.clean();

    // Optional: Validate test data integrity
    if (process.env.VALIDATE_TEST_DATA === 'true') {
      const validation = await testDb.validateIntegrity();
      if (!validation.valid) {
        console.warn('⚠️ Test data integrity issues:', validation.issues);
      }
    }
  });

  afterEach(async () => {
    // Clean up any entities created by the isolation manager
    await isolationManager.cleanupCreatedEntities();
  });

  afterAll(async () => {
    // Print isolation statistics if debugging
    if (process.env.DEBUG_TESTS) {
      const stats = isolationManager.getCreatedEntitiesStats();
      console.log('🔬 Test Data Isolation Stats:', stats);
    }

    await testDb.disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user with isolated data', async () => {
      // Use isolation manager to create unique test data
      const userEmail = isolationManager.generateTestEmail('register-test');
      const newUser = {
        email: userEmail,
        password: 'SecureTest@2024!',
      };

      const response = await request(app).post('/api/auth/register').send(newUser).expect(201);

      expect(response.body).toHaveProperty('message', 'User created successfully');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', newUser.email);

      // Verify user was created in database
      const createdUser = await testDb.prisma.user.findUnique({
        where: { email: newUser.email },
      });
      expect(createdUser).toBeTruthy();
    });

    it('handles duplicate email conflicts gracefully', async () => {
      // Create a user using the isolation manager
      const existingUser = await isolationManager.createIsolatedTestUser({
        email: isolationManager.generateTestEmail('duplicate-test'),
        password: 'TestSecure@123!',
      });

      // Try to register with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: existingUser.email,
          password: 'NewTestSecure@123!',
        })
        .expect(409);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body.message).toMatch(/already exists/i);
    });

    it('runs multiple tests in parallel without conflicts', async () => {
      // This test demonstrates that parallel tests won't conflict
      // because each test gets unique data
      const promises = Array.from({ length: 5 }, async (_, index) => {
        const userEmail = isolationManager.generateTestEmail(`parallel-${index}`);
        const userData = {
          email: userEmail,
          password: 'ParallelTest@2024!',
        };

        const response = await request(app).post('/api/auth/register').send(userData).expect(201);

        return {
          index,
          email: userEmail,
          userId: response.body.user.id,
        };
      });

      const results = await Promise.all(promises);

      // Verify all registrations succeeded with unique emails
      const emails = results.map(r => r.email);
      const uniqueEmails = new Set(emails);
      expect(uniqueEmails.size).toBe(results.length);
    });
  });

  describe('POST /api/auth/login', () => {
    it('successfully logs in with isolated test data', async () => {
      // Create user with isolation manager
      const user = await isolationManager.createIsolatedTestUser({
        password: 'CorrectTestSecure@123!',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: user.plainPassword,
        })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Login successful');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body.user).toHaveProperty('id', user.id);
    });

    it('demonstrates complete test environment isolation', async () => {
      // Create a complete test environment
      const environment = await isolationManager.createTestEnvironment({
        userCount: 2,
        runsPerUser: 3,
        goalsPerUser: 2,
        racesPerUser: 1,
      });

      // Verify environment was created
      expect(environment.users).toHaveLength(2);
      expect(environment.runs).toHaveLength(6); // 2 users * 3 runs
      expect(environment.goals).toHaveLength(4); // 2 users * 2 goals
      expect(environment.races).toHaveLength(2); // 2 users * 1 race

      // Test login with one of the created users
      const testUser = environment.users[0];
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.plainPassword,
        })
        .expect(200);

      expect(response.body.user.id).toBe(testUser.id);

      // Verify isolation is working
      const isolationCheck = await isolationManager.verifyIsolation();
      expect(isolationCheck.isolated).toBe(true);

      if (isolationCheck.conflicts.length > 0) {
        console.warn('⚠️ Isolation conflicts detected:', isolationCheck.conflicts);
        console.info('💡 Recommendations:', isolationCheck.recommendations);
      }
    });
  });

  // Example of test that would benefit from data factories
  describe('Complex scenarios with multiple entities', () => {
    it('tests user with related data without conflicts', async () => {
      // Create user with related entities
      const user = await isolationManager.createIsolatedTestUser();

      // Create runs for the user
      const runs = await Promise.all([
        isolationManager.createIsolatedTestRun({
          userId: user.id,
          distance: 5.0,
          duration: 1800,
        }),
        isolationManager.createIsolatedTestRun({
          userId: user.id,
          distance: 10.0,
          duration: 3600,
        }),
      ]);

      // Create goals for the user
      const goal = await isolationManager.createIsolatedTestGoal({
        userId: user.id,
        type: 'DISTANCE',
        targetValue: 50.0,
      });

      // Test API endpoints with this data
      const token = testDb.generateToken(user.id, user.email);

      const runsResponse = await request(app)
        .get('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(runsResponse.body.runs).toHaveLength(2);
      expect(runsResponse.body.runs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: runs[0].id }),
          expect.objectContaining({ id: runs[1].id }),
        ])
      );

      const goalsResponse = await request(app)
        .get('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(goalsResponse.body.goals).toHaveLength(1);
      expect(goalsResponse.body.goals[0]).toEqual(expect.objectContaining({ id: goal.id }));
    });
  });
});
