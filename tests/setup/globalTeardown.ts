#!/usr/bin/env tsx

/**
 * Global Jest teardown for integration tests
 * Ensures proper cleanup after all tests complete
 */

import { CIIntegrationDBManager } from '../../scripts/ci-integration-db-setup.js';

export default async function globalTeardown() {
  console.log('🧹 Running global teardown for integration tests...');

  try {
    const manager = new CIIntegrationDBManager({ verbose: false });
    await manager.teardownForCI();
    console.log('✅ Global teardown completed successfully');
  } catch (error) {
    console.error('❌ Global teardown failed:', error);
    // Don't fail the test run if teardown fails
  }
}
