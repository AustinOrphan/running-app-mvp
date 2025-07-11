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
      constructor(_options?: unknown) {} // Prefix unused parameter with underscore
    },
    File: class MockFile {
      constructor(_options?: unknown) {} // Prefix unused parameter with underscore
    },
  },
  createLogger: (_options?: unknown) => ({
    // Prefix unused parameter with underscore
    // eslint-disable-next-line no-console
    info: (message: string, meta?: unknown) => console.log('INFO:', message, meta),
    // eslint-disable-next-line no-console
    error: (message: string, meta?: unknown) => console.error('ERROR:', message, meta),
    // eslint-disable-next-line no-console
    warn: (message: string, meta?: unknown) => console.warn('WARN:', message, meta),
    // eslint-disable-next-line no-console
    debug: (message: string, meta?: unknown) => console.log('DEBUG:', message, meta),
  }),
  Logform: undefined as any, // Added missing Logform property
};

export default winston;
