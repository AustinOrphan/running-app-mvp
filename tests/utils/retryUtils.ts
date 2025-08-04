/**
 * Test Retry Utilities
 *
 * Provides retry logic for flaky tests across different test frameworks
 * with configurable retry counts, delays, and logging.
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  delayMs?: number;
  /** Exponential backoff multiplier (default: 1.5) */
  backoffMultiplier?: number;
  /** Maximum delay between retries in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Whether to log retry attempts (default: true in CI, false locally) */
  logRetries?: boolean;
  /** Custom description for the operation being retried */
  description?: string;
  /** Function to determine if an error should trigger a retry */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Default retry configuration with maximum 3 attempts limit
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3, // MAXIMUM 3 attempts total (2 retries + 1 original)
  delayMs: 1000,
  backoffMultiplier: 1.5,
  maxDelayMs: 10000,
  logRetries: !!process.env.CI || !!process.env.DEBUG_TESTS,
  description: 'operation',
  shouldRetry: (error: unknown, attempt: number) => {
    // Don't retry on syntax errors or assertion failures
    if (error instanceof SyntaxError) return false;
    if (error && typeof error === 'object' && 'name' in error) {
      const errorName = (error as { name: string }).name;
      if (errorName === 'AssertionError' || errorName === 'TestFailure') {
        return false;
      }
    }

    // HARD LIMIT: Never exceed 3 total attempts
    return attempt < Math.min(DEFAULT_RETRY_OPTIONS.maxAttempts, 3);
  },
};

/**
 * Common flaky test error patterns that should be retried
 */
const RETRYABLE_ERROR_PATTERNS = [
  /timeout/i,
  /connection.*refused/i,
  /network.*error/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /502 Bad Gateway/i,
  /503 Service Unavailable/i,
  /504 Gateway Timeout/i,
  /rate limit/i,
  /too many requests/i,
  /element not found/i,
  /element not visible/i,
  /stale element/i,
  /no such element/i,
];

/**
 * Determine if an error should be retried based on common patterns
 */
function shouldRetryError(error: unknown): boolean {
  if (!error) return false;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack || '' : '';
  const fullErrorText = `${errorMessage} ${errorStack}`;

  return RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(fullErrorText));
}

/**
 * Enhanced retry function with exponential backoff and smart error detection
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
    // ENFORCE MAXIMUM 3 ATTEMPTS LIMIT
    maxAttempts: Math.min(options.maxAttempts || DEFAULT_RETRY_OPTIONS.maxAttempts, 3),
  };
  let lastError: unknown;
  let currentDelay = config.delayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await operation();

      // Log successful retry if it wasn't the first attempt
      if (attempt > 1 && config.logRetries) {
        console.log(
          `✅ ${config.description} succeeded on attempt ${attempt}/${config.maxAttempts}`
        );
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!config.shouldRetry(error, attempt) && !shouldRetryError(error)) {
        if (config.logRetries) {
          console.log(
            `❌ ${config.description} failed with non-retryable error on attempt ${attempt}: ${error}`
          );
        }
        throw error;
      }

      // Don't retry if we've reached max attempts
      if (attempt >= config.maxAttempts) {
        if (config.logRetries) {
          console.log(
            `❌ ${config.description} failed after ${config.maxAttempts} attempts. Final error: ${error}`
          );
        }
        break;
      }

      // Log retry attempt
      if (config.logRetries) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(
          `🔄 ${config.description} failed on attempt ${attempt}/${config.maxAttempts}: ${errorMessage}`
        );
        console.log(`⏱️  Retrying in ${currentDelay}ms...`);
      }

      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, currentDelay));

      // Increase delay for next attempt (exponential backoff)
      currentDelay = Math.min(currentDelay * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  // All attempts failed
  throw lastError;
}

/**
 * Wrapper for Jest/Vitest tests with automatic retry logic
 */
export function retryTest(
  testName: string,
  testFn: () => Promise<void> | void,
  options: RetryOptions = {}
): void {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options, description: `test "${testName}"` };

  // For frameworks that support built-in retries
  if (typeof test !== 'undefined' && 'retry' in test) {
    // Playwright/Jest with retry support
    (test as any).retry(config.maxAttempts - 1)(testName, testFn);
    return;
  }

  // Manual retry implementation
  if (typeof test !== 'undefined') {
    test(testName, async () => {
      await retry(async () => {
        await testFn();
      }, config);
    });
  } else if (typeof it !== 'undefined') {
    it(testName, async () => {
      await retry(async () => {
        await testFn();
      }, config);
    });
  } else {
    throw new Error('No test framework detected (test/it functions not available)');
  }
}

/**
 * Wrapper for describe blocks with retry logic for all tests
 */
export function retryDescribe(
  suiteName: string,
  suiteFn: () => void,
  options: RetryOptions = {}
): void {
  if (typeof describe !== 'undefined') {
    describe(suiteName, () => {
      // Store original test function
      const originalTest = typeof test !== 'undefined' ? test : (global as any).it;
      const originalIt = typeof it !== 'undefined' ? it : (global as any).it;

      // Override test functions to add retry logic
      if (originalTest) {
        (global as any).test = (name: string, fn: () => Promise<void> | void) => {
          retryTest(name, fn, options);
        };
      }

      if (originalIt) {
        (global as any).it = (name: string, fn: () => Promise<void> | void) => {
          retryTest(name, fn, options);
        };
      }

      // Run the suite
      suiteFn();

      // Restore original functions
      if (originalTest) {
        (global as any).test = originalTest;
      }
      if (originalIt) {
        (global as any).it = originalIt;
      }
    });
  } else {
    throw new Error('No test framework detected (describe function not available)');
  }
}

/**
 * Retry wrapper specifically for Playwright operations
 */
export async function retryPlaywrightAction<T>(
  page: any,
  action: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
    description: options.description || 'Playwright action',
    shouldRetry: (error: unknown, attempt: number) => {
      // Playwright-specific retryable errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (
          message.includes('timeout') ||
          message.includes('element not found') ||
          message.includes('element not visible') ||
          message.includes('element is not attached') ||
          message.includes('navigation failed') ||
          message.includes('page crashed')
        ) {
          return attempt < config.maxAttempts;
        }
      }
      return shouldRetryError(error) && attempt < config.maxAttempts;
    },
  };

  return retry(action, config);
}

/**
 * Retry wrapper for database operations
 */
export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
    description: options.description || 'database operation',
    shouldRetry: (error: unknown, attempt: number) => {
      // Database-specific retryable errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (
          message.includes('connection') ||
          message.includes('timeout') ||
          message.includes('lock') ||
          message.includes('deadlock') ||
          message.includes('busy') ||
          message.includes('database is locked')
        ) {
          return attempt < config.maxAttempts;
        }
      }
      return shouldRetryError(error) && attempt < config.maxAttempts;
    },
  };

  return retry(operation, config);
}

/**
 * Retry wrapper for network requests
 */
export async function retryNetworkRequest<T>(
  request: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
    description: options.description || 'network request',
    delayMs: options.delayMs || 2000, // Longer delay for network requests
    shouldRetry: (error: unknown, attempt: number) => {
      // Network-specific retryable errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (
          message.includes('network') ||
          message.includes('timeout') ||
          message.includes('econnreset') ||
          message.includes('enotfound') ||
          message.includes('etimedout') ||
          message.includes('fetch failed')
        ) {
          return attempt < config.maxAttempts;
        }
      }

      // HTTP status code based retries
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status >= 500 || status === 429) {
          // Server errors or rate limiting
          return attempt < config.maxAttempts;
        }
      }

      return shouldRetryError(error) && attempt < config.maxAttempts;
    },
  };

  return retry(request, config);
}

/**
 * Get retry statistics for monitoring flaky tests
 */
export class RetryStats {
  private static stats = new Map<
    string,
    {
      totalAttempts: number;
      successfulRetries: number;
      failures: number;
      averageAttempts: number;
    }
  >();

  static recordAttempt(testName: string, attempt: number, success: boolean): void {
    const current = this.stats.get(testName) || {
      totalAttempts: 0,
      successfulRetries: 0,
      failures: 0,
      averageAttempts: 0,
    };

    current.totalAttempts += attempt;
    if (success && attempt > 1) {
      current.successfulRetries++;
    }
    if (!success) {
      current.failures++;
    }

    const totalTests = current.successfulRetries + current.failures + (success ? 1 : 0);
    current.averageAttempts = current.totalAttempts / Math.max(totalTests, 1);

    this.stats.set(testName, current);
  }

  static getStats(): Map<string, any> {
    return new Map(this.stats);
  }

  static getFlakyTests(threshold: number = 1.5): string[] {
    return Array.from(this.stats.entries())
      .filter(([_, stats]) => stats.averageAttempts > threshold)
      .map(([testName]) => testName);
  }

  static generateReport(): string {
    const flakyTests = this.getFlakyTests();
    const totalTests = this.stats.size;
    const flakyPercentage =
      totalTests > 0 ? ((flakyTests.length / totalTests) * 100).toFixed(1) : '0';

    let report = `\n📊 Test Retry Statistics\n`;
    report += `========================\n`;
    report += `Total tests with retry data: ${totalTests}\n`;
    report += `Flaky tests (avg > 1.5 attempts): ${flakyTests.length} (${flakyPercentage}%)\n\n`;

    if (flakyTests.length > 0) {
      report += `🔄 Most Flaky Tests:\n`;
      const sortedFlaky = Array.from(this.stats.entries())
        .filter(([name]) => flakyTests.includes(name))
        .sort(([, a], [, b]) => b.averageAttempts - a.averageAttempts)
        .slice(0, 10);

      sortedFlaky.forEach(([name, stats]) => {
        report += `  - ${name}: ${stats.averageAttempts.toFixed(1)} avg attempts (${stats.successfulRetries} retries, ${stats.failures} failures)\n`;
      });
    }

    return report;
  }
}

/**
 * Export default retry utilities
 */
export default {
  retry,
  retryTest,
  retryDescribe,
  retryPlaywrightAction,
  retryDatabaseOperation,
  retryNetworkRequest,
  RetryStats,
  RETRYABLE_ERROR_PATTERNS,
};
