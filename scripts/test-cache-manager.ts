#!/usr/bin/env tsx

/**
 * Test Cache Manager
 * 
 * A CLI utility to manage test caching across Jest, Vitest, and Playwright.
 * Integrates with the existing cache management system.
 */

import { runCacheCommand } from '../tests/utils/testCaching.js';

async function main() {
  const command = process.argv[2] || 'stats';
  
  try {
    await runCacheCommand(command);
  } catch (error) {
    console.error('Cache management failed:', error);
    process.exit(1);
  }
}

main();