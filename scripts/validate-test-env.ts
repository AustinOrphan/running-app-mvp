#!/usr/bin/env tsx

/**
 * Test Environment Validation CLI
 * Run this script to validate your test environment setup
 * 
 * Usage:
 *   npm run validate-test-env
 *   npx tsx scripts/validate-test-env.ts
 */

import { validateTestEnvironment } from '../tests/setup/validateTestEnvironment';

async function main() {
  console.log('🔍 Validating test environment...\n');
  
  try {
    await validateTestEnvironment();
    console.log('\n✨ Test environment validation completed successfully!');
  } catch (error) {
    console.error('\n💥 Test environment validation failed!');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

main().catch(console.error);