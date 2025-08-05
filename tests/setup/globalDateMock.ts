/**
 * Global Date Mock Setup for Tests
 *
 * This module provides consistent date/time mocking across all test suites
 * to prevent timezone-sensitive test failures.
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Fixed date for consistent testing (July 26, 2024, 12:00:00 UTC)
export const MOCK_DATE = new Date('2024-07-26T12:00:00.000Z');
export const MOCK_TIMESTAMP = MOCK_DATE.getTime();

// Store original Date constructor and methods
const OriginalDate = global.Date;
const originalDateNow = Date.now;
const originalDateParse = Date.parse;

/**
 * Mock implementation of Date constructor
 */
export class MockDate extends Date {
  constructor();
  constructor(value: number | string);
  constructor(
    year: number,
    monthIndex: number,
    date?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    ms?: number
  );
  constructor(...args: any[]) {
    if (args.length === 0) {
      super(MOCK_TIMESTAMP);
    } else if (args.length === 1) {
      super(args[0]);
    } else {
      // @ts-expect-error TypeScript cannot properly type-check spread arguments in constructor calls
      // The Date constructor accepts multiple overloads but spread syntax confuses the type checker
      super(...args);
    }
  }

  static now(): number {
    return MOCK_TIMESTAMP;
  }

  static parse(dateString: string): number {
    return originalDateParse.call(Date, dateString);
  }

  static UTC(
    year: number,
    monthIndex?: number,
    date?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    ms?: number
  ): number {
    return OriginalDate.UTC(
      year,
      monthIndex ?? 0,
      date ?? 1,
      hours ?? 0,
      minutes ?? 0,
      seconds ?? 0,
      ms ?? 0
    );
  }
}

// Copy over other static properties
Object.setPrototypeOf(MockDate, OriginalDate);
Object.setPrototypeOf(MockDate.prototype, OriginalDate.prototype);

/**
 * Enable global date mocking
 */
export function enableDateMocking(): void {
  // Mock Date constructor
  global.Date = MockDate as any;

  // Mock Date.now()
  Date.now = vi.fn(() => MOCK_TIMESTAMP);

  // Mock performance.now() for consistent timing
  if (typeof performance !== 'undefined') {
    vi.spyOn(performance, 'now').mockReturnValue(MOCK_TIMESTAMP);
  }
}

/**
 * Disable global date mocking and restore original Date
 */
export function disableDateMocking(): void {
  // Restore original Date constructor
  global.Date = OriginalDate;

  // Restore Date.now
  Date.now = originalDateNow;

  // Restore performance.now
  if (typeof performance !== 'undefined' && vi.isMockFunction(performance.now)) {
    vi.mocked(performance.now).mockRestore();
  }
}

/**
 * Temporarily set a different mock date
 * @param date - The date to mock (Date object or ISO string)
 * @returns Cleanup function to restore previous mock date
 */
export function withMockDate(date: Date | string): () => void {
  const newMockDate = typeof date === 'string' ? new Date(date) : date;
  const newMockTimestamp = newMockDate.getTime();

  const previousNowMock = Date.now;

  // Update Date.now mock
  Date.now = vi.fn(() => newMockTimestamp);

  // Create temporary Date class with new mock date
  class TempMockDate extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(newMockTimestamp);
      } else if (args.length === 1) {
        super(args[0]);
      } else {
        // @ts-expect-error TypeScript cannot infer correct overload for Date constructor with spread arguments
        // This is safe as we're passing the same arguments that Date constructor expects
        super(...args);
      }
    }

    static now(): number {
      return newMockTimestamp;
    }
  }

  // Copy prototype and static methods
  Object.setPrototypeOf(TempMockDate, OriginalDate);
  Object.setPrototypeOf(TempMockDate.prototype, OriginalDate.prototype);

  global.Date = TempMockDate as any;

  // Return cleanup function
  return () => {
    global.Date = MockDate as any;
    Date.now = previousNowMock;
  };
}

/**
 * Format date helpers that work with mocked dates
 */
export const formatters = {
  /**
   * Format date as YYYY-MM-DD for HTML date inputs
   */
  toDateInput(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Format date as ISO string
   */
  toISO(date: Date = new Date()): string {
    return date.toISOString();
  },

  /**
   * Get timestamp
   */
  toTimestamp(date: Date = new Date()): number {
    return date.getTime();
  },
};

/**
 * Common test date values relative to mock date
 */
export const MOCK_DATES = {
  // Current mock date
  NOW: new Date(MOCK_TIMESTAMP),
  NOW_STRING: formatters.toDateInput(new Date(MOCK_TIMESTAMP)),
  NOW_ISO: new Date(MOCK_TIMESTAMP).toISOString(),

  // Past dates
  YESTERDAY: new Date(MOCK_TIMESTAMP - 24 * 60 * 60 * 1000),
  LAST_WEEK: new Date(MOCK_TIMESTAMP - 7 * 24 * 60 * 60 * 1000),
  LAST_MONTH: new Date(MOCK_TIMESTAMP - 30 * 24 * 60 * 60 * 1000),

  // Future dates
  TOMORROW: new Date(MOCK_TIMESTAMP + 24 * 60 * 60 * 1000),
  NEXT_WEEK: new Date(MOCK_TIMESTAMP + 7 * 24 * 60 * 60 * 1000),
  NEXT_MONTH: new Date(MOCK_TIMESTAMP + 30 * 24 * 60 * 60 * 1000),

  // Formatted strings for inputs
  YESTERDAY_STRING: formatters.toDateInput(new Date(MOCK_TIMESTAMP - 24 * 60 * 60 * 1000)),
  TOMORROW_STRING: formatters.toDateInput(new Date(MOCK_TIMESTAMP + 24 * 60 * 60 * 1000)),
  NEXT_WEEK_STRING: formatters.toDateInput(new Date(MOCK_TIMESTAMP + 7 * 24 * 60 * 60 * 1000)),
};

/**
 * Setup hooks for automatic date mocking in tests
 */
export function setupDateMocking(): void {
  beforeEach(() => {
    enableDateMocking();
  });

  afterEach(() => {
    disableDateMocking();
  });
}
