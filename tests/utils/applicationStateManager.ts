/**
 * Application State Manager for Integration Tests
 *
 * This module provides comprehensive utilities to reset application state
 * between integration tests, ensuring proper test isolation by clearing:
 * - In-memory caches and stores
 * - Global variables and singletons
 * - Background timers and intervals
 * - Process state modifications
 */

import { securityMetrics, resetSecurityMetrics } from '../../server/utils/securityLogger.js';
import { clearAuditLoggerStorage } from '../../server/utils/auditLogger.js';

/**
 * Interface for components that can be reset between tests
 */
interface Resettable {
  reset(): void | Promise<void>;
}

/**
 * Registry of active timers to clean up between tests
 */
class TimerRegistry {
  private timers: Set<NodeJS.Timeout> = new Set();
  private intervals: Set<NodeJS.Timeout> = new Set();

  /**
   * Register a timer for cleanup
   */
  registerTimer(timer: NodeJS.Timeout): void {
    this.timers.add(timer);
  }

  /**
   * Register an interval for cleanup
   */
  registerInterval(interval: NodeJS.Timeout): void {
    this.intervals.add(interval);
  }

  /**
   * Clear all registered timers and intervals
   */
  clearAll(): void {
    // Clear all timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Clear all intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  /**
   * Get count of active timers/intervals
   */
  getActiveCount(): { timers: number; intervals: number } {
    return {
      timers: this.timers.size,
      intervals: this.intervals.size,
    };
  }
}

/**
 * Manager for process environment variables that may be modified during tests
 */
class EnvironmentStateManager {
  private originalEnvValues: Map<string, string | undefined> = new Map();

  /**
   * Track original value of an environment variable before modification
   */
  trackEnvVar(key: string): void {
    if (!this.originalEnvValues.has(key)) {
      this.originalEnvValues.set(key, process.env[key]);
    }
  }

  /**
   * Restore all tracked environment variables to their original values
   */
  restoreEnvVars(): void {
    for (const [key, originalValue] of this.originalEnvValues) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
    this.originalEnvValues.clear();
  }

  /**
   * Set an environment variable and track its original value
   */
  setEnvVar(key: string, value: string): void {
    this.trackEnvVar(key);
    process.env[key] = value;
  }

  /**
   * Get count of tracked environment variables
   */
  getTrackedCount(): number {
    return this.originalEnvValues.size;
  }
}

/**
 * Manager for in-memory caches and data stores
 */
class CacheManager {
  private caches: Map<string, Resettable> = new Map();

  /**
   * Register a cache or store for cleanup
   */
  registerCache(name: string, cache: Resettable): void {
    this.caches.set(name, cache);
  }

  /**
   * Clear all registered caches
   */
  async clearAllCaches(): Promise<void> {
    const clearPromises: Promise<void>[] = [];

    for (const [name, cache] of this.caches) {
      try {
        const result = cache.reset();
        if (result instanceof Promise) {
          clearPromises.push(result);
        }
      } catch (error) {
        console.warn(`Failed to clear cache ${name}:`, error);
      }
    }

    if (clearPromises.length > 0) {
      await Promise.allSettled(clearPromises);
    }
  }

  /**
   * Get registered cache names
   */
  getRegisteredCaches(): string[] {
    return Array.from(this.caches.keys());
  }
}

/**
 * Main Application State Manager
 */
class ApplicationStateManager {
  private static instance: ApplicationStateManager;
  private timerRegistry = new TimerRegistry();
  private envManager = new EnvironmentStateManager();
  private cacheManager = new CacheManager();
  private resetCount = 0;

  static getInstance(): ApplicationStateManager {
    if (!ApplicationStateManager.instance) {
      ApplicationStateManager.instance = new ApplicationStateManager();
    }
    return ApplicationStateManager.instance;
  }

  /**
   * Initialize the state manager with built-in state sources
   */
  initialize(): void {
    // Register built-in caches and state sources
    this.cacheManager.registerCache('securityMetrics', {
      reset: () => resetSecurityMetrics(),
    });

    this.cacheManager.registerCache('auditLogger', {
      reset: () => clearAuditLoggerStorage(),
    });
  }

  /**
   * Register a custom cache or state source for cleanup
   */
  registerCustomCache(name: string, cache: Resettable): void {
    this.cacheManager.registerCache(name, cache);
  }

  /**
   * Register a timer for cleanup
   */
  registerTimer(timer: NodeJS.Timeout): void {
    this.timerRegistry.registerTimer(timer);
  }

  /**
   * Register an interval for cleanup
   */
  registerInterval(interval: NodeJS.Timeout): void {
    this.timerRegistry.registerInterval(interval);
  }

  /**
   * Set an environment variable and track it for restoration
   */
  setTestEnvVar(key: string, value: string): void {
    this.envManager.setEnvVar(key, value);
  }

  /**
   * Comprehensive reset of all application state
   */
  async resetApplicationState(): Promise<{
    clearedCaches: string[];
    clearedTimers: number;
    clearedIntervals: number;
    restoredEnvVars: number;
    resetCount: number;
  }> {
    const startTime = Date.now();
    this.resetCount++;

    try {
      // 1. Clear all in-memory caches and stores
      const cacheNames = this.cacheManager.getRegisteredCaches();
      await this.cacheManager.clearAllCaches();

      // 2. Clear all active timers and intervals
      const { timers, intervals } = this.timerRegistry.getActiveCount();
      this.timerRegistry.clearAll();

      // 3. Restore environment variables
      const trackedEnvVars = this.envManager.getTrackedCount();
      this.envManager.restoreEnvVars();

      // 4. Clear any global variables that accumulate state
      this.clearGlobalState();

      // 5. Force garbage collection if available (Node.js with --expose-gc)
      if (global.gc) {
        global.gc();
      }

      const duration = Date.now() - startTime;

      if (process.env.DEBUG_TESTS) {
        console.log(`✅ Application state reset completed in ${duration}ms`, {
          clearedCaches: cacheNames,
          clearedTimers: timers,
          clearedIntervals: intervals,
          restoredEnvVars: trackedEnvVars,
          resetCount: this.resetCount,
        });
      }

      return {
        clearedCaches: cacheNames,
        clearedTimers: timers,
        clearedIntervals: intervals,
        restoredEnvVars: trackedEnvVars,
        resetCount: this.resetCount,
      };
    } catch (error) {
      console.error('❌ Failed to reset application state:', error);
      throw error;
    }
  }

  /**
   * Clear global variables and singleton state
   */
  private clearGlobalState(): void {
    // Clear any global Node.js state that might accumulate

    // Reset require cache for test-specific modules (careful with this!)
    // Only clear test-specific modules, not core dependencies
    const testModulePattern = /tests\//;
    for (const key of Object.keys(require.cache)) {
      if (testModulePattern.test(key)) {
        delete require.cache[key];
      }
    }

    // Clear any process listeners that might have been added during tests
    // But preserve the original listeners
    const originalListeners = new Map([
      ['uncaughtException', process.listeners('uncaughtException')],
      ['unhandledRejection', process.listeners('unhandledRejection')],
      ['SIGINT', process.listeners('SIGINT')],
      ['SIGTERM', process.listeners('SIGTERM')],
    ]);

    // Remove test-added listeners and restore originals
    for (const [event, originalListenerList] of originalListeners) {
      process.removeAllListeners(event as any);
      for (const listener of originalListenerList) {
        process.on(event as any, listener);
      }
    }
  }

  /**
   * Get statistics about current application state
   */
  getStateStatistics(): {
    registeredCaches: number;
    activeTimers: number;
    activeIntervals: number;
    trackedEnvVars: number;
    totalResets: number;
  } {
    const { timers, intervals } = this.timerRegistry.getActiveCount();

    return {
      registeredCaches: this.cacheManager.getRegisteredCaches().length,
      activeTimers: timers,
      activeIntervals: intervals,
      trackedEnvVars: this.envManager.getTrackedCount(),
      totalResets: this.resetCount,
    };
  }

  /**
   * Reset the state manager itself (for testing purposes)
   */
  resetManager(): void {
    this.timerRegistry.clearAll();
    this.envManager.restoreEnvVars();
    this.resetCount = 0;
    this.cacheManager = new CacheManager();
    this.timerRegistry = new TimerRegistry();
    this.envManager = new EnvironmentStateManager();
  }
}

// Create and export singleton instance
export const applicationStateManager = ApplicationStateManager.getInstance();

// Export convenience functions
export const resetApplicationState = () => applicationStateManager.resetApplicationState();
export const registerCustomCache = (name: string, cache: Resettable) =>
  applicationStateManager.registerCustomCache(name, cache);
export const registerTimer = (timer: NodeJS.Timeout) =>
  applicationStateManager.registerTimer(timer);
export const registerInterval = (interval: NodeJS.Timeout) =>
  applicationStateManager.registerInterval(interval);
export const setTestEnvVar = (key: string, value: string) =>
  applicationStateManager.setTestEnvVar(key, value);
export const getStateStatistics = () => applicationStateManager.getStateStatistics();

// Export types
export type { Resettable };

// Initialize the manager
applicationStateManager.initialize();

/**
 * Helper function to wrap timers/intervals for automatic registration
 */
export const createManagedTimer = (callback: () => void, delay: number): NodeJS.Timeout => {
  const timer = setTimeout(callback, delay);
  applicationStateManager.registerTimer(timer);
  return timer;
};

export const createManagedInterval = (callback: () => void, delay: number): NodeJS.Timeout => {
  const interval = setInterval(callback, delay);
  applicationStateManager.registerInterval(interval);
  return interval;
};

/**
 * Enhanced rate limit store wrapper that can be reset
 */
export class ResettableRateLimitStore implements Resettable {
  private hitCounts: Map<string, { hits: number; resetTime: number }> = new Map();

  hit(key: string, windowMs: number): { hits: number; resetTime: number } {
    const now = Date.now();
    const current = this.hitCounts.get(key);

    if (!current || now > current.resetTime) {
      const newEntry = { hits: 1, resetTime: now + windowMs };
      this.hitCounts.set(key, newEntry);
      return newEntry;
    }

    current.hits++;
    return current;
  }

  reset(): void {
    this.hitCounts.clear();
  }

  getStats(): { totalKeys: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.hitCounts.values()) {
      totalHits += entry.hits;
    }
    return {
      totalKeys: this.hitCounts.size,
      totalHits,
    };
  }
}
