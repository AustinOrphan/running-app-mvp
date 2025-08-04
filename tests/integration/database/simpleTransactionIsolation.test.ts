/**
 * Simple test to demonstrate transaction-based test isolation
 *
 * This test shows how transaction rollback works without complex setup
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

describe('Simple Transaction Isolation Demo', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Setup Prisma client
    const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/test.db';
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('transaction rollback isolation - manual example', async () => {
    // Clean database first
    await prisma.user.deleteMany();

    // Start count
    const startCount = await prisma.user.count();
    console.log(`Start count: ${startCount}`);

    try {
      // Run operations in a transaction
      await prisma.$transaction(async tx => {
        // Create user within transaction
        const user = await tx.user.create({
          data: {
            email: 'transaction-test@example.com',
            name: 'Transaction Test',
            password: await bcrypt.hash('password123', 10),
          },
        });

        console.log(`Created user: ${user.email}`);

        // Verify user exists within transaction
        const countInTx = await tx.user.count();
        console.log(`Count inside transaction: ${countInTx}`);
        expect(countInTx).toBe(startCount + 1);

        // Create more data
        await tx.run.create({
          data: {
            userId: user.id,
            date: new Date(),
            distance: 5.0,
            duration: 1800,
          },
        });

        const runCount = await tx.run.count();
        console.log(`Runs inside transaction: ${runCount}`);

        // Intentionally throw to rollback
        throw new Error('ROLLBACK_TEST');
      });
    } catch {
      console.log('Transaction rolled back as expected');
    }

    // Verify rollback worked
    const endCount = await prisma.user.count();
    const runCount = await prisma.run.count();

    console.log(`End user count: ${endCount}`);
    console.log(`End run count: ${runCount}`);

    expect(endCount).toBe(startCount);
    expect(runCount).toBe(0);
  });

  test('multiple tests with isolation', async () => {
    // This test should see clean database
    const userCount = await prisma.user.count();
    console.log(`Test 2 - User count: ${userCount}`);
    expect(userCount).toBe(0);

    // Create data normally (not in transaction)
    const user = await prisma.user.create({
      data: {
        email: 'persistent-user@example.com',
        name: 'Persistent User',
        password: await bcrypt.hash('password123', 10),
      },
    });

    expect(user.id).toBeDefined();

    // This will persist since it's not in a rolled-back transaction
    const afterCreateCount = await prisma.user.count();
    expect(afterCreateCount).toBe(1);
  });

  test('automated transaction isolation with helper', async () => {
    // Helper function to run test in transaction
    async function runInTransaction<T>(
      testFn: (tx: PrismaClient) => Promise<T>
    ): Promise<T | undefined> {
      try {
        const result = await prisma.$transaction(async tx => {
          const testResult = await testFn(tx as any);
          // Always rollback by throwing
          throw { rollback: true, result: testResult };
        });
        return result;
      } catch (error: any) {
        if (error.rollback) {
          return error.result;
        }
        throw error;
      }
    }

    // Use the helper
    const result = await runInTransaction(async tx => {
      const user = await tx.user.create({
        data: {
          email: 'helper-test@example.com',
          name: 'Helper Test',
          password: await bcrypt.hash('password123', 10),
        },
      });

      const run = await tx.run.create({
        data: {
          userId: user.id,
          date: new Date(),
          distance: 10.0,
          duration: 3600,
        },
      });

      // Return test results
      return { userId: user.id, runId: run.id };
    });

    console.log('Transaction result:', result);
    expect(result?.userId).toBeDefined();
    expect(result?.runId).toBeDefined();

    // Verify data was rolled back
    const users = await prisma.user.findMany({
      where: { email: 'helper-test@example.com' },
    });
    expect(users).toHaveLength(0);
  });

  afterEach(async () => {
    // Clean up any persistent data
    await prisma.run.deleteMany();
    await prisma.goal.deleteMany();
    await prisma.race.deleteMany();
    await prisma.user.deleteMany();
  });
});
