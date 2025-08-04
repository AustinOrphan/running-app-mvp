#!/usr/bin/env tsx

/**
 * Cache Management Script
 * 
 * This script helps manage test result caches, including:
 * - Viewing current cache status
 * - Invalidating specific caches
 * - Monitoring cache performance
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

interface CacheInfo {
  key: string;
  type: 'unit' | 'integration' | 'e2e';
  created?: Date;
  size?: number;
  files: string[];
}

class CacheManager {
  private cacheVersion = 'v1';
  private testResultsCacheVersion = 'v1';
  private resultCacheEnabled = process.env.ENABLE_RESULT_CACHE !== 'false';
  
  async generateCacheKey(type: 'unit' | 'integration' | 'e2e'): Promise<string> {
    const paths = {
      unit: ['src', 'tests/unit'],
      integration: ['server', 'tests/integration'],
      e2e: ['tests/e2e', 'playwright.config.ts']
    };
    
    const configFiles = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json'];
    
    // Generate hash for test files
    const testFilesHash = await this.hashFiles(paths[type], ['*.ts', '*.tsx', '*.js']);
    
    // Generate hash for config files
    const configHash = await this.hashFiles(['.'], configFiles.map(f => path.basename(f)));
    
    return `${type}-tests-${this.testResultsCacheVersion}-${testFilesHash}-${configHash}`;
  }
  
  private async hashFiles(directories: string[], patterns: string[]): Promise<string> {
    const hash = crypto.createHash('sha256');
    
    for (const dir of directories) {
      try {
        const files = await this.findFiles(dir, patterns);
        for (const file of files.sort()) {
          try {
            const content = await fs.readFile(file);
            hash.update(content);
          } catch (err) {
            // File might not exist or be inaccessible
            continue;
          }
        }
      } catch (err) {
        // Directory might not exist
        continue;
      }
    }
    
    return hash.digest('hex').substring(0, 16);
  }
  
  private async findFiles(directory: string, patterns: string[]): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          files.push(...await this.findFiles(fullPath, patterns));
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (this.matchesPattern(entry.name, pattern)) {
              files.push(fullPath);
              break;
            }
          }
        }
      }
    } catch (err) {
      // Directory might not be accessible
    }
    
    return files;
  }
  
  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      return filename.endsWith(pattern.substring(1));
    }
    return filename === pattern;
  }
  
  async checkCacheStatus(): Promise<void> {
    console.log('📊 Checking cache status...\n');
    
    const types: Array<'unit' | 'integration' | 'e2e'> = ['unit', 'integration', 'e2e'];
    
    for (const type of types) {
      const key = await this.generateCacheKey(type);
      const cachePaths = {
        unit: ['.test-results/unit', 'coverage'],
        integration: ['.test-results/integration', 'coverage-integration'],
        e2e: ['.test-results/e2e', 'playwright-report']
      };
      
      console.log(`### ${type.toUpperCase()} Tests`);
      console.log(`Cache Key: ${key}`);
      
      let totalSize = 0;
      let exists = false;
      
      for (const cachePath of cachePaths[type]) {
        try {
          const stat = await fs.stat(cachePath);
          if (stat.isDirectory()) {
            exists = true;
            const size = await this.getDirectorySize(cachePath);
            totalSize += size;
            console.log(`- ${cachePath}: ${this.formatBytes(size)}`);
          }
        } catch (err) {
          console.log(`- ${cachePath}: not found`);
        }
      }
      
      if (exists && type !== 'e2e') {
        try {
          const timestampPath = path.join('.test-results', type, 'timestamp');
          const timestamp = await fs.readFile(timestampPath, 'utf-8');
          const date = new Date(parseInt(timestamp.trim()) * 1000);
          console.log(`Last cached: ${date.toLocaleString()}`);
        } catch (err) {
          // No timestamp file
        }
      }
      
      console.log(`Total size: ${this.formatBytes(totalSize)}`);
      console.log('');
    }
  }
  
  private async getDirectorySize(dir: string): Promise<number> {
    let size = 0;
    
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
          size += await this.getDirectorySize(fullPath);
        } else {
          try {
            const stat = await fs.stat(fullPath);
            size += stat.size;
          } catch (err) {
            // File might not be accessible
          }
        }
      }
    } catch (err) {
      // Directory might not be accessible
    }
    
    return size;
  }
  
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  async invalidateCache(type?: 'unit' | 'integration' | 'e2e'): Promise<void> {
    console.log('🗑️ Invalidating caches...\n');
    
    const cacheDirs = {
      unit: ['.test-results/unit', 'coverage'],
      integration: ['.test-results/integration', 'coverage-integration'],
      e2e: ['.test-results/e2e', 'playwright-report']
    };
    
    const typesToClear = type ? [type] : Object.keys(cacheDirs) as Array<'unit' | 'integration' | 'e2e'>;
    
    for (const cacheType of typesToClear) {
      console.log(`Clearing ${cacheType} test caches...`);
      
      for (const dir of cacheDirs[cacheType]) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
          console.log(`✅ Removed ${dir}`);
        } catch (err) {
          console.log(`⏭️ ${dir} not found`);
        }
      }
      
      console.log('');
    }
    
    console.log('Cache invalidation complete!');
  }
  
  async monitorCachePerformance(): Promise<void> {
    console.log('📈 Cache Performance Metrics\n');
    
    // Check if we have any performance data
    const perfFile = '.cache-metrics/performance.json';
    
    try {
      const data = await fs.readFile(perfFile, 'utf-8');
      const metrics = JSON.parse(data);
      
      console.log('### Historical Performance');
      console.log(`Total runs: ${metrics.totalRuns}`);
      console.log(`Cache hits: ${metrics.cacheHits}`);
      console.log(`Cache misses: ${metrics.cacheMisses}`);
      console.log(`Hit rate: ${((metrics.cacheHits / metrics.totalRuns) * 100).toFixed(1)}%`);
      console.log(`Average time saved: ${metrics.avgTimeSaved}s`);
      
    } catch (err) {
      console.log('No performance metrics available yet.');
      console.log('Run tests with caching enabled to collect metrics.');
    }
    
    console.log('\n### Cache Recommendations');
    console.log('- Invalidate caches when major dependencies change');
    console.log('- Monitor cache hit rates - aim for >70%');
    console.log('- Clear caches if they grow larger than 100MB');
    console.log('- Use cache versioning for controlled invalidation');
  }
  
  async setupGitHubActionsCache(): Promise<void> {
    console.log('🔧 GitHub Actions Cache Configuration\n');
    
    console.log('Add this to your workflow:\n');
    
    console.log('```yaml');
    console.log('- name: 💾 Cache test results');
    console.log('  uses: actions/cache@v4');
    console.log('  with:');
    console.log('    path: |');
    console.log('      .test-results');
    console.log('      coverage');
    console.log('      coverage-integration');
    console.log('      .jest-cache');
    console.log('      node_modules/.cache');
    console.log('      ~/.cache/ms-playwright');
    console.log('    key: ${{ runner.os }}-tests-${{ hashFiles(\'**/*.test.ts\', \'package-lock.json\') }}');
    console.log('    restore-keys: |');
    console.log('      ${{ runner.os }}-tests-');
    console.log('```');
  }

  async checkResultCache(type: 'unit' | 'integration' | 'e2e'): Promise<boolean> {
    if (!this.resultCacheEnabled) return false;
    
    const cacheKey = await this.generateCacheKey(type);
    const cacheFile = path.join('.test-results', type, 'cache.json');
    
    try {
      const cacheData = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
      return cacheData.key === cacheKey && cacheData.results?.passed === true;
    } catch (err) {
      return false;
    }
  }

  async saveResultCache(type: 'unit' | 'integration' | 'e2e', results: { passed: boolean; duration?: number; coverage?: number }): Promise<void> {
    if (!this.resultCacheEnabled) return;
    
    const cacheKey = await this.generateCacheKey(type);
    const cacheDir = path.join('.test-results', type);
    const cacheFile = path.join(cacheDir, 'cache.json');
    
    // Ensure directory exists
    await fs.mkdir(cacheDir, { recursive: true });
    
    const cacheData = {
      key: cacheKey,
      timestamp: Date.now(),
      results,
      version: this.testResultsCacheVersion
    };
    
    await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
  }

  async shouldSkipTests(type: 'unit' | 'integration' | 'e2e'): Promise<{ skip: boolean; reason?: string }> {
    if (!this.resultCacheEnabled) {
      return { skip: false, reason: 'Result caching disabled' };
    }
    
    const hasValidCache = await this.checkResultCache(type);
    
    if (hasValidCache) {
      return { skip: true, reason: 'Valid cached results found - tests haven\'t changed' };
    }
    
    return { skip: false, reason: 'No valid cache found or tests have changed' };
  }
}

// CLI Interface
async function main() {
  const manager = new CacheManager();
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  switch (command) {
    case 'status':
      await manager.checkCacheStatus();
      break;
      
    case 'invalidate':
      const type = args[0] as 'unit' | 'integration' | 'e2e' | undefined;
      if (type && !['unit', 'integration', 'e2e'].includes(type)) {
        console.error('Invalid cache type. Use: unit, integration, or e2e');
        process.exit(1);
      }
      await manager.invalidateCache(type);
      break;
      
    case 'monitor':
      await manager.monitorCachePerformance();
      break;
      
    case 'setup':
      await manager.setupGitHubActionsCache();
      break;
      
    case 'check':
      const checkType = args[0] as 'unit' | 'integration' | 'e2e';
      if (!checkType || !['unit', 'integration', 'e2e'].includes(checkType)) {
        console.error('Specify test type: unit, integration, or e2e');
        process.exit(1);
      }
      const skipInfo = await manager.shouldSkipTests(checkType);
      console.log(`Should skip ${checkType} tests: ${skipInfo.skip}`);
      if (skipInfo.reason) console.log(`Reason: ${skipInfo.reason}`);
      break;
      
    default:
      console.log('Cache Management Tool');
      console.log('\nUsage:');
      console.log('  npm run cache status              - Check cache status');
      console.log('  npm run cache invalidate          - Clear all caches');
      console.log('  npm run cache invalidate <type>   - Clear specific cache (unit/integration/e2e)');
      console.log('  npm run cache monitor             - View performance metrics');
      console.log('  npm run cache setup               - Show GitHub Actions setup');
      console.log('  npm run cache check <type>        - Check if tests can be skipped due to cache');
  }
}

// Execute if this is the main module
main().catch(console.error);