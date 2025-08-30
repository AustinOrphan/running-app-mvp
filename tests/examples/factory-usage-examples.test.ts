/**
 * Test Data Factory Usage Examples
 * Demonstrates how to use the factory system effectively
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Factory function imports (traditional approach)
import {
  createUser,
  createRun,
  createGoal,
  createRunSeries,
  setupTestData,
  testManager,
  TestContext,
} from '../factories';

// Builder pattern imports (fluent API approach)
import { user, run, goal, race, scenario } from '../factories/builders';

// Common utilities
import {
  generateEmail,
  generatePassword,
  generateGeoJSON,
  generateDateRange,
  generateDates,
} from '../factories/commonFactory';

describe('Factory Usage Examples', () => {
  let prisma: PrismaClient;
  let testContext: TestContext;

  beforeEach(async () => {
    prisma = new PrismaClient();
  });

  afterEach(async () => {
    if (testContext) {
      await testContext.cleanup();
    }
    await prisma.$disconnect();
  });

  describe('Traditional Factory Functions', () => {
    test('basic user creation', async () => {
      const testUser = await createUser({
        email: 'example@test.com',
        name: 'Example User',
        password: 'securePassword123',
      });

      expect(testUser.email).toBe('example@test.com');
      expect(testUser.name).toBe('Example User');
      expect(testUser.plainPassword).toBe('securePassword123');
      expect(testUser.password).not.toBe('securePassword123'); // Should be hashed
    });

    test('creating runs for user', async () => {
      const testUser = await createUser();

      // Single run
      const singleRun = await createRun({
        userId: testUser.id,
        distance: 10.5,
        duration: 3600,
        tag: 'Long Run',
      });

      expect(singleRun.distance).toBe(10.5);
      expect(singleRun.duration).toBe(3600);
      expect(singleRun.tag).toBe('Long Run');

      // Multiple runs
      const runs = await createRunSeries(testUser.id, 5);
      expect(runs).toHaveLength(5);
      runs.forEach(run => {
        expect(run.userId).toBe(testUser.id);
        expect(run.distance).toBeGreaterThan(0);
        expect(run.duration).toBeGreaterThan(0);
      });
    });

    test('creating goals', async () => {
      const testUser = await createUser();

      const distanceGoal = await createGoal({
        userId: testUser.id,
        title: 'Monthly Distance Challenge',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 150,
        targetUnit: 'km',
      });

      expect(distanceGoal.title).toBe('Monthly Distance Challenge');
      expect(distanceGoal.type).toBe('DISTANCE');
      expect(distanceGoal.targetValue).toBe(150);
      expect(distanceGoal.currentValue).toBe(0);
    });

    test('predefined scenarios', async () => {
      // Basic scenario: 1 user, 10 runs, 2 goals
      testContext = await setupTestData('basic');

      expect(testContext.users).toHaveLength(1);
      const user = testContext.users[0];
      expect(user.email).toContain('@example.com');
      expect(user.plainPassword).toBeDefined();

      // Competition scenario: 3 users, races, goals
      await testContext.cleanup();
      testContext = await setupTestData('competition');

      expect(testContext.users).toHaveLength(3);
    });
  });

  describe('Builder Pattern Usage', () => {
    test('fluent user builder', async () => {
      const userData = await user()
        .withEmail('fluent@example.com')
        .withName('Fluent User')
        .withPassword('customPassword')
        .build();

      expect(userData.email).toBe('fluent@example.com');
      expect(userData.name).toBe('Fluent User');
      expect(userData.plainPassword).toBe('customPassword');
    });

    test('fluent run builder with predefined types', async () => {
      const userData = await user().build();

      // Easy run
      const easyRunData = await run().withUserId(userData.id).asEasyRun().build();

      expect(easyRunData.tag).toBe('Easy Run');
      expect(easyRunData.distance).toBeGreaterThan(5);
      expect(easyRunData.distance).toBeLessThan(10);

      // Long run
      const longRunData = await run().withUserId(userData.id).asLongRun().build();

      expect(longRunData.tag).toBe('Long Run');
      expect(longRunData.distance).toBeGreaterThan(15);

      // Speed work
      const speedRunData = await run().withUserId(userData.id).asSpeedWork().build();

      expect(speedRunData.tag).toBe('Speed Work');
    });

    test('fluent run builder with date helpers', async () => {
      const userData = await user().build();

      const yesterdayRunData = await run().withUserId(userData.id).yesterdayRun().build();

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      expect(yesterdayRunData.date.toDateString()).toBe(yesterday.toDateString());

      const lastWeekRunData = await run().withUserId(userData.id).lastWeekRun().build();

      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);

      expect(lastWeekRunData.date.toDateString()).toBe(lastWeek.toDateString());
    });

    test('fluent goal builder with predefined types', async () => {
      const userData = await user().build();

      // Distance goal
      const distanceGoalData = await goal()
        .withUserId(userData.id)
        .asDistanceGoal(200)
        .asMonthlyGoal()
        .withProgressPercentage(60)
        .build();

      expect(distanceGoalData.type).toBe('DISTANCE');
      expect(distanceGoalData.period).toBe('MONTHLY');
      expect(distanceGoalData.targetValue).toBe(200);
      expect(distanceGoalData.currentValue).toBe(120); // 60% of 200

      // Frequency goal
      const frequencyGoalData = await goal()
        .withUserId(userData.id)
        .asFrequencyGoal(5)
        .asWeeklyGoal()
        .build();

      expect(frequencyGoalData.type).toBe('FREQUENCY');
      expect(frequencyGoalData.period).toBe('WEEKLY');
      expect(frequencyGoalData.targetValue).toBe(5);
      expect(frequencyGoalData.targetUnit).toBe('runs');

      // Completed goal
      const completedGoalData = await goal()
        .withUserId(userData.id)
        .asDistanceGoal(100)
        .asCompleted()
        .build();

      expect(completedGoalData.isCompleted).toBe(true);
      expect(completedGoalData.completedAt).toBeInstanceOf(Date);
      expect(completedGoalData.currentValue).toBe(100);
    });

    test('fluent race builder', async () => {
      const userData = await user().build();

      // Marathon
      const marathonData = await race()
        .withUserId(userData.id)
        .asMarathon()
        .upcomingRace(60)
        .withTargetTime(14400) // 4 hours
        .build();

      expect(marathonData.name).toBe('Marathon');
      expect(marathonData.distance).toBe(42.195);
      expect(marathonData.targetTime).toBe(14400);

      const raceDate = new Date();
      raceDate.setDate(raceDate.getDate() + 60);
      expect(marathonData.raceDate.toDateString()).toBe(raceDate.toDateString());

      // Completed 10K
      const completed10K = await race()
        .withUserId(userData.id)
        .as10K()
        .pastRace(30)
        .asCompleted(2400) // 40 minutes
        .build();

      expect(completed10K.name).toBe('10K Race');
      expect(completed10K.distance).toBe(10);
      expect(completed10K.actualTime).toBe(2400);
    });
  });

  describe('Scenario Builder Usage', () => {
    test('complex multi-user scenario', async () => {
      const data = await scenario()
        .addUser(u => u.withName('Beginner Runner').withEmail('beginner@test.com'))
        .addUser(u => u.withName('Intermediate Runner').withEmail('intermediate@test.com'))
        .addUser(u => u.withName('Advanced Runner').withEmail('advanced@test.com'))

        // Beginner: Easy runs and basic goals
        .addRunForUser(0, r => r.asEasyRun().withDistance(3))
        .addRunForUser(0, r => r.asEasyRun().withDistance(4).yesterdayRun())
        .addGoalForUser(0, g => g.asFrequencyGoal(3).asWeeklyGoal())

        // Intermediate: Mixed training
        .addRunForUser(1, r => r.asEasyRun().withDistance(8))
        .addRunForUser(1, r => r.asSpeedWork().withDistance(6))
        .addGoalForUser(1, g => g.asDistanceGoal(120).asMonthlyGoal())

        // Advanced: Serious training with race
        .addRunForUser(2, r => r.asLongRun().withDistance(20))
        .addRunForUser(2, r => r.asSpeedWork().withDistance(10))
        .addGoalForUser(2, g => g.asDistanceGoal(300).asMonthlyGoal())
        .addRaceForUser(2, r => r.asMarathon().upcomingRace(45))

        .build();

      // Verify structure
      expect(data.users).toHaveLength(3);
      expect(data.runs).toHaveLength(6); // 2 runs each
      expect(data.goals).toHaveLength(3); // 1 goal each
      expect(data.races).toHaveLength(1); // 1 race for advanced user

      // Verify specific data
      const beginnerUser = data.users.find(u => u.name === 'Beginner Runner');
      expect(beginnerUser?.email).toBe('beginner@test.com');

      const beginnerRuns = data.runs.filter(r => r.userId === beginnerUser?.id);
      expect(beginnerRuns).toHaveLength(2);

      const marathonRace = data.races[0];
      expect(marathonRace.name).toBe('Marathon');
      expect(marathonRace.distance).toBe(42.195);
    });

    test('training plan scenario', async () => {
      const data = await scenario()
        .addUser(u => u.withName('Marathon Trainee'))

        // Week 1: Base building
        .addRunForUser(0, r => r.asEasyRun().withDistance(8).withDate(new Date('2024-01-01')))
        .addRunForUser(0, r => r.asEasyRun().withDistance(6).withDate(new Date('2024-01-02')))
        .addRunForUser(0, r => r.asLongRun().withDistance(16).withDate(new Date('2024-01-03')))

        // Week 2: Adding intensity
        .addRunForUser(0, r => r.asEasyRun().withDistance(8).withDate(new Date('2024-01-08')))
        .addRunForUser(0, r => r.asSpeedWork().withDistance(8).withDate(new Date('2024-01-09')))
        .addRunForUser(0, r => r.asLongRun().withDistance(18).withDate(new Date('2024-01-10')))

        // Goals for training
        .addGoalForUser(0, g => g.asDistanceGoal(200).asMonthlyGoal())
        .addGoalForUser(0, g => g.asFrequencyGoal(5).asWeeklyGoal())
        .addGoalForUser(0, g =>
          g.withTitle('Longest Run').withType('LONGEST_RUN').withTarget(25, 'km')
        )

        // Target race
        .addRaceForUser(0, r => r.asMarathon().upcomingRace(90).withTargetTime(15300)) // 4:15 target

        .build();

      expect(data.users).toHaveLength(1);
      expect(data.runs).toHaveLength(6);
      expect(data.goals).toHaveLength(3);
      expect(data.races).toHaveLength(1);

      // Verify training progression
      const runs = data.runs.sort((a, b) => a.date.getTime() - b.date.getTime());
      const longRuns = runs.filter(r => r.tag === 'Long Run');
      expect(longRuns[0].distance).toBe(16);
      expect(longRuns[1].distance).toBe(18);
    });
  });

  describe('Common Utilities', () => {
    test('email and password generation', () => {
      const email1 = generateEmail('runner');
      const email2 = generateEmail('runner');

      expect(email1).toContain('runner_');
      expect(email1).toContain('@test.com');
      expect(email1).not.toBe(email2); // Should be unique

      const password = generatePassword(16);
      expect(password).toHaveLength(16);
      expect(password).toMatch(/[A-Z]/); // Contains uppercase
      expect(password).toMatch(/[a-z]/); // Contains lowercase
      expect(password).toMatch(/[0-9]/); // Contains number
      expect(password).toMatch(/[!@#$%^&*]/); // Contains special char
    });

    test('date generation', () => {
      const range = generateDateRange(30, 7); // 30 days back, 7 forward
      expect(range.start).toBeInstanceOf(Date);
      expect(range.end).toBeInstanceOf(Date);
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());

      const dates = generateDates(5, range);
      expect(dates).toHaveLength(5);
      dates.forEach(date => {
        expect(date.getTime()).toBeGreaterThanOrEqual(range.start.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(range.end.getTime());
      });

      // Should be sorted
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i - 1].getTime());
      }
    });

    test('GeoJSON generation', () => {
      const geoJson = generateGeoJSON(50);
      const parsed = JSON.parse(geoJson);

      expect(parsed.type).toBe('Feature');
      expect(parsed.geometry.type).toBe('LineString');
      expect(parsed.geometry.coordinates).toHaveLength(50);
      expect(parsed.properties.name).toBeDefined();
      expect(parsed.properties.distance).toBeGreaterThan(0);
    });
  });

  describe('Test Data Manager Integration', () => {
    test('isolated test data creation', async () => {
      testContext = await testManager.createIsolatedData(async userId => {
        // Create custom test scenario
        await createRunSeries(userId, 15);
        await createGoal({
          userId,
          title: 'Custom Training Goal',
          type: 'DISTANCE',
          targetValue: 250,
        });
      });

      expect(testContext.users).toHaveLength(1);

      // Data should exist
      const user = testContext.users[0];
      expect(user.id).toBeDefined();
      expect(user.email).toContain('@example.com');
    });

    test('database reset and seed', async () => {
      // This would be used in setup/teardown typically
      await testManager.resetDatabase();

      // Verify clean state (in real test, would check actual database)

      // Seed with sample data
      await testManager.seedDatabase();

      // Verify seeded data exists (in real test, would check actual database)
    });
  });

  describe('Performance Examples', () => {
    test('batch creation vs individual creation', async () => {
      const userData = await user().build();

      // ✅ Good: Use batch functions
      const startBatch = Date.now();
      const batchRuns = await createRunSeries(userData.id, 50);
      const batchTime = Date.now() - startBatch;

      expect(batchRuns).toHaveLength(50);

      // ❌ Avoid: Individual creation (simulated with smaller count)
      const startIndividual = Date.now();
      const individualRuns = [];
      for (let i = 0; i < 5; i++) {
        // Smaller count for test performance
        const runData = await run().withUserId(userData.id).build();
        individualRuns.push(runData);
      }
      const individualTime = Date.now() - startIndividual;

      expect(individualRuns).toHaveLength(5);

      // Note: In real scenarios, batch creation is significantly faster
      console.log(`Batch creation (50 items): ${batchTime}ms`);
      console.log(`Individual creation (5 items): ${individualTime}ms`);
    });
  });
});

describe('Factory Error Handling', () => {
  test('builder validation errors', async () => {
    // Missing required userId for run
    await expect(run().withDistance(10).build()).rejects.toThrow('UserId is required for Run');

    // Missing required userId for goal
    await expect(goal().asDistanceGoal().build()).rejects.toThrow('UserId is required for Goal');

    // Missing required userId for race
    await expect(race().asMarathon().build()).rejects.toThrow('UserId is required for Race');
  });

  test('scenario builder validation', async () => {
    // Invalid user index
    const scenarioBuilder = scenario()
      .addUser()
      .addRunForUser(5, r => r.asEasyRun()); // Index 5 doesn't exist

    await expect(scenarioBuilder.build()).rejects.toThrow();
  });
});
