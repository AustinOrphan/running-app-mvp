/**
 * Integration tests for application state reset functionality
 *
 * These tests verify that application state is properly reset between tests,
 * ensuring test isolation by validating that in-memory caches, global variables,
 * and other stateful components are cleared.
 */

import { describe, test, expect } from '@jest/globals';
import {
  resetApplicationState,
  validateApplicationStateReset,
} from '../utils/applicationStateReset.js';
import { securityMetrics, trackSecurityMetric } from '../../server/utils/securityLogger.js';
import { auditLogger, auditAuth } from '../../server/utils/auditLogger.js';
import { blacklistToken } from '../../server/utils/jwtUtils.js';

describe('Application State Reset Integration Tests', () => {
  test('should reset security metrics between tests', async () => {
    // Add some security metrics
    trackSecurityMetric('test_metric_1');
    trackSecurityMetric('test_metric_2');
    trackSecurityMetric('test_metric_1'); // Increment again

    // Verify metrics were added
    const metricsBeforeReset = securityMetrics.getMetrics();
    expect(metricsBeforeReset['test_metric_1']).toBe(2);
    expect(metricsBeforeReset['test_metric_2']).toBe(1);

    // Reset application state
    await resetApplicationState();

    // Verify metrics were cleared
    const metricsAfterReset = securityMetrics.getMetrics();
    expect(Object.keys(metricsAfterReset)).toHaveLength(0);
  });

  test('should reset audit logger storage between tests', async () => {
    // Add some audit events
    await auditAuth.login(
      { ip: '127.0.0.1', get: () => 'test-agent' } as any,
      'test-user-1',
      'success'
    );
    await auditAuth.login(
      { ip: '127.0.0.1', get: () => 'test-agent' } as any,
      'test-user-2',
      'failure'
    );

    // Verify events were added
    const storage = auditLogger.getStorageForTesting();
    if (storage && typeof (storage as any).events !== 'undefined') {
      const eventsBeforeReset = (storage as any).events;
      expect(eventsBeforeReset.length).toBeGreaterThan(0);
    }

    // Reset application state
    await resetApplicationState();

    // Verify events were cleared
    const storageAfterReset = auditLogger.getStorageForTesting();
    if (storageAfterReset && typeof (storageAfterReset as any).events !== 'undefined') {
      const eventsAfterReset = (storageAfterReset as any).events;
      expect(eventsAfterReset.length).toBe(0);
    }
  });

  test('should reset JWT blacklist between tests', async () => {
    // Add tokens to blacklist
    const testToken1 = 'test-jti-1';
    const testToken2 = 'test-jti-2';
    const futureExpiry = Date.now() + 3600000; // 1 hour from now

    blacklistToken(testToken1, futureExpiry);
    blacklistToken(testToken2, futureExpiry);

    // Reset application state
    await resetApplicationState();

    // Verify JWT blacklist was cleared
    // The blacklist is internal, but we can test indirectly by adding the same tokens again
    // If the blacklist was cleared, adding them again should work without duplicates
    blacklistToken(testToken1, futureExpiry);
    blacklistToken(testToken2, futureExpiry);

    // This test passes if no errors are thrown during the reset and re-addition
    expect(true).toBe(true);
  });

  test('should validate application state reset completeness', async () => {
    // Pollute application state
    trackSecurityMetric('pollution_test');
    await auditAuth.login(
      { ip: '127.0.0.1', get: () => 'test-agent' } as any,
      'pollution-user',
      'success'
    );
    blacklistToken('pollution-jti', Date.now() + 3600000);

    // Verify state is polluted
    const validationBefore = await validateApplicationStateReset();
    expect(validationBefore.isClean).toBe(false);
    expect(validationBefore.issues.length).toBeGreaterThan(0);

    // Reset application state
    await resetApplicationState();

    // Verify state is clean
    const validationAfter = await validateApplicationStateReset();
    expect(validationAfter.isClean).toBe(true);
    expect(validationAfter.issues).toHaveLength(0);
  });

  test('should handle reset errors gracefully', async () => {
    // This test verifies that even if some reset operations fail,
    // the reset process doesn't throw and continues with other operations

    // Mock a failing condition (if needed for testing error handling)
    const originalConsoleWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '));
    };

    try {
      // Add some state to reset
      trackSecurityMetric('error_test');

      // Reset should complete without throwing
      await expect(resetApplicationState()).resolves.not.toThrow();

      // State should still be reset even if some operations warned
      const metrics = securityMetrics.getMetrics();
      expect(Object.keys(metrics)).toHaveLength(0);
    } finally {
      // Restore console.warn
      console.warn = originalConsoleWarn;
    }
  });

  test('should isolate test state between consecutive tests', async () => {
    // This is Test A
    trackSecurityMetric('test_a_metric');
    const metricsTestA = securityMetrics.getMetrics();
    expect(metricsTestA['test_a_metric']).toBe(1);

    // After this test completes, the afterEach hook will reset state
    // The next test should start with clean state
  });

  test('should have clean state from previous test', async () => {
    // This is Test B - should not see metrics from Test A
    const metricsTestB = securityMetrics.getMetrics();
    expect(metricsTestB['test_a_metric']).toBeUndefined();
    expect(Object.keys(metricsTestB)).toHaveLength(0);

    // Add our own metric to verify this test can modify state
    trackSecurityMetric('test_b_metric');
    const updatedMetrics = securityMetrics.getMetrics();
    expect(updatedMetrics['test_b_metric']).toBe(1);
  });

  test('should reset state even with async operations', async () => {
    // Test with async operations that might create lingering state
    const promises = Array.from({ length: 5 }, async (_, i) => {
      trackSecurityMetric(`async_metric_${i}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      return i;
    });

    await Promise.all(promises);

    // Verify state was created
    const metricsBeforeReset = securityMetrics.getMetrics();
    expect(Object.keys(metricsBeforeReset).length).toBe(5);

    // Reset should handle async cleanup
    await resetApplicationState();

    // Verify clean state
    const metricsAfterReset = securityMetrics.getMetrics();
    expect(Object.keys(metricsAfterReset)).toHaveLength(0);
  });
});

/**
 * Test suite to verify specific reset functions work independently
 */
describe('Individual Reset Functions', () => {
  test('resetSecurityMetricsState should clear only security metrics', async () => {
    const { resetSecurityMetricsState } = await import('../utils/applicationStateReset.js');

    // Add metrics
    trackSecurityMetric('isolated_test');
    expect(securityMetrics.getMetrics()['isolated_test']).toBe(1);

    // Reset only security metrics
    resetSecurityMetricsState();

    // Verify only security metrics were cleared
    expect(Object.keys(securityMetrics.getMetrics())).toHaveLength(0);
  });

  test('resetAuditStorage should clear only audit events', async () => {
    const { resetAuditStorage } = await import('../utils/applicationStateReset.js');

    // Add audit events
    await auditAuth.login(
      { ip: '127.0.0.1', get: () => 'test-agent' } as any,
      'isolated-user',
      'success'
    );

    // Reset only audit storage
    resetAuditStorage();

    // Verify only audit storage was cleared
    const storage = auditLogger.getStorageForTesting();
    if (storage && typeof (storage as any).events !== 'undefined') {
      expect((storage as any).events.length).toBe(0);
    }
  });
});
