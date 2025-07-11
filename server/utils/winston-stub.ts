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
    printf: () => ({})
  },
  transports: {
    Console: class MockConsole {
      constructor(options?: any) {}
    },
    File: class MockFile {
      constructor(options?: any) {}
    }
  },
  createLogger: (options?: any) => ({
    info: (message: string, meta?: any) => console.log('INFO:', message, meta),
    error: (message: string, meta?: any) => console.error('ERROR:', message, meta),
    warn: (message: string, meta?: any) => console.warn('WARN:', message, meta),
    debug: (message: string, meta?: any) => console.log('DEBUG:', message, meta),
  })
};

export default winston;