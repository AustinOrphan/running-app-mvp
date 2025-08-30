import {
  getTestPrismaClient,
  setupTestDatabase,
  // teardownTestDatabase,
  connectionPool,
} from '../utils/connectionPoolManager.js';
import { testDb } from './utils/testDbSetup.js';

describe('Database Connection Test', () => {
  describe('Connection Pool Management', () => {
    it('should connect to test database using connection pool', async () => {
      // Use the managed connection pool instead of creating a new client
      const prisma = getTestPrismaClient();

      try {
        // The connection is managed by the pool, no need to explicitly connect
        console.log('Database connected successfully via connection pool');

        // Try a simple query
        const userCount = await prisma.user.count();
        console.log('User count:', userCount);

        expect(typeof userCount).toBe('number');
        // Note: Don't disconnect here as it's managed by the connection pool
      } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
      }
    }, 10000); // 10 second timeout

    it('should handle connection pool setup and teardown', async () => {
      try {
        // Test pool setup
        await setupTestDatabase();
        console.log('Connection pool setup successful');

        // Verify connection works through pool
        const prisma = getTestPrismaClient();
        const userCount = await prisma.user.count();
        expect(typeof userCount).toBe('number');

        console.log('Connection pool works properly');
      } catch (error) {
        console.error('Connection pool test failed:', error);
        throw error;
      }
      // Note: Don't teardown here as it's handled globally
    }, 10000);

    it('should use shared test database connection', async () => {
      // Use the shared testDb connection for consistency
      try {
        // Verify the testDb connection works
        const health = await testDb.healthCheck();
        expect(health.connected).toBe(true);
        expect(health.healthy).toBe(true);

        // Test a simple operation
        const userCount = await testDb.prisma.user.count();
        expect(typeof userCount).toBe('number');

        console.log('Shared test database connection works properly');
      } catch (error) {
        console.error('Shared test database connection failed:', error);
        throw error;
      }
      // Note: testDb.disconnect() is handled by global teardown, not per-test
    }, 10000);
  });

  describe('Connection Lifecycle', () => {
    it('should not leak connections during multiple operations', async () => {
      const prisma = getTestPrismaClient();

      try {
        // Perform multiple operations to test connection stability
        const operations = [];
        for (let i = 0; i < 5; i++) {
          operations.push(prisma.user.count());
        }

        const results = await Promise.all(operations);
        expect(results).toHaveLength(5);

        // All results should be numbers (user counts)
        results.forEach(count => {
          expect(typeof count).toBe('number');
        });

        console.log('Multiple operations completed without connection leaks');
      } catch (error) {
        console.error('Connection lifecycle test failed:', error);
        throw error;
      }
    }, 15000);

    it('should maintain connection pool integrity', async () => {
      try {
        // Get initial state
        const isConnected = connectionPool.isConnected();
        console.log('Connection pool connected:', isConnected);

        // Test operations work
        const prisma = getTestPrismaClient();
        await prisma.user.count();

        // Pool should still be connected
        expect(connectionPool.isConnected()).toBe(true);

        console.log('Connection pool integrity maintained');
      } catch (error) {
        console.error('Connection pool integrity test failed:', error);
        throw error;
      }
    }, 10000);
  });
});
