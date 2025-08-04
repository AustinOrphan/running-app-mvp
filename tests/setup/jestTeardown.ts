/**
 * Jest Global Teardown for Integration Tests
 * Ensures proper cleanup of database connections and resources
 */

import { forceCleanupAllConnections } from '../utils/connectionPoolManager';

export default async function globalTeardown(): Promise<void> {
  console.log('🧹 Running global test teardown...');

  try {
    // Force cleanup all database connections to prevent leaks
    await forceCleanupAllConnections();
    console.log('✅ Database connections cleaned up successfully');
  } catch (error) {
    console.error('⚠️ Error during global teardown:', error);
    // Don't throw to avoid masking test results
  }

  // Give a moment for any remaining async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('✅ Global teardown completed');
}
