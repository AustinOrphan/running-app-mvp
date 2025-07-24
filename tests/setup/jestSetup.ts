import { jest } from '@jest/globals';
import { testDb } from '../integration/utils/testDbSetup.js';

// Make Jest globals available
(global as any).jest = jest;

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.LOG_SALT = process.env.LOG_SALT || 'test-log-salt';
process.env.AUDIT_ENCRYPTION_KEY = process.env.AUDIT_ENCRYPTION_KEY || 'test-audit-key';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '10'; // Lower for faster tests

// Initialize test database once before all tests
beforeAll(async () => {
  try {
    await testDb.initialize();
  } catch (error) {
    console.error('Failed to initialize test database:', error);
    throw error;
  }
}, 30000); // 30 second timeout

// Clean database before each test
beforeEach(async () => {
  await testDb.clean();
});

// Disconnect after all tests
afterAll(async () => {
  await testDb.clean();
  await testDb.disconnect();
});

// Export for use in tests
export { testDb };
