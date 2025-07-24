/**
 * Temporary Winston Stub - Fix for missing winston dependency
 *
 * This is a minimal stub implementation to unblock tests while
 * the winston dependency installation is resolved.
 *
 * TODO: Remove this file once winston is properly installed
 */

// Mock winston interface to match expected API
export const winston = {
  format: {
    combine: () => ({}),
    timestamp: () => ({}),
    errors: () => ({}),
    json: () => ({}),
    printf: () => ({}),
    colorize: () => ({}), // Added missing colorize function
  },
  transports: {
    Console: class MockConsole {
      constructor(_options?: unknown) {} // Better type safety with unknown
    },
    File: class MockFile {
      constructor(_options?: unknown) {} // Better type safety with unknown
    },
  },
  createLogger: (_options?: unknown) => ({
    // Better type safety with unknown
    // eslint-disable-next-line no-console
    info: (message: string, meta?: unknown) => console.log('INFO:', message, meta),
    // eslint-disable-next-line no-console
    error: (message: string, meta?: unknown) => console.error('ERROR:', message, meta),
    // eslint-disable-next-line no-console
    warn: (message: string, meta?: unknown) => console.warn('WARN:', message, meta),
    // eslint-disable-next-line no-console
    debug: (message: string, meta?: unknown) => console.log('DEBUG:', message, meta),
  }),
  Logform: {} as any, // Mock Logform property for tests
};

export default winston;

// Export Logform type for tests
export type Logform = any;
