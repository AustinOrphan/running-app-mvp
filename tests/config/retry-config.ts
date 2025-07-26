/**
 * Global retry configuration for all test types
 * Provides consistent retry behavior across unit, integration, and E2E tests
 */

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
  maxRetryDelay: number;
  retryableErrors: string[];
}

/**
 * Get retry configuration based on test type and environment
 */
export function getRetryConfig(testType: 'unit' | 'integration' | 'e2e'): RetryConfig {
  const isCI = process.env.CI === 'true';

  const baseConfig: RetryConfig = {
    maxRetries: isCI ? 3 : 1,
    retryDelay: 1000, // 1 second
    backoffMultiplier: 2,
    maxRetryDelay: 10000, // 10 seconds
    retryableErrors: [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'NetworkError',
      'TimeoutError',
      'ERR_CONNECTION_REFUSED',
    ],
  };

  // Customize by test type
  switch (testType) {
    case 'unit':
      return {
        ...baseConfig,
        maxRetries: isCI ? 2 : 0, // Less retries for unit tests
        retryDelay: 500, // Faster retry for unit tests
      };

    case 'integration':
      return {
        ...baseConfig,
        maxRetries: isCI ? 3 : 1,
        retryDelay: 2000, // Longer delay for DB operations
        retryableErrors: [
          ...baseConfig.retryableErrors,
          'SQLITE_BUSY',
          'ER_LOCK_DEADLOCK',
          'Database is locked',
        ],
      };

    case 'e2e':
      return {
        ...baseConfig,
        maxRetries: isCI ? 4 : 2, // More retries for E2E
        retryDelay: 3000, // Longer delay for browser operations
        retryableErrors: [
          ...baseConfig.retryableErrors,
          'Target closed',
          'Page closed',
          'Execution context was destroyed',
          'Protocol error',
          'net::ERR_CONNECTION_RESET',
        ],
      };

    default:
      return baseConfig;
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error, config: RetryConfig): boolean {
  const errorMessage = error.message || '';
  const errorName = error.name || '';

  return config.retryableErrors.some(
    retryableError => errorMessage.includes(retryableError) || errorName.includes(retryableError)
  );
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(attemptNumber: number, config: RetryConfig): number {
  const delay = config.retryDelay * Math.pow(config.backoffMultiplier, attemptNumber - 1);
  return Math.min(delay, config.maxRetryDelay);
}

/**
 * Generic retry wrapper function
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  testType: 'unit' | 'integration' | 'e2e',
  operationName?: string
): Promise<T> {
  const config = getRetryConfig(testType);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt <= config.maxRetries && isRetryableError(lastError, config)) {
        const delay = calculateRetryDelay(attempt, config);
        console.log(
          `Retry ${attempt}/${config.maxRetries} for ${operationName || 'operation'} after ${delay}ms:`,
          lastError.message
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }

  throw lastError || new Error('Operation failed');
}

/**
 * Vitest retry decorator
 */
export function vitestRetry(testFn: () => Promise<void>) {
  return async () => {
    await retryOperation(testFn, 'unit', 'vitest test');
  };
}

/**
 * Jest retry decorator
 */
export function jestRetry(testFn: () => Promise<void>) {
  return async () => {
    await retryOperation(testFn, 'integration', 'jest test');
  };
}

/**
 * Playwright retry decorator
 */
export function playwrightRetry(testFn: () => Promise<void>) {
  return async () => {
    await retryOperation(testFn, 'e2e', 'playwright test');
  };
}
