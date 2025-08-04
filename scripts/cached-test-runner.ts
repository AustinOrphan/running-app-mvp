#!/usr/bin/env tsx

/**
 * Cached Test Runner
 * 
 * This script wraps the normal test runners with intelligent caching
 * to skip tests when nothing has changed, improving CI performance.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

interface TestRunResult {
  passed: boolean;
  duration: number;
  coverage?: number;
  skipped?: boolean;
  reason?: string;
}

class CachedTestRunner {
  private async runCacheManager(command: string): Promise<{ skip: boolean; reason?: string }> {
    try {
      const { stdout } = await execAsync(`tsx scripts/cache-management.ts ${command}`);
      const lines = stdout.trim().split('\n');
      const skipLine = lines.find(line => line.includes('Should skip'));
      const reasonLine = lines.find(line => line.includes('Reason:'));
      
      if (skipLine?.includes('true')) {
        return { 
          skip: true, 
          reason: reasonLine?.replace('Reason: ', '') || 'Cache hit' 
        };
      }
      
      return { skip: false, reason: reasonLine?.replace('Reason: ', '') };
    } catch (err) {
      console.warn('Cache check failed:', err);
      return { skip: false, reason: 'Cache check failed' };
    }
  }

  private async saveTestResults(type: 'unit' | 'integration' | 'e2e', result: TestRunResult): Promise<void> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      // Import and use CacheManager directly
      const { default: cacheScript } = await import('./cache-management');
      // For now, just log - we'd need to refactor to properly save results
      console.log(`📊 Test result: ${JSON.stringify(result)}`);
    } catch (err) {
      console.warn('Failed to save test results:', err);
    }
  }

  async runUnitTests(): Promise<TestRunResult> {
    console.log('🧪 Checking unit test cache...');
    const cacheCheck = await this.runCacheManager('check unit');
    
    if (cacheCheck.skip) {
      console.log(`⚡ Skipping unit tests: ${cacheCheck.reason}`);
      return { passed: true, duration: 0, skipped: true, reason: cacheCheck.reason };
    }

    console.log('🧪 Running unit tests...');
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execAsync('npm run test:coverage:unit:ci');
      const duration = (Date.now() - startTime) / 1000;
      
      // Parse coverage from output if available
      const coverageMatch = stdout.match(/All files\s+\|\s+([\d.]+)/);
      const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : undefined;
      
      const result = { passed: true, duration, coverage };
      await this.saveTestResults('unit', result);
      
      console.log(`✅ Unit tests passed in ${duration}s`);
      if (coverage) console.log(`📊 Coverage: ${coverage}%`);
      
      return result;
    } catch (err) {
      const duration = (Date.now() - startTime) / 1000;
      const result = { passed: false, duration };
      await this.saveTestResults('unit', result);
      
      console.error(`❌ Unit tests failed after ${duration}s`);
      throw err;
    }
  }

  async runIntegrationTests(): Promise<TestRunResult> {
    console.log('🔧 Checking integration test cache...');
    const cacheCheck = await this.runCacheManager('check integration');
    
    if (cacheCheck.skip) {
      console.log(`⚡ Skipping integration tests: ${cacheCheck.reason}`);
      return { passed: true, duration: 0, skipped: true, reason: cacheCheck.reason };
    }

    console.log('🔧 Running integration tests...');
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('npm run test:coverage:integration:ci');
      const duration = (Date.now() - startTime) / 1000;
      
      const result = { passed: true, duration };
      await this.saveTestResults('integration', result);
      
      console.log(`✅ Integration tests passed in ${duration}s`);
      return result;
    } catch (err) {
      const duration = (Date.now() - startTime) / 1000;
      const result = { passed: false, duration };
      await this.saveTestResults('integration', result);
      
      console.error(`❌ Integration tests failed after ${duration}s`);
      throw err;
    }
  }

  async runE2ETests(): Promise<TestRunResult> {
    console.log('🎭 Checking E2E test cache...');
    const cacheCheck = await this.runCacheManager('check e2e');
    
    if (cacheCheck.skip) {
      console.log(`⚡ Skipping E2E tests: ${cacheCheck.reason}`);
      return { passed: true, duration: 0, skipped: true, reason: cacheCheck.reason };
    }

    console.log('🎭 Running E2E tests...');
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('npm run test:e2e:ci');
      const duration = (Date.now() - startTime) / 1000;
      
      const result = { passed: true, duration };
      await this.saveTestResults('e2e', result);
      
      console.log(`✅ E2E tests passed in ${duration}s`);
      return result;
    } catch (err) {
      const duration = (Date.now() - startTime) / 1000;
      const result = { passed: false, duration };
      await this.saveTestResults('e2e', result);
      
      console.error(`❌ E2E tests failed after ${duration}s`);
      throw err;
    }
  }

  async runAllTests(): Promise<TestRunResult[]> {
    const results: TestRunResult[] = [];
    
    console.log('🚀 Running cached test suite...\n');
    const totalStartTime = Date.now();
    
    try {
      // Run tests in sequence to avoid resource conflicts
      results.push(await this.runUnitTests());
      results.push(await this.runIntegrationTests());
      results.push(await this.runE2ETests());
      
      const totalDuration = (Date.now() - totalStartTime) / 1000;
      const skippedCount = results.filter(r => r.skipped).length;
      const passedCount = results.filter(r => r.passed).length;
      
      console.log('\n📊 Test Summary:');
      console.log(`Total time: ${totalDuration}s`);
      console.log(`Tests passed: ${passedCount}/${results.length}`);
      console.log(`Tests skipped (cached): ${skippedCount}/${results.length}`);
      
      if (skippedCount > 0) {
        const timeSaved = results
          .filter(r => r.skipped)
          .reduce((sum, r) => sum + (r.duration || 30), 0); // Estimate 30s per skipped suite
        console.log(`⚡ Estimated time saved: ${timeSaved}s`);
      }
      
      return results;
    } catch (err) {
      console.error('\n❌ Test suite failed');
      throw err;
    }
  }
}

// CLI Interface
async function main() {
  const runner = new CachedTestRunner();
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'unit':
        await runner.runUnitTests();
        break;
        
      case 'integration':
        await runner.runIntegrationTests();
        break;
        
      case 'e2e':
        await runner.runE2ETests();
        break;
        
      case 'all':
      default:
        await runner.runAllTests();
        break;
    }
    
    console.log('\n🎉 All tests completed successfully!');
  } catch (err) {
    console.error('\n💥 Test execution failed:', err);
    process.exit(1);
  }
}

// Execute if this is the main module
if (require.main === module) {
  main().catch(console.error);
}

export default CachedTestRunner;