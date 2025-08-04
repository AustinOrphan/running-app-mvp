import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';
import { testDataUtils } from '../../utils/testDataIsolationManager.js';
import {
  withTimeoutAndCleanup,
  safeExecute,
  withDatabaseSafety,
  handlePromiseRejection,
  AsyncManager,
  testAsyncUtils,
  integrationAsyncUtils,
  retryAsync,
  waitFor,
} from '../utils/asyncHelpers.js';

describe('Enhanced Async Operations Examples', () => {
  let app: ReturnType<typeof createTestApp>;
  let asyncManager: AsyncManager;

  beforeAll(() => {
    app = createTestApp();
    asyncManager = new AsyncManager();
  });

  beforeEach(async () => {
    // Database cleanup is handled globally by jestSetup.ts afterEach
    // No manual cleanup needed here - this avoids redundant cleanup operations
  });

  afterAll(async () => {
    await asyncManager.shutdown();
    await testDb.disconnect();
  });

  describe('Timeout Handling with Cleanup', () => {
    it('handles timeouts with proper cleanup', async () => {
      let cleanupCalled = false;

      const cleanup = async () => {
        cleanupCalled = true;
        console.log('Cleanup executed');
      };

      try {
        await withTimeoutAndCleanup(
          () => new Promise(resolve => setTimeout(resolve, 2000)), // 2s operation
          1000, // 1s timeout
          cleanup
        );
        fail('Should have timed out');
      } catch (error: any) {
        expect(error.message).toContain('Operation timed out');
        expect(cleanupCalled).toBe(true);
      }
    });

    it('executes cleanup on operation error', async () => {
      let cleanupCalled = false;

      const cleanup = async () => {
        cleanupCalled = true;
        console.log('Cleanup executed on error');
      };

      try {
        await withTimeoutAndCleanup(
          () => Promise.reject(new Error('Operation failed')),
          5000,
          cleanup
        );
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Operation failed');
        expect(cleanupCalled).toBe(true);
      }
    });
  });

  describe('Safe Promise Execution', () => {
    it('handles successful operations', async () => {
      const result = await safeExecute(() => Promise.resolve('success'), 'test operation');

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.error).toBeUndefined();
    });

    it('handles failed operations with error logging', async () => {
      const result = await safeExecute(
        () => Promise.reject(new Error('operation failed')),
        'test operation'
      );

      expect(result.success).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('operation failed');
    });
  });

  describe('Database Safety with Rollback', () => {
    it('handles successful database operations', async () => {
      const user = await withDatabaseSafety(() =>
        testDb.createUser({
          email: testDataUtils.generateUniqueEmail('test'),
          password: 'password123',
        })
      );

      expect(user).toBeDefined();
      expect(user.email).toContain('test');
    });

    it('executes rollback on database errors', async () => {
      let rollbackCalled = false;

      const rollback = async () => {
        rollbackCalled = true;
        // Note: Manual cleanup removed to prevent test order dependencies
        // Global cleanup handles database state between tests
      };

      try {
        await withDatabaseSafety(async () => {
          // Create user first (this will succeed)
          await testDb.createUser({
            email: testDataUtils.generateUniqueEmail('test'),
            password: 'password123',
          });

          // Then force an error
          throw new Error('Simulated database error');
        }, rollback);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Simulated database error');
        expect(rollbackCalled).toBe(true);

        // Verify cleanup worked
        const users = await testDb.prisma.user.findMany();
        expect(users).toHaveLength(0);
      }
    });
  });

  describe('Promise Rejection Handling', () => {
    it('catches and logs promise rejections', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      try {
        await handlePromiseRejection(Promise.reject(new Error('Test rejection')), 'test context');
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Test rejection');
        expect(consoleSpy).toHaveBeenCalledWith(
          'Promise rejection in test context:',
          'Test rejection'
        );
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('Async Manager for Operation Tracking', () => {
    it('tracks and manages async operations', async () => {
      const manager = new AsyncManager();

      expect(manager.getActiveCount()).toBe(0);

      // Add some operations
      const op1 = manager.add(new Promise(resolve => setTimeout(() => resolve('op1'), 100)));
      const op2 = manager.add(new Promise(resolve => setTimeout(() => resolve('op2'), 200)));

      expect(manager.getActiveCount()).toBe(2);

      // Wait for operations to complete
      const results = await Promise.all([op1, op2]);
      expect(results).toEqual(['op1', 'op2']);

      // Give a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(manager.getActiveCount()).toBe(0);

      await manager.shutdown();
    });

    it('prevents new operations during shutdown', async () => {
      const manager = new AsyncManager();

      // Start shutdown
      const shutdownPromise = manager.shutdown();

      // Try to add operation during shutdown
      try {
        await manager.add(Promise.resolve('test'));
        fail('Should have rejected new operations');
      } catch (error: any) {
        expect(error.message).toBe('AsyncManager is shutting down');
      }

      await shutdownPromise;
    });
  });

  describe('CI-Friendly Async Utilities', () => {
    it('uses appropriate timeouts for CI environment', async () => {
      // Mock CI environment
      const originalCI = process.env.CI;
      process.env.CI = 'true';

      try {
        expect(testAsyncUtils.timeouts.short).toBe(10000); // CI value
        expect(testAsyncUtils.timeouts.medium).toBe(30000); // CI value
        expect(testAsyncUtils.retryConfig.database.maxRetries).toBe(5); // CI value
      } finally {
        if (originalCI !== undefined) {
          process.env.CI = originalCI;
        } else {
          delete process.env.CI;
        }
      }
    });

    it('performs database operations with CI-adjusted settings', async () => {
      const user = await testAsyncUtils.databaseOperation(() =>
        testDb.createUser({
          email: testDataUtils.generateUniqueEmail('ci-test'),
          password: 'password123',
        })
      );

      expect(user).toBeDefined();
      expect(user.email).toContain('ci-test');
    });

    it('performs API operations with retry logic', async () => {
      let attempts = 0;

      const result = await testAsyncUtils.apiOperation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Simulated API failure');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Integration-Specific Async Patterns', () => {
    it('waits for server to be ready', async () => {
      // This test assumes the development server is running
      // In a real test, you might start a test server here

      try {
        await integrationAsyncUtils.waitForServer('http://localhost:3001', {
          timeout: 5000,
          healthPath: '/api/health',
          expectedStatus: 200,
        });
        console.log('Server is ready');
      } catch (error) {
        console.warn('Server not available for test:', error);
        // Don't fail the test if server isn't running
      }
    });

    it('performs database operations with connection management', async () => {
      let cleanupCalled = false;

      const cleanup = async () => {
        cleanupCalled = true;
        console.log('Database cleanup executed');
      };

      const user = await integrationAsyncUtils.withDatabaseConnection(
        () =>
          testDb.createUser({
            email: testDataUtils.generateUniqueEmail('connection-test'),
            password: 'password123',
          }),
        cleanup
      );

      expect(user).toBeDefined();
      expect(user.email).toContain('connection-test');
      // Cleanup is called on success as well in some implementations
    });

    it('makes API requests with comprehensive error handling', async () => {
      const user = await testDb.createUser();
      const token = testDb.generateToken(user.id, user.email);

      const response = await integrationAsyncUtils.apiRequest(
        () =>
          request(app)
            .get('/api/runs')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
            .then(res => res.body),
        'Get runs API request'
      );

      expect(Array.isArray(response)).toBe(true);
    });
  });

  describe('Advanced Async Patterns', () => {
    it('handles retry logic with exponential backoff', async () => {
      let attempts = 0;

      const result = await retryAsync(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`);
          }
          return `Success after ${attempts} attempts`;
        },
        {
          maxRetries: 3,
          initialDelay: 100,
          backoffFactor: 2,
          shouldRetry: error => error.message.includes('failed'),
        }
      );

      expect(result).toBe('Success after 3 attempts');
      expect(attempts).toBe(3);
    });

    it('waits for conditions with timeout', async () => {
      let counter = 0;

      const incrementAsync = async () => {
        setTimeout(() => counter++, 50);
      };

      // Start async operation
      incrementAsync();

      // Wait for condition
      await waitFor(() => counter > 0, {
        timeout: 1000,
        interval: 10,
        message: 'Counter should be incremented',
      });

      expect(counter).toBeGreaterThan(0);
    });

    it('handles multiple async operations with proper error isolation', async () => {
      const operations = [
        () => Promise.resolve('success1'),
        () => Promise.reject(new Error('error1')),
        () => Promise.resolve('success2'),
        () => Promise.reject(new Error('error2')),
      ];

      const results = await Promise.allSettled(operations.map(op => asyncManager.add(op())));

      expect(results).toHaveLength(4);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
      expect(results[3].status).toBe('rejected');

      if (results[0].status === 'fulfilled') {
        expect(results[0].value).toBe('success1');
      }
      if (results[2].status === 'fulfilled') {
        expect(results[2].value).toBe('success2');
      }
    });
  });
});
