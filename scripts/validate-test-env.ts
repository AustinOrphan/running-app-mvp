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
  // eslint-disable-next-line no-console
  console.log('🔍 Validating test environment...\n');

  try {
    await validateTestEnvironment();
    // eslint-disable-next-line no-console
    console.log('\n✨ Test environment validation completed successfully!');
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('\n💥 Test environment validation failed!');
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// eslint-disable-next-line no-console
main().catch(console.error);
