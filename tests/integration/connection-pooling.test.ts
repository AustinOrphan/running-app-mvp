import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { testDb } from './utils/testDbSetup.js';
import { testDataUtils } from '../utils/testDataIsolationManager.js';

describe('Database Connection Pooling', () => {
  beforeAll(async () => {
    await testDb.initialize();
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  it('should maintain healthy connection pool', async () => {
    const healthCheck = await testDb.checkPoolHealth();

    expect(healthCheck.healthy).toBe(true);
    expect(healthCheck.connectionActive).toBe(true);
    expect(healthCheck.responseTime).toBeLessThan(1000); // Should be fast for SQLite
  });

  it('should handle multiple concurrent operations without connection leaks', async () => {
    // Create multiple concurrent database operations
    const operations = Array.from({ length: 5 }, async (_, index) => {
      const user = await testDb.createUser({
        email: testDataUtils.generateUniqueEmail(`concurrent-user-${index}`),
        name: `Concurrent User ${index}`,
      });

      // Perform some operations
      await testDb.prisma.user.findUnique({ where: { id: user.id } });
      await testDb.prisma.user.update({
        where: { id: user.id },
        data: { name: `Updated User ${index}` },
      });

      return user;
    });

    // Execute all operations concurrently
    const results = await Promise.all(operations);

    expect(results).toHaveLength(5);
    results.forEach((user, index) => {
      expect(user.email).toContain(`concurrent-user-${index}`);
    });

    // Check that connection pool is still healthy after concurrent operations
    const healthCheck = await testDb.checkPoolHealth();
    expect(healthCheck.healthy).toBe(true);
  });

  it('should recover from connection issues', async () => {
    // Verify initial health
    let healthCheck = await testDb.checkPoolHealth();
    expect(healthCheck.healthy).toBe(true);

    // Force disconnect
    await testDb.disconnect();

    // Verify disconnection
    healthCheck = await testDb.checkPoolHealth();
    expect(healthCheck.healthy).toBe(false);

    // Force reconnection
    const reconnected = await testDb.forceReconnect();
    expect(reconnected).toBe(true);

    // Verify health is restored
    healthCheck = await testDb.checkPoolHealth();
    expect(healthCheck.healthy).toBe(true);
  });

  it('should properly clean up connections after operations', async () => {
    // Perform some database operations
    const user = await testDb.createUser({
      email: testDataUtils.generateUniqueEmail('cleanup-test'),
      name: 'Cleanup Test User',
    });

    // Check initial state
    const initialHealth = await testDb.checkPoolHealth();
    expect(initialHealth.healthy).toBe(true);

    // Note: Manual cleanup removed to avoid interfering with global cleanup strategy
    // Database cleanup is handled by jestSetup.ts afterEach hook

    // Verify health is maintained
    const postOperationHealth = await testDb.checkPoolHealth();
    expect(postOperationHealth.healthy).toBe(true);

    // The user will be cleaned up by the global cleanup after this test
  });

  it('should handle rapid connect/disconnect cycles', async () => {
    const cycles = 3;

    for (let i = 0; i < cycles; i++) {
      // Connect and perform operation
      const user = await testDb.createUser({
        email: testDataUtils.generateUniqueEmail(`cycle-${i}`),
        name: `Cycle User ${i}`,
      });

      // Verify operation succeeded
      expect(user.id).toBeDefined();

      // Check health
      const health = await testDb.checkPoolHealth();
      expect(health.healthy).toBe(true);

      // Note: Manual cleanup removed to prevent test order dependencies
      // Global cleanup handles database state between tests
    }

    // Final health check
    const finalHealth = await testDb.checkPoolHealth();
    expect(finalHealth.healthy).toBe(true);
  });

  it('should detect and handle connection timeouts', async () => {
    const healthCheck = await testDb.checkPoolHealth();

    // For SQLite, response times should be very fast
    expect(healthCheck.responseTime).toBeLessThan(500);
    expect(healthCheck.healthy).toBe(true);
  });

  it('should maintain connection stability during stress test', async () => {
    const numberOfOperations = 10;
    const operations = [];

    // Create a mix of different operations
    for (let i = 0; i < numberOfOperations; i++) {
      if (i % 3 === 0) {
        // Create user operation
        operations.push(
          testDb.createUser({
            email: testDataUtils.generateUniqueEmail(`stress-user-${i}`),
            name: `Stress User ${i}`,
          })
        );
      } else if (i % 3 === 1) {
        // Health check operation
        operations.push(testDb.checkPoolHealth());
      } else {
        // Raw query operation
        operations.push(testDb.prisma.$queryRaw`SELECT datetime('now') as current_time`);
      }
    }

    // Execute all operations
    const results = await Promise.all(operations);

    expect(results).toHaveLength(numberOfOperations);

    // Verify final connection health
    const finalHealth = await testDb.checkPoolHealth();
    expect(finalHealth.healthy).toBe(true);
  });
});
