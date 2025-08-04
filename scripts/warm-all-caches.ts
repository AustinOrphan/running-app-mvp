#!/usr/bin/env tsx
/**
 * Warm All Caches Script
 * Pre-populates Jest, Vitest, and Playwright caches for optimal performance
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const CACHE_DIRS = [
  '.jest-cache',
  'node_modules/.cache/vitest',
  '.vitest-cache',
  'test-results',
  'playwright-results',
  '.test-results/unit',
  '.test-results/integration',
  '.test-results/e2e',
];

function ensureCacheDirectories() {
  console.log('📁 Ensuring cache directories exist...\n');
  
  CACHE_DIRS.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`✅ Created ${dir}`);
    } else {
      console.log(`✓ Found ${dir}`);
    }
  });
  
  console.log('');
}

function warmJestCache() {
  console.log('🔥 Warming Jest cache...');
  
  try {
    // List tests to populate Jest's module cache
    execSync('NODE_OPTIONS=--experimental-vm-modules npx jest --listTests --config jest.config.js', { 
      stdio: 'pipe',
      cwd: process.cwd() 
    });
    
    console.log('✅ Jest cache warmed');
  } catch (error) {
    console.warn('⚠️  Could not warm Jest cache (this is often normal)');
  }
}

function warmVitestCache() {
  console.log('🔥 Warming Vitest cache...');
  
  try {
    // Run a quick test pass to populate Vitest cache
    execSync('npx vitest run --reporter=silent --passWithNoTests', { 
      stdio: 'pipe',
      cwd: process.cwd()
    });
    
    console.log('✅ Vitest cache warmed');
  } catch (error) {
    console.warn('⚠️  Could not warm Vitest cache (this is often normal)');
  }
}

function warmPlaywrightCache() {
  console.log('🔥 Warming Playwright cache...');
  
  try {
    // Install browsers if not already cached
    execSync('npx playwright install --with-deps chromium firefox', { 
      stdio: 'pipe',
      cwd: process.cwd()
    });
    
    console.log('✅ Playwright browsers cached');
  } catch (error) {
    console.warn('⚠️  Could not cache Playwright browsers:', error);
  }
}

function warmNodeModulesCache() {
  console.log('🔥 Warming Node modules cache...');
  
  try {
    // Ensure node_modules/.cache exists and is writable
    const cacheDir = join('node_modules', '.cache');
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    
    // Pre-compile TypeScript files to warm TS cache
    execSync('npx tsc --noEmit --skipLibCheck', { 
      stdio: 'pipe',
      cwd: process.cwd()
    });
    
    console.log('✅ TypeScript cache warmed');
  } catch (error) {
    console.warn('⚠️  Could not warm TypeScript cache');
  }
}

function generateCacheSummary() {
  console.log('\n📊 Cache Summary:');
  console.log('┌─────────────────────────┬─────────────┐');
  console.log('│ Cache Type              │ Status      │');
  console.log('├─────────────────────────┼─────────────┤');
  
  const cacheStatuses = [
    { name: 'Jest Cache', dir: '.jest-cache' },
    { name: 'Vitest Cache', dir: 'node_modules/.cache/vitest' },
    { name: 'Playwright Results', dir: 'playwright-results' },
    { name: 'Test Results', dir: 'test-results' },
  ];
  
  cacheStatuses.forEach(({ name, dir }) => {
    const status = existsSync(dir) ? '✅ Ready' : '❌ Missing';
    console.log(`│ ${name.padEnd(23)} │ ${status.padEnd(11)} │`);
  });
  
  console.log('└─────────────────────────┴─────────────┘');
}

function main() {
  const startTime = Date.now();
  
  console.log('🚀 Warming all test caches...\n');
  
  try {
    ensureCacheDirectories();
    warmNodeModulesCache();
    warmJestCache();
    warmVitestCache();
    warmPlaywrightCache();
    generateCacheSummary();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 Cache warming completed in ${duration}s!`);
    console.log('\n💡 Tips:');
    console.log('  - Run this script before CI builds for better performance');
    console.log('  - Cache warming is most effective on clean environments');
    console.log('  - Use "npm run cache:status" to check cache health');
    
  } catch (error) {
    console.error('❌ Cache warming failed:', error);
    process.exit(1);
  }
}

// Execute if this is the main module
main();

export { ensureCacheDirectories, warmJestCache, warmVitestCache, warmPlaywrightCache };