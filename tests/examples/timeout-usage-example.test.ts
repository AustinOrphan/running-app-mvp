/**
 * Example Test File: Timeout Usage Examples
 *
 * This file demonstrates various ways to use the timeout configuration system.
 */

import { describe, it, expect } from 'vitest';
import {
  /* setTimeoutForFile, */ setTimeoutForTest,
  autoApplyTimeout,
} from '../setup/timeoutSetup';

// Example 1: Auto-apply timeout based on file name detection
// This will automatically detect this is a test file and apply appropriate timeout
autoApplyTimeout();

// Example 2: Manually set timeout for entire file
// setTimeoutForFile(__filename);

describe('Timeout Usage Examples', () => {
  it('should use default timeout from file configuration', async () => {
    // This test will use the timeout configured for the entire file
    // or the default 30s baseline timeout

    await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
    expect(true).toBe(true);
  });

  it('should use specific timeout for slow operation', async () => {
    // Example 3: Set specific timeout for this individual test case
    setTimeoutForTest(__filename, 'should use specific timeout for slow operation');

    // Simulate a slow operation (3 seconds)
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(true).toBe(true);
  });

  it('should handle encryption operations with appropriate timeout', async () => {
    // This test would get extended timeout if it matches patterns in SPECIFIC_TEST_TIMEOUTS
    // or if the file is in the slow test configuration

    // Simulate crypto operations
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect(true).toBe(true);
  });

  describe('Performance tests', () => {
    it('should measure performance with extended timeout', async () => {
      // Set specific timeout for performance measurement
      setTimeoutForTest(__filename, 'should measure performance with extended timeout');

      // Simulate performance measurement
      const start = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5s operation
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThan(4000);
    });
  });
});

// Example 4: Different timeout strategies for different test types
describe('Database operations', () => {
  // These tests would automatically get longer timeouts if this file
  // is listed in SLOW_TESTS_CONFIG.integration

  it('should handle complex database queries', async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect(true).toBe(true);
  });

  it('should handle database migrations', async () => {
    // This specific test needs extra time
    setTimeoutForTest(__filename, 'should handle database migrations');

    await new Promise(resolve => setTimeout(resolve, 4000));
    expect(true).toBe(true);
  });
});

/**
 * Usage Notes:
 *
 * 1. File-level timeouts: Add filename to SLOW_TESTS_CONFIG in slowTestTimeouts.ts
 * 2. Specific file overrides: Add to SPECIFIC_TEST_TIMEOUTS for custom file timeouts
 * 3. Individual test timeouts: Use setTimeoutForTest() for specific test cases
 * 4. Auto-detection: Use autoApplyTimeout() for automatic timeout detection
 *
 * Priority order (highest to lowest):
 * - Individual test case timeouts (setTimeoutForTest)
 * - Specific file timeout overrides (SPECIFIC_TEST_TIMEOUTS)
 * - Test category timeouts (SLOW_TESTS_CONFIG)
 * - Global baseline timeout (30s)
 *
 * Environment adjustments:
 * - CI gets 2x-3x longer timeouts automatically
 * - Windows gets 1.5x longer timeouts automatically
 * - Platform adjustments are applied to all timeout levels
 */
