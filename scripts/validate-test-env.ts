#!/usr/bin/env tsx

/**
 * Test Environment Validation CLI
 * Run this script to validate your test environment setup
 *
 * Usage:
 *   npm run validate-test-env
 *   npx tsx scripts/validate-test-env.ts
 */

/* eslint-disable no-console */

import { validateTestEnvironment } from '../tests/setup/validateTestEnvironment';

/**
 * Logs test environment validation errors
 */
function logTestEnvError(message: string, error: string): void {
  console.error(message);
  console.error(error);
}

async function main() {
  console.log('🔍 Validating test environment...\n');

  try {
    await validateTestEnvironment();
    console.log('\n✨ Test environment validation completed successfully!');
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const validationFailedMessage = '\n💥 Test environment validation failed!';
    logTestEnvError(validationFailedMessage, errorMessage);
    process.exit(1);
  }
}
main().catch(console.error);
