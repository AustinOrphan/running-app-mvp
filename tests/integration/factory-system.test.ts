/**
 * Test Data Factory System Integration Test
 * Verifies that the factory system works with the actual database
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { createUser, createRun, createGoal } from '../factories';
import { user, run, goal, scenario } from '../factories/builders';

describe('Factory System Integration', () => {
  let prisma: PrismaClient;
  let createdUserIds: string[] = [];

  beforeEach(async () => {
    const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/test.db';
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    await prisma.$connect();
    createdUserIds = [];
  });

  afterEach(async () => {
    // Clean up created test data
    if (createdUserIds.length > 0) {
      await prisma.race.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.goal.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.run.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await prisma.$disconnect();
  });

  test('factory functions create valid database records', async () => {
    // Create user using factory
    const testUser = await createUser({
      email: 'factory-test@example.com',
      name: 'Factory Test User',
    });
    createdUserIds.push(testUser.id);

    // Verify user was created in database
    const dbUser = await prisma.user.findUnique({
      where: { id: testUser.id },
    });
    expect(dbUser).toBeTruthy();
    expect(dbUser?.email).toBe('factory-test@example.com');
    expect(dbUser?.name).toBe('Factory Test User');

    // Create run using factory
    const testRun = await createRun({
      userId: testUser.id,
      distance: 10.5,
      duration: 3600,
      tag: 'Test Run',
    });

    // Verify run was created in database
    const dbRun = await prisma.run.findUnique({
      where: { id: testRun.id },
    });
    expect(dbRun).toBeTruthy();
    expect(dbRun?.distance).toBe(10.5);
    expect(dbRun?.duration).toBe(3600);
    expect(dbRun?.tag).toBe('Test Run');

    // Create goal using factory
    const testGoal = await createGoal({
      userId: testUser.id,
      title: 'Factory Test Goal',
      type: 'DISTANCE',
      targetValue: 100,
    });

    // Verify goal was created in database
    const dbGoal = await prisma.goal.findUnique({
      where: { id: testGoal.id },
    });
    expect(dbGoal).toBeTruthy();
    expect(dbGoal?.title).toBe('Factory Test Goal');
    expect(dbGoal?.type).toBe('DISTANCE');
    expect(dbGoal?.targetValue).toBe(100);
  });

  test('builder patterns create valid data structures', async () => {
    // Test builders create correct data structures (not saved to DB)
    const userData = await user()
      .withEmail('builder-test@example.com')
      .withName('Builder Test User')
      .build();

    expect(userData.email).toBe('builder-test@example.com');
    expect(userData.name).toBe('Builder Test User');
    expect(userData.password).toBeDefined();
    expect(userData.plainPassword).toBeDefined();

    const runData = await run().withUserId(userData.id).asEasyRun().build();

    expect(runData.userId).toBe(userData.id);
    expect(runData.tag).toBe('Easy Run');
    expect(runData.distance).toBeGreaterThan(5);
    expect(runData.distance).toBeLessThan(10);

    const goalData = await goal()
      .withUserId(userData.id)
      .asDistanceGoal(150)
      .asMonthlyGoal()
      .build();

    expect(goalData.userId).toBe(userData.id);
    expect(goalData.type).toBe('DISTANCE');
    expect(goalData.period).toBe('MONTHLY');
    expect(goalData.targetValue).toBe(150);
  });

  test('scenario builder creates complex data structures', async () => {
    const data = await scenario()
      .addUser(u => u.withName('Scenario User 1'))
      .addUser(u => u.withName('Scenario User 2'))
      .addRunForUser(0, r => r.asEasyRun().withDistance(5))
      .addRunForUser(1, r => r.asLongRun().withDistance(15))
      .addGoalForUser(0, g => g.asFrequencyGoal(3))
      .addGoalForUser(1, g => g.asDistanceGoal(200))
      .build();

    expect(data.users).toHaveLength(2);
    expect(data.runs).toHaveLength(2);
    expect(data.goals).toHaveLength(2);

    // Verify relationships
    const user1 = data.users.find(u => u.name === 'Scenario User 1');
    const user2 = data.users.find(u => u.name === 'Scenario User 2');

    expect(user1).toBeDefined();
    expect(user2).toBeDefined();

    const user1Run = data.runs.find(r => r.userId === user1?.id);
    const user2Run = data.runs.find(r => r.userId === user2?.id);

    expect(user1Run?.distance).toBe(5);
    expect(user2Run?.distance).toBe(15);

    const user1Goal = data.goals.find(g => g.userId === user1?.id);
    const user2Goal = data.goals.find(g => g.userId === user2?.id);

    expect(user1Goal?.type).toBe('FREQUENCY');
    expect(user2Goal?.type).toBe('DISTANCE');
  });

  test('factory data can be saved to database', async () => {
    // Build data using builders
    const userData = await user()
      .withEmail('save-test@example.com')
      .withName('Save Test User')
      .build();

    // Save to database
    const savedUser = await prisma.user.create({
      data: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        password: userData.password,
      },
    });
    createdUserIds.push(savedUser.id);

    // Build run data
    const runData = await run()
      .withUserId(savedUser.id)
      .withDistance(8.5)
      .withDuration(2700)
      .build();

    // Save to database
    const savedRun = await prisma.run.create({
      data: runData,
    });

    // Verify in database
    const dbRun = await prisma.run.findUnique({
      where: { id: savedRun.id },
      include: { user: true },
    });

    expect(dbRun).toBeTruthy();
    expect(dbRun?.distance).toBe(8.5);
    expect(dbRun?.duration).toBe(2700);
    expect(dbRun?.user.email).toBe('save-test@example.com');
  });

  test('error handling works correctly', async () => {
    // Builder validation
    await expect(run().withDistance(10).build()).rejects.toThrow('UserId is required for Run');

    // Invalid scenario
    await expect(
      scenario()
        .addUser()
        .addRunForUser(5, r => r.asEasyRun()) // Invalid user index
        .build()
    ).rejects.toThrow();
  });
});
