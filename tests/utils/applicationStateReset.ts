/**
 * Application State Reset Utility
 *
 * Provides comprehensive state reset functionality for test isolation,
 * clearing in-memory caches, global variables, and side effects between tests.
 */

import { testStateManager } from '../integration/utils/testStateManager.js';
import { resetPrismaConnection } from '../../server/prisma.js';

/**
 * Interface for tracking application state that needs reset
 */
interface ApplicationState {
  // In-memory caches
  jwtBlacklist: Set<string>;
  prismaGlobalClient: unknown;
  moduleCache: Record<string, unknown>;

  // Global variables
  processEnv: NodeJS.ProcessEnv;
  globalTimers: {
    timeouts: Set<NodeJS.Timeout>;
    intervals: Set<NodeJS.Timeout>;
    immediates: Set<NodeJS.Immediate>;
  };

  // Side effects
  eventListeners: Array<{
    target: EventTarget | NodeJS.EventEmitter;
    event: string;
    listener: (...args: any[]) => void;
  }>;
  uncaughtExceptionListeners: Array<(...args: any[]) => void>;
  unhandledRejectionListeners: Array<(...args: any[]) => void>;
}

class ApplicationStateReset {
  private originalState: Partial<ApplicationState> = {};
  private activeTimeouts = new Set<NodeJS.Timeout>();
  private activeIntervals = new Set<NodeJS.Timeout>();
  private activeImmediates = new Set<NodeJS.Immediate>();
  private registeredListeners: Array<{
    target: EventTarget | NodeJS.EventEmitter;
    event: string;
    listener: (...args: any[]) => void;
  }> = [];

  /**
   * Capture initial state before tests begin
   */
  captureInitialState(): void {
    // Capture environment variables
    this.originalState.processEnv = { ...process.env };

    // Store references to original timer functions
    this.originalState.globalTimers = {
      timeouts: new Set(),
      intervals: new Set(),
      immediates: new Set(),
    };

    // Capture test state manager state
    testStateManager.captureState();
  }

  /**
   * Clear in-memory caches
   */
  clearInMemoryCaches(): void {
    try {
      // Clear JWT blacklist (in-memory cache)
      this.clearJWTBlacklist();

      // Clear module cache for server modules
      this.clearServerModuleCache();

      // Clear any other in-memory caches
      this.clearAdditionalCaches();
    } catch (error) {
      console.warn('Warning: Some caches could not be cleared:', error);
    }
  }

  /**
   * Clear JWT token blacklist
   */
  private clearJWTBlacklist(): void {
    try {
      // Use the exported clearTokenBlacklist function
      const { clearTokenBlacklist } = require('../../server/utils/jwtUtils.js');
      clearTokenBlacklist();
    } catch (error) {
      console.warn('Could not clear JWT blacklist:', error);
      // Fallback: clear module cache to force re-import
      try {
        const jwtUtilsPath = require.resolve('../../server/utils/jwtUtils.js');
        if (require.cache[jwtUtilsPath]) {
          delete require.cache[jwtUtilsPath];
        }
      } catch {
        console.warn('Could not clear JWT utils module cache');
      }
    }
  }

  /**
   * Clear server module cache to ensure fresh imports
   */
  private clearServerModuleCache(): void {
    const serverModulePatterns = [/\/server\//, /\/routes\//, /\/middleware\//, /\/utils\//];

    Object.keys(require.cache).forEach(key => {
      if (serverModulePatterns.some(pattern => pattern.test(key))) {
        delete require.cache[key];
      }
    });
  }

  /**
   * Clear additional application caches
   */
  private clearAdditionalCaches(): void {
    // Clear any other application-specific caches here
    // For example, if we had a user session cache, API response cache, etc.

    // Clear any global state in the application
    if (global) {
      // Remove any test-specific global variables
      const globalKeys = Object.keys(global);
      globalKeys.forEach(key => {
        if (key.startsWith('test_') || key.startsWith('mock_')) {
          delete (global as any)[key];
        }
      });
    }
  }

  /**
   * Reset global variables to their original state
   */
  resetGlobalVariables(): void {
    // Reset environment variables
    if (this.originalState.processEnv) {
      process.env = { ...this.originalState.processEnv };
    }

    // Clear any added environment variables
    Object.keys(process.env).forEach(key => {
      if (this.originalState.processEnv && !(key in this.originalState.processEnv)) {
        delete process.env[key];
      }
    });

    // Reset test state manager global variables
    testStateManager.resetState();
  }

  /**
   * Clean up side effects
   */
  cleanupSideEffects(): void {
    // Clear all active timers
    this.clearActiveTimers();

    // Remove all registered event listeners
    this.removeEventListeners();

    // Clean up uncaught exception handlers
    this.cleanupExceptionHandlers();

    // Reset Prisma connection
    this.resetDatabaseConnections();
  }

  /**
   * Clear all active timers
   */
  private clearActiveTimers(): void {
    // Clear timeouts
    this.activeTimeouts.forEach(timeout => {
      try {
        clearTimeout(timeout);
      } catch {
        // Ignore errors from already cleared timers
      }
    });
    this.activeTimeouts.clear();

    // Clear intervals
    this.activeIntervals.forEach(interval => {
      try {
        clearInterval(interval);
      } catch {
        // Ignore errors from already cleared intervals
      }
    });
    this.activeIntervals.clear();

    // Clear immediates
    this.activeImmediates.forEach(immediate => {
      try {
        clearImmediate(immediate);
      } catch {
        // Ignore errors from already cleared immediates
      }
    });
    this.activeImmediates.clear();
  }

  /**
   * Remove all registered event listeners
   */
  private removeEventListeners(): void {
    this.registeredListeners.forEach(({ target, event, listener }) => {
      try {
        if ('removeEventListener' in target) {
          target.removeEventListener(event, listener as EventListener);
        } else if ('removeListener' in target) {
          (target as NodeJS.EventEmitter).removeListener(event, listener);
        }
      } catch (error) {
        console.warn(`Could not remove listener for event ${event}:`, error);
      }
    });
    this.registeredListeners = [];
  }

  /**
   * Clean up uncaught exception handlers
   */
  private cleanupExceptionHandlers(): void {
    // Remove all uncaught exception listeners added during tests
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  }

  /**
   * Reset database connections
   */
  private async resetDatabaseConnections(): Promise<void> {
    try {
      await resetPrismaConnection();
    } catch (error) {
      console.warn('Could not reset Prisma connection:', error);
    }
  }

  /**
   * Track timer for cleanup
   */
  trackTimer(timer: NodeJS.Timeout, type: 'timeout' | 'interval'): NodeJS.Timeout {
    if (type === 'timeout') {
      this.activeTimeouts.add(timer);
    } else {
      this.activeIntervals.add(timer);
    }
    return timer;
  }

  /**
   * Track immediate for cleanup
   */
  trackImmediate(immediate: NodeJS.Immediate): NodeJS.Immediate {
    this.activeImmediates.add(immediate);
    return immediate;
  }

  /**
   * Track event listener for cleanup
   */
  trackEventListener(
    target: EventTarget | NodeJS.EventEmitter,
    event: string,
    listener: (...args: any[]) => void
  ): void {
    this.registeredListeners.push({ target, event, listener });
  }

  /**
   * Complete application state reset
   */
  async resetApplicationState(): Promise<void> {
    try {
      // Clear in-memory caches
      this.clearInMemoryCaches();

      // Reset global variables
      this.resetGlobalVariables();

      // Clean up side effects
      this.cleanupSideEffects();

      // Wait a bit for async cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    } catch (error) {
      console.error('Error during application state reset:', error);
      throw error;
    }
  }

  /**
   * Get reset statistics for debugging
   */
  getResetStats(): {
    clearedTimers: number;
    removedListeners: number;
    clearedCaches: boolean;
    resetGlobals: boolean;
  } {
    return {
      clearedTimers:
        this.activeTimeouts.size + this.activeIntervals.size + this.activeImmediates.size,
      removedListeners: this.registeredListeners.length,
      clearedCaches: true,
      resetGlobals: true,
    };
  }
}

// Export singleton instance
export const applicationStateReset = new ApplicationStateReset();

/**
 * Helper function for Jest setup hooks
 */
export function setupApplicationStateReset(): void {
  beforeAll(() => {
    applicationStateReset.captureInitialState();
  });

  afterEach(async () => {
    await applicationStateReset.resetApplicationState();
  });
}

/**
 * Enhanced timer functions that track timers for cleanup
 */
export const trackingTimers = {
  setTimeout: (callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout => {
    const timer = setTimeout(callback, ms, ...args);
    return applicationStateReset.trackTimer(timer, 'timeout');
  },

  setInterval: (
    callback: (...args: any[]) => void,
    ms?: number,
    ...args: any[]
  ): NodeJS.Timeout => {
    const timer = setInterval(callback, ms, ...args);
    return applicationStateReset.trackTimer(timer, 'interval');
  },

  setImmediate: (callback: (...args: any[]) => void, ...args: any[]): NodeJS.Immediate => {
    const immediate = setImmediate(callback, ...args);
    return applicationStateReset.trackImmediate(immediate);
  },
};

/**
 * Enhanced event listener function that tracks listeners for cleanup
 */
export function trackEventListener(
  target: EventTarget | NodeJS.EventEmitter,
  event: string,
  listener: (...args: any[]) => void
): void {
  if ('addEventListener' in target) {
    target.addEventListener(event, listener as EventListener);
  } else if ('on' in target) {
    (target as NodeJS.EventEmitter).on(event, listener);
  }

  applicationStateReset.trackEventListener(target, event, listener);
}

/**
 * Initialize application state tracking
 * Called during test suite setup to prepare state tracking
 */
export const initializeApplicationStateTracking = (): void => {
  // Initialize the application state reset system
  try {
    applicationStateReset.captureInitialState();

    if (process.env.DEBUG_TESTS) {
      console.log('✅ Application state tracking initialized');
    }
  } catch (error) {
    console.warn('Warning during application state tracking initialization:', error);
  }
};

/**
 * Cleanup function for application state tracking
 * Called during test suite teardown to clean up any persistent tracking state
 */
export const cleanupApplicationStateTracking = (): void => {
  // Clean up any persistent state tracking that might remain after tests
  try {
    // Reset all application state one final time
    applicationStateReset.resetApplicationState();

    if (process.env.DEBUG_TESTS) {
      console.log('✅ Application state tracking cleanup completed');
    }
  } catch (error) {
    console.warn('Warning during application state tracking cleanup:', error);
  }
};

// Export convenience functions that match expected interface
export const resetApplicationState = async (): Promise<void> => {
  await applicationStateReset.resetApplicationState();
};

export const validateApplicationStateReset = async (): Promise<{
  isClean: boolean;
  issues: string[];
}> => {
  // Basic validation - check if major state sources are clean
  const issues: string[] = [];

  try {
    // Check security metrics
    const { getSecurityMetrics } = await import('../../server/utils/securityLogger.js');
    const metrics = getSecurityMetrics();
    if (Object.keys(metrics).length > 0) {
      issues.push(`Security metrics not clean: ${Object.keys(metrics).length} metrics remaining`);
    }
  } catch (error) {
    issues.push(`Could not validate security metrics: ${error}`);
  }

  try {
    // Check audit storage
    const { auditLogger } = await import('../../server/utils/auditLogger.js');
    const storage = auditLogger.getStorageForTesting();
    if (storage && typeof (storage as any).events !== 'undefined') {
      const eventCount = (storage as any).events?.length || 0;
      if (eventCount > 0) {
        issues.push(`Audit storage not clean: ${eventCount} events remaining`);
      }
    }
  } catch (error) {
    issues.push(`Could not validate audit storage: ${error}`);
  }

  return {
    isClean: issues.length === 0,
    issues,
  };
};

export default applicationStateReset;
