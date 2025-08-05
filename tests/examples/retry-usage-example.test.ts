/**
 * Example Test File: Retry Logic Usage Examples
 *
 * This file demonstrates various ways to use the retry functionality
 * across different test scenarios and frameworks.
 */

import { describe, it, expect } from 'vitest';
import { retry, retryDatabaseOperation, retryNetworkRequest } from '../utils/retryUtils';
import { testWithRetry } from '../setup/vitestRetrySetup';
import { getRetryCount, isFlakyTest } from '../config/retryConfig';

describe('Retry Usage Examples', () => {
  it('should demonstrate basic retry functionality', async () => {
    let attempts = 0;

    const result = await retry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Simulated flaky operation');
        }
        return 'success';
      },
      {
        maxAttempts: 3,
        delayMs: 100, // Short delay for test speed
        description: 'flaky operation demo',
      }
    );

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should demonstrate database operation retry', async () => {
    let dbAttempts = 0;

    const dbResult = await retryDatabaseOperation(
      async () => {
        dbAttempts++;
        if (dbAttempts < 2) {
          const error = new Error('Connection timeout');
          throw error;
        }
        return { id: 1, name: 'test' };
      },
      {
        maxAttempts: 3,
        delayMs: 50,
        description: 'database query',
      }
    );

    expect(dbResult).toEqual({ id: 1, name: 'test' });
    expect(dbAttempts).toBe(2);
  });

  it('should demonstrate network request retry', async () => {
    let networkAttempts = 0;

    const networkResult = await retryNetworkRequest(
      async () => {
        networkAttempts++;
        if (networkAttempts < 2) {
          const error = new Error('ECONNRESET: Connection reset');
          throw error;
        }
        return { status: 200, data: 'response' };
      },
      {
        maxAttempts: 3,
        delayMs: 50,
        description: 'API request',
      }
    );

    expect(networkResult).toEqual({ status: 200, data: 'response' });
    expect(networkAttempts).toBe(2);
  });

  it('should respect retry configuration for flaky tests', () => {
    // Check if this test is configured as flaky
    const fileName = __filename.split('/').pop() || '';
    const isFlaky = isFlakyTest(fileName, 'should respect retry configuration for flaky tests');
    const retryCount = getRetryCount(
      fileName,
      'should respect retry configuration for flaky tests',
      'unit'
    );

    // These would be 0 for regular tests, but might be higher for configured flaky tests
    expect(typeof isFlaky).toBe('boolean');
    expect(typeof retryCount).toBe('number');
    expect(retryCount).toBeGreaterThanOrEqual(0);
  });

  // Example of using testWithRetry wrapper
  testWithRetry(
    'should demonstrate testWithRetry wrapper',
    async () => {
      // This test will automatically retry based on configuration
      const randomFailure = Math.random() < 0.3; // 30% chance of failure

      if (randomFailure && process.env.NODE_ENV === 'test-simulate-flaky') {
        throw new Error('Random test failure for demonstration');
      }

      expect(true).toBe(true);
    },
    { retries: 2 }
  );

  it('should handle assertion errors correctly (no retry)', async () => {
    // Assertion errors should not be retried
    let assertionAttempts = 0;

    try {
      await retry(
        async () => {
          assertionAttempts++;
          expect(1).toBe(2); // This will always fail
        },
        {
          maxAttempts: 3,
          delayMs: 10,
          description: 'assertion test',
        }
      );
    } catch (error) {
      // Should only attempt once since it's an assertion error
      expect(assertionAttempts).toBe(1);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('should demonstrate exponential backoff', async () => {
    const attemptTimes: number[] = [];
    let attempts = 0;

    try {
      await retry(
        async () => {
          attemptTimes.push(Date.now());
          attempts++;
          throw new Error('Always fail for backoff demo');
        },
        {
          maxAttempts: 3,
          delayMs: 100,
          backoffMultiplier: 2.0,
          description: 'backoff demo',
        }
      );
    } catch {
      expect(attempts).toBe(3);
      expect(attemptTimes).toHaveLength(3);

      // Check that delays increased (with some tolerance for timing)
      if (attemptTimes.length >= 2) {
        const firstDelay = attemptTimes[1] - attemptTimes[0];
        expect(firstDelay).toBeGreaterThan(80); // ~100ms with tolerance
      }

      if (attemptTimes.length >= 3) {
        const secondDelay = attemptTimes[2] - attemptTimes[1];
        expect(secondDelay).toBeGreaterThan(150); // ~200ms with tolerance
      }
    }
  });

  describe('Error Pattern Recognition', () => {
    it('should retry network errors', async () => {
      let attempts = 0;

      const result = await retry(
        async () => {
          attempts++;
          if (attempts === 1) throw new Error('ECONNRESET');
          if (attempts === 2) throw new Error('ETIMEDOUT');
          return 'success';
        },
        {
          maxAttempts: 3,
          delayMs: 10,
          description: 'network error patterns',
        }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should retry timeout errors', async () => {
      let attempts = 0;

      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error('Operation timeout after 5000ms');
          return 'success';
        },
        {
          maxAttempts: 2,
          delayMs: 10,
          description: 'timeout error patterns',
        }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should not retry syntax errors', async () => {
      let attempts = 0;

      try {
        await retry(
          async () => {
            attempts++;
            throw new SyntaxError('Unexpected token');
          },
          {
            maxAttempts: 3,
            delayMs: 10,
            description: 'syntax error test',
          }
        );
      } catch (error) {
        expect(attempts).toBe(1); // Should not retry syntax errors
        expect(error).toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe('CI-Specific Behavior', () => {
    it('should adapt retry behavior based on environment', () => {
      const originalCI = process.env.CI;

      // Test local environment behavior
      process.env.CI = '';
      const localRetries = getRetryCount('test.ts', 'example test', 'unit');

      // Test CI environment behavior
      process.env.CI = 'true';
      const ciRetries = getRetryCount('test.ts', 'example test', 'unit');

      // Restore original environment
      process.env.CI = originalCI;

      // CI should generally have more retries
      expect(ciRetries).toBeGreaterThanOrEqual(localRetries);
    });
  });
});

/**
 * Usage Examples in Comments:
 *
 * 1. Basic retry with custom options:
 * ```typescript
 * await retry(async () => {
 *   return await someFlakeyOperation();
 * }, {
 *   maxAttempts: 3,
 *   delayMs: 1000,
 *   description: 'my operation',
 * });
 * ```
 *
 * 2. Database operation with retry:
 * ```typescript
 * await retryDatabaseOperation(async () => {
 *   return await db.query('SELECT * FROM users');
 * });
 * ```
 *
 * 3. Network request with retry:
 * ```typescript
 * await retryNetworkRequest(async () => {
 *   return await fetch('/api/data');
 * });
 * ```
 *
 * 4. Test with automatic retry:
 * ```typescript
 * testWithRetry('flaky test', async () => {
 *   // Test implementation
 * }, { retries: 2 });
 * ```
 *
 * 5. Playwright action with retry:
 * ```typescript
 * await retryPlaywrightAction(page, async () => {
 *   await page.click('[data-testid="button"]');
 * });
 * ```
 *
 * Configuration Tips:
 * - Set AUTO_RETRY_FLAKY_TESTS=true to enable automatic retries for known flaky tests
 * - Set DEBUG_TESTS=true to see detailed retry logging
 * - Use environment-specific configuration in retryConfig.ts
 * - Track flaky tests and update configuration as needed
 */
