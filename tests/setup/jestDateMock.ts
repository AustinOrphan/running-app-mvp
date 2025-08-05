/**
 * Jest Date Mock Setup for Integration Tests
 *
 * This module provides the same date mocking functionality for Jest tests
 * to ensure consistency between Vitest and Jest test suites.
 */

// Fixed date for consistent testing (July 26, 2024, 12:00:00 UTC)
export const MOCK_DATE = new Date('2024-07-26T12:00:00.000Z');
export const MOCK_TIMESTAMP = MOCK_DATE.getTime();

// Store original Date constructor and methods
const OriginalDate = global.Date;
const originalDateNow = Date.now;

/**
 * Enable global date mocking for Jest
 */
export function enableJestDateMocking(): void {
  // Mock Date constructor
  global.Date = class extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(MOCK_TIMESTAMP);
      } else if (args.length === 1) {
        super(args[0]);
      } else {
        // @ts-expect-error TypeScript cannot infer correct overload for Date constructor with spread arguments
        // This is safe as we're passing the same arguments that Date constructor expects
        super(...args);
      }
    }

    static now(): number {
      return MOCK_TIMESTAMP;
    }

    static parse(dateString: string): number {
      return OriginalDate.parse(dateString);
    }

    static UTC(...args: any[]): number {
      return OriginalDate.UTC(...args);
    }
  } as any;

  // Copy prototype
  Object.setPrototypeOf(global.Date, OriginalDate);
  Object.setPrototypeOf(global.Date.prototype, OriginalDate.prototype);
}

/**
 * Disable global date mocking and restore original Date
 */
export function disableJestDateMocking(): void {
  global.Date = OriginalDate;
  Date.now = originalDateNow;
}

/**
 * Setup hooks for automatic date mocking in Jest tests
 */
export function setupJestDateMocking(): void {
  beforeEach(() => {
    enableJestDateMocking();
  });

  afterEach(() => {
    disableJestDateMocking();
  });
}

// Auto-setup if this is imported in a test environment
if (typeof beforeEach !== 'undefined' && typeof afterEach !== 'undefined') {
  setupJestDateMocking();
}
