/**
 * Test Caching Utilities
 *
 * This module provides comprehensive caching utilities for all test types:
 * - Jest (integration tests)
 * - Vitest (unit tests)
 * - Playwright (E2E tests)
 *
 * Features:
 * - Result caching across test runs
 * - Dependency-based cache invalidation
 * - CI-optimized cache management
 * - Performance metrics collection
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface CacheConfig {
  baseDir: string;
  maxAge?: number; // in milliseconds
  enableInCI?: boolean;
  enableLocally?: boolean;
}

export interface TestResult {
  testPath: string;
  duration: number;
  status: 'passed' | 'failed' | 'skipped';
  hash: string;
  timestamp: number;
  dependencies?: string[];
}

export interface CacheEntry {
  results: TestResult[];
  metadata: {
    nodeVersion: string;
    platform: string;
    ciEnvironment: boolean;
    cacheVersion: string;
  };
  createdAt: number;
  expiresAt: number;
}

export class TestCache {
  private config: Required<CacheConfig>;
  private cacheDir: string;
  private static readonly CACHE_VERSION = '1.0.0';

  constructor(config: CacheConfig) {
    this.config = {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours default
      enableInCI: true,
      enableLocally: true,
      ...config,
    };

    this.cacheDir = path.resolve(this.config.baseDir);
  }

  /**
   * Check if caching is enabled for the current environment
   */
  private isEnabled(): boolean {
    const isCI = !!process.env.CI;
    return isCI ? this.config.enableInCI : this.config.enableLocally;
  }

  /**
   * Generate a hash for test file content and dependencies
   */
  private async generateTestHash(testPath: string, dependencies: string[] = []): Promise<string> {
    const hasher = crypto.createHash('sha256');

    try {
      // Hash test file content
      const testContent = await fs.readFile(testPath, 'utf-8');
      hasher.update(testContent);

      // Hash dependency content
      for (const dep of dependencies) {
        if (await this.fileExists(dep)) {
          const depContent = await fs.readFile(dep, 'utf-8');
          hasher.update(depContent);
        }
      }

      // Include environment factors
      hasher.update(process.version); // Node version
      hasher.update(process.platform); // Platform
      hasher.update(TestCache.CACHE_VERSION); // Cache version
    } catch {
      // If file reading fails, use file stats
      try {
        const stats = await fs.stat(testPath);
        hasher.update(stats.mtime.toISOString());
        hasher.update(stats.size.toString());
      } catch {
        // Fallback to timestamp
        hasher.update(Date.now().toString());
      }
    }

    return hasher.digest('hex');
  }

  /**
   * Get cached test results if they exist and are valid
   */
  async getCachedResults(
    testPath: string,
    dependencies: string[] = []
  ): Promise<TestResult | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const hash = await this.generateTestHash(testPath, dependencies);
    const cacheFile = path.join(this.cacheDir, `${hash}.json`);

    try {
      const cacheData = await fs.readFile(cacheFile, 'utf-8');
      const entry: CacheEntry = JSON.parse(cacheData);

      // Check if cache is expired
      if (Date.now() > entry.expiresAt) {
        await this.removeCacheEntry(cacheFile);
        return null;
      }

      // Check if cache is compatible
      if (!this.isCacheCompatible(entry.metadata)) {
        await this.removeCacheEntry(cacheFile);
        return null;
      }

      // Find result for this specific test
      return entry.results.find(result => result.testPath === testPath) || null;
    } catch {
      // Cache miss or invalid cache
      return null;
    }
  }

  /**
   * Store test results in cache
   */
  async setCachedResults(results: TestResult[]): Promise<void> {
    if (!this.isEnabled() || results.length === 0) {
      return;
    }

    await this.ensureCacheDir();

    // Group results by hash for efficient storage
    const resultsByHash = new Map<string, TestResult[]>();

    for (const result of results) {
      if (!resultsByHash.has(result.hash)) {
        resultsByHash.set(result.hash, []);
      }
      resultsByHash.get(result.hash)!.push(result);
    }

    // Store each group
    for (const [hash, hashResults] of resultsByHash) {
      const cacheFile = path.join(this.cacheDir, `${hash}.json`);

      const entry: CacheEntry = {
        results: hashResults,
        metadata: {
          nodeVersion: process.version,
          platform: process.platform,
          ciEnvironment: !!process.env.CI,
          cacheVersion: TestCache.CACHE_VERSION,
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + this.config.maxAge,
      };

      try {
        await fs.writeFile(cacheFile, JSON.stringify(entry, null, 2));
      } catch (error) {
        console.warn(`Failed to write cache file ${cacheFile}:`, error);
      }
    }
  }

  /**
   * Check if cache metadata is compatible with current environment
   */
  private isCacheCompatible(metadata: CacheEntry['metadata']): boolean {
    return (
      metadata.nodeVersion === process.version &&
      metadata.platform === process.platform &&
      metadata.ciEnvironment === !!process.env.CI &&
      metadata.cacheVersion === TestCache.CACHE_VERSION
    );
  }

  /**
   * Clear all cached results
   */
  async clearCache(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist, which is fine
    }
  }

  /**
   * Clear expired cache entries
   */
  async clearExpiredCache(): Promise<void> {
    if (!(await this.fileExists(this.cacheDir))) {
      return;
    }

    try {
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const entry: CacheEntry = JSON.parse(content);

          if (now > entry.expiresAt) {
            await this.removeCacheEntry(filePath);
          }
        } catch {
          // Invalid cache file, remove it
          await this.removeCacheEntry(filePath);
        }
      }
    } catch (error) {
      console.warn('Failed to clear expired cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  }> {
    if (!(await this.fileExists(this.cacheDir))) {
      return {
        totalEntries: 0,
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }

    const files = await fs.readdir(this.cacheDir);
    let totalSize = 0;
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;
    let validEntries = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(this.cacheDir, file);

      try {
        const stats = await fs.stat(filePath);
        totalSize += stats.size;

        const content = await fs.readFile(filePath, 'utf-8');
        const entry: CacheEntry = JSON.parse(content);

        validEntries++;

        if (oldestEntry === null || entry.createdAt < oldestEntry) {
          oldestEntry = entry.createdAt;
        }

        if (newestEntry === null || entry.createdAt > newestEntry) {
          newestEntry = entry.createdAt;
        }
      } catch {
        // Skip invalid files
      }
    }

    return {
      totalEntries: validEntries,
      totalSize,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Utility methods
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.warn(`Failed to create cache directory ${this.cacheDir}:`, error);
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async removeCacheEntry(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist, which is fine
    }
  }
}

/**
 * Global cache instances for different test types
 */
export const jestCache = new TestCache({
  baseDir: '.jest-cache/results',
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

export const vitestCache = new TestCache({
  baseDir: '.vitest-cache/results',
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

export const playwrightCache = new TestCache({
  baseDir: '.playwright-cache/results',
  maxAge: 12 * 60 * 60 * 1000, // 12 hours (shorter for E2E tests)
});

/**
 * Cache management utilities
 */
export class CacheManager {
  static async clearAllCaches(): Promise<void> {
    await Promise.all([
      jestCache.clearCache(),
      vitestCache.clearCache(),
      playwrightCache.clearCache(),
    ]);
  }

  static async clearExpiredCaches(): Promise<void> {
    await Promise.all([
      jestCache.clearExpiredCache(),
      vitestCache.clearExpiredCache(),
      playwrightCache.clearExpiredCache(),
    ]);
  }

  static async getAllCacheStats(): Promise<{
    jest: Awaited<ReturnType<TestCache['getCacheStats']>>;
    vitest: Awaited<ReturnType<TestCache['getCacheStats']>>;
    playwright: Awaited<ReturnType<TestCache['getCacheStats']>>;
  }> {
    const [jest, vitest, playwright] = await Promise.all([
      jestCache.getCacheStats(),
      vitestCache.getCacheStats(),
      playwrightCache.getCacheStats(),
    ]);

    return { jest, vitest, playwright };
  }
}

/**
 * CLI utility for cache management
 */
export async function runCacheCommand(command: string): Promise<void> {
  switch (command) {
    case 'clear':
      console.log('Clearing all test caches...');
      await CacheManager.clearAllCaches();
      console.log('All caches cleared.');
      break;

    case 'clean':
      console.log('Cleaning expired cache entries...');
      await CacheManager.clearExpiredCaches();
      console.log('Expired cache entries cleaned.');
      break;

    case 'stats': {
      console.log('Gathering cache statistics...');
      const stats = await CacheManager.getAllCacheStats();

      console.log('\nCache Statistics:');
      console.log('================');

      for (const [type, stat] of Object.entries(stats)) {
        console.log(`\n${type.toUpperCase()}:`);
        console.log(`  Entries: ${stat.totalEntries}`);
        console.log(`  Size: ${(stat.totalSize / 1024 / 1024).toFixed(2)} MB`);

        if (stat.oldestEntry) {
          console.log(`  Oldest: ${new Date(stat.oldestEntry).toISOString()}`);
        }

        if (stat.newestEntry) {
          console.log(`  Newest: ${new Date(stat.newestEntry).toISOString()}`);
        }
      }
      break;
    }

    default:
      console.log('Available commands: clear, clean, stats');
  }
}
