/**
 * Async test helpers for proper promise handling
 */

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    message?: string;
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, message = 'Condition not met' } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition: ${message}`);
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffFactor = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Run operations in parallel with a concurrency limit
 */
export async function runParallel<T, R>(
  items: T[],
  operation: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const promise = operation(item, i).then(result => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex(p => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Ensure all promises in an array are settled before continuing
 */
export async function settleAll<T>(
  promises: Promise<T>[]
): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }>> {
  return Promise.allSettled(promises) as any;
}

/**
 * Create a deferred promise
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Timeout wrapper for async operations
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Ensure async operations complete in order
 */
export class AsyncQueue {
  private queue: Promise<any> = Promise.resolve();

  async add<T>(operation: () => Promise<T>): Promise<T> {
    const promise = this.queue.then(operation);
    this.queue = promise.catch(() => {}); // Don't break the chain on errors
    return promise;
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

/**
 * Test helper to ensure all pending promises are resolved
 */
export async function flushPromises(): Promise<void> {
  // Run all pending microtasks
  await new Promise(resolve => setImmediate(resolve));
}

/**
 * Assert that an async function throws
 */
export async function expectAsync(promise: Promise<any>): Promise<{
  toThrow: (error?: any) => Promise<void>;
  toResolve: () => Promise<void>;
  toReject: () => Promise<void>;
}> {
  return {
    async toThrow(expectedError?: any) {
      try {
        await promise;
        throw new Error('Expected promise to throw but it resolved');
      } catch (error) {
        if (expectedError) {
          expect(error).toEqual(expectedError);
        }
      }
    },
    async toResolve() {
      await expect(promise).resolves.toBeDefined();
    },
    async toReject() {
      await expect(promise).rejects.toBeDefined();
    },
  };
}

/**
 * Enhanced timeout handling with proper cleanup
 */
export async function withTimeoutAndCleanup<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  cleanup?: () => Promise<void> | void
): Promise<T> {
  let cleanupExecuted = false;
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(async () => {
      if (!cleanupExecuted && cleanup) {
        cleanupExecuted = true;
        try {
          await cleanup();
        } catch (cleanupError) {
          console.warn('Cleanup failed during timeout:', cleanupError);
        }
      }
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    if (!cleanupExecuted && cleanup) {
      cleanupExecuted = true;
      try {
        await cleanup();
      } catch (cleanupError) {
        console.warn('Cleanup failed during error handling:', cleanupError);
      }
    }
    throw error;
  }
}

/**
 * Safe promise execution with proper error logging
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  context: string = 'async operation'
): Promise<{ success: boolean; result?: T; error?: Error }> {
  try {
    const result = await operation();
    return { success: true, result };
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    console.warn(`Failed to execute ${context}:`, err.message);
    return { success: false, error: err };
  }
}

/**
 * Database-safe async operations with transaction handling
 */
export async function withDatabaseSafety<T>(
  operation: () => Promise<T>,
  rollback?: () => Promise<void>
): Promise<T> {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    if (rollback) {
      try {
        await rollback();
        console.log('Database rollback completed');
      } catch (rollbackError) {
        console.error('Database rollback failed:', rollbackError);
      }
    }
    throw error;
  }
}

/**
 * Promise rejection handler to prevent unhandled rejections
 */
export function handlePromiseRejection<T>(
  promise: Promise<T>,
  context: string = 'background operation'
): Promise<T> {
  return promise.catch(error => {
    console.warn(
      `Promise rejection in ${context}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    throw error;
  });
}

/**
 * Graceful async operation shutdown
 */
export class AsyncManager {
  private operations = new Set<Promise<any>>();
  private shutdownRequested = false;

  add<T>(operation: Promise<T>): Promise<T> {
    if (this.shutdownRequested) {
      return Promise.reject(new Error('AsyncManager is shutting down'));
    }

    this.operations.add(operation);

    const cleanup = () => {
      this.operations.delete(operation);
    };

    operation.then(cleanup).catch(cleanup);

    return operation;
  }

  async shutdown(timeoutMs: number = 30000): Promise<void> {
    this.shutdownRequested = true;

    if (this.operations.size === 0) {
      return;
    }

    console.log(`Shutting down ${this.operations.size} async operations...`);

    try {
      await withTimeout(
        Promise.allSettled(Array.from(this.operations)),
        timeoutMs,
        'Async operations shutdown timed out'
      );
    } catch (error) {
      console.warn('Some async operations did not complete during shutdown:', error);
    }

    this.operations.clear();
  }

  getActiveCount(): number {
    return this.operations.size;
  }
}

/**
 * Test-specific async utilities for CI/CD environments
 */
export const testAsyncUtils = {
  /**
   * CI-friendly timeout values
   */
  timeouts: {
    short: process.env.CI ? 10000 : 5000,
    medium: process.env.CI ? 30000 : 15000,
    long: process.env.CI ? 60000 : 30000,
    database: process.env.CI ? 45000 : 20000,
    api: process.env.CI ? 20000 : 10000,
  },

  /**
   * Retry configurations for CI environments
   */
  retryConfig: {
    database: {
      maxRetries: process.env.CI ? 5 : 3,
      initialDelay: process.env.CI ? 2000 : 1000,
      maxDelay: process.env.CI ? 10000 : 5000,
      backoffFactor: 2,
    },
    api: {
      maxRetries: process.env.CI ? 4 : 2,
      initialDelay: process.env.CI ? 1500 : 500,
      maxDelay: process.env.CI ? 8000 : 4000,
      backoffFactor: 2,
    },
    flaky: {
      maxRetries: process.env.CI ? 6 : 3,
      initialDelay: process.env.CI ? 3000 : 1000,
      maxDelay: process.env.CI ? 15000 : 8000,
      backoffFactor: 2.5,
    },
  },

  /**
   * Database operation with CI-adjusted timeouts
   */
  async databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    return withTimeoutAndCleanup(
      () => retryAsync(operation, testAsyncUtils.retryConfig.database),
      testAsyncUtils.timeouts.database
    );
  },

  /**
   * API operation with CI-adjusted timeouts
   */
  async apiOperation<T>(operation: () => Promise<T>): Promise<T> {
    return withTimeoutAndCleanup(
      () => retryAsync(operation, testAsyncUtils.retryConfig.api),
      testAsyncUtils.timeouts.api
    );
  },

  /**
   * Flaky test operation with maximum resilience
   */
  async flakyOperation<T>(operation: () => Promise<T>): Promise<T> {
    return withTimeoutAndCleanup(
      () => retryAsync(operation, testAsyncUtils.retryConfig.flaky),
      testAsyncUtils.timeouts.long
    );
  },
};

/**
 * Integration test specific async patterns
 */
export const integrationAsyncUtils = {
  /**
   * Server startup with health checks
   */
  async waitForServer(
    url: string,
    options: {
      timeout?: number;
      healthPath?: string;
      expectedStatus?: number;
    } = {}
  ): Promise<void> {
    const {
      timeout = testAsyncUtils.timeouts.medium,
      healthPath = '/api/health',
      expectedStatus = 200,
    } = options;

    await waitFor(
      async () => {
        try {
          const response = await fetch(`${url}${healthPath}`);
          return response.status === expectedStatus;
        } catch {
          return false;
        }
      },
      {
        timeout,
        interval: 1000,
        message: `Server at ${url} not ready`,
      }
    );
  },

  /**
   * Database connection with proper cleanup
   */
  async withDatabaseConnection<T>(
    operation: () => Promise<T>,
    cleanup?: () => Promise<void>
  ): Promise<T> {
    return withDatabaseSafety(() => testAsyncUtils.databaseOperation(operation), cleanup);
  },

  /**
   * API request with full error handling
   */
  async apiRequest<T>(request: () => Promise<T>, context: string = 'API request'): Promise<T> {
    return handlePromiseRejection(testAsyncUtils.apiOperation(request), context);
  },
};
