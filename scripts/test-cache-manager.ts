#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

interface TestCacheMetadata {
  timestamp: Date;
  testFiles: string[];
  sourceFiles: string[];
  dependencies: Record<string, string>;
  nodeVersion: string;
  testResults: {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
}

interface CacheEntry {
  key: string;
  metadata: TestCacheMetadata;
  resultPath: string;
  coveragePath?: string;
}

class TestCacheManager {
  private cacheDir: string;
  private metadataFile: string;
  private cacheEntries: Map<string, CacheEntry> = new Map();

  constructor(cacheDir: string = '.test-cache') {
    this.cacheDir = path.join(process.cwd(), cacheDir);
    this.metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
    this.loadCache();
  }

  private loadCache(): void {
    if (fs.existsSync(this.metadataFile)) {
      try {
        const data = fs.readFileSync(this.metadataFile, 'utf-8');
        const entries = JSON.parse(data);
        entries.forEach((entry: CacheEntry) => {
          this.cacheEntries.set(entry.key, entry);
        });
      } catch (error) {
        console.warn('Failed to load cache metadata:', error);
      }
    }
  }

  private saveCache(): void {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const entries = Array.from(this.cacheEntries.values());
    fs.writeFileSync(this.metadataFile, JSON.stringify(entries, null, 2));
  }

  private generateCacheKey(testType: string, testFiles: string[], sourceFiles: string[]): string {
    const hash = crypto.createHash('sha256');

    // Add test type
    hash.update(testType);

    // Add test file hashes
    testFiles.sort().forEach(file => {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8');
        hash.update(content);
      }
    });

    // Add source file hashes
    sourceFiles.sort().forEach(file => {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8');
        hash.update(content);
      }
    });

    // Add dependencies hash
    if (fs.existsSync('package-lock.json')) {
      const lockContent = fs.readFileSync('package-lock.json', 'utf-8');
      hash.update(lockContent);
    }

    return hash.digest('hex').substring(0, 16);
  }

  private getTestFiles(pattern: string): string[] {
    try {
      const files = execSync(
        `find . -path ./node_modules -prune -o -name "${pattern}" -type f -print`,
        {
          encoding: 'utf-8',
        }
      )
        .trim()
        .split('\n')
        .filter(Boolean);
      return files;
    } catch {
      return [];
    }
  }

  private getSourceFiles(): string[] {
    try {
      const tsFiles = execSync('find src server -name "*.ts" -o -name "*.tsx" -type f', {
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      return tsFiles;
    } catch {
      return [];
    }
  }

  private getDependencies(): Record<string, string> {
    if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      return {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
    }
    return {};
  }

  canUseCache(testType: string, pattern: string): { hit: boolean; key?: string; reason?: string } {
    const testFiles = this.getTestFiles(pattern);
    const sourceFiles = this.getSourceFiles();
    const key = this.generateCacheKey(testType, testFiles, sourceFiles);

    const entry = this.cacheEntries.get(key);
    if (!entry) {
      return { hit: false, reason: 'No cache entry found' };
    }

    // Check if cache is stale (older than 24 hours)
    const age = Date.now() - new Date(entry.metadata.timestamp).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (age > maxAge) {
      return { hit: false, reason: 'Cache is too old' };
    }

    // Check if result files still exist
    if (!fs.existsSync(entry.resultPath)) {
      return { hit: false, reason: 'Cached results file missing' };
    }

    // Check if any test failed in cached results
    if (entry.metadata.testResults.failed > 0) {
      return { hit: false, reason: 'Previous test run had failures' };
    }

    // Check Node version
    const currentNodeVersion = process.version;
    if (entry.metadata.nodeVersion !== currentNodeVersion) {
      return { hit: false, reason: 'Node version changed' };
    }

    return { hit: true, key };
  }

  saveTestResults(
    testType: string,
    pattern: string,
    resultPath: string,
    testResults: TestCacheMetadata['testResults'],
    coveragePath?: string,
    coverage?: TestCacheMetadata['coverage']
  ): void {
    const testFiles = this.getTestFiles(pattern);
    const sourceFiles = this.getSourceFiles();
    const key = this.generateCacheKey(testType, testFiles, sourceFiles);

    const metadata: TestCacheMetadata = {
      timestamp: new Date(),
      testFiles,
      sourceFiles,
      dependencies: this.getDependencies(),
      nodeVersion: process.version,
      testResults,
      coverage,
    };

    const cacheResultPath = path.join(this.cacheDir, `${testType}-${key}.json`);
    const cacheCoveragePath = coveragePath
      ? path.join(this.cacheDir, `${testType}-coverage-${key}`)
      : undefined;

    // Copy result file to cache
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.copyFileSync(resultPath, cacheResultPath);

    // Copy coverage data if provided
    if (coveragePath && cacheCoveragePath && fs.existsSync(coveragePath)) {
      this.copyDirectory(coveragePath, cacheCoveragePath);
    }

    const entry: CacheEntry = {
      key,
      metadata,
      resultPath: cacheResultPath,
      coveragePath: cacheCoveragePath,
    };

    this.cacheEntries.set(key, entry);
    this.saveCache();

    console.log(`✅ Cached ${testType} test results with key: ${key}`);
  }

  getCachedResults(key: string): { results: any; coverage?: any } | null {
    const entry = this.cacheEntries.get(key);
    if (!entry || !fs.existsSync(entry.resultPath)) {
      return null;
    }

    const results = JSON.parse(fs.readFileSync(entry.resultPath, 'utf-8'));

    let coverage = null;
    if (entry.coveragePath && fs.existsSync(entry.coveragePath)) {
      const coverageFile = path.join(entry.coveragePath, 'coverage-final.json');
      if (fs.existsSync(coverageFile)) {
        coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf-8'));
      }
    }

    return { results, coverage };
  }

  private copyDirectory(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  cleanOldCaches(maxAgeDays: number = 7): void {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const entriesToRemove: string[] = [];

    this.cacheEntries.forEach((entry, key) => {
      const age = now - new Date(entry.metadata.timestamp).getTime();
      if (age > maxAge) {
        entriesToRemove.push(key);

        // Remove cached files
        if (fs.existsSync(entry.resultPath)) {
          fs.unlinkSync(entry.resultPath);
        }
        if (entry.coveragePath && fs.existsSync(entry.coveragePath)) {
          fs.rmSync(entry.coveragePath, { recursive: true });
        }
      }
    });

    entriesToRemove.forEach(key => this.cacheEntries.delete(key));

    if (entriesToRemove.length > 0) {
      this.saveCache();
      console.log(`🧹 Cleaned ${entriesToRemove.length} old cache entries`);
    }
  }

  getCacheStats(): {
    totalEntries: number;
    totalSize: number;
    oldestEntry?: Date;
    newestEntry?: Date;
    hitRate?: number;
  } {
    const stats = {
      totalEntries: this.cacheEntries.size,
      totalSize: 0,
      oldestEntry: undefined as Date | undefined,
      newestEntry: undefined as Date | undefined,
      hitRate: undefined as number | undefined,
    };

    if (this.cacheEntries.size === 0) {
      return stats;
    }

    let oldest = Date.now();
    let newest = 0;

    this.cacheEntries.forEach(entry => {
      const timestamp = new Date(entry.metadata.timestamp).getTime();
      if (timestamp < oldest) oldest = timestamp;
      if (timestamp > newest) newest = timestamp;

      // Calculate size
      if (fs.existsSync(entry.resultPath)) {
        stats.totalSize += fs.statSync(entry.resultPath).size;
      }
      if (entry.coveragePath && fs.existsSync(entry.coveragePath)) {
        stats.totalSize += this.getDirectorySize(entry.coveragePath);
      }
    });

    stats.oldestEntry = new Date(oldest);
    stats.newestEntry = new Date(newest);

    return stats;
  }

  private getDirectorySize(dir: string): number {
    let size = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        size += this.getDirectorySize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }

    return size;
  }

  generateCacheReport(): void {
    const stats = this.getCacheStats();

    console.log('\n📊 Test Cache Report');
    console.log('='.repeat(50));
    console.log(`Total entries: ${stats.totalEntries}`);
    console.log(`Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);

    if (stats.oldestEntry && stats.newestEntry) {
      console.log(`Oldest entry: ${stats.oldestEntry.toISOString()}`);
      console.log(`Newest entry: ${stats.newestEntry.toISOString()}`);
    }

    console.log('\n📋 Cache Entries:');
    this.cacheEntries.forEach((entry, key) => {
      const age = Date.now() - new Date(entry.metadata.timestamp).getTime();
      const ageHours = Math.floor(age / (1000 * 60 * 60));

      console.log(`\n${key}:`);
      console.log(
        `  Type: ${
          entry.resultPath.includes('unit')
            ? 'Unit'
            : entry.resultPath.includes('integration')
              ? 'Integration'
              : 'E2E'
        }`
      );
      console.log(`  Age: ${ageHours} hours`);
      console.log(
        `  Tests: ${entry.metadata.testResults.passed} passed, ${entry.metadata.testResults.failed} failed`
      );
      if (entry.metadata.coverage) {
        console.log(`  Coverage: ${entry.metadata.coverage.lines.toFixed(1)}% lines`);
      }
    });

    console.log('\n' + '='.repeat(50));
  }
}

// Export for use in CI scripts
export { TestCacheManager, TestCacheMetadata, CacheEntry };

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const manager = new TestCacheManager();

  switch (command) {
    case 'check':
      const testType = args[1] || 'unit';
      const pattern = args[2] || '*.test.ts';
      const result = manager.canUseCache(testType, pattern);
      console.log(result.hit ? `✅ Cache hit: ${result.key}` : `❌ Cache miss: ${result.reason}`);
      process.exit(result.hit ? 0 : 1);
      break;

    case 'save':
      // Example: npm run cache-save unit "*.test.ts" test-results.json
      const saveType = args[1];
      const savePattern = args[2];
      const resultPath = args[3];
      // This would need actual test results passed in
      console.log('Save functionality requires integration with test runners');
      break;

    case 'clean':
      const days = parseInt(args[1]) || 7;
      manager.cleanOldCaches(days);
      break;

    case 'stats':
      manager.generateCacheReport();
      break;

    default:
      console.log('Usage: test-cache-manager <command> [options]');
      console.log('Commands:');
      console.log('  check <type> <pattern>  - Check if cache can be used');
      console.log('  save <type> <pattern> <results> - Save test results to cache');
      console.log('  clean [days]           - Clean caches older than N days (default: 7)');
      console.log('  stats                  - Show cache statistics');
  }
}
