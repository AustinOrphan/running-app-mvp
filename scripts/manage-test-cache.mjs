#!/usr/bin/env node

/**
 * Jest Cache Management Script
 * 
 * Provides utilities for managing Jest test cache to improve performance:
 * - Clear cache when needed
 * - Show cache statistics
 * - Optimize cache configuration
 */

import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const CACHE_DIRS = [
  join(projectRoot, 'node_modules/.cache/jest'),
  join(projectRoot, 'node_modules/.cache/jest-ci'),
  join(projectRoot, '.jest-cache'),
];

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getCacheSize(dir) {
  if (!existsSync(dir)) return 0;
  
  let totalSize = 0;
  const files = readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const filePath = join(dir, file.name);
    if (file.isDirectory()) {
      totalSize += getCacheSize(filePath);
    } else {
      totalSize += statSync(filePath).size;
    }
  }
  
  return totalSize;
}

function showCacheStats() {
  console.log('\n🔍 Jest Cache Statistics:');
  console.log('==========================');
  
  let totalSize = 0;
  
  for (const cacheDir of CACHE_DIRS) {
    const size = getCacheSize(cacheDir);
    totalSize += size;
    
    const exists = existsSync(cacheDir);
    const status = exists ? `${formatBytes(size)}` : 'Not found';
    
    console.log(`📁 ${cacheDir.replace(projectRoot, '.')}: ${status}`);
  }
  
  console.log(`\n📊 Total cache size: ${formatBytes(totalSize)}`);
  
  if (totalSize > 100 * 1024 * 1024) { // > 100MB
    console.log('⚠️  Cache size is large. Consider running "npm run test:cache:clear" if tests are behaving unexpectedly.');
  } else if (totalSize > 0) {
    console.log('✅ Cache size is reasonable. Jest caching is active and should improve test performance.');
  } else {
    console.log('ℹ️  No cache found. Cache will be created on first test run.');
  }
}

function clearCache() {
  console.log('\n🧹 Clearing Jest cache...');
  
  try {
    // Use Jest's built-in cache clearing
    execSync('npx jest --clearCache', { cwd: projectRoot, stdio: 'inherit' });
    console.log('✅ Jest cache cleared successfully');
  } catch (error) {
    console.error('❌ Error clearing Jest cache:', error.message);
    process.exit(1);
  }
}

function warmupCache() {
  console.log('\n🔥 Warming up Jest cache...');
  console.log('This will run a subset of tests to populate the cache.');
  
  try {
    // Run a quick test to populate cache
    execSync('npm run test:integration -- --testPathPattern="auth" --passWithNoTests', { 
      cwd: projectRoot, 
      stdio: 'inherit' 
    });
    console.log('✅ Cache warmed up successfully');
  } catch (error) {
    console.log('⚠️  Cache warmup completed with some issues (this is normal)');
  }
}

function optimizeCache() {
  console.log('\n⚡ Optimizing Jest cache configuration...');
  
  // Check if cache directories exist and create them if needed
  for (const cacheDir of CACHE_DIRS) {
    if (!existsSync(cacheDir)) {
      console.log(`📁 Creating cache directory: ${cacheDir.replace(projectRoot, '.')}`);
      try {
        execSync(`mkdir -p "${cacheDir}"`, { cwd: projectRoot });
      } catch (error) {
        console.log(`⚠️  Could not create ${cacheDir}: ${error.message}`);
      }
    }
  }
  
  console.log('✅ Cache optimization complete');
}

function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'stats':
    case 'status':
      showCacheStats();
      break;
      
    case 'clear':
      clearCache();
      break;
      
    case 'warmup':
      warmupCache();
      break;
      
    case 'optimize':
      optimizeCache();
      break;
      
    case 'help':
    default:
      console.log(`
🧪 Jest Cache Management

Usage: node scripts/manage-test-cache.mjs [command]

Commands:
  stats     Show cache statistics and size
  clear     Clear all Jest cache
  warmup    Warm up cache by running sample tests
  optimize  Optimize cache directory structure
  help      Show this help message

Examples:
  npm run test:cache:stats    # Show cache info
  npm run test:cache:clear    # Clear cache
  npm run test:cache:warmup   # Warm up cache
`);
      break;
  }
}

main();